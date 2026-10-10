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

if (config.produzione && config.jwtSecret === 'cambia-questa-chiave-in-produzione') {
  console.error('ERRORE: imposta JWT_SECRET in produzione.');
  process.exit(1);
}
if (config.produzione && config.paypal.simulato) {
  console.error('ERRORE: PAYPAL_SIMULATO non può essere attivo in produzione.');
  process.exit(1);
}

module.exports = config;
