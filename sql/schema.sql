-- Schema della piattaforma giochi. Viene eseguito automaticamente all'avvio (idempotente).

CREATE TABLE IF NOT EXISTS utenti (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  nome          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  omaggio_fino  TIMESTAMPTZ,                 -- accesso gratuito concesso dall'amministratore
  creato_il     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS abbonamenti (
  id                 SERIAL PRIMARY KEY,
  utente_id          INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  paypal_id          TEXT NOT NULL UNIQUE,   -- es. I-XXXXXXXXXX
  piano_id           TEXT,
  stato              TEXT NOT NULL,          -- ACTIVE, CANCELLED, SUSPENDED, EXPIRED, APPROVED...
  valido_fino        TIMESTAMPTZ,            -- prossimo rinnovo / fine periodo pagato
  ultimo_pagamento   TIMESTAMPTZ,
  sincronizzato_il   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  creato_il          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS abbonamenti_utente_idx ON abbonamenti(utente_id);

CREATE TABLE IF NOT EXISTS giochi (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  titolo        TEXT NOT NULL,
  categoria     TEXT NOT NULL DEFAULT 'Arcade',
  sottotitolo   TEXT NOT NULL DEFAULT '',
  descrizione   TEXT NOT NULL DEFAULT '',
  comandi       TEXT NOT NULL DEFAULT '',
  autore        TEXT NOT NULL DEFAULT '',
  file_avvio    TEXT NOT NULL DEFAULT 'index.html',
  copertina     TEXT,                        -- chiave nello storage
  pubblicato    BOOLEAN NOT NULL DEFAULT FALSE,
  gratuito      BOOLEAN NOT NULL DEFAULT FALSE, -- giocabile anche senza abbonamento
  in_evidenza   BOOLEAN NOT NULL DEFAULT FALSE,
  partite       INTEGER NOT NULL DEFAULT 0,
  versione      INTEGER NOT NULL DEFAULT 1,
  creato_il     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aggiornato_il TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preferiti (
  utente_id INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  gioco_id  INTEGER NOT NULL REFERENCES giochi(id) ON DELETE CASCADE,
  PRIMARY KEY (utente_id, gioco_id)
);

CREATE TABLE IF NOT EXISTS eventi_paypal (
  id          TEXT PRIMARY KEY,              -- id del webhook, evita doppie elaborazioni
  tipo        TEXT NOT NULL,
  ricevuto_il TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inviti agli amici: link personale, chi ha invitato chi, premi già assegnati.
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS codice_invito TEXT UNIQUE;
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS invitato_da INTEGER REFERENCES utenti(id) ON DELETE SET NULL;
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS invito_valido_il TIMESTAMPTZ;   -- quando l'invitato si è abbonato
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS premi_inviti INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS utenti_invitato_da_idx ON utenti(invitato_da);
