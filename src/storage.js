// Archiviazione dei file dei giochi: cartella locale (sviluppo) o Supabase Storage (produzione).
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

const TIPI = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json',
  wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', glb: 'model/gltf-binary',
  gltf: 'model/gltf+json', obj: 'text/plain', fbx: 'application/octet-stream', ttf: 'font/ttf',
  otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8',
  xml: 'application/xml', pck: 'application/octet-stream', data: 'application/octet-stream',
  bin: 'application/octet-stream', unityweb: 'application/octet-stream',
};

// Supporto build compresse (Unity WebGL/Godot): file.js.br -> Content-Encoding br
function infoFile(chiave) {
  let nome = chiave.toLowerCase();
  let encoding = null;
  if (nome.endsWith('.br')) { encoding = 'br'; nome = nome.slice(0, -3); }
  else if (nome.endsWith('.gz')) { encoding = 'gzip'; nome = nome.slice(0, -3); }
  const ext = nome.split('.').pop();
  return { tipo: TIPI[ext] || 'application/octet-stream', encoding };
}

function pulisci(chiave) {
  const n = path.posix.normalize(String(chiave).replace(/\\/g, '/')).replace(/^\/+/, '');
  if (n.startsWith('..') || n.includes('/../') || n === '..') throw new Error('Percorso non valido');
  return n;
}

// ---------- Driver locale ----------
const locale = {
  async salva(chiave, buffer) {
    const p = path.join(config.storage.cartellaLocale, pulisci(chiave));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, buffer);
  },
  async leggi(chiave) {
    try {
      return await fs.readFile(path.join(config.storage.cartellaLocale, pulisci(chiave)));
    } catch { return null; }
  },
  async eliminaPrefisso(prefisso) {
    await fs.rm(path.join(config.storage.cartellaLocale, pulisci(prefisso)), { recursive: true, force: true });
  },
};

// ---------- Driver Supabase ----------
let sb = null;
function client() {
  if (!sb) {
    const { createClient } = require('@supabase/supabase-js');
    sb = createClient(config.storage.supabaseUrl, config.storage.supabaseKey, { auth: { persistSession: false } });
  }
  return sb;
}
const supabase = {
  async preparaBucket() {
    const c = client();
    const { data } = await c.storage.getBucket(config.storage.bucket);
    if (!data) {
      const { error } = await c.storage.createBucket(config.storage.bucket, { public: false });
      if (error && !/already exists/i.test(error.message)) throw error;
      console.log(`Bucket "${config.storage.bucket}" creato (privato).`);
    }
  },
  async salva(chiave, buffer) {
    const { error } = await client().storage.from(config.storage.bucket)
      .upload(pulisci(chiave), buffer, { upsert: true, contentType: 'application/octet-stream' });
    if (error) throw error;
  },
  async leggi(chiave) {
    const { data, error } = await client().storage.from(config.storage.bucket).download(pulisci(chiave));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  },
  async eliminaPrefisso(prefisso) {
    const c = client().storage.from(config.storage.bucket);
    await c.remove([pulisci(prefisso)]); // se è un singolo file
    const tutti = [];
    async function elenca(dir) {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await c.list(dir, { limit: 1000, offset });
        if (error || !data || !data.length) break;
        for (const v of data) {
          const p = dir ? `${dir}/${v.name}` : v.name;
          if (v.id) tutti.push(p); else await elenca(p);
        }
        if (data.length < 1000) break;
      }
    }
    await elenca(pulisci(prefisso).replace(/\/$/, ''));
    for (let i = 0; i < tutti.length; i += 500) await c.remove(tutti.slice(i, i + 500));
  },
};

const driver = config.storage.tipo === 'supabase' ? supabase : locale;

module.exports = {
  infoFile,
  salva: (k, b) => driver.salva(k, b),
  leggi: (k) => driver.leggi(k),
  eliminaPrefisso: (p) => driver.eliminaPrefisso(p),
  prepara: async () => { if (driver.preparaBucket) await driver.preparaBucket(); },
};
