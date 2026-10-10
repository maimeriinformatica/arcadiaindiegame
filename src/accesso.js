// Autenticazione (cookie JWT) e regole di accesso ai giochi.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { uno, q } = require('./db');
const paypal = require('./paypal');

const COOKIE = 'sessione';
const DURATA_GIORNI = 30;

function impostaSessione(res, utente) {
  const t = jwt.sign({ uid: utente.id }, config.jwtSecret, { expiresIn: `${DURATA_GIORNI}d` });
  res.cookie(COOKIE, t, {
    httpOnly: true, sameSite: 'lax', secure: config.produzione, maxAge: DURATA_GIORNI * 86400_000, path: '/',
  });
}
function chiudiSessione(res) { res.clearCookie(COOKIE, { path: '/' }); }

// Middleware: carica req.utente se c'è una sessione valida.
async function caricaUtente(req, _res, next) {
  req.utente = null;
  const t = req.cookies && req.cookies[COOKIE];
  if (t) {
    try {
      const { uid } = jwt.verify(t, config.jwtSecret);
      req.utente = await uno('SELECT id, email, nome, is_admin, omaggio_fino, creato_il FROM utenti WHERE id=$1', [uid]);
    } catch { /* sessione scaduta o non valida */ }
  }
  next();
}

function richiediLogin(req, res, next) {
  if (!req.utente) return res.status(401).json({ errore: 'Devi accedere.' });
  next();
}
function richiediAdmin(req, res, next) {
  if (!req.utente || !req.utente.is_admin) return res.status(403).json({ errore: 'Riservato agli amministratori.' });
  next();
}

const hash = (p) => bcrypt.hash(p, 11);
const confronta = (p, h) => bcrypt.compare(p, h);

// ---------------- Abbonamenti ----------------

// Aggiorna nel DB un abbonamento leggendo lo stato vero da PayPal.
async function sincronizzaAbbonamento(paypalId, utenteIdAtteso) {
  const s = await paypal.leggiAbbonamento(paypalId);
  if (config.paypal.pianoId && s.plan_id !== config.paypal.pianoId) {
    throw Object.assign(new Error('Piano PayPal non riconosciuto'), { status: 400 });
  }
  // Blocca abbonamenti creati con prezzo modificato lato browser (override del piano).
  if (s.plan_overridden) {
    throw Object.assign(new Error('Abbonamento con condizioni modificate, rifiutato'), { status: 400 });
  }
  const utenteId = Number(s.custom_id);
  if (!utenteId) throw Object.assign(new Error('Abbonamento senza utente collegato'), { status: 400 });
  if (utenteIdAtteso && utenteId !== utenteIdAtteso) {
    throw Object.assign(new Error('Questo abbonamento appartiene a un altro utente'), { status: 403 });
  }
  if (!(await uno('SELECT 1 FROM utenti WHERE id=$1', [utenteId]))) {
    throw Object.assign(new Error(`Utente ${utenteId} inesistente`), { status: 404 });
  }
  const b = s.billing_info || {};
  const prossimo = b.next_billing_time || null;
  const ultimo = (b.last_payment && b.last_payment.time) || null;

  const esistente = await uno('SELECT valido_fino FROM abbonamenti WHERE paypal_id=$1', [s.id]);
  // Se disdetto, PayPal non fornisce più next_billing_time: conserviamo la fine del periodo già pagato.
  let validoFino = prossimo;
  if (!validoFino && esistente) validoFino = esistente.valido_fino;
  if (!validoFino && ultimo) validoFino = new Date(new Date(ultimo).getTime() + 31 * 86400_000).toISOString();

  await q(`INSERT INTO abbonamenti (utente_id, paypal_id, piano_id, stato, valido_fino, ultimo_pagamento, sincronizzato_il)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (paypal_id) DO UPDATE SET stato=EXCLUDED.stato, valido_fino=EXCLUDED.valido_fino,
             ultimo_pagamento=COALESCE(EXCLUDED.ultimo_pagamento, abbonamenti.ultimo_pagamento),
             piano_id=EXCLUDED.piano_id, sincronizzato_il=NOW()`,
  [utenteId, s.id, s.plan_id, s.status, validoFino, ultimo]);
  return { utenteId, stato: s.status, validoFino };
}

function abbonamentoValido(a) {
  if (!a) return false;
  const adesso = Date.now();
  const fine = a.valido_fino ? new Date(a.valido_fino).getTime() : 0;
  if (a.stato === 'ACTIVE') return !fine || fine > adesso - 3 * 86400_000; // 3 giorni di tolleranza sul rinnovo
  if (a.stato === 'CANCELLED') return fine > adesso;                    // disdetto: vale fino a fine periodo
  return false;
}

// Stato completo dell'accesso di un utente.
async function statoAccesso(utente) {
  if (!utente) return { accesso: false, motivo: 'anonimo' };
  if (utente.is_admin) return { accesso: true, motivo: 'admin' };
  if (utente.omaggio_fino && new Date(utente.omaggio_fino) > new Date()) {
    return { accesso: true, motivo: 'omaggio', fino: utente.omaggio_fino };
  }
  let a = await uno(`SELECT * FROM abbonamenti WHERE utente_id=$1
                     ORDER BY (stato='ACTIVE') DESC, valido_fino DESC NULLS LAST LIMIT 1`, [utente.id]);
  // Se i dati locali sono vecchi o il periodo è finito, ricontrolliamo PayPal (i webhook potrebbero essersi persi).
  if (a) {
    const vecchio = Date.now() - new Date(a.sincronizzato_il).getTime() > 12 * 3600_000;
    const scaduto = a.valido_fino && new Date(a.valido_fino) < new Date();
    if ((vecchio || scaduto) && ['ACTIVE', 'CANCELLED', 'APPROVED', 'SUSPENDED'].includes(a.stato)) {
      try {
        await sincronizzaAbbonamento(a.paypal_id, utente.id);
        a = await uno('SELECT * FROM abbonamenti WHERE id=$1', [a.id]);
      } catch (e) { console.warn('Sincronizzazione PayPal non riuscita:', e.message); }
    }
  }
  if (abbonamentoValido(a)) {
    return { accesso: true, motivo: a.stato === 'ACTIVE' ? 'abbonato' : 'disdetto', fino: a.valido_fino, abbonamento: a };
  }
  return { accesso: false, motivo: a ? 'scaduto' : 'nessuno', abbonamento: a };
}

module.exports = {
  impostaSessione, chiudiSessione, caricaUtente, richiediLogin, richiediAdmin, hash, confronta,
  sincronizzaAbbonamento, statoAccesso, abbonamentoValido,
};
