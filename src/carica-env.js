// Carica il file .env se presente (in locale). Su Render le variabili arrivano dal pannello.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '.env');
if (fs.existsSync(file)) {
  for (const riga of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || riga.trim().startsWith('#')) continue;
    const v = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
