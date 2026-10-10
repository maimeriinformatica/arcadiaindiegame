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
app.use(caricaUtente);

app.get('/salute', (req, res) => res.json({ ok: true }));

app.use('/api', require('./src/rotte/api'));
app.use('/api/admin', require('./src/rotte/admin'));
app.use(require('./src/rotte/gioca'));

// Pagine HTML: sostituisce i segnaposto con i dati della piattaforma.
const PUBBLICA = path.join(__dirname, 'public');
const cacheHtml = new Map();
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
      .replaceAll('{{DITTA_EMAIL}}', d.email || d.pec);
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

(async () => {
  await db.migra();
  await storage.prepara();
  await seminaDemo();
  app.listen(config.porta, () => {
    console.log(`${config.nome} attivo su ${config.urlPubblico}`);
    console.log(`Storage: ${config.storage.tipo} · PayPal: ${config.paypal.simulato ? 'SIMULATO' : config.paypal.ambiente}`);
    if (!config.paypal.simulato && !(config.paypal.clientId && config.paypal.pianoId)) {
      console.warn('ATTENZIONE: PayPal non configurato (PAYPAL_CLIENT_ID / PAYPAL_PLAN_ID). Gli utenti non potranno abbonarsi.');
    }
  });
})().catch((e) => { console.error('Avvio non riuscito:', e); process.exit(1); });
