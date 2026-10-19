// Statistiche di traffico: raccoglie visite, provenienza, ricerche, dispositivi e luoghi.
// Modulo autonomo: non modifica giochi, utenti o abbonamenti, legge solo le richieste.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { q, uno } = require('./db');
const config = require('./config');

let UAParser = null;
try { UAParser = require('ua-parser-js'); } catch { /* libreria facoltativa */ }
let geoip = null;
let geoTentato = false;
function geo(ip) {
  if (!geoTentato) {
    geoTentato = true;
    try { geoip = require('geoip-lite'); } catch { console.warn('Statistiche: geoip-lite non installato, niente paesi/città.'); }
  }
  if (!geoip || !ip) return {};
  try { return geoip.lookup(ip) || {}; } catch { return {}; }
}

const COOKIE = 'aid';
const DURATA_SESSIONE = 30 * 60_000;

// ---------------------------------------------------------------- utilità
const corto = (s, n = 300) => (s == null ? null : String(s).slice(0, n));

function ipCliente(req) {
  const h = req.headers;
  const v = h['cf-connecting-ip'] || h['true-client-ip']
    || (h['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  return v.replace(/^::ffff:/, '');
}

const NOMI_PAGINE = {
  '/': 'Home', '/index.html': 'Home', '/gioco.html': 'Scheda gioco', '/gioca.html': 'Gioca',
  '/abbonati.html': 'Abbonamento', '/accedi.html': 'Accesso / iscrizione', '/account.html': 'Account',
  '/admin.html': 'Gestione', '/statistiche.html': 'Statistiche', '/termini.html': 'Termini',
  '/privacy.html': 'Privacy',
};
const nomePagina = (p) => NOMI_PAGINE[p] || p;

const REGIONI_IT = {
  21: 'Piemonte', 23: "Valle d'Aosta", 25: 'Lombardia', 32: 'Trentino-Alto Adige', 34: 'Veneto',
  36: 'Friuli-Venezia Giulia', 42: 'Liguria', 45: 'Emilia-Romagna', 52: 'Toscana', 55: 'Umbria',
  57: 'Marche', 62: 'Lazio', 65: 'Abruzzo', 67: 'Molise', 72: 'Campania', 75: 'Puglia',
  77: 'Basilicata', 78: 'Calabria', 82: 'Sicilia', 88: 'Sardegna',
};

// ---------------------------------------------------------------- robot
const ROBOT = [
  [/googlebot|google-inspectiontool|storebot-google|adsbot-google|mediapartners-google|google-read-aloud/i, 'Google'],
  [/bingbot|bingpreview|msnbot/i, 'Bing'], [/yandex/i, 'Yandex'], [/duckduckbot|duckassist/i, 'DuckDuckGo'],
  [/baiduspider/i, 'Baidu'], [/applebot/i, 'Apple'],
  [/facebookexternalhit|facebookcatalog|meta-externalagent/i, 'Facebook (anteprima link)'],
  [/whatsapp/i, 'WhatsApp (anteprima link)'], [/telegrambot/i, 'Telegram (anteprima link)'],
  [/twitterbot/i, 'X / Twitter (anteprima link)'], [/linkedinbot/i, 'LinkedIn (anteprima link)'],
  [/slackbot|discordbot|skypeuripreview|pinterestbot|redditbot/i, 'Anteprima link (altre app)'],
  [/gptbot|chatgpt-user|oai-searchbot/i, 'ChatGPT / OpenAI'], [/claudebot|claude-user|claude-searchbot|anthropic/i, 'Claude / Anthropic'],
  [/perplexitybot|perplexity-user/i, 'Perplexity'], [/ccbot/i, 'Common Crawl'],
  [/ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|amazonbot|seznambot|dataforseo/i, 'Robot SEO / commerciali'],
  [/uptimerobot|pingdom|statuscake|render|betteruptime|site24x7/i, 'Monitoraggio'],
  [/headless|lighthouse|pagespeed|phantomjs|puppeteer|playwright|selenium/i, 'Browser automatico'],
  [/curl|wget|python-requests|python-urllib|aiohttp|go-http-client|okhttp|java\/|node-fetch|axios|libwww|httpclient|scrapy/i, 'Script / programmi'],
  [/bot\b|bot\/|crawler|spider|crawl|slurp|preview|scan|fetch/i, 'Altri robot'],
];
function robot(ua) {
  if (!ua) return 'Senza browser';
  for (const [re, nome] of ROBOT) if (re.test(ua)) return nome;
  return null;
}

// ---------------------------------------------------------------- provenienza
const MOTORI = [
  [/(^|\.)google\.[a-z.]+$/, 'Google', 'q'], [/(^|\.)bing\.com$/, 'Bing', 'q'], [/(^|\.)yahoo\.[a-z.]+$/, 'Yahoo', 'p'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo', 'q'], [/(^|\.)ecosia\.org$/, 'Ecosia', 'q'], [/(^|\.)qwant\.com$/, 'Qwant', 'q'],
  [/(^|\.)yandex\.[a-z.]+$/, 'Yandex', 'text'], [/(^|\.)baidu\.com$/, 'Baidu', 'wd'], [/(^|\.)startpage\.com$/, 'Startpage', 'query'],
  [/^search\.brave\.com$/, 'Brave Search', 'q'], [/(^|\.)virgilio\.it$/, 'Virgilio', 'qs'], [/(^|\.)libero\.it$/, 'Libero', 'query'],
  [/(^|\.)aol\.[a-z.]+$/, 'AOL', 'q'], [/(^|\.)seznam\.cz$/, 'Seznam', 'q'], [/(^|\.)naver\.com$/, 'Naver', 'query'],
];
const ASSISTENTI = [
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, 'ChatGPT'], [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)claude\.ai$/, 'Claude'], [/^gemini\.google\.com$|^bard\.google\.com$/, 'Gemini'],
  [/^copilot\.microsoft\.com$/, 'Copilot'], [/(^|\.)deepseek\.com$/, 'DeepSeek'], [/(^|\.)you\.com$/, 'You.com'],
  [/(^|\.)mistral\.ai$/, 'Mistral'], [/(^|\.)meta\.ai$/, 'Meta AI'],
];
const SOCIAL = [
  [/(^|\.)facebook\.com$|^fb\.me$|(^|\.)fb\.com$/, 'Facebook'], [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X / Twitter'], [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'LinkedIn'],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, 'Pinterest'], [/(^|\.)reddit\.com$|^redd\.it$/, 'Reddit'],
  [/^t\.me$|(^|\.)telegram\.(org|me)$/, 'Telegram'], [/(^|\.)whatsapp\.(com|net)$|^wa\.me$/, 'WhatsApp'],
  [/(^|\.)threads\.(net|com)$/, 'Threads'], [/(^|\.)discord(app)?\.com$|^discord\.gg$/, 'Discord'],
  [/(^|\.)twitch\.tv$/, 'Twitch'], [/(^|\.)snapchat\.com$/, 'Snapchat'], [/(^|\.)bsky\.app$/, 'Bluesky'],
  [/(^|\.)tumblr\.com$/, 'Tumblr'], [/(^|\.)vk\.com$/, 'VK'], [/(^|\.)messenger\.com$/, 'Messenger'],
];
const EMAIL = [
  [/^mail\.google\.com$/, 'Gmail'], [/(^|\.)outlook\.(live|office|office365)\.com$/, 'Outlook'],
  [/^mail\.yahoo\.com$/, 'Yahoo Mail'], [/(^|\.)mail\.libero\.it$/, 'Libero Mail'], [/(^|\.)mail\.virgilio\.it$/, 'Virgilio Mail'],
  [/^webmail\./, 'Webmail'], [/(^|\.)mail\./, 'Webmail'],
];
const CANALE_DA_MEDIUM = [
  [/^(cpc|ppc|paid|paidsearch|paid_social|paidsocial|ads?|display|banner|cpm|sponsor)/i, 'Pubblicità'],
  [/^(social|social-network|social_media|sm|organic_social)/i, 'Social'],
  [/^(email|e-mail|newsletter|mail)/i, 'Email'],
  [/^(qr|qrcode|offline|print|stampa|volantino|flyer|poster)/i, 'QR / stampa'],
  [/^(referral|partner|affiliate|affiliato)/i, 'Siti esterni'],
];
const NOMI_SORGENTI_UTM = {
  ig: 'Instagram', instagram: 'Instagram', fb: 'Facebook', facebook: 'Facebook', tiktok: 'TikTok', tt: 'TikTok',
  youtube: 'YouTube', yt: 'YouTube', google: 'Google', bing: 'Bing', whatsapp: 'WhatsApp', wa: 'WhatsApp',
  telegram: 'Telegram', newsletter: 'Newsletter', email: 'Email', linkedin: 'LinkedIn', x: 'X / Twitter', twitter: 'X / Twitter',
  qr: 'QR code', volantino: 'Volantino',
  'chatgpt.com': 'ChatGPT', chatgpt: 'ChatGPT', openai: 'ChatGPT', 'perplexity.ai': 'Perplexity', perplexity: 'Perplexity',
  'copilot.microsoft.com': 'Copilot', copilot: 'Copilot', gemini: 'Gemini', claude: 'Claude', 'claude.ai': 'Claude',
};
const ASSISTENTI_NOMI = new Set(['ChatGPT', 'Perplexity', 'Copilot', 'Gemini', 'Claude']);
const CITTA_IT = {
  Rome: 'Roma', Milan: 'Milano', Naples: 'Napoli', Turin: 'Torino', Florence: 'Firenze', Venice: 'Venezia', Genoa: 'Genova',
  Padua: 'Padova', Mantua: 'Mantova', Syracuse: 'Siracusa', Leghorn: 'Livorno', 'Reggio Calabria': 'Reggio Calabria',
};

function trova(lista, host) { for (const [re, nome, par] of lista) if (re.test(host)) return { nome, par }; return null; }

function classifica({ referrer, query, hostProprio }) {
  const r = {
    referrer: null, ref_host: null, canale: 'Diretto', sorgente: 'Accesso diretto', ricerca: null, click_id: null,
    utm_source: corto(query.utm_source, 100), utm_medium: corto(query.utm_medium, 100), utm_campaign: corto(query.utm_campaign, 150),
    utm_term: corto(query.utm_term, 200), utm_content: corto(query.utm_content, 150), interno: false,
  };
  if (query.gclid || query.gbraid || query.wbraid) r.click_id = 'Google Ads';
  else if (query.msclkid) r.click_id = 'Microsoft Ads';
  else if (query.ttclid) r.click_id = 'TikTok Ads';
  else if (query.fbclid) r.click_id = 'Facebook / Instagram';
  else if (query.igshid) r.click_id = 'Instagram';
  else if (query.twclid) r.click_id = 'X / Twitter Ads';
  else if (query.li_fat_id) r.click_id = 'LinkedIn Ads';

  let u = null;
  if (referrer) { try { u = new URL(referrer); } catch { /* referrer non valido */ } }
  if (u && /^https?:$/.test(u.protocol)) {
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\.|^l\.|^lm\.|^mobile\./, '');
    if (hostProprio.includes(u.hostname.toLowerCase())) { r.interno = true; r.canale = 'Interno'; r.sorgente = 'Navigazione nel sito'; }
    else {
      r.referrer = corto(`${u.origin}${u.pathname}`, 300);
      r.ref_host = host;
      let m;
      if ((m = trova(ASSISTENTI, u.hostname.toLowerCase()) || trova(ASSISTENTI, host))) { r.canale = 'Assistenti AI'; r.sorgente = m.nome; }
      else if ((m = trova(EMAIL, u.hostname.toLowerCase()))) { r.canale = 'Email'; r.sorgente = m.nome; }
      else if ((m = trova(MOTORI, host))) {
        r.canale = 'Ricerca'; r.sorgente = m.nome;
        const parola = u.searchParams.get(m.par) || u.searchParams.get('q');
        if (parola) r.ricerca = corto(parola.trim().toLowerCase(), 200);
      } else if ((m = trova(SOCIAL, host))) { r.canale = 'Social'; r.sorgente = m.nome; }
      else { r.canale = 'Siti esterni'; r.sorgente = host; }
    }
  }
  // Le campagne con link tracciati (utm_...) hanno la precedenza sul referrer.
  if (r.utm_source || r.utm_campaign) {
    const src = String(r.utm_source || '').toLowerCase();
    r.sorgente = NOMI_SORGENTI_UTM[src] || r.utm_source || r.sorgente;
    let canale = 'Campagne';
    for (const [re, c] of CANALE_DA_MEDIUM) if (r.utm_medium && re.test(r.utm_medium)) { canale = c; break; }
    if (canale === 'Campagne' && /instagram|facebook|tiktok|youtube|telegram|whatsapp|linkedin|twitter/i.test(r.sorgente)) canale = 'Social';
    if (ASSISTENTI_NOMI.has(r.sorgente)) canale = 'Assistenti AI';
    r.canale = canale;
    r.interno = false;
    if (r.utm_term && !r.ricerca) r.ricerca = corto(r.utm_term.toLowerCase(), 200);
  } else if (r.click_id && !r.interno) {
    if (/Ads/.test(r.click_id)) { r.canale = 'Pubblicità'; r.sorgente = r.click_id; }
    else if (r.canale === 'Diretto') { r.canale = 'Social'; r.sorgente = r.click_id; } // es. link da app Facebook/Instagram senza referrer
  }
  return r;
}

function dispositivo(ua) {
  if (!UAParser) return { dispositivo: null, browser: null, sistema: null };
  const p = new UAParser(ua).getResult();
  const tipi = { mobile: 'Telefono', tablet: 'Tablet', smarttv: 'TV', console: 'Console', wearable: 'Smartwatch', embedded: 'Altro' };
  let d = tipi[p.device.type] || 'Computer';
  if (d === 'Computer' && /smart-?tv|hbbtv|netcast|web0s|tizen|appletv|googletv|android tv|crkey|aft[a-z]/i.test(ua)) d = 'TV';
  const nomeOs = p.os.name ? `${p.os.name}${p.os.name === 'Windows' && p.os.version ? ' ' + p.os.version : ''}` : null;
  let br = p.browser.name || null;
  if (/Instagram/.test(ua)) br = 'Instagram (app)';
  else if (/FBAN|FBAV|FB_IAB/.test(ua)) br = 'Facebook (app)';
  else if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) br = 'TikTok (app)';
  else if (/WhatsApp/.test(ua)) br = 'WhatsApp (app)';
  return { dispositivo: d, browser: corto(br, 60), sistema: corto(nomeOs, 60) };
}

// ---------------------------------------------------------------- sessioni (in memoria, con ripiego sul database)
const sessioni = new Map(); // visitatore -> { id, ultimo, attr }
setInterval(() => {
  const limite = Date.now() - 2 * DURATA_SESSIONE;
  for (const [k, v] of sessioni) if (v.ultimo < limite) sessioni.delete(k);
}, 10 * 60_000).unref();

async function sessione(visitatore, prov, forzaNuova) {
  const ora = Date.now();
  let s = sessioni.get(visitatore);
  if (!s) {
    const r = await uno(`SELECT sessione, ts, canale, sorgente, ricerca, ref_host, utm_source, utm_medium, utm_campaign
      FROM stat_visite WHERE visitatore=$1 AND ts > NOW() - INTERVAL '30 minutes' AND tipo='pagina'
      ORDER BY ts DESC LIMIT 1`, [visitatore]).catch(() => null);
    if (r) {
      const primo = await uno(`SELECT canale, sorgente, ricerca, ref_host, utm_source, utm_medium, utm_campaign
        FROM stat_visite WHERE sessione=$1 AND nuova_sessione LIMIT 1`, [r.sessione]).catch(() => null);
      s = { id: r.sessione, ultimo: new Date(r.ts).getTime(), attr: primo || r };
    }
  }
  const esterna = prov && !prov.interno && (prov.canale !== 'Diretto' || prov.utm_source);
  let nuova = false;
  if (!s || ora - s.ultimo > DURATA_SESSIONE || (forzaNuova && esterna && prov.sorgente !== s.attr.sorgente)) {
    s = { id: crypto.randomBytes(9).toString('base64url'), ultimo: ora, attr: prov && !prov.interno ? prov : { canale: 'Diretto', sorgente: 'Accesso diretto' } };
    nuova = true;
  }
  s.ultimo = ora;
  sessioni.set(visitatore, s);
  return { id: s.id, nuova, attr: s.attr };
}

// ---------------------------------------------------------------- identificativo visitatore
function identificativo(req, res) {
  let id = req.cookies && req.cookies[COOKIE];
  let nuovo = false;
  if (!id || !/^[A-Za-z0-9_-]{16,40}$/.test(id)) {
    nuovo = true;
    id = crypto.randomBytes(12).toString('base64url');
    try {
      res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: config.produzione, maxAge: 395 * 86400_000, path: '/' });
    } catch { /* intestazioni già inviate */ }
  }
  return { id, nuovo };
}

function hostPropri(req) {
  const l = [String(req.headers.host || '').split(':')[0].toLowerCase()];
  try { l.push(new URL(config.urlPubblico).hostname.toLowerCase()); } catch { /* ignorato */ }
  return l;
}

function basi(req) {
  const ua = req.headers['user-agent'] || '';
  const g = geo(ipCliente(req));
  const lingua = String(req.headers['accept-language'] || '').split(',')[0].split(';')[0].trim().toLowerCase() || null;
  return {
    ...dispositivo(ua),
    lingua: corto(lingua, 20),
    paese: g.country || null,
    regione: g.country === 'IT' ? (REGIONI_IT[g.region] || null) : (g.region || null),
    citta: corto((g.country === 'IT' && CITTA_IT[g.city]) || g.city || null, 80),
    utente_id: req.utente ? req.utente.id : null,
    admin: Boolean(req.utente && req.utente.is_admin),
  };
}

const COLONNE = ['tipo', 'evento', 'visitatore', 'sessione', 'nuova_sessione', 'nuovo_visitatore', 'percorso', 'pagina', 'gioco',
  'dettaglio', 'referrer', 'ref_host', 'canale', 'sorgente', 'ricerca', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
  'utm_content', 'click_id', 'dispositivo', 'browser', 'sistema', 'lingua', 'schermo', 'paese', 'regione', 'citta', 'durata_s',
  'utente_id', 'admin', 'bot'];
async function inserisci(riga) {
  const predefiniti = { nuova_sessione: false, nuovo_visitatore: false, admin: false };
  const vals = COLONNE.map((c) => (riga[c] == null ? (predefiniti[c] ?? null) : riga[c]));
  await q(`INSERT INTO stat_visite (${COLONNE.join(',')}) VALUES (${COLONNE.map((_, i) => `$${i + 1}`).join(',')})`, vals);
}

// ---------------------------------------------------------------- middleware: visite alle pagine
function èPagina(req) {
  return req.method === 'GET' && (req.path === '/' || /^\/[a-z0-9-]+\.html$/.test(req.path));
}

function raccogli(req, res, next) {
  if (!èPagina(req)) return next();
  const ua = req.headers['user-agent'] || '';
  const nomeRobot = robot(ua);
  // Le richieste di "prefetch" del browser non sono visite vere.
  if (/prefetch|prerender/i.test(req.headers.purpose || req.headers['sec-purpose'] || '')) return next();
  const ident = nomeRobot ? null : identificativo(req, res);
  res.on('finish', () => {
    if (res.statusCode !== 200) return;
    registraPagina(req, ident, nomeRobot).catch((e) => console.warn('Statistiche (visita):', e.message));
  });
  next();
}

async function registraPagina(req, ident, nomeRobot) {
  const percorso = req.path === '/index.html' ? '/' : req.path;
  const gioco = corto(req.query.slug || req.query.gioco || null, 80);
  const base = { tipo: 'pagina', percorso, pagina: nomePagina(percorso), gioco };
  if (nomeRobot) {
    await inserisci({ ...base, visitatore: 'robot', sessione: 'robot', bot: nomeRobot, ...dispositivo(req.headers['user-agent'] || '') });
    return;
  }
  const prov = classifica({ referrer: req.headers.referer || req.headers.referrer, query: req.query, hostProprio: hostPropri(req) });
  const visitatore = ident.id;
  const s = await sessione(visitatore, prov, true);
  const attr = s.nuova ? prov : s.attr;
  await inserisci({
    ...base, ...basi(req), visitatore, sessione: s.id, nuova_sessione: s.nuova, nuovo_visitatore: ident.nuovo && s.nuova,
    referrer: s.nuova ? prov.referrer : (prov.interno ? null : prov.referrer), ref_host: s.nuova ? prov.ref_host : null,
    canale: s.nuova ? (prov.interno ? 'Diretto' : prov.canale) : attr.canale,
    sorgente: s.nuova ? (prov.interno ? 'Accesso diretto' : prov.sorgente) : attr.sorgente,
    ricerca: s.nuova ? prov.ricerca : null,
    utm_source: prov.utm_source, utm_medium: prov.utm_medium, utm_campaign: prov.utm_campaign,
    utm_term: prov.utm_term, utm_content: prov.utm_content, click_id: prov.click_id,
  });
}

// ---------------------------------------------------------------- middleware: iscrizioni e abbonamenti
const EVENTI_API = { '/api/registrati': 'iscrizione', '/api/abbonamento/attiva': 'abbonamento' };
function eventi(req, res, next) {
  const ev = req.method === 'POST' && EVENTI_API[req.path];
  if (!ev) return next();
  const ident = identificativo(req, res);
  res.on('finish', () => {
    if (res.statusCode !== 200) return;
    registraEvento(req, ident.id, ev, null).catch((e) => console.warn('Statistiche (evento):', e.message));
  });
  next();
}

async function registraEvento(req, visitatore, evento, extra) {
  const s = await sessione(visitatore, null, false);
  await inserisci({
    tipo: 'evento', evento, visitatore, sessione: s.id, ...basi(req),
    canale: s.attr.canale, sorgente: s.attr.sorgente, ...(extra || {}),
  });
}

// ---------------------------------------------------------------- segnali dal browser (durata, click, ricerche interne)
const segnali = express.Router();
segnali.post('/api/stat', express.text({ type: '*/*', limit: '4kb' }), async (req, res) => {
  res.status(204).end();
  if (robot(req.headers['user-agent'] || '')) return;
  let d;
  try { d = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return; }
  if (!d || typeof d !== 'object') return;
  const visitatore = req.cookies && req.cookies[COOKIE];
  if (!visitatore) return;
  const percorso = corto(String(d.p || '').split('?')[0], 120);
  try {
    if (d.t === 'durata') {
      const sec = Math.max(0, Math.min(6 * 3600, Math.round(Number(d.s) || 0)));
      const schermo = /^\d{2,5}x\d{2,5}$/.test(d.w || '') ? d.w : null;
      await q(`UPDATE stat_visite SET durata_s = GREATEST(COALESCE(durata_s,0), $1), schermo = COALESCE(schermo, $2)
        WHERE id = (SELECT id FROM stat_visite WHERE visitatore=$3 AND percorso=$4 AND tipo='pagina'
                    AND ts > NOW() - INTERVAL '7 hours' ORDER BY ts DESC LIMIT 1)`, [sec, schermo, visitatore, percorso === '/index.html' ? '/' : percorso]);
    } else if (d.t === 'click' || d.t === 'ricerca') {
      const testo = corto(String(d.x || '').replace(/\s+/g, ' ').trim(), 120);
      if (!testo) return;
      await registraEvento(req, visitatore, d.t === 'click' ? 'click' : 'ricerca_interna', {
        percorso, pagina: nomePagina(percorso), dettaglio: d.t === 'ricerca' ? testo.toLowerCase() : testo,
        gioco: corto(d.g || null, 80), referrer: d.t === 'click' ? corto(d.h || null, 300) : null,
      });
    }
  } catch (e) { console.warn('Statistiche (segnale):', e.message); }
});

// ---------------------------------------------------------------- avvio e pulizia
async function prepara() {
  await q(fs.readFileSync(path.join(__dirname, '..', 'sql', 'statistiche.sql'), 'utf8'));
  const pulisci = () => q(`DELETE FROM stat_visite WHERE ts < NOW() - INTERVAL '400 days'
      OR (bot IS NOT NULL AND ts < NOW() - INTERVAL '30 days')`).catch(() => {});
  pulisci();
  setInterval(pulisci, 24 * 3600_000).unref();
}

// Script che il server aggiunge in fondo alle pagine del portale (non ai giochi).
const SCRIPT = '<script src="/js/statistiche-segnali.js" defer></script>';

module.exports = { prepara, raccogli, eventi, segnali, SCRIPT, classifica, robot, nomePagina };
