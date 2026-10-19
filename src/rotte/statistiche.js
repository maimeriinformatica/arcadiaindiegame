// API delle statistiche: solo per amministratori.
const express = require('express');
const { q, uno } = require('../db');
const A = require('../accesso');

const r = express.Router();
r.use(A.richiediAdmin);

// Intervallo richiesto, in giorni del calendario italiano.
function intervallo(qs) {
  const oggi = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const valida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  let da;
  let a;
  if (valida(qs.da) && valida(qs.a)) { da = qs.da; a = qs.a; }
  else {
    const giorni = Math.max(1, Math.min(400, Number(qs.giorni) || 30));
    const inizio = new Date(oggi); inizio.setDate(inizio.getDate() - (giorni - 1));
    da = iso(inizio); a = iso(oggi);
  }
  if (da > a) [da, a] = [a, da];
  const durata = Math.round((new Date(a) - new Date(da)) / 86400_000) + 1;
  const pIni = new Date(da); pIni.setDate(pIni.getDate() - durata);
  const pFin = new Date(da); pFin.setDate(pFin.getDate() - 1);
  return { da, a, durata, prec: { da: iso(pIni), a: iso(pFin) }, admin: qs.admin === '1' };
}

// Frammento comune: righe del periodo, senza robot e (di norma) senza le visite degli amministratori.
const BASE = `ts >= ($1::date)::timestamp AT TIME ZONE 'Europe/Rome'
  AND ts < (($2::date) + 1)::timestamp AT TIME ZONE 'Europe/Rome'
  AND bot IS NULL AND (NOT admin OR $3::boolean)`;
const P = (i) => [i.da, i.a, i.admin];

async function kpi(da, a, admin) {
  const p = [da, a, admin];
  const [k, s] = await Promise.all([
    uno(`SELECT
        COUNT(*) FILTER (WHERE tipo='pagina')::int AS pagine,
        COUNT(*) FILTER (WHERE tipo='pagina' AND nuova_sessione)::int AS visite,
        COUNT(DISTINCT visitatore) FILTER (WHERE tipo='pagina')::int AS visitatori,
        COUNT(DISTINCT visitatore) FILTER (WHERE nuovo_visitatore)::int AS nuovi,
        COUNT(*) FILTER (WHERE evento='iscrizione')::int AS iscrizioni,
        COUNT(*) FILTER (WHERE evento='abbonamento')::int AS abbonamenti,
        COUNT(*) FILTER (WHERE tipo='pagina' AND pagina='Gioca')::int AS partite
      FROM stat_visite WHERE ${BASE}`, p),
    uno(`WITH s AS (
        SELECT sessione, COUNT(*) FILTER (WHERE tipo='pagina') AS pv, SUM(durata_s) AS dur
        FROM stat_visite WHERE ${BASE} GROUP BY sessione HAVING COUNT(*) FILTER (WHERE tipo='pagina') > 0)
      SELECT ROUND(AVG(pv)::numeric, 1)::float AS pagine_per_visita,
             ROUND(AVG(dur) FILTER (WHERE dur IS NOT NULL))::int AS durata_media,
             CASE WHEN COUNT(*) > 0 THEN ROUND(100.0 * COUNT(*) FILTER (WHERE pv = 1) / COUNT(*))::int END AS rimbalzo
      FROM s`, p),
  ]);
  return { ...k, ...s };
}

r.get('/', async (req, res, next) => {
  try {
    const i = intervallo(req.query);
    const p = P(i);
    const orario = i.durata <= 2;
    const unita = orario ? 'hour' : 'day';
    const [
      attuale, precedente, serie, canali, sorgenti, siti, linkEsterni, ricerche, ricercheNascoste, ricercheInterne,
      campagne, pagine, ingresso, uscita, giochi, paesi, regioni, citta, dispositivi, browser, sistemi, lingue,
      schermi, orari, click, ritorno, robot, ultime,
    ] = await Promise.all([
      kpi(i.da, i.a, i.admin),
      kpi(i.prec.da, i.prec.a, i.admin),
      q(`WITH g AS (
          SELECT generate_series(($1::date)::timestamp, (($2::date) + 1)::timestamp - INTERVAL '1 ${unita}', INTERVAL '1 ${unita}') AS t),
        v AS (
          SELECT date_trunc('${unita}', ts AT TIME ZONE 'Europe/Rome') AS t,
            COUNT(*) FILTER (WHERE tipo='pagina' AND nuova_sessione) AS visite,
            COUNT(DISTINCT visitatore) FILTER (WHERE tipo='pagina') AS visitatori,
            COUNT(*) FILTER (WHERE tipo='pagina') AS pagine,
            COUNT(*) FILTER (WHERE evento='iscrizione') AS iscrizioni,
            COUNT(*) FILTER (WHERE evento='abbonamento') AS abbonamenti
          FROM stat_visite WHERE ${BASE} GROUP BY 1)
        SELECT to_char(g.t, 'YYYY-MM-DD"T"HH24:MI') AS t, COALESCE(visite,0)::int AS visite, COALESCE(visitatori,0)::int AS visitatori,
          COALESCE(pagine,0)::int AS pagine, COALESCE(iscrizioni,0)::int AS iscrizioni, COALESCE(abbonamenti,0)::int AS abbonamenti
        FROM g LEFT JOIN v ON v.t = g.t ORDER BY g.t`, p),
      q(`SELECT canale AS nome, COUNT(*) FILTER (WHERE tipo='pagina' AND nuova_sessione)::int AS visite,
          COUNT(DISTINCT visitatore) FILTER (WHERE tipo='pagina' AND nuova_sessione)::int AS visitatori,
          COUNT(*) FILTER (WHERE evento='iscrizione')::int AS iscrizioni, COUNT(*) FILTER (WHERE evento='abbonamento')::int AS abbonamenti
        FROM stat_visite WHERE ${BASE} AND canale IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, p),
      q(`SELECT sorgente AS nome, canale, COUNT(*) FILTER (WHERE tipo='pagina' AND nuova_sessione)::int AS visite,
          COUNT(DISTINCT visitatore) FILTER (WHERE tipo='pagina' AND nuova_sessione)::int AS visitatori,
          COUNT(*) FILTER (WHERE evento='iscrizione')::int AS iscrizioni, COUNT(*) FILTER (WHERE evento='abbonamento')::int AS abbonamenti
        FROM stat_visite WHERE ${BASE} AND sorgente IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) FILTER (WHERE tipo='pagina' AND nuova_sessione) > 0
          OR COUNT(*) FILTER (WHERE tipo='evento' AND evento IN ('iscrizione','abbonamento')) > 0
        ORDER BY 3 DESC LIMIT 50`, p),
      q(`SELECT ref_host AS nome, canale, COUNT(*)::int AS visite, COUNT(DISTINCT visitatore)::int AS visitatori
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' AND nuova_sessione AND ref_host IS NOT NULL
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`, p),
      q(`SELECT referrer AS nome, COUNT(*)::int AS visite FROM stat_visite
        WHERE ${BASE} AND tipo='pagina' AND nuova_sessione AND referrer IS NOT NULL AND canale IN ('Siti esterni','Social','Assistenti AI','Email')
        GROUP BY 1 ORDER BY 2 DESC LIMIT 30`, p),
      q(`SELECT ricerca AS nome, sorgente, COUNT(*)::int AS visite FROM stat_visite
        WHERE ${BASE} AND tipo='pagina' AND nuova_sessione AND ricerca IS NOT NULL
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50`, p),
      uno(`SELECT COUNT(*)::int AS n FROM stat_visite
        WHERE ${BASE} AND tipo='pagina' AND nuova_sessione AND canale='Ricerca' AND ricerca IS NULL`, p),
      q(`SELECT dettaglio AS nome, COUNT(*)::int AS volte, COUNT(DISTINCT visitatore)::int AS persone FROM stat_visite
        WHERE ${BASE} AND evento='ricerca_interna' GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, p),
      q(`WITH ini AS (
          SELECT sessione, utm_campaign, utm_source, utm_medium, utm_content FROM stat_visite
          WHERE ${BASE} AND tipo='pagina' AND nuova_sessione
            AND (utm_campaign IS NOT NULL OR (utm_source IS NOT NULL AND canale <> 'Assistenti AI'))),
        ev AS (SELECT sessione, evento FROM stat_visite WHERE ${BASE} AND evento IN ('iscrizione','abbonamento'))
        SELECT COALESCE(ini.utm_campaign,'(senza nome)') AS campagna, COALESCE(ini.utm_source,'') AS sorgente,
          COALESCE(ini.utm_medium,'') AS mezzo, COALESCE(ini.utm_content,'') AS contenuto,
          COUNT(DISTINCT ini.sessione)::int AS visite,
          COUNT(ev.*) FILTER (WHERE ev.evento='iscrizione')::int AS iscrizioni,
          COUNT(ev.*) FILTER (WHERE ev.evento='abbonamento')::int AS abbonamenti
        FROM ini LEFT JOIN ev ON ev.sessione = ini.sessione
        GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 50`, p),
      q(`SELECT pagina AS nome, percorso, COUNT(*)::int AS viste, COUNT(DISTINCT visitatore)::int AS visitatori,
          ROUND(AVG(durata_s) FILTER (WHERE durata_s > 0))::int AS durata_media
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`, p),
      q(`SELECT pagina AS nome, COUNT(*)::int AS visite FROM stat_visite
        WHERE ${BASE} AND tipo='pagina' AND nuova_sessione GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, p),
      q(`SELECT pagina AS nome, COUNT(*)::int AS visite FROM (
          SELECT DISTINCT ON (sessione) pagina FROM stat_visite WHERE ${BASE} AND tipo='pagina'
          ORDER BY sessione, ts DESC) x GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, p),
      q(`SELECT s.gioco AS slug, COALESCE(g.titolo, s.gioco) AS nome,
          COUNT(*) FILTER (WHERE s.pagina='Scheda gioco')::int AS schede,
          COUNT(*) FILTER (WHERE s.pagina='Gioca')::int AS partite,
          COUNT(DISTINCT s.visitatore) FILTER (WHERE s.pagina='Gioca')::int AS giocatori,
          ROUND(AVG(s.durata_s) FILTER (WHERE s.pagina='Gioca' AND s.durata_s > 0))::int AS durata_media
        FROM stat_visite s LEFT JOIN giochi g ON g.slug = s.gioco
        WHERE ${BASE.replace(/\bts\b/g, 's.ts').replace(/\bbot\b/, 's.bot').replace(/\badmin\b/, 's.admin')}
          AND s.tipo='pagina' AND s.gioco IS NOT NULL
        GROUP BY 1, 2 ORDER BY 4 DESC, 3 DESC LIMIT 50`, p),
      q(`SELECT COALESCE(paese,'??') AS codice, COUNT(*) FILTER (WHERE nuova_sessione)::int AS visite,
          COUNT(DISTINCT visitatore)::int AS visitatori
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, p),
      q(`SELECT regione AS nome, COUNT(*) FILTER (WHERE nuova_sessione)::int AS visite, COUNT(DISTINCT visitatore)::int AS visitatori
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' AND paese='IT' AND regione IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, p),
      q(`SELECT citta AS nome, paese, regione, COUNT(*) FILTER (WHERE nuova_sessione)::int AS visite,
          COUNT(DISTINCT visitatore)::int AS visitatori
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' AND citta IS NOT NULL GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 40`, p),
      ...['dispositivo', 'browser', 'sistema', 'lingua', 'schermo'].map((col) => q(`SELECT COALESCE(${col},'Non rilevato') AS nome,
          COUNT(DISTINCT sessione)::int AS visite, COUNT(DISTINCT visitatore)::int AS visitatori
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, p)),
      q(`SELECT EXTRACT(ISODOW FROM ts AT TIME ZONE 'Europe/Rome')::int AS giorno,
          EXTRACT(HOUR FROM ts AT TIME ZONE 'Europe/Rome')::int AS ora, COUNT(*)::int AS visite
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' AND nuova_sessione GROUP BY 1, 2`, p),
      q(`SELECT dettaglio AS nome, pagina, COUNT(*)::int AS click, COUNT(DISTINCT visitatore)::int AS persone
        FROM stat_visite WHERE ${BASE} AND evento='click' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40`, p),
      uno(`SELECT COUNT(*) FILTER (WHERE nuovo_visitatore)::int AS nuovi,
          COUNT(*) FILTER (WHERE NOT nuovo_visitatore)::int AS di_ritorno
        FROM stat_visite WHERE ${BASE} AND tipo='pagina' AND nuova_sessione`, p),
      q(`SELECT bot AS nome, COUNT(*)::int AS richieste, MAX(ts) AS ultima,
          ARRAY_AGG(DISTINCT pagina) FILTER (WHERE pagina IS NOT NULL) AS pagine
        FROM stat_visite WHERE ts >= ($1::date)::timestamp AT TIME ZONE 'Europe/Rome'
          AND ts < (($2::date) + 1)::timestamp AT TIME ZONE 'Europe/Rome' AND bot IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC`, [i.da, i.a]),
      q(`WITH s AS (
          SELECT sessione, MIN(ts) AS inizio, MAX(ts) AS fine, COUNT(*) FILTER (WHERE tipo='pagina')::int AS pagine,
            SUM(durata_s)::int AS durata,
            ARRAY_AGG(pagina ORDER BY ts) FILTER (WHERE tipo='pagina') AS percorso,
            ARRAY_AGG(DISTINCT evento) FILTER (WHERE evento IN ('iscrizione','abbonamento')) AS eventi,
            MAX(utente_id) AS utente_id
          FROM stat_visite WHERE ${BASE} GROUP BY sessione HAVING COUNT(*) FILTER (WHERE tipo='pagina') > 0
          ORDER BY MAX(ts) DESC LIMIT 60)
        SELECT s.*, v.canale, v.sorgente, v.ricerca, v.ref_host, v.utm_campaign, v.dispositivo, v.browser, v.sistema,
          v.paese, v.regione, v.citta, v.nuovo_visitatore, u.email
        FROM s
        LEFT JOIN LATERAL (SELECT * FROM stat_visite x WHERE x.sessione = s.sessione AND x.tipo='pagina' ORDER BY x.ts LIMIT 1) v ON TRUE
        LEFT JOIN utenti u ON u.id = s.utente_id
        ORDER BY s.fine DESC`, p),
    ]);
    res.json({
      intervallo: i, orario, attuale, precedente, serie, canali, sorgenti, siti, linkEsterni, ricerche,
      ricercheNascoste: ricercheNascoste.n, ricercheInterne, campagne, pagine, ingresso, uscita, giochi,
      paesi, regioni, citta, dispositivi, browser, sistemi, lingue, schermi, orari, click, ritorno, robot, ultime,
    });
  } catch (e) { next(e); }
});

// Chi è sul sito adesso (ultimi 5 minuti)
r.get('/adesso', async (req, res, next) => {
  try {
    const righe = await q(`SELECT DISTINCT ON (sessione) sessione, ts, pagina, gioco, canale, sorgente, citta, paese, dispositivo
      FROM stat_visite WHERE ts > NOW() - INTERVAL '5 minutes' AND tipo='pagina' AND bot IS NULL AND NOT admin
      ORDER BY sessione, ts DESC`);
    res.json({ persone: righe.length, sessioni: righe.sort((x, y) => new Date(y.ts) - new Date(x.ts)) });
  } catch (e) { next(e); }
});

// Esportazione completa in CSV (si apre con Excel)
r.get('/esporta.csv', async (req, res, next) => {
  try {
    const i = intervallo(req.query);
    const righe = await q(`SELECT to_char(ts AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD HH24:MI:SS') AS data_ora, tipo, evento,
        pagina, gioco, dettaglio, canale, sorgente, ricerca, ref_host AS sito_provenienza, referrer AS pagina_provenienza,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, click_id, dispositivo, browser, sistema, lingua, schermo,
        paese, regione, citta, durata_s AS secondi, nuova_sessione AS inizio_visita, nuovo_visitatore, sessione
      FROM stat_visite WHERE ${BASE} ORDER BY ts`, P(i));
    const colonne = righe.length ? Object.keys(righe[0]) : ['data_ora'];
    const cella = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [colonne.join(';'), ...righe.map((rr) => colonne.map((c) => cella(rr[c])).join(';'))].join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="statistiche_${i.da}_${i.a}.csv"`);
    res.send('﻿' + csv); // BOM: Excel riconosce gli accenti
  } catch (e) { next(e); }
});

module.exports = r;
