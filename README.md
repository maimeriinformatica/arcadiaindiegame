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

## Statistiche (solo amministratore)

Menu **Statistiche** → `/statistiche.html`. Raccoglie, senza servizi esterni e senza toccare i giochi:
- provenienza di ogni visita: motori di ricerca, social, assistenti AI (ChatGPT, Perplexity…), altri siti con la pagina esatta del link, email, accesso diretto;
- parole cercate (quando il motore le comunica) e ricerche fatte nel catalogo;
- campagne con link tracciati (`utm_...`), con generatore di link per i social;
- pagine e giochi più visti, pagine di ingresso e di uscita, click su link e pulsanti, tempo sulla pagina;
- paese, regione e città (dall'indirizzo internet, che non viene salvato), dispositivo, browser, sistema, lingua, schermo;
- iscrizioni e abbonamenti collegati alla provenienza, visitatori nuovi o di ritorno, giorni e ore di punta;
- persone sul sito in questo momento, robot che leggono il sito, esportazione CSV.

I dati stanno nella tabella `stat_visite` (creata da sola all'avvio) e vengono cancellati dopo 13 mesi.
Le parole cercate su Google arrivano solo collegando il sito a Google Search Console.

## Inviti agli amici e condivisione

- **Link personale**: ogni utente trova in *Account* il suo link (`/?invito=CODICE`) con i pulsanti Condividi, Copia e WhatsApp.
  Chi apre il link e si registra entro 30 giorni resta collegato a chi l'ha invitato.
- **Premio**: ogni **3 amici invitati che attivano l'abbonamento** (non basta la registrazione), chi li ha invitati riceve
  **30 giorni di accesso omaggio**, aggiunti dopo la fine del suo accesso attuale. Il conteggio parte quando PayPal conferma
  l'abbonamento (`ACTIVE`), quindi un account finto senza pagamento non vale. I premi già dati non si ripetono.
- **Condividi nel player**: nella barra del gioco c'è il pulsante *Condividi*, che manda il link del gioco con il codice invito
  di chi gioca (così anche le partite condivise portano iscritti).
- **Risultato a fine partita**: un gioco può proporre di condividere il punteggio con una riga JavaScript:
  ```js
  if (window.parent !== window) parent.postMessage({ arcadia: 'risultato', testo: 'Caveau aperto in 5 tentativi 🟡🟡⚪' }, '*');
  ```
  La piattaforma mostra "Bella partita! Vuoi sfidare un amico?" e prepara il messaggio con il link. Balzo lo fa già.
- Tabelle: colonne `codice_invito`, `invitato_da`, `invito_valido_il`, `premi_inviti` in `utenti` (create da sole all'avvio).

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

Basta lo ZIP: trascinalo nella pagina Gestione (o nel modulo "Aggiungi un gioco").
Se lo ZIP contiene anche **gioco.json** e un'immagine **copertina.png** (o .jpg/.webp/.svg),
titolo, frase di presentazione, descrizione, comandi, categoria, autore, copertina e spunte
si compilano da soli: controlli e premi "Salva il gioco". Quello che scrivi a mano nel modulo vince sul file.

Esempio di `gioco.json` (modello scaricabile dalla pagina Gestione, `/modello-gioco.json`):

```json
{
  "titolo": "Nome del gioco",
  "sottotitolo": "Frase breve (max 160 caratteri)",
  "descrizione": ["Primo paragrafo.", "Secondo paragrafo."],
  "comandi": ["Frecce: muoviti", "Spazio: salta"],
  "categoria": "Platform",
  "autore": "Studio interno",
  "copertina": "copertina.png",
  "file_avvio": "index.html",
  "pubblicato": true,
  "gratuito": false,
  "in_evidenza": false
}
```

- Categorie: 3D, Platform, Arcade, Avventura, Puzzle, Corse, Sport, Strategia, Narrativo, Da tavolo, Altro.
- `descrizione` e `comandi` possono essere un testo unico o un elenco di righe.
- Vanno bene anche i nomi inglesi (title, description, controls, category, cover…) e il nome `game.json`.
- Se `copertina` manca, viene usato il primo file chiamato copertina/cover/thumbnail nello ZIP.
- Un JSON scritto male blocca il caricamento con un messaggio che indica la riga dell'errore.

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
