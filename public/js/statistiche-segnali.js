// Statistiche del portale: tempo sulla pagina, click e ricerche interne.
// Nessun dato personale: niente testo dei campi (tranne la casella di ricerca), niente password.
(() => {
  const P = location.pathname;
  const gioco = new URLSearchParams(location.search).get('slug');
  const invia = (dati) => {
    const corpo = JSON.stringify({ p: P, g: gioco, ...dati });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/stat', new Blob([corpo], { type: 'text/plain' }))) return;
    } catch { /* ripiego sotto */ }
    fetch('/api/stat', { method: 'POST', body: corpo, keepalive: true, credentials: 'same-origin' }).catch(() => {});
  };

  // Tempo effettivo con la pagina visibile
  let visibile = document.visibilityState === 'visible' ? performance.now() : null;
  let totale = 0;
  let inviato = 0;
  const schermo = `${screen.width}x${screen.height}`;
  function chiudi() {
    if (visibile !== null) { totale += performance.now() - visibile; visibile = null; }
    const s = Math.round(totale / 1000);
    if (s > inviato) { inviato = s; invia({ t: 'durata', s, w: schermo }); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') chiudi();
    else visibile = performance.now();
  });
  addEventListener('pagehide', chiudi);
  setTimeout(() => invia({ t: 'durata', s: 0, w: schermo }), 1500); // schermo anche per visite brevissime

  // Click su link e pulsanti
  let ultimoClick = 0;
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a, button, [role=button], [role=tab], .chip');
    if (!el || Date.now() - ultimoClick < 300) return;
    ultimoClick = Date.now();
    let testo = el.getAttribute('aria-label') || el.innerText || el.title || el.getAttribute('alt') || '';
    if (!testo.trim()) { const img = el.querySelector('img[alt]'); testo = img ? img.alt : ''; }
    if (!testo.trim() && el.matches('a.gioco')) testo = (el.querySelector('h3') || {}).textContent || 'Gioco';
    let h = null;
    if (el.href) {
      try {
        const u = new URL(el.href, location.href);
        h = u.origin === location.origin ? u.pathname + u.search : u.href;
      } catch { /* link non valido */ }
    }
    invia({ t: 'click', x: testo.trim().slice(0, 120) || el.tagName.toLowerCase(), h });
  }, true);

  // Ricerche nel catalogo
  let timer = null;
  let ultima = '';
  document.addEventListener('input', (e) => {
    if (!e.target.matches('input[type=search]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = e.target.value.trim().toLowerCase();
      if (v.length >= 2 && v !== ultima && !ultima.startsWith(v)) { ultima = v; invia({ t: 'ricerca', x: v }); }
    }, 1500);
  });
})();
