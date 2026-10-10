const express = require('express');
const config = require('../config');
const { q, uno } = require('../db');
const A = require('../accesso');
const paypal = require('../paypal');

const r = express.Router();

// Limite tentativi di accesso (in memoria, per IP)
const tentativi = new Map();
function limita(req, res, next) {
  const k = req.ip;
  const ora = Date.now();
  const t = (tentativi.get(k) || []).filter((x) => ora - x < 15 * 60_000);
  if (t.length >= 20) return res.status(429).json({ errore: 'Troppi tentativi. Riprova tra qualche minuto.' });
  t.push(ora);
  tentativi.set(k, t);
  next();
}

const emailValida = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const pubblico = (u) => u && ({ id: u.id, email: u.email, nome: u.nome, admin: u.is_admin });

// ---------------- Configurazione per il frontend ----------------
r.get('/config', (req, res) => {
  res.json({
    nome: config.nome,
    prezzo: config.prezzo,
    paypal: {
      clientId: config.paypal.clientId,
      pianoId: config.paypal.pianoId,
      simulato: config.paypal.simulato,
      configurato: config.paypal.simulato || Boolean(config.paypal.clientId && config.paypal.pianoId),
    },
    ditta: config.ditta,
  });
});

// ---------------- Account ----------------
r.post('/registrati', limita, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const nome = String(req.body.nome || '').trim().slice(0, 60);
  const password = String(req.body.password || '');
  if (!emailValida(email)) return res.status(400).json({ errore: 'Email non valida.' });
  if (password.length < 8) return res.status(400).json({ errore: 'La password deve avere almeno 8 caratteri.' });
  if (!req.body.accetto) return res.status(400).json({ errore: 'Devi accettare termini e privacy.' });
  if (await uno('SELECT 1 FROM utenti WHERE email=$1', [email])) {
    return res.status(409).json({ errore: 'Esiste già un account con questa email.' });
  }
  const admin = Boolean(config.adminEmail) && email === config.adminEmail;
  const u = await uno(
    'INSERT INTO utenti (email, nome, password_hash, is_admin) VALUES ($1,$2,$3,$4) RETURNING *',
    [email, nome, await A.hash(password), admin],
  );
  A.impostaSessione(res, u);
  res.json({ utente: pubblico(u) });
});

r.post('/accedi', limita, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = await uno('SELECT * FROM utenti WHERE email=$1', [email]);
  if (!u || !(await A.confronta(String(req.body.password || ''), u.password_hash))) {
    return res.status(401).json({ errore: 'Email o password errate.' });
  }
  if (config.adminEmail && email === config.adminEmail && !u.is_admin) {
    await q('UPDATE utenti SET is_admin=TRUE WHERE id=$1', [u.id]);
    u.is_admin = true;
  }
  A.impostaSessione(res, u);
  res.json({ utente: pubblico(u) });
});

r.post('/esci', (req, res) => { A.chiudiSessione(res); res.json({ ok: true }); });

r.get('/io', async (req, res) => {
  if (!req.utente) return res.json({ utente: null, accesso: { accesso: false, motivo: 'anonimo' } });
  const s = await A.statoAccesso(req.utente);
  res.json({
    utente: pubblico(req.utente),
    accesso: {
      accesso: s.accesso, motivo: s.motivo, fino: s.fino || null,
      abbonamento: s.abbonamento ? { stato: s.abbonamento.stato, valido_fino: s.abbonamento.valido_fino, id: s.abbonamento.paypal_id } : null,
    },
  });
});

r.post('/cambia-password', A.richiediLogin, async (req, res) => {
  const u = await uno('SELECT * FROM utenti WHERE id=$1', [req.utente.id]);
  if (!(await A.confronta(String(req.body.attuale || ''), u.password_hash))) {
    return res.status(400).json({ errore: 'La password attuale non è corretta.' });
  }
  const nuova = String(req.body.nuova || '');
  if (nuova.length < 8) return res.status(400).json({ errore: 'La nuova password deve avere almeno 8 caratteri.' });
  await q('UPDATE utenti SET password_hash=$1 WHERE id=$2', [await A.hash(nuova), u.id]);
  res.json({ ok: true });
});

// ---------------- Catalogo ----------------
const CAMPI = `g.id, g.slug, g.titolo, g.categoria, g.sottotitolo, g.descrizione, g.comandi, g.autore,
  g.gratuito, g.in_evidenza, g.partite, g.pubblicato, g.versione, g.file_avvio, g.creato_il, g.aggiornato_il, (g.copertina IS NOT NULL) AS ha_copertina`;

r.get('/giochi', async (req, res) => {
  const tutti = req.utente && req.utente.is_admin && req.query.tutti === '1';
  const righe = await q(`SELECT ${CAMPI},
      ${req.utente ? 'EXISTS(SELECT 1 FROM preferiti p WHERE p.gioco_id=g.id AND p.utente_id=$1)' : 'FALSE'} AS preferito
    FROM giochi g ${tutti ? '' : 'WHERE g.pubblicato'}
    ORDER BY g.in_evidenza DESC, g.creato_il DESC`, req.utente ? [req.utente.id] : []);
  res.json({ giochi: righe });
});

r.get('/giochi/:slug', async (req, res) => {
  const g = await uno(`SELECT ${CAMPI} FROM giochi g WHERE g.slug=$1`, [req.params.slug]);
  if (!g || (!g.pubblicato && !(req.utente && req.utente.is_admin))) return res.status(404).json({ errore: 'Gioco non trovato.' });
  const s = await A.statoAccesso(req.utente);
  res.json({ gioco: g, puoGiocare: g.gratuito || s.accesso, loggato: Boolean(req.utente) });
});

r.post('/giochi/:slug/preferito', A.richiediLogin, async (req, res) => {
  const g = await uno('SELECT id FROM giochi WHERE slug=$1', [req.params.slug]);
  if (!g) return res.status(404).json({ errore: 'Gioco non trovato.' });
  const c = await uno('DELETE FROM preferiti WHERE utente_id=$1 AND gioco_id=$2 RETURNING 1', [req.utente.id, g.id]);
  if (!c) await q('INSERT INTO preferiti VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.utente.id, g.id]);
  res.json({ preferito: !c });
});

// ---------------- Abbonamento ----------------

// Chiamato dal pulsante PayPal dopo l'approvazione dell'abbonamento.
r.post('/abbonamento/attiva', A.richiediLogin, async (req, res) => {
  const id = String(req.body.subscriptionID || '').trim();
  if (!/^I-[A-Z0-9]{6,}$/i.test(id)) return res.status(400).json({ errore: 'Identificativo abbonamento non valido.' });
  try {
    const esito = await A.sincronizzaAbbonamento(id, req.utente.id);
    const s = await A.statoAccesso(req.utente);
    res.json({ ok: true, stato: esito.stato, accesso: s.accesso });
  } catch (e) {
    console.error('Attivazione abbonamento:', e.message);
    if (e.status && e.status < 500 && e.status !== 404) return res.status(e.status).json({ errore: e.message });
    res.status(502).json({ errore: 'Non riesco a verificare l\'abbonamento con PayPal. Riprova tra un minuto; se hai già pagato non ti verrà addebitato due volte.' });
  }
});

// Solo modalità simulata: crea un finto abbonamento per provare il flusso senza PayPal.
r.post('/abbonamento/simula', A.richiediLogin, async (req, res) => {
  if (!config.paypal.simulato) return res.status(404).end();
  const id = `I-SIMULATO${req.utente.id}${Date.now().toString(36).toUpperCase()}`;
  paypal.simula(id, req.utente.id);
  await A.sincronizzaAbbonamento(id, req.utente.id);
  res.json({ ok: true, subscriptionID: id });
});

r.post('/abbonamento/disdici', A.richiediLogin, async (req, res) => {
  const a = await uno("SELECT * FROM abbonamenti WHERE utente_id=$1 AND stato='ACTIVE' ORDER BY creato_il DESC LIMIT 1", [req.utente.id]);
  if (!a) return res.status(404).json({ errore: 'Nessun abbonamento attivo da disdire.' });
  try {
    await paypal.disdiciAbbonamento(a.paypal_id);
    await A.sincronizzaAbbonamento(a.paypal_id, req.utente.id).catch(() =>
      q("UPDATE abbonamenti SET stato='CANCELLED', sincronizzato_il=NOW() WHERE id=$1", [a.id]));
    const agg = await uno('SELECT stato, valido_fino FROM abbonamenti WHERE id=$1', [a.id]);
    res.json({ ok: true, valido_fino: agg.valido_fino });
  } catch (e) {
    console.error('Disdetta:', e.message);
    res.status(502).json({ errore: 'PayPal non ha risposto. Puoi disdire anche dal tuo conto PayPal (Impostazioni → Pagamenti → Pagamenti automatici).' });
  }
});

// ---------------- Webhook PayPal ----------------
r.post('/paypal/webhook', async (req, res) => {
  const ev = req.body || {};
  try {
    // Firma verificata se PAYPAL_WEBHOOK_ID è impostato. In ogni caso i dati vengono
    // sempre riletti da PayPal: un messaggio falso non può concedere accessi.
    if (config.paypal.webhookId && !config.paypal.simulato) {
      const ok = await paypal.verificaWebhook(req.headers, ev);
      if (!ok) { console.warn('Webhook PayPal con firma non valida, ignorato.'); return res.status(400).end(); }
    }
    if (ev.id && await uno('SELECT 1 FROM eventi_paypal WHERE id=$1', [ev.id])) {
      return res.json({ ok: true, duplicato: true });
    }
    const risorsa = ev.resource || {};
    let idAbb = null;
    if (String(ev.event_type).startsWith('BILLING.SUBSCRIPTION')) idAbb = risorsa.id;
    else if (ev.event_type === 'PAYMENT.SALE.COMPLETED') idAbb = risorsa.billing_agreement_id;
    if (idAbb) {
      await A.sincronizzaAbbonamento(idAbb);
      console.log(`Webhook ${ev.event_type} → abbonamento ${idAbb} aggiornato`);
    }
    if (ev.id) await q('INSERT INTO eventi_paypal (id, tipo) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, ev.event_type || '']);
    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook PayPal:', e.message);
    if (e.status && e.status < 500) return res.json({ ok: false }); // errore permanente: inutile far riprovare
    res.status(500).end(); // PayPal riproverà
  }
});

module.exports = r;
