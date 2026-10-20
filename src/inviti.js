// Inviti: ogni utente ha un link personale. Ogni 3 amici invitati che attivano
// l'abbonamento, chi li ha invitati riceve un mese di gioco gratis.
const crypto = require('crypto');
const config = require('./config');
const { q, uno } = require('./db');

const COOKIE = 'invito';
const AMICI_PER_PREMIO = 3;
const GIORNI_PREMIO = 30;
const FORMATO = /^[A-Z2-9]{8}$/;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // senza 0/O e 1/I, per non confondersi

function nuovoCodice() {
  const b = crypto.randomBytes(8);
  return Array.from(b, (x) => ALFABETO[x % ALFABETO.length]).join('');
}

// Middleware: chi arriva da un link ?invito=CODICE se lo porta dietro per 30 giorni.
function cattura(req, res, next) {
  const c = String((req.query && req.query.invito) || '').trim().toUpperCase();
  if (FORMATO.test(c) && !req.utente) {
    res.cookie(COOKIE, c, { httpOnly: true, sameSite: 'lax', secure: config.produzione, maxAge: 30 * 86400_000, path: '/' });
  }
  next();
}

// Codice personale dell'utente (creato la prima volta che serve).
async function codiceDi(utenteId) {
  const u = await uno('SELECT codice_invito FROM utenti WHERE id=$1', [utenteId]);
  if (u && u.codice_invito) return u.codice_invito;
  for (let i = 0; i < 5; i += 1) {
    const c = nuovoCodice();
    const r = await uno(`UPDATE utenti SET codice_invito=$1 WHERE id=$2 AND codice_invito IS NULL
                         AND NOT EXISTS (SELECT 1 FROM utenti WHERE codice_invito=$1) RETURNING codice_invito`, [c, utenteId]);
    if (r) return r.codice_invito;
    const ora = await uno('SELECT codice_invito FROM utenti WHERE id=$1', [utenteId]);
    if (ora && ora.codice_invito) return ora.codice_invito;
  }
  throw new Error('Impossibile creare il codice di invito');
}

// Alla registrazione: collega il nuovo utente a chi l'ha invitato.
async function collega(nuovoId, codice, res) {
  if (res) res.clearCookie(COOKIE, { path: '/' });
  const c = String(codice || '').trim().toUpperCase();
  if (!FORMATO.test(c)) return;
  const chi = await uno('SELECT id FROM utenti WHERE codice_invito=$1', [c]);
  if (!chi || chi.id === nuovoId) return;
  await q('UPDATE utenti SET invitato_da=$1 WHERE id=$2 AND invitato_da IS NULL', [chi.id, nuovoId]);
}

// Quando un utente attiva l'abbonamento: l'invito diventa valido e, ogni 3 inviti validi,
// chi ha invitato riceve un mese di accesso in più (dopo la fine dell'accesso che ha già).
async function abbonamentoAttivato(utenteId) {
  const u = await uno(`UPDATE utenti SET invito_valido_il=NOW()
                       WHERE id=$1 AND invitato_da IS NOT NULL AND invito_valido_il IS NULL
                       RETURNING invitato_da`, [utenteId]);
  if (!u) return;
  const chi = u.invitato_da;
  const { validi } = await uno('SELECT COUNT(*)::int AS validi FROM utenti WHERE invitato_da=$1 AND invito_valido_il IS NOT NULL', [chi]);
  const dovuti = Math.floor(validi / AMICI_PER_PREMIO);
  // Aggiornamento atomico: assegna solo i premi non ancora dati (niente doppioni se due webhook arrivano insieme).
  const r = await uno(`UPDATE utenti SET premi_inviti=$2,
        omaggio_fino = GREATEST(NOW(), COALESCE(omaggio_fino, NOW()),
          COALESCE((SELECT MAX(valido_fino) FROM abbonamenti a WHERE a.utente_id=utenti.id AND a.stato IN ('ACTIVE','CANCELLED')), NOW()))
          + make_interval(days => $3 * ($2 - premi_inviti))
      WHERE id=$1 AND premi_inviti < $2 RETURNING email, omaggio_fino`, [chi, dovuti, GIORNI_PREMIO]);
  if (r) console.log(`Inviti: premio a ${r.email}, accesso gratuito fino al ${new Date(r.omaggio_fino).toISOString().slice(0, 10)}`);
}

async function riepilogo(utenteId) {
  const codice = await codiceDi(utenteId);
  const s = await uno(`SELECT COUNT(*)::int AS iscritti,
      COUNT(*) FILTER (WHERE invito_valido_il IS NOT NULL)::int AS abbonati
      FROM utenti WHERE invitato_da=$1`, [utenteId]);
  const u = await uno('SELECT premi_inviti FROM utenti WHERE id=$1', [utenteId]);
  return {
    codice,
    link: `${config.urlPubblico.replace(/\/$/, '')}/?invito=${codice}`,
    iscritti: s.iscritti,
    abbonati: s.abbonati,
    mesiOttenuti: u.premi_inviti,
    mancano: AMICI_PER_PREMIO - (s.abbonati % AMICI_PER_PREMIO),
    amiciPerPremio: AMICI_PER_PREMIO,
  };
}

module.exports = { cattura, codiceDi, collega, abbonamentoAttivato, riepilogo, COOKIE };
