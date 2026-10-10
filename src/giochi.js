// Importazione dei giochi: da file ZIP (pannello admin) o da cartella (giochi demo).
const fs = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const storage = require('./storage');

const IGNORA = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git)(\/|$)/;

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'gioco';
}

// Da un elenco di {percorso, dati} trova la cartella radice (dove sta il file di avvio).
function normalizza(voci, fileAvvio = 'index.html') {
  voci = voci.filter((v) => !IGNORA.test(v.percorso));
  const avvio = fileAvvio.toLowerCase();
  const candidati = voci.map((v) => v.percorso)
    .filter((p) => p.toLowerCase().split('/').pop() === avvio)
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (!candidati.length) {
    throw Object.assign(new Error(`Nel pacchetto non trovo "${fileAvvio}". Carica lo ZIP della build web del gioco.`), { status: 400 });
  }
  const radice = candidati[0].includes('/') ? candidati[0].slice(0, candidati[0].lastIndexOf('/') + 1) : '';
  return voci
    .filter((v) => v.percorso.startsWith(radice))
    .map((v) => ({ percorso: v.percorso.slice(radice.length), dati: v.dati }))
    .filter((v) => v.percorso);
}

async function caricaVoci(prefisso, voci) {
  let i = 0;
  const lavoratori = Array.from({ length: 8 }, async () => {
    while (i < voci.length) {
      const v = voci[i++];
      await storage.salva(`${prefisso}/${v.percorso}`, v.dati);
    }
  });
  await Promise.all(lavoratori);
  return voci.length;
}

async function importaZip(slug, versione, buffer, fileAvvio) {
  let zip;
  try { zip = new AdmZip(buffer); } catch { throw Object.assign(new Error('File ZIP non valido.'), { status: 400 }); }
  const voci = zip.getEntries().filter((e) => !e.isDirectory)
    .map((e) => ({ percorso: e.entryName.replace(/\\/g, '/'), dati: e.getData() }));
  const puliti = normalizza(voci, fileAvvio);
  return caricaVoci(`giochi/${slug}/v${versione}`, puliti);
}

async function importaCartella(slug, versione, cartella) {
  const voci = [];
  async function scorri(dir, rel) {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await scorri(p, r);
      else if (d.name !== 'gioco.json' && !d.name.startsWith('copertina.')) voci.push({ percorso: r, dati: await fs.readFile(p) });
    }
  }
  await scorri(cartella, '');
  return caricaVoci(`giochi/${slug}/v${versione}`, normalizza(voci));
}

module.exports = { slugify, importaZip, importaCartella };
