# SPECTRA // VISION
> **Sci-Fi Interface for Ring Intercom/Doorbell**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-14%2B-green.svg)](https://nodejs.org/)

Un'interfaccia web moderna, veloce e dark-mode per gestire i tuoi dispositivi Ring. Include streaming a bassa latenza, snapshot automatici e notifiche in tempo reale.

## ⚡ Caratteristiche (Ferrari Mode)
- **Ultra Low Latency:** Streaming HLS ottimizzato (~2sec ritardo)
- **Fast Notifications:** Polling eventi ogni 3 secondi
- **Audio Bidirezionale:** Talk & Listen (sperimentale)
- **Cyberpunk UI:** Design "Nexus" ispirato alla fantascienza
- **Privacy:** Tutti i dati restano in locale

## 🚀 Installazione

### 1. Clona la repository
```bash
git clone https://github.com/inferis995/spectra-vision.git
cd spectra-vision
npm install
```

### 2. Configura il Token Ring
L'app richiede un "Refresh Token" per collegarsi al tuo account Ring senza username/password.
Esegui questo comando e segui le istruzioni a schermo (login 2FA):

```bash
npx -p ring-client-api ring-auth-cli
```

**Copia il token generato** (una stringa lunghissima che inizia per `eyJ...`).

### 3. Configura le Variabili d'Ambiente
Copia il file di esempio e incollaci il tuo token:

```bash
cp .env.example .env
```
Apri `.env` e incolla il token in `RING_REFRESH_TOKEN`:

```ini
RING_REFRESH_TOKEN=incolla_qui_tutto_il_token_generato
```

### 4. Avvia
```bash
node server.js
```
Apri il browser su: `http://localhost:3005`

## 🛠️ Requisiti
- Node.js v14+
- FFmpeg installato nel sistema (deve essere nel PATH)
- Un account Ring attivo

## ⚠️ Note
Questo progetto non è affiliato con Ring/Amazon. Usa API non ufficiali.
Usalo a tuo rischio e pericolo.

---
*SPECTRA // VISION System v1.0 - by Poola Ai*
