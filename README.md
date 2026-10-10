# Arcadia Indie – piattaforma di giochi indipendenti

Piattaforma web per ospitare giochi 3D, platform, arcade e qualsiasi gioco che gira nel browser.
L'accesso al catalogo costa **1 € al mese** con abbonamento **PayPal** a rinnovo automatico.

Il nome "Arcadia Indie" è provvisorio: si cambia con la variabile `NOME_PIATTAFORMA`.

## Cosa fa

- **Catalogo** con gioco in evidenza, filtri per categoria e ricerca.
- **Scheda gioco** con descrizione, comandi, preferiti.
- **Player a schermo intero** (iframe) con supporto a gamepad, touch e TV.
- **Account**: registrazione, accesso, cambio password, stato abbonamento, disdetta.
- **Abbonamento PayPal 1 €/mese**: attivazione verificata lato server, disdetta dal sito
  (resta attivo fino a fine mese pagato), aggiornamenti automatici via webhook.
- **Gestione (admin)**: carichi lo ZIP della build web di un gioco (Three.js, Unity WebGL,
  Godot, Phaser, GDevelop, Construct…), copertina, bozza/pubblicato, "gratis per tutti",
  "in evidenza"; aggiornamento del gioco con nuovo ZIP; elenco utenti e abbonati,
  accesso omaggio a tempo, reimpostazione password, statistiche e incasso mensile.
- **Due giochi dimostrativi** caricati al primo avvio: *Balzo* (platform 2D, gratis come prova)
  e *Corsia Cristallo* (runner 3D in Three.js, per abbonati).
- Pagine **Termini** e **Privacy** già intestate a Maimeri Informatica (bozze da far verificare).

## Come si protegge l'accesso

I file dei giochi non sono pubblici: passano dal server, che controlla l'abbonamento a ogni
richiesta. Lo stato dell'abbonamento viene sempre riletto da PayPal (mai preso per buono dal
browser): si verifica che il piano sia il nostro, che non sia stato modificato il prezzo e che
l'abbonamento appartenga all'utente collegato.

## Messa online (GitHub → Render → Supabase)

### 1. Supabase
1. Crea un progetto (regione Europa).
2. **Database** → *Connect* → copia la *connection string* "Session pooler" → sarà `DATABASE_URL`.
3. **Project Settings → API**: copia *Project URL* (`SUPABASE_URL`) e la chiave *service_role*
   (`SUPABASE_SERVICE_KEY`, segreta).
4. Le tabelle e il bucket privato `giochi` si creano da soli al primo avvio.

### 2. PayPal
1. Vai su developer.paypal.com → *Apps & Credentials* → crea un'app (prima in **Sandbox**).
2. Copia *Client ID* e *Secret* in un file `.env` (vedi `.env.example`).
3. Crea il piano da 1 €/mese e il webhook con:
   ```
   npm install
   npm run configura-paypal -- https://tuo-sito.onrender.com
   ```
   Lo script stampa `PAYPAL_PLAN_ID` e `PAYPAL_WEBHOOK_ID` da inserire su Render.
4. Quando le prove in sandbox sono ok, ripeti con le credenziali **Live** e `PAYPAL_AMBIENTE=live`.

### 3. GitHub + Render
1. Carica questa cartella in un repository GitHub (privato).
2. Su Render: *New → Blueprint* → scegli il repository: `render.yaml` crea il servizio.
3. Compila le variabili richieste (Supabase, PayPal, `ADMIN_EMAIL`, `URL_PUBBLICO`, `DITTA_EMAIL`).
4. Apri il sito e **registrati con l'email di `ADMIN_EMAIL`**: diventi amministratore
   e vedi la voce "Gestione".

## Prova in locale

```
cp .env.example .env      # imposta DATABASE_URL e lascia PAYPAL_SIMULATO=1
npm install
npm start
```
Con `PAYPAL_SIMULATO=1` il pulsante di pagamento simula l'abbonamento senza PayPal
(il server rifiuta di partire con questa opzione in produzione).

## Caricare un gioco

Esporta il gioco per il web e comprimi la cartella in ZIP (deve contenere `index.html`,
anche dentro una sottocartella). Consigli per motore:
- **Unity**: build WebGL; sono supportati i file compressi `.br` e `.gz`.
- **Godot 4**: esporta per Web con *Thread Support* disattivato.
- **Three.js / Phaser / Babylon**: basta la cartella con `index.html`.
Limite predefinito: 300 MB per ZIP (`MAX_UPLOAD_MB`).

## Commissioni PayPal su 1 €

Con la tariffa standard italiana (3,40% + 0,35 €) su 1 € PayPal trattiene circa 0,38 €.
Con la tariffa **micropagamenti** (5% + 0,10 €, da richiedere a PayPal) scende a circa 0,15 €.
Conviene chiederla prima di andare online.

## Struttura

```
server.js              avvio e pagine
src/config.js          variabili d'ambiente
src/accesso.js         login e regole di accesso/abbonamento
src/paypal.js          API PayPal (piano, verifica, disdetta, webhook)
src/storage.js         file dei giochi: cartella locale o Supabase Storage
src/rotte/api.js       API pubbliche e webhook
src/rotte/admin.js     API di gestione
src/rotte/gioca.js     servizio protetto dei file dei giochi
public/                pagine del sito
giochi-demo/           giochi dimostrativi
sql/schema.sql         tabelle del database
```
