// Configurazione centralizzata: tutto arriva da variabili d'ambiente.
const env = process.env;

const config = {
  nome: env.NOME_PIATTAFORMA || 'Arcadia Indie',
  porta: Number(env.PORT || 3000),
  urlPubblico: (env.URL_PUBBLICO || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  produzione: env.NODE_ENV === 'production',
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET || 'cambia-questa-chiave-in-produzione',
  adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),

  // Abbonamento
  prezzo: env.PREZZO_ABBONAMENTO || '1.00',
  valuta: 'EUR',

  paypal: {
    clientId: env.PAYPAL_CLIENT_ID || '',
    secret: env.PAYPAL_CLIENT_SECRET || '',
    pianoId: env.PAYPAL_PLAN_ID || '',
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
    ambiente: env.PAYPAL_AMBIENTE === 'live' ? 'live' : 'sandbox',
    // Solo per prove in locale: simula PayPal senza pagamenti reali.
    simulato: env.PAYPAL_SIMULATO === '1',
  },

  storage: {
    tipo: env.STORAGE === 'supabase' ? 'supabase' : 'locale',
    cartellaLocale: env.STORAGE_CARTELLA || './dati/storage',
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseKey: env.SUPABASE_SERVICE_KEY || '',
    bucket: env.SUPABASE_BUCKET || 'giochi',
  },

  maxUploadMb: Number(env.MAX_UPLOAD_MB || 300),

  ditta: {
    ragioneSociale: env.DITTA_NOME || 'Maimeri Informatica',
    indirizzo: env.DITTA_INDIRIZZO || 'Via Berto Barbarani 76 – Volargne (VR)',
    piva: env.DITTA_PIVA || '05093730231',
    pec: env.DITTA_PEC || 'maimeri.informatica@pec.it',
    email: env.DITTA_EMAIL || '',
  },
};

// Problemi bloccanti e avvisi, mostrati tutti insieme all'avvio (vedi server.js).
config.problemi = [];
config.avvisi = [];

if (config.produzione && config.jwtSecret === 'cambia-questa-chiave-in-produzione') {
  // Non blocchiamo l'avvio: usiamo una chiave casuale (gli utenti dovranno riaccedere a ogni riavvio).
  config.jwtSecret = require('crypto').randomBytes(32).toString('hex');
  config.avvisi.push('JWT_SECRET non impostata: uso una chiave temporanea, gli utenti verranno disconnessi a ogni riavvio. Aggiungila su Render (una frase lunga e casuale).');
}
if (config.produzione && config.paypal.simulato) {
  config.problemi.push('PAYPAL_SIMULATO=1 non è ammesso in produzione: toglila dalle variabili di Render.');
}
if (!config.databaseUrl) {
  config.problemi.push('Manca DATABASE_URL: in Supabase apri "Connect" → "Session pooler", copia la stringa e sostituisci [YOUR-PASSWORD] con la password del database.');
} else if (/\[YOUR-PASSWORD\]/i.test(config.databaseUrl)) {
  config.problemi.push('In DATABASE_URL c\'è ancora "[YOUR-PASSWORD]": sostituiscilo con la password del database Supabase (senza parentesi quadre).');
}
if (config.storage.tipo === 'supabase') {
  if (!config.storage.supabaseUrl) config.problemi.push('STORAGE=supabase ma manca SUPABASE_URL (Supabase → Project Settings → API → Project URL).');
  if (!config.storage.supabaseKey) config.problemi.push('STORAGE=supabase ma manca SUPABASE_SERVICE_KEY (Supabase → Project Settings → API → chiave service_role).');
}
if (config.produzione && config.storage.tipo === 'locale') {
  config.avvisi.push('STORAGE non è "supabase": i giochi caricati verranno persi a ogni nuovo deploy di Render.');
}
if (!config.paypal.simulato && !(config.paypal.clientId && config.paypal.pianoId)) {
  config.avvisi.push('PayPal non configurato (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_PLAN_ID): il sito funziona ma nessuno può abbonarsi.');
}

module.exports = config;
