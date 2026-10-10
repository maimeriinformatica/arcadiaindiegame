// Integrazione PayPal Subscriptions (API REST v1 billing).
const config = require('./config');

const BASE = config.paypal.ambiente === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

let token = null;
let scadenzaToken = 0;

async function accessToken() {
  if (token && Date.now() < scadenzaToken - 60_000) return token;
  const auth = Buffer.from(`${config.paypal.clientId}:${config.paypal.secret}`).toString('base64');
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal token: ${r.status} ${await r.text()}`);
  const j = await r.json();
  token = j.access_token;
  scadenzaToken = Date.now() + j.expires_in * 1000;
  return token;
}

async function chiama(metodo, percorso, corpo) {
  const r = await fetch(`${BASE}${percorso}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const testo = await r.text();
  if (!r.ok) {
    const e = new Error(`PayPal ${metodo} ${percorso}: ${r.status} ${testo}`);
    e.status = r.status;
    throw e;
  }
  return testo ? JSON.parse(testo) : {};
}

// ---------------- Modalità simulata (solo sviluppo) ----------------
const simulati = new Map();
function simula(id, custom, stato = 'ACTIVE') {
  const prossimo = new Date(Date.now() + 30 * 86400_000).toISOString();
  const s = {
    id, status: stato, plan_id: config.paypal.pianoId || 'P-SIMULATO', custom_id: String(custom),
    billing_info: { next_billing_time: prossimo, last_payment: { time: new Date().toISOString() } },
  };
  simulati.set(id, s);
  return s;
}

async function leggiAbbonamento(id) {
  if (config.paypal.simulato) {
    const s = simulati.get(id);
    if (!s) { const e = new Error('non trovato'); e.status = 404; throw e; }
    return s;
  }
  return chiama('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
}

async function disdiciAbbonamento(id, motivo = 'Disdetta richiesta dal cliente') {
  if (config.paypal.simulato) {
    const s = simulati.get(id);
    if (s) s.status = 'CANCELLED';
    return;
  }
  await chiama('POST', `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: motivo });
}

// Verifica la firma di un webhook usando l'API di PayPal.
async function verificaWebhook(headers, evento) {
  if (!config.paypal.webhookId) return false;
  const r = await chiama('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: config.paypal.webhookId,
    webhook_event: evento,
  });
  return r.verification_status === 'SUCCESS';
}

// Crea prodotto + piano mensile (usato dallo script di configurazione).
async function creaPiano({ nome, prezzo }) {
  const prodotto = await chiama('POST', '/v1/catalogs/products', {
    name: nome, description: `Abbonamento mensile a ${nome}`, type: 'DIGITAL', category: 'SOFTWARE',
  });
  const piano = await chiama('POST', '/v1/billing/plans', {
    product_id: prodotto.id,
    name: `${nome} – abbonamento mensile`,
    description: `Accesso illimitato a tutti i giochi di ${nome}`,
    status: 'ACTIVE',
    billing_cycles: [{
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
      pricing_scheme: { fixed_price: { value: prezzo, currency_code: 'EUR' } },
    }],
    payment_preferences: {
      auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 2,
    },
  });
  return { prodotto, piano };
}

async function creaWebhook(url) {
  return chiama('POST', '/v1/notifications/webhooks', {
    url,
    event_types: [
      'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.UPDATED', 'BILLING.SUBSCRIPTION.CANCELLED',
      'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.RE-ACTIVATED',
      'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED',
    ].map((name) => ({ name })),
  });
}

module.exports = {
  leggiAbbonamento, disdiciAbbonamento, verificaWebhook, creaPiano, creaWebhook, simula,
  urlSdk: () => `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypal.clientId)}`
    + '&vault=true&intent=subscription&currency=EUR&locale=it_IT&components=buttons',
};
