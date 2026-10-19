const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

// I parametri sslmode/ssl... nell'URL (es. "?sslmode=require" copiato da Supabase) fanno sì che
// la libreria pg pretenda un certificato verificato e rifiuti quello di Supabase
// ("self-signed certificate in certificate chain"). Li togliamo e gestiamo SSL qui sotto.
function pulisciUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(sslmode|ssl|sslcert|sslkey|sslrootcert|uselibpqcompat)$/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url; // URL non analizzabile: il problema verrà spiegato dalla diagnosi di connessione
  }
}

const url = config.databaseUrl ? pulisciUrl(config.databaseUrl.trim()) : '';
const locale = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const pool = new Pool({
  connectionString: url,
  ssl: locale ? false : { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 15000,
});
pool.on('error', (e) => console.error('Connessione al database interrotta:', e.message));

async function q(sql, params) {
  const r = await pool.query(sql, params);
  return r.rows;
}
async function uno(sql, params) {
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
}

async function migra() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// Traduce gli errori di connessione più comuni in istruzioni pratiche.
function spiegaErrore(e) {
  const m = `${e.code || ''} ${e.message || ''}`;
  let host = '';
  try { host = new URL(url).hostname; } catch { /* ignorato */ }
  if (/ENETUNREACH|EADDRNOTAVAIL/.test(m) || (/ENOTFOUND/.test(m) && /^db\..*supabase\.co$/.test(host))) {
    return 'Render non raggiunge l\'indirizzo "Direct connection" di Supabase (funziona solo in IPv6). '
      + 'In Supabase apri "Connect", scegli "Session pooler" e copia QUELLA stringa in DATABASE_URL '
      + '(l\'host inizia con aws-0-...pooler.supabase.com, l\'utente è postgres.xxxxxxxx).';
  }
  if (/^[a-z0-9]+\.supabase\.(co|in)$/.test(host)) {
    return `In DATABASE_URL hai messo l'indirizzo del sito Supabase (${host}), non quello del database. `
      + 'In Supabase clicca "Connect" in alto, scegli "Session pooler" e copia quella stringa: '
      + 'l\'host deve essere tipo aws-0-eu-central-1.pooler.supabase.com e l\'utente postgres.<id-progetto>.';
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return `L'host del database "${host}" non esiste: controlla di aver copiato tutta la DATABASE_URL.`;
  if (/password authentication failed|28P01/.test(m)) {
    return 'Password del database errata. In DATABASE_URL sostituisci [YOUR-PASSWORD] con la password del database '
      + '(Supabase → Project Settings → Database → Reset database password se non la ricordi). '
      + 'Se la password contiene caratteri come @ # / ? % va scritta codificata o cambiata con una senza simboli.';
  }
  if (/Tenant or user not found/i.test(m)) return 'Con il pooler di Supabase l\'utente deve essere "postgres.<id-progetto>", non solo "postgres". Ricopia la stringa "Session pooler".';
  if (/self.signed|certificate/i.test(m)) return 'Problema di certificato SSL con il database.';
  if (/ECONNREFUSED/.test(m)) return 'Il database rifiuta la connessione: controlla host e porta (5432 per Session pooler).';
  if (/timeout|ETIMEDOUT/i.test(m)) return 'Il database non risponde: controlla che il progetto Supabase non sia in pausa e che l\'indirizzo sia giusto.';
  if (/Invalid URL|invalid connection/i.test(m)) return 'DATABASE_URL non è una stringa di connessione valida (deve iniziare con postgresql://).';
  return null;
}

module.exports = { pool, q, uno, migra, spiegaErrore };
