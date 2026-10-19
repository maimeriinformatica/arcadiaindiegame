const express = require('express');
const multer = require('multer');
const config = require('../config');
const { q, uno } = require('../db');
const A = require('../accesso');
const storage = require('../storage');
const { slugify, analizzaZip, importaVoci, CATEGORIE } = require('../giochi');

const r = express.Router();
r.use(A.richiediAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });
const bool = (v) => v === true || v === 'true' || v === '1' || v === 'on';

// Statistiche per la dashboard
r.get('/stato', async (req, res) => {
  const [n] = await q(`SELECT
      (SELECT COUNT(*) FROM utenti)::int AS utenti,
      (SELECT COUNT(*) FROM abbonamenti WHERE stato='ACTIVE')::int AS attivi,
      (SELECT COUNT(*) FROM abbonamenti WHERE stato='CANCELLED' AND valido_fino > NOW())::int AS in_scadenza,
      (SELECT COUNT(*) FROM giochi)::int AS giochi,
      (SELECT COUNT(*) FROM giochi WHERE pubblicato)::int AS pubblicati,
      (SELECT COALESCE(SUM(partite),0) FROM giochi)::int AS partite`);
  res.json({ ...n, prezzo: config.prezzo, categorie: CATEGORIE, paypal: { ambiente: config.paypal.ambiente, simulato: config.paypal.simulato } });
});

// ---------------- Giochi ----------------
function datiGioco(b) {
  return {
    titolo: String(b.titolo || '').trim().slice(0, 100),
    categoria: CATEGORIE.includes(b.categoria) ? b.categoria : 'Altro',
    sottotitolo: String(b.sottotitolo || '').trim().slice(0, 160),
    descrizione: String(b.descrizione || '').trim().slice(0, 5000),
    comandi: String(b.comandi || '').trim().slice(0, 1000),
    autore: String(b.autore || '').trim().slice(0, 100),
    file_avvio: String(b.file_avvio || 'index.html').trim() || 'index.html',
    pubblicato: bool(b.pubblicato), gratuito: bool(b.gratuito), in_evidenza: bool(b.in_evidenza),
  };
}

// I campi scritti nel modulo vincono; quelli lasciati vuoti si prendono da gioco.json dentro lo ZIP.
function unisci(body, meta) {
  const out = { ...body };
  for (const k of ['titolo', 'sottotitolo', 'descrizione', 'comandi', 'autore', 'categoria', 'file_avvio', 'slug']) {
    if ((out[k] == null || String(out[k]).trim() === '') && meta[k]) out[k] = meta[k];
  }
  for (const k of ['pubblicato', 'gratuito', 'in_evidenza']) {
    if (out[k] == null && meta[k] != null) out[k] = meta[k] ? '1' : '0';
  }
  return out;
}

async function salvaCopertinaZip(slug, cop) {
  if (!cop || !cop.tipo) return null;
  const chiave = `copertine/${slug}-${Date.now().toString(36)}.${cop.ext}`;
  await storage.salva(chiave, cop.dati);
  return chiave;
}

function analizza(pacchetto) {
  if (!pacchetto) return { meta: {}, copertina: null, voci: null };
  const an = analizzaZip(pacchetto.buffer);
  if (an.errScheda) throw Object.assign(new Error(an.errScheda), { status: 400 });
  return an;
}

async function salvaCopertina(slug, file) {
  if (!file) return null;
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype)) {
    throw Object.assign(new Error('La copertina deve essere un\'immagine (PNG, JPG, WEBP, GIF, SVG).'), { status: 400 });
  }
  const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const chiave = `copertine/${slug}-${Date.now().toString(36)}.${ext}`;
  await storage.salva(chiave, file.buffer);
  return chiave;
}

const campiUpload = upload.fields([{ name: 'pacchetto', maxCount: 1 }, { name: 'copertina', maxCount: 1 }]);

r.post('/giochi', campiUpload, async (req, res, next) => {
  try {
    const pacchetto = req.files && req.files.pacchetto && req.files.pacchetto[0];
    if (!pacchetto) return res.status(400).json({ errore: 'Carica lo ZIP del gioco.' });
    const an = analizza(pacchetto);
    const corpo = unisci(req.body, an.meta);
    const d = datiGioco(corpo);
    if (!d.titolo) return res.status(400).json({ errore: 'Manca il titolo: scrivilo nel modulo oppure mettilo in gioco.json dentro lo ZIP.' });
    let slug = slugify(corpo.slug || d.titolo);
    for (let i = 2; await uno('SELECT 1 FROM giochi WHERE slug=$1', [slug]); i++) slug = `${slugify(corpo.slug || d.titolo)}-${i}`;

    const nFile = await importaVoci(slug, 1, an.voci, d.file_avvio);
    const caricata = req.files.copertina && req.files.copertina[0];
    const copertina = caricata ? await salvaCopertina(slug, caricata) : await salvaCopertinaZip(slug, an.copertina);
    const g = await uno(`INSERT INTO giochi (slug, titolo, categoria, sottotitolo, descrizione, comandi, autore, file_avvio,
        copertina, pubblicato, gratuito, in_evidenza, versione) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1) RETURNING *`,
    [slug, d.titolo, d.categoria, d.sottotitolo, d.descrizione, d.comandi, d.autore, d.file_avvio, copertina,
      d.pubblicato, d.gratuito, d.in_evidenza]);
    res.json({ gioco: g, file: nFile, daScheda: an.haScheda, copertinaDaZip: !caricata && Boolean(copertina) });
  } catch (e) { next(e); }
});

r.put('/giochi/:id', campiUpload, async (req, res, next) => {
  try {
    const g = await uno('SELECT * FROM giochi WHERE id=$1', [req.params.id]);
    if (!g) return res.status(404).json({ errore: 'Gioco non trovato.' });
    const pacchetto = req.files && req.files.pacchetto && req.files.pacchetto[0];
    const an = analizza(pacchetto);
    const d = datiGioco(unisci(req.body, an.meta));
    if (!d.titolo) return res.status(400).json({ errore: 'Il titolo è obbligatorio.' });

    let versione = g.versione;
    let nFile = null;
    if (pacchetto) {
      versione = g.versione + 1;
      nFile = await importaVoci(g.slug, versione, an.voci, d.file_avvio);
    }
    let copertina = g.copertina;
    const caricata = req.files && req.files.copertina && req.files.copertina[0];
    const nuova = caricata ? await salvaCopertina(g.slug, caricata) : await salvaCopertinaZip(g.slug, an.copertina);
    if (nuova) copertina = nuova;

    const agg = await uno(`UPDATE giochi SET titolo=$1, categoria=$2, sottotitolo=$3, descrizione=$4, comandi=$5, autore=$6,
        file_avvio=$7, copertina=$8, pubblicato=$9, gratuito=$10, in_evidenza=$11, versione=$12, aggiornato_il=NOW()
      WHERE id=$13 RETURNING *`,
    [d.titolo, d.categoria, d.sottotitolo, d.descrizione, d.comandi, d.autore, d.file_avvio, copertina,
      d.pubblicato, d.gratuito, d.in_evidenza, versione, g.id]);

    // Pulizia file vecchi dopo l'aggiornamento
    if (pacchetto) storage.eliminaPrefisso(`giochi/${g.slug}/v${g.versione}`).catch(() => {});
    if (nuova && g.copertina) storage.eliminaPrefisso(g.copertina).catch(() => {});
    res.json({ gioco: agg, file: nFile });
  } catch (e) { next(e); }
});

r.delete('/giochi/:id', async (req, res) => {
  const g = await uno('DELETE FROM giochi WHERE id=$1 RETURNING *', [req.params.id]);
  if (!g) return res.status(404).json({ errore: 'Gioco non trovato.' });
  storage.eliminaPrefisso(`giochi/${g.slug}`).catch(() => {});
  if (g.copertina) storage.eliminaPrefisso(g.copertina).catch(() => {});
  res.json({ ok: true });
});

// ---------------- Utenti ----------------
r.get('/utenti', async (req, res) => {
  const cerca = `%${String(req.query.cerca || '').trim().toLowerCase()}%`;
  const righe = await q(`SELECT u.id, u.email, u.nome, u.is_admin, u.omaggio_fino, u.creato_il,
      a.stato, a.valido_fino, a.paypal_id, a.ultimo_pagamento
    FROM utenti u
    LEFT JOIN LATERAL (SELECT * FROM abbonamenti x WHERE x.utente_id=u.id
      ORDER BY (x.stato='ACTIVE') DESC, x.valido_fino DESC NULLS LAST LIMIT 1) a ON TRUE
    WHERE LOWER(u.email) LIKE $1 OR LOWER(u.nome) LIKE $1
    ORDER BY u.creato_il DESC LIMIT 500`, [cerca]);
  res.json({ utenti: righe });
});

// Accesso omaggio (es. tester, amici, sviluppatori dei giochi)
r.post('/utenti/:id/omaggio', async (req, res) => {
  const giorni = Math.max(0, Math.min(3650, Number(req.body.giorni) || 0));
  const fino = giorni ? new Date(Date.now() + giorni * 86400_000) : null;
  await q('UPDATE utenti SET omaggio_fino=$1 WHERE id=$2', [fino, req.params.id]);
  res.json({ ok: true, omaggio_fino: fino });
});

r.post('/utenti/:id/admin', async (req, res) => {
  if (Number(req.params.id) === req.utente.id) return res.status(400).json({ errore: 'Non puoi modificare il tuo ruolo.' });
  await q('UPDATE utenti SET is_admin=$1 WHERE id=$2', [bool(req.body.admin), req.params.id]);
  res.json({ ok: true });
});

r.post('/utenti/:id/password', async (req, res) => {
  const p = String(req.body.password || '');
  if (p.length < 8) return res.status(400).json({ errore: 'Almeno 8 caratteri.' });
  await q('UPDATE utenti SET password_hash=$1 WHERE id=$2', [await A.hash(p), req.params.id]);
  res.json({ ok: true });
});

r.post('/utenti/:id/sincronizza', async (req, res) => {
  const a = await uno('SELECT paypal_id FROM abbonamenti WHERE utente_id=$1 ORDER BY creato_il DESC LIMIT 1', [req.params.id]);
  if (!a) return res.status(404).json({ errore: 'Nessun abbonamento PayPal per questo utente.' });
  try {
    res.json(await A.sincronizzaAbbonamento(a.paypal_id));
  } catch (e) { res.status(502).json({ errore: e.message }); }
});

module.exports = r;
