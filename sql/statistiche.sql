-- Statistiche di traffico (modulo separato: non tocca le tabelle dei giochi).
CREATE TABLE IF NOT EXISTS stat_visite (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo          TEXT NOT NULL,             -- 'pagina' oppure 'evento'
  evento        TEXT,                      -- iscrizione, abbonamento, click, ricerca_interna
  visitatore    TEXT NOT NULL,             -- identificativo anonimo (cookie casuale)
  sessione      TEXT NOT NULL,
  nuova_sessione BOOLEAN NOT NULL DEFAULT FALSE,
  nuovo_visitatore BOOLEAN NOT NULL DEFAULT FALSE,
  percorso      TEXT,                      -- es. /gioco.html
  pagina        TEXT,                      -- nome leggibile
  gioco         TEXT,                      -- slug del gioco, se la pagina riguarda un gioco
  dettaglio     TEXT,                      -- testo del click, ricerca interna, ecc.
  referrer      TEXT,
  ref_host      TEXT,
  canale        TEXT,                      -- Ricerca, Social, Siti esterni, Diretto, Campagne, Email, Assistenti AI, Pubblicità
  sorgente      TEXT,                      -- Google, Instagram, nomesito.it, ...
  ricerca       TEXT,                      -- parole cercate, quando il motore le comunica
  utm_source    TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  click_id      TEXT,                      -- Google Ads, Facebook, TikTok Ads, Microsoft Ads
  dispositivo   TEXT, browser TEXT, sistema TEXT, lingua TEXT, schermo TEXT,
  paese         TEXT, regione TEXT, citta TEXT,
  durata_s      INTEGER,
  utente_id     INTEGER,
  admin         BOOLEAN NOT NULL DEFAULT FALSE,
  bot           TEXT                       -- nome del robot (Googlebot, ...) oppure NULL
);
CREATE INDEX IF NOT EXISTS stat_visite_ts_idx ON stat_visite (ts);
CREATE INDEX IF NOT EXISTS stat_visite_sessione_idx ON stat_visite (sessione);
CREATE INDEX IF NOT EXISTS stat_visite_visitatore_idx ON stat_visite (visitatore, ts);
