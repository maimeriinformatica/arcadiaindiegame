// Crea su PayPal il prodotto e il piano di abbonamento mensile, e (facoltativo) il webhook.
// Uso:  node scripts/configura-paypal.js [https://tuo-sito.onrender.com]
require('../src/carica-env');
const config = require('../src/config');
const paypal = require('../src/paypal');

(async () => {
  if (!config.paypal.clientId || !config.paypal.secret) {
    console.error('Imposta prima PAYPAL_CLIENT_ID e PAYPAL_CLIENT_SECRET (nel file .env o nelle variabili d\'ambiente).');
    process.exit(1);
  }
  console.log(`Ambiente PayPal: ${config.paypal.ambiente.toUpperCase()}`);
  const { prodotto, piano } = await paypal.creaPiano({ nome: config.nome, prezzo: config.prezzo });
  console.log(`Prodotto creato: ${prodotto.id}`);
  console.log(`Piano creato:    ${piano.id}  (${config.prezzo} EUR al mese)`);

  const url = process.argv[2] || (config.urlPubblico.startsWith('https://') ? config.urlPubblico : '');
  let webhook = null;
  if (url) {
    try {
      webhook = await paypal.creaWebhook(`${url.replace(/\/$/, '')}/api/paypal/webhook`);
      console.log(`Webhook creato:  ${webhook.id}`);
    } catch (e) {
      console.warn(`Webhook non creato (${e.message.slice(0, 200)}). Puoi crearlo dal pannello sviluppatori PayPal.`);
    }
  } else {
    console.log('Webhook non creato: passa l\'indirizzo pubblico https del sito come argomento per crearlo.');
  }

  console.log('\nAggiungi queste variabili su Render (o nel file .env):');
  console.log(`PAYPAL_PLAN_ID=${piano.id}`);
  if (webhook) console.log(`PAYPAL_WEBHOOK_ID=${webhook.id}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
