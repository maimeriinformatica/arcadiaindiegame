const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  console.error('ERRORE: manca DATABASE_URL (stringa di connessione Postgres / Supabase).');
  process.exit(1);
}

const locale = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: locale ? false : { rejectUnauthorized: false },
  max: 10,
});

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

module.exports = { pool, q, uno, migra };
