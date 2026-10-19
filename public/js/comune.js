// Funzioni comuni a tutte le pagine.
const NOME = document.documentElement.dataset.nome || document.title;

async function api(percorso, opzioni = {}) {
  const o = { credentials: 'same-origin', ...opzioni };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers = { 'Content-Type': 'application/json', ...(o.headers || {}) };
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(`/api${percorso}`, o);
  let dati = {};
  try { dati = await r.json(); } catch { /* risposta vuota */ }
  if (!r.ok) throw new Error(dati.errore || `Errore ${r.status}`);
  return dati;
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const data = (d) => d ? new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const parametro = (n) => new URLSearchParams(location.search).get(n);
function messaggio(el, testo, tipo = 'errore') { el.className = `avviso ${tipo}`; el.textContent = testo || ''; }

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="7" width="28" height="18" rx="9" fill="#ff7a45"/><rect x="8" y="14" width="8" height="3" rx="1.5" fill="#17153a"/><rect x="10.5" y="11.5" width="3" height="8" rx="1.5" fill="#17153a"/><circle cx="21.5" cy="13.5" r="2" fill="#ffd166"/><circle cx="24.5" cy="17.5" r="2" fill="#17153a"/></svg>`;

let _io = null;
async function chiSono() {
  if (!_io) _io = api('/io').catch(() => ({ utente: null, accesso: { accesso: false } }));
  return _io;
}

async function testata() {
  const qui = location.pathname;
  const io = await chiSono();
  const u = io.utente;
  const link = (href, testo, cls = '') =>
    `<a href="${href}" class="${cls}" ${qui === href ? 'aria-current="page"' : ''}>${testo}</a>`;
  const voci = [link('/', 'Giochi')];
  if (u) {
    if (u.admin) voci.push(link('/admin.html', 'Gestione'), link('/statistiche.html', 'Statistiche'));
    voci.push(link('/account.html', 'Account'));
    if (!io.accesso.accesso) voci.push(link('/abbonati.html', 'Abbonati', 'btn piccolo'));
  } else {
    voci.push(link('/accedi.html', 'Accedi'));
    voci.push(link('/abbonati.html', 'Abbonati', 'btn piccolo'));
  }
  const h = document.createElement('header');
  h.className = 'testata';
  h.innerHTML = `<div class="fila"><a class="logo" href="/">${LOGO}<span>${esc(NOME)}</span></a><nav class="nav" aria-label="Principale">${voci.join('')}</nav></div>`;
  document.body.prepend(h);

  const f = document.createElement('footer');
  f.className = 'piede';
  const d = document.documentElement.dataset;
  f.innerHTML = `<div class="fila"><span>${esc(NOME)} è un servizio di ${esc(d.ditta)} · P.IVA ${esc(d.piva)}</span>
    <span><a href="/termini.html">Termini</a> · <a href="/privacy.html">Privacy</a></span></div>`;
  document.body.append(f);
  return io;
}

function urlCopertina(g) { return g.ha_copertina ? `/copertine/${encodeURIComponent(g.slug)}?v=${new Date(g.aggiornato_il).getTime()}` : '/img/copertina-vuota.svg'; }
