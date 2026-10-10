// Al primo avvio (catalogo vuoto) carica i giochi dimostrativi dalla cartella giochi-demo/.
const fs = require('fs/promises');
const path = require('path');
const { q, uno } = require('./db');
const storage = require('./storage');
const { importaCartella } = require('./giochi');

async function seminaDemo() {
  if (process.env.SENZA_DEMO === '1') return;
  const n = await uno('SELECT COUNT(*)::int AS n FROM giochi');
  if (n.n > 0) return;
  const base = path.join(__dirname, '..', 'giochi-demo');
  let cartelle = [];
  try { cartelle = await fs.readdir(base); } catch { return; }
  for (const slug of cartelle.sort()) {
    const dir = path.join(base, slug);
    let meta;
    try { meta = JSON.parse(await fs.readFile(path.join(dir, 'gioco.json'), 'utf8')); } catch { continue; }
    await importaCartella(slug, 1, dir);
    let copertina = null;
    for (const ext of ['svg', 'png', 'jpg', 'webp']) {
      try {
        const dati = await fs.readFile(path.join(dir, `copertina.${ext}`));
        copertina = `copertine/${slug}.${ext}`;
        await storage.salva(copertina, dati);
        break;
      } catch { /* prova il formato successivo */ }
    }
    await q(`INSERT INTO giochi (slug, titolo, categoria, sottotitolo, descrizione, comandi, autore, copertina,
        pubblicato, gratuito, in_evidenza) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10) ON CONFLICT (slug) DO NOTHING`,
    [slug, meta.titolo, meta.categoria, meta.sottotitolo || '', meta.descrizione || '', meta.comandi || '',
      meta.autore || '', copertina, Boolean(meta.gratuito), Boolean(meta.in_evidenza)]);
    console.log(`Gioco dimostrativo caricato: ${meta.titolo}`);
  }
}

module.exports = { seminaDemo };
