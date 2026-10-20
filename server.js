require('./src/carica-env');
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./src/config');
const db = require('./src/db');
const storage = require('./src/storage');
const { caricaUtente } = require('./src/accesso');
const { seminaDemo } = require('./src/semina');
const stat = require('./src/statistiche');
const inviti = require('./src/inviti');

const app = express();
app.set('trust proxy', 1); // Render sta dietro un proxy
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false,          // i giochi caricano librerie e risorse eterogenee
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
// Finché database e storage non sono pronti, il sito risponde con una pagina di attesa
// invece di chiudersi: così su Render la porta è subito aperta e il motivo resta leggibile nel log.
let pronto = false;
let erroreAvvio = null;
app.get('/salute', (req, res) => res.status(pronto ? 200 : 503).json({ ok: pronto }));
app.use((req, res, next) => {
  if (pronto) return next();
  res.status(503).set('Retry-After', '30');
  if (req.path.startsWith('/api/')) return res.json({ errore: 'Piattaforma in avvio, riprova tra poco.' });
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.nome}</title><body style="background:#17153a;color:#f6f0ff;font:18px system-ui;display:grid;place-content:center;min-height:100vh;text-align:center;padding:16px">
<h1>${config.nome}</h1><p>${erroreAvvio ? 'La piattaforma è in manutenzione. Torna tra qualche minuto.' : 'La piattaforma si sta avviando…'}</p>
${erroreAvvio ? '' : '<script>setTimeout(()=>location.reload(),4000)</script>'}`);
});
app.use(caricaUtente);
app.use(inviti.cattura); // ?invito=CODICE → cookie per la registrazione

// Statistiche di traffico (solo pagine del portale: i giochi non vengono toccati)
app.use(stat.segnali);
app.use(stat.eventi);
app.use(stat.raccogli);

app.use('/api', require('./src/rotte/api'));
app.use('/api/admin/statistiche', require('./src/rotte/statistiche'));
app.use('/api/admin', require('./src/rotte/admin'));
app.use(require('./src/rotte/gioca'));

// Pagine HTML: sostituisce i segnaposto con i dati della piattaforma.
const PUBBLICA = path.join(__dirname, 'public');
const cacheHtml = new Map();
const VERSIONE = Date.now().toString(36); // cambia a ogni deploy: il browser riscarica CSS e script aggiornati
function paginaHtml(nome) {
  if (!config.produzione || !cacheHtml.has(nome)) {
    const d = config.ditta;
    const html = fs.readFileSync(path.join(PUBBLICA, nome), 'utf8')
      .replaceAll('{{NOME}}', config.nome)
      .replaceAll('{{PREZZO}}', config.prezzo.replace('.', ','))
      .replaceAll('{{ANNO}}', String(new Date().getFullYear()))
      .replaceAll('{{DITTA}}', d.ragioneSociale)
      .replaceAll('{{DITTA_INDIRIZZO}}', d.indirizzo)
      .replaceAll('{{DITTA_PIVA}}', d.piva)
      .replaceAll('{{DITTA_PEC}}', d.pec)
      .replaceAll('{{DITTA_EMAIL}}', d.email || d.pec)
      .replace('</body>', `${stat.SCRIPT}\n</body>`)
      .replace(/(href|src)="(\/(?:css|js)\/[a-z0-9-]+\.(?:css|js))"/g, `$1="$2?v=${VERSIONE}"`);
    cacheHtml.set(nome, html);
  }
  return cacheHtml.get(nome);
}
app.get(['/', '/:pagina.html'], (req, res, next) => {
  const nome = req.params.pagina ? `${req.params.pagina}.html` : 'index.html';
  if (!/^[a-z0-9-]+\.html$/.test(nome) || !fs.existsSync(path.join(PUBBLICA, nome))) return next();
  res.type('html').set('Cache-Control', 'no-cache').send(paginaHtml(nome));
});
app.use(express.static(PUBBLICA, { maxAge: config.produzione ? '1h' : 0, index: false }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ errore: 'Non trovato' });
  res.status(404).type('html').send(paginaHtml('404.html'));
});

// Errori: messaggi chiari per l'utente, dettagli nel log.
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') err = Object.assign(new Error(`File troppo grande (max ${config.maxUploadMb} MB).`), { status: 413 });
  const status = err.status && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ errore: status >= 500 ? 'Errore del server. Riprova.' : err.message });
});

function riquadro(titolo, righe) {
  console.error(`\n======== ${titolo} ========`);
  righe.forEach((r, n) => console.error(`${n + 1}. ${r}`));
  console.error('='.repeat(titolo.length + 18) + '\n');
}

// La porta si apre SUBITO (Render la cerca entro pochi secondi), poi si prepara il resto.
app.listen(config.porta, '0.0.0.0', () => {
  console.log(`${config.nome} in ascolto sulla porta ${config.porta}`);
  avvia();
});

async function avvia() {
  config.avvisi.forEach((a) => console.warn(`ATTENZIONE: ${a}`));
  if (config.problemi.length) {
    erroreAvvio = 'configurazione';
    riquadro('CONFIGURAZIONE INCOMPLETA – correggi su Render → Environment e rifai il deploy', config.problemi);
    setTimeout(() => process.exit(1), 60_000); // lascia leggere il log, poi Render riprova
    return;
  }
  let fase = 'database';
  try {
    await db.migra();
    await stat.prepara();
    console.log('Database collegato e tabelle pronte.');
    fase = 'storage';
    await storage.prepara();
    fase = 'giochi dimostrativi';
    await seminaDemo();
    pronto = true;
    console.log(`${config.nome} attivo su ${config.urlPubblico}`);
    console.log(`Storage: ${config.storage.tipo} · PayPal: ${config.paypal.simulato ? 'SIMULATO' : config.paypal.ambiente}`);
  } catch (e) {
    erroreAvvio = e;
    let spiegazione = null;
    if (fase === 'database') spiegazione = db.spiegaErrore(e);
    if (fase === 'storage') {
      spiegazione = /Invalid Compact JWS|invalid.*(key|jwt|signature)|Unauthorized|403|401/i.test(`${e.message} ${e.statusCode || ''}`)
        ? 'SUPABASE_SERVICE_KEY non è valida: copia la chiave "service_role" (non la "anon") da Supabase → Project Settings → API.'
        : 'Non riesco a usare lo storage di Supabase: controlla SUPABASE_URL (https://xxxx.supabase.co) e SUPABASE_SERVICE_KEY.';
    }
    riquadro(`AVVIO NON RIUSCITO (fase: ${fase})`, [
      spiegazione || 'Errore non previsto: vedi il dettaglio qui sotto.',
      `Dettaglio tecnico: ${e.code ? e.code + ' ' : ''}${e.message}`,
    ]);
    setTimeout(() => process.exit(1), 60_000);
  }
}
