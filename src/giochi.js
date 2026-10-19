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

// ---------------- Scheda del gioco dentro lo ZIP (gioco.json + copertina) ----------------
const CATEGORIE = ['3D', 'Platform', 'Arcade', 'Avventura', 'Puzzle', 'Corse', 'Sport', 'Strategia', 'Narrativo', 'Da tavolo', 'Altro'];
const FILE_SCHEDA = /^(gioco|game|scheda)\.json$/i;
const FILE_COPERTINA = /^(copertina|cover|thumbnail|thumb|anteprima|poster)\.(png|jpe?g|webp|gif|svg)$/i;
const TIPI_IMMAGINE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

// Accetta nomi italiani o inglesi e testi su più righe (stringa o elenco).
function normalizzaScheda(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
  const pick = (...k) => { for (const x of k) if (j[x] != null && j[x] !== '') return j[x]; return undefined; };
  const testo = (v) => (v == null ? undefined : (Array.isArray(v) ? v.join('\n') : String(v)).trim());
  const flag = (v) => (v == null ? undefined : v === true || v === 1 || /^(true|si|sì|yes|1)$/i.test(String(v)));
  const cat = testo(pick('categoria', 'category', 'genere', 'genre'));
  return {
    titolo: testo(pick('titolo', 'title', 'nome', 'name')),
    sottotitolo: testo(pick('sottotitolo', 'descrizione_breve', 'descrizioneBreve', 'frase', 'subtitle', 'tagline', 'short_description')),
    descrizione: testo(pick('descrizione', 'descrizione_lunga', 'descrizioneLunga', 'description', 'long_description')),
    comandi: testo(pick('comandi', 'controlli', 'controls', 'istruzioni', 'how_to_play')),
    autore: testo(pick('autore', 'author', 'studio', 'sviluppatore', 'developer')),
    categoria: cat ? (CATEGORIE.find((c) => c.toLowerCase() === cat.toLowerCase()) || 'Altro') : undefined,
    file_avvio: testo(pick('file_avvio', 'avvio', 'entry', 'index')),
    slug: testo(pick('slug', 'id')),
    copertina: testo(pick('copertina', 'cover', 'immagine', 'image', 'thumbnail')),
    pubblicato: flag(pick('pubblicato', 'published')),
    gratuito: flag(pick('gratuito', 'gratis', 'free')),
    in_evidenza: flag(pick('in_evidenza', 'evidenza', 'featured')),
  };
}

function apriZip(buffer) {
  let zip;
  try { zip = new AdmZip(buffer); } catch { throw Object.assign(new Error('File ZIP non valido.'), { status: 400 }); }
  return zip.getEntries().filter((e) => !e.isDirectory)
    .map((e) => ({ percorso: e.entryName.replace(/\\/g, '/'), dati: e.getData() }))
    .filter((v) => !IGNORA.test(v.percorso));
}

// Legge dallo ZIP la scheda (gioco.json) e l'immagine di copertina, se presenti.
function analizzaZip(buffer) {
  const voci = apriZip(buffer);
  const piuCorto = (lista) => lista.sort((a, b) => a.percorso.split('/').length - b.percorso.split('/').length)[0];
  const nome = (p) => p.split('/').pop();
  const cartella = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
  let meta = {};
  let errScheda = null;
  const vs = piuCorto(voci.filter((v) => FILE_SCHEDA.test(nome(v.percorso))));
  if (vs) {
    try { meta = normalizzaScheda(JSON.parse(vs.dati.toString('utf8').replace(/^\uFEFF/, ''))); }
    catch (e) { errScheda = `Il file ${vs.percorso} non è un JSON valido (${e.message.slice(0, 80)}).`; }
  }
  let cop = null;
  if (meta.copertina) {
    const cercato = (cartella(vs.percorso) + meta.copertina.replace(/^\.?\//, '')).toLowerCase();
    cop = voci.find((v) => v.percorso.toLowerCase() === cercato) || null;
  }
  if (!cop) {
    const cand = voci.filter((v) => FILE_COPERTINA.test(nome(v.percorso)));
    cop = (vs && cand.find((v) => cartella(v.percorso) === cartella(vs.percorso))) || piuCorto(cand) || null;
  }
  const copertina = cop ? { dati: cop.dati, ext: nome(cop.percorso).split('.').pop().toLowerCase().replace('jpeg', 'jpg') } : null;
  if (copertina) copertina.tipo = TIPI_IMMAGINE[copertina.ext];
  return { voci, meta, copertina, errScheda, haScheda: Boolean(vs) };
}

async function importaVoci(slug, versione, voci, fileAvvio) {
  return caricaVoci(`giochi/${slug}/v${versione}`, normalizza(voci, fileAvvio));
}

async function importaZip(slug, versione, buffer, fileAvvio) {
  return importaVoci(slug, versione, apriZip(buffer), fileAvvio);
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

module.exports = { slugify, importaZip, importaCartella, analizzaZip, importaVoci, normalizzaScheda, CATEGORIE };
