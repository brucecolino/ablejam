# Installare AbleJam

Guida per installare e configurare **AbleJam** su **Windows** e **macOS**.
Serve **Ableton Live 12** sullo stesso computer.

> Gli installer **non sono firmati**: al primo avvio Windows (SmartScreen) e macOS
> (Gatekeeper) mostrano un avviso. È normale — sotto trovi come procedere.

Dove prendere gli installer: dalla sezione **Releases** del repo (o dal file che ti è
stato fornito). Per compilarli da sorgente, vedi [in fondo](#compilare-gli-installer-da-sorgente).

---

## Windows (`AbleJam-Setup-<versione>.exe`)

### 1. Installa l'app
1. Doppio clic su **`AbleJam-Setup-<versione>.exe`**.
2. Se compare **"Windows ha protetto il PC"** → **Ulteriori informazioni** → **Esegui comunque**.
3. Completa l'installazione (è **per-utente**, niente UAC per l'app).

### 2. Installa il bridge per Ableton + loopMIDI
Il "bridge" è lo script che fa parlare AbleJam con Ableton; **loopMIDI** è la porta MIDI
virtuale che serve al pulsante **PANIC / PULL UP**.

1. Avvia **AbleJam**.
2. Menu **AbleJam → "Installa bridge Ableton + loopMIDI…"**.
3. Approva il prompt **UAC** del driver loopMIDI quando appare.

Questo installa loopMIDI (porta `AbleJam`) e copia il control surface nella User Library di Ableton.

### 3. Attiva il control surface in Live
1. **Esci e riapri** Ableton Live 12 (i control surface si caricano all'avvio).
2. Live → **Preferenze → Link, Tempo & MIDI**.
3. **Superficie di controllo** → seleziona **AbleJam**.
4. Vedrai "AbleJam connected" nella barra di stato di Live; in AbleJam il **pallino "Live"** diventa verde.

### 4. (Per il PANIC) Instrada la porta MIDI
1. Live → Preferenze → Link, Tempo & MIDI → **Porte MIDI**: riga **input `AbleJam`** → **Track = On**, **Remote = Off**.
2. Sulla traccia drum (quella che suona il sample di emergenza): **MIDI From = `AbleJam`**, **Monitor = In**.
3. In AbleJam → **Impostazioni → Panic**: porta = **`AbleJam`** (o **Automatico**), nota **D#2 (51)**.

---

## macOS (`AbleJam-<versione>.dmg`)

### 1. Installa l'app
1. Apri **`AbleJam-<versione>.dmg`** e trascina **AbleJam** in **Applicazioni**.
2. In Applicazioni, **clic destro** su AbleJam → **Apri** → **Apri** (necessario solo la prima volta: l'app non è firmata).
   - Se compare "danneggiata / impossibile aprire", esegui in Terminale:
     `xattr -dr com.apple.quarantine /Applications/AbleJam.app`
3. Al primo avvio concedi il permesso **Automazione** quando richiesto (serve a leggere il nome del Set aperto).

### 2. Installa il bridge per Ableton
1. Menu **AbleJam → "Installa bridge Ableton…"** → copia il control surface in
   `~/Music/Ableton/User Library/Remote Scripts/AbleJam`.

### 3. Attiva il PANIC con l'IAC Driver
Su macOS la porta MIDI virtuale è già nel sistema (IAC), non serve installare nulla.
1. Apri **Audio MIDI Setup** (Configurazione MIDI Audio) → **Finestra → Mostra finestra MIDI Studio** → doppio clic su **IAC Driver**.
2. Spunta **"Device is online"** (Il dispositivo è online).

### 4. Attiva il control surface in Live
1. **Esci e riapri** Ableton Live 12.
2. Live → **Preferenze → Link, Tempo & MIDI** → **Superficie di controllo** → **AbleJam**.

### 5. (Per il PANIC) Instrada la porta MIDI
1. Sulla traccia drum di emergenza: **MIDI From = IAC Driver**, **Monitor = In**.
2. In AbleJam → **Impostazioni → Panic**: porta = **IAC Driver** (o **Automatico**).

---

## Accesso da tablet / telefono (stessa Wi-Fi)

AbleJam serve l'interfaccia anche agli altri dispositivi sulla stessa rete.
- Menu **AbleJam → "Apri nel browser (LAN)"** mostra/apre l'indirizzo, es. `http://192.168.1.50:3700`.
- Sul tablet/telefono apri quell'indirizzo nel browser. Aggiungi `?view=stage&kiosk=1` per il gobbo a schermo intero.

---

## Aggiornare AbleJam
- **App**: installa la nuova versione sopra la precedente (Windows: il nuovo `.exe`; macOS: il nuovo `.dmg`).
- **Bridge**: se cambia, rifai **"Installa bridge…"** dal menu e **riavvia Live** (i control surface si ricaricano solo all'avvio).
  La versione del bridge caricato è mostrata accanto al pallino **Live** (es. `Live v46`): se non è l'ultima, Live non è stato riavviato.

---

## Compilare gli installer da sorgente

Servono **Node 20+** e **pnpm**.

```bash
git clone https://github.com/brucecolino/ablejam.git
cd ablejam
pnpm install
pnpm dist:desktop:win    # su Windows -> packages/desktop/release/AbleJam-Setup-<versione>.exe
pnpm dist:desktop:mac    # su macOS   -> packages/desktop/release/AbleJam-<versione>.dmg (+ .zip)
```

Gli installer si costruiscono **sul sistema operativo di destinazione** (electron-builder non fa cross-build:
il `.dmg` va creato su un Mac, il `.exe` su Windows).
