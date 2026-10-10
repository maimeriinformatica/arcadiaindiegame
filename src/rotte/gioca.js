// Servizio dei file dei giochi (protetto dall'abbonamento) e delle copertine (pubbliche).
const express = require('express');
const { uno, q } = require('../db');
const A = require('../accesso');
const storage = require('../storage');

const r = express.Router();

// Cache in memoria dei file più usati (le chiavi contengono la versione, quindi non va mai invalidata).
const LIMITE_CACHE = Number(process.env.CACHE_MB || 150) * 1024 * 1024;
const cache = new Map();
let occupato = 0;
async function leggiConCache(chiave) {
  if (cache.has(chiave)) {
    const v = cache.get(chiave);
    cache.delete(chiave); cache.set(chiave, v); // aggiorna ordine LRU
    return v;
  }
  const dati = await storage.leggi(chiave);
  if (dati && dati.length < LIMITE_CACHE / 10) {
    cache.set(chiave, dati);
    occupato += dati.length;
    for (const [k, v] of cache) {
      if (occupato <= LIMITE_CACHE) break;
      cache.delete(k); occupato -= v.length;
    }
  }
  return dati;
}

function invia(res, chiave, dati, cachePubblica) {
  const { tipo, encoding } = storage.infoFile(chiave);
  res.set('Content-Type', tipo);
  if (encoding) res.set('Content-Encoding', encoding);
  res.set('Cache-Control', cachePubblica ? 'public, max-age=86400' : 'private, max-age=3600');
  res.send(dati);
}

r.get('/copertine/:slug', async (req, res) => {
  const g = await uno('SELECT copertina FROM giochi WHERE slug=$1', [req.params.slug]);
  const dati = g && g.copertina && await leggiConCache(g.copertina);
  if (!dati) return res.redirect('/img/copertina-vuota.svg');
  invia(res, g.copertina, dati, true);
});

r.get('/gioca/:slug', (req, res, next) => {
  if (req.path.endsWith('/')) return next(); // Express ignora la barra finale: la gestisce la rotta successiva
  res.redirect(301, `/gioca/${encodeURIComponent(req.params.slug)}/`);
});

r.get(['/gioca/:slug/', '/gioca/:slug/{*percorso}'], async (req, res) => {
  const richiesto = Array.isArray(req.params.percorso) ? req.params.percorso.join('/') : '';
  const g = await uno('SELECT * FROM giochi WHERE slug=$1', [req.params.slug]);
  const admin = req.utente && req.utente.is_admin;
  if (!g || (!g.pubblicato && !admin)) return res.status(404).send('Gioco non trovato');

  if (!g.gratuito) {
    const s = await A.statoAccesso(req.utente);
    if (!s.accesso) {
      if (!richiesto) return res.redirect(`/abbonati.html?gioco=${encodeURIComponent(g.slug)}`);
      return res.status(403).send('Abbonamento richiesto');
    }
  }

  let percorso = richiesto || g.file_avvio;
  if (req.path.endsWith('/') && richiesto) percorso += '/index.html';
  const chiave = `giochi/${g.slug}/v${g.versione}/${percorso}`;
  if (chiave.split('/').includes('..')) return res.status(400).end();

  const dati = await leggiConCache(chiave);
  if (!dati) return res.status(404).send('File non trovato');
  if (percorso === g.file_avvio) q('UPDATE giochi SET partite=partite+1 WHERE id=$1', [g.id]).catch(() => {});
  invia(res, chiave, dati, false);
});

module.exports = r;
