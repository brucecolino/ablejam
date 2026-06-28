# AbleJam — Piano di sviluppo

> Setlist manager per Ableton Live, ispirato (non copiato) ad AbleSet.
> Implementazione **clean-room** e originale: nessun codice o asset di AbleSet,
> nessuna decompilazione dell'eseguibile. Base aperta + comportamento documentato.

> **Specifica funzionale completa** (cosa deve fare ogni feature, distillata da
> docs + 18 tutorial ufficiali): [SPEC.md](SPEC.md). Materiali grezzi in
> `.ui-analysis/` (frame video + trascrizioni).

## 0. Principi

- **Clean-room**: si parte dalla documentazione pubblica del comportamento e da
  componenti open-source con licenza permissiva. AbleSet si usa solo come prodotto
  di riferimento UX, mai come sorgente.
- **Scope**: funzioni v1 + v2. Escluso v3 (AbleNet/ridondanza, interfacce audio
  ridondanti, drift correction).
- **Interoperabilità**: namespace OSC compatibile, così controller/Stream Deck
  esistenti continuano a funzionare. È un'interfaccia, non codice protetto.
- **Identità propria**: layout ispirato ma con design system, nome, icone e
  palette originali ("AbleJam").

---

## 1. Architettura

```
┌────────────┐   LOM    ┌──────────────────────┐  OSC/UDP   ┌──────────────────┐  WebSocket  ┌──────────────┐
│ Ableton    │ <------> │ AbleJam Bridge       │ <--------> │ AbleJam Host     │ <---------> │ Client UI    │
│ Live       │  Python  │ (Control Surface +   │ localhost  │ (Node/Electron)  │   :PORT     │ (browser/    │
│            │          │  opz. M4L playhead)  │            │  web server+OSC  │             │  Electron)   │
└────────────┘          └──────────────────────┘            └──────────────────┘             └──────────────┘
```

Catena: **Live → script Python (legge locator/transport, esegue jump/mute) →
OSC su localhost → Host app Node (web server + logica + OSC pubblico) →
WebSocket → una o più UI (desktop, telefono, tablet sulla LAN).**

### 1.1 Il punto critico: integrazione con Live

Live non ha API di rete ufficiali. L'unico modo robusto e supportato è un
**Control Surface script in Python** che gira dentro Live e accede al Live
Object Model. Oggetti/proprietà che ci servono:

- `Song`: `is_playing`, `current_song_time` (in beat), `tempo`,
  `signature_numerator/denominator`, `cue_points`, `loop`, `loop_start`,
  `loop_length`, `clip_trigger_quantization`, `metronome`, `record_mode`,
  `back_to_arranger`, `re_enable_automation`.
- Metodi: `start_playing()`, `stop_playing()`, `continue_playing()`,
  `jump_by(beats)`, `jump_to_next_cue()`, `jump_to_prev_cue()`,
  `scrub_by()`; `CuePoint.jump()` per saltare a un locator preciso.
- `Track`: `name`, `mute`, `solo`, `arm`, `color`, `output_meter_level`,
  `mixer_device.volume`; `clip_slots` (per Sections/Lyrics/Measures tracks).
- Listener: `add_current_song_time_listener`, `add_is_playing_listener`,
  `add_tempo_listener`, listener su `cue_points` per ricaricare la struttura.

**Fondazione**: forkare/estendere **AbletonOSC** (MIT) come bridge, aggiungendo
sopra la logica AbleJam (parsing notazione, jump modes, stato setlist). In
alternativa, control surface custom minimale basata su `ableton.v2/v3
control_surface`. Decisione in M0.

**Limite di precisione**: i listener Python aggiornano a ~10–30 Hz. Per playhead
fluido e jump precisi si aggiunge un **device Max for Live** (in **baseline**,
abbiamo la licenza Suite) che manda la posizione via OSC ad alta frequenza —
stessa strada di AbleSet. Il device viene caricato automaticamente in una traccia
dedicata o suggerito in onboarding.

### 1.2 Stack

- **Bridge Live**: Python (versione legata a Live: 11 ≈ 3.7, 12 ≈ 3.11), socket
  UDP/OSC. + opzionale device M4L (JS/`live.observer`).
- **Host app**: Node.js + TypeScript. Electron per la finestra "menubar/tray"
  (Win/macOS). Web server: Fastify (statici + REST). Realtime: `ws`. OSC:
  `osc`/`node-osc`. MIDI: `@julusian/midi`. Persistenza: file JSON nella
  cartella progetto (come `ableset.json`).
- **Frontend**: React + TypeScript + Vite + Tailwind. Stato: Zustand. Realtime:
  client WebSocket con store sincronizzato. Routing: React Router.
- **Build/dist**: electron-builder (Win prima, poi macOS). Monorepo pnpm.

---

## 2. Moduli

| Modulo | Responsabilità |
|---|---|
| `bridge` | Control surface Python + (opz.) M4L. Legge LOM, esegue comandi. |
| `host/transport` | Stato transport, scheduling jump, jump modes, quantizzazione. |
| `host/notation` | Parser della notazione locator → modello Song/Section. |
| `host/setlist` | Modello setlist, ordine, attiva/disattiva, save/load, import. |
| `host/osc` | Server OSC pubblico (namespace compatibile) + client verso bridge. |
| `host/midi` | MIDI mapping, MIDI learn, mapping→azione/OSC/script. |
| `host/server` | Web server + WebSocket broadcast dello stato. |
| `web/setlist-view` | Vista scaletta + controlli transport. |
| `web/setlist-editor` | Drag&drop, add/remove, dettagli brano, save/load, stampa. |
| `web/lyrics` | Rendering lyrics + ChordPro + immagini. |
| `web/canvas` | Builder UI custom (v2). |
| `web/settings` | Impostazioni, account/licenza, mapping. |

---

## 3. Modello dati & grammatica notazione

```
Project
 └─ Setlist (ordered) ─ Song[]
Song { id, title, color?, tags[], duration?, notes?, isSong, sections[] }
Section { id, title, startBeat, type: normal|quick, flags[], color? }
Flag = PAUSE | LOOP | LOOPFULL | LOOP:n | SKIP | END | JUMP | STAY | ...
```

Grammatica locator (clean-room dalla doc pubblica):
- `Title` → inizio brano
- `> Name` sezione, `>> Name` sezione quick-access
- `{...}` descrizione, `[mm:ss]` durata, `#tag`, `[color]`, `[.class]`
- `SONG END` / `STOP` / `AUTOSTOP` / `.` prefisso = fine/stop
- `>>> Target` transizione, `+PAUSE/+LOOP/+SKIP/...` flag
- `*` = ignora locator
- **Sections track** alternativa: traccia MIDI con clip (Live 11+).

---

## 4. Namespace OSC (compatibile)

Mantengo la struttura documentata per interoperabilità:
`/global/play|pause|stop|playPause`, `/global/tempo`, `/loop/enable|escape|toggle`,
`/setlist/jumpToSong|jumpToSection|jumpBySongs|go|load`, `/lyrics/jumpByLines`,
`/click/mute|solo`, `/mixer/<group>/mute|solo|volume`, `/settings/jumpMode`,
`/notify/big|banner`. Porta in ascolto configurabile (default 39051).

---

## 5. Roadmap

### M0 — Spike integrazione (la prova del fuoco)
- Bridge: AbletonOSC fork legge `cue_points` + `current_song_time` + `is_playing`.
- Host minimale: riceve OSC, broadcast WS.
- UI minimale: lista locator + Play/Stop/Next che muovono davvero Live.
- ✅ Esito atteso: dimostra che l'approccio regge end-to-end.

### M1 — Core setlist (v1)
- Parser notazione completo.
- Setlist view + transport (play/stop/next/prev/jump-to-song/section).
- Jump modes: Quantized / End-of-Section / End-of-Song / Manual (+ coda jump).
- Settings base, web multi-device sulla LAN.

### M2 — Editor & I/O
- Setlist editor (drag, add/remove, dettagli, attiva/disattiva).
- Save/load (JSON in cartella progetto), copia/incolla, import testo, stampa/PDF.

### M3 — Controllo
- OSC server pubblico completo.
- MIDI mapping + MIDI learn, pulsante GO contestuale.

### M4 — Performance features (v2)
- Lyrics (+ChordPro, immagini, allsongs, delay).
- Measure track, Visual Metronome, Count-in, Guide tracks.
- Mixer/gruppi (`+G:NOME`, `+NEVERMUTE`).

### M5 — Avanzate (v2)
- Multi-file projects.
- Canvas builder + templating `${...}` + variabili locali/condivise.
- Scripting engine (sandbox JS), custom styles, scorciatoie complete.

### M6 — Packaging
- Installer Windows (electron-builder), poi macOS. Onboarding "Aggiungi plugin a
  Ableton" che installa il control surface.

---

## 6. Struttura repo (monorepo pnpm)

```
AbleJam/
├─ bridge/                 # control surface Python (+ M4L device opz.)
│  └─ AbleJam/             # da installare in MIDI Remote Scripts
├─ packages/
│  ├─ host/                # Electron main + server + OSC + MIDI + logica
│  ├─ shared/              # tipi, notazione, modello dati (TS condiviso)
│  └─ web/                 # frontend React
├─ PLAN.md
└─ package.json
```

---

## 7. Rischi & mitigazioni

| Rischio | Mitigazione |
|---|---|
| Precisione timing jump senza M4L | Interpolazione client + M4L opzionale |
| Differenze Live 11 vs 12 (Python/LOM) | Astrarre il bridge, testare su entrambe |
| Comportamenti LOM non documentati | Partire da AbletonOSC (già provato) |
| Cross-OS (Win/mac) | Electron + CI su entrambi; Win prima |

## 8. Decisioni prese
- **Target: Ableton Live 12** (Python 3.11, API LOM aggiornate).
- **Max for Live: disponibile e in baseline** — come AbleSet, il device M4L manda
  il playhead ad alta frequenza per jump precisi. Niente fallback a interpolazione.
- **Client principale: desktop cross-platform** — MacBook Pro **e** Windows, en-
  trambi con Live 12. Electron tray su entrambi gli OS, CI su mac + win.

---

## 9. UI & Design System (da analisi del video AbleSet)

> Analisi ricavata dal walkthrough video (`.ui-analysis/`). Riproduciamo i
> **pattern di layout collaudati**, con **identità visiva propria** di AbleJam
> (nome, logo, accento, set di icone Lucide ricostruito — nessun asset copiato).

### 9.1 Shell a 3 zone (sempre presente)

```
┌─────────────────────────────────────────────────────────────┐
│ TOP BAR  [Titolo progetto]            Stato · Settings Mixer  │  ~40px
│                                       Canvas Lyrics Performance│
├─────────────────────────────────────────────────────────────┤
│                                                               │
│                    CONTENUTO (vista attiva, scroll)           │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ TRANSPORT  [#brano]   ⏮   ▶/⏸   ⟳   ⏭                         │  ~56px
│            [BPM / sig]                                         │
└─────────────────────────────────────────────────────────────┘
```

- **Top bar**: a sinistra nome progetto; a destra indicatore stato (AbleSet mostra
  "9 minutes left" del trial → in AbleJam: stato licenza/connessione) + tab di
  navigazione: **Settings · Mixer · Canvas · Lyrics · Performance**. La vista
  Setlist è quella di default (home).
- **Transport bar** fissa in basso, piena larghezza: cella stato a sinistra
  (numero brano in scaletta sopra, `BPM / time signature` sotto), al centro i
  controlli **Prev ⏮ · Play/Pause · Loop ⟳ · Next ⏭**. Il Play diventa Pause in
  riproduzione; lo stato attivo è **riempito di verde** a tutta altezza.

### 9.2 Viste

**A) Setlist (home, modalità lista)**
- Righe brano: `chevron ›` (espande le sezioni) · titolo · durata a destra.
- Brano corrente **evidenziato in verde**; durante il play mostra il **tempo
  rimanente in negativo** (es. `-00:45`).
- Cluster flottante in basso a destra: 🔒 lock · ⚙️ settings · ＋ add · ✏️ edit.

**B) Setlist Editor** (dal pulsante ✏️)
- Ogni riga acquisisce: **drag handle ⠿** · **✕ rimuovi** · **⋮ menu dettagli**.
- Il cluster diventa una **toolbar di azioni** (cerchi scuri, icone chiare),
  da sinistra: ↻ ripristina · 🗑 svuota · ↕A‑Z ordina · 📁 apri · 💾 salva ·
  👁 mostra/nascondi esclusi · ＋ aggiungi · ✓ fine.
- `⋮` apre il **popover dettagli brano** (override locator, salvati nella setlist).

**C) Performance** (full-screen, leggibile dal palco)
- Sfondo nero, **titolo brano gigante nel colore del brano** (color-coding).
- **Pill informative**: `154 BPM` · `4/4` · `02:09` (durata) · `-02:06`
  (countdown rimanente). Pill = rettangoli arrotondati slate, testo azzurro.
- **Barra di progresso** grande (porzione suonata più chiara).
- `Next: <BRANO>` e `N songs (HH:MM:SS) left`.
- Header: 🔒 + ⚙️ a sinistra, titolo progetto al centro, ✕ chiudi a destra.
- Transport dedicato: **Restart Song · Play/Pause · Next**.

**D) Lyrics** (full-screen) — empty state "No lyrics tracks found · Add a lyrics
track to get started"; con testo: righe sincronizzate (v2, ChordPro/immagini).

**E) Settings / Mixer / Canvas** — tab dedicate (dettaglio in M3–M5).

### 9.3 Design tokens (proposta AbleJam)

| Token | Valore | Note |
|---|---|---|
| `--bg` | `#0B0B0C` | sfondo base quasi nero |
| `--surface` | `#151517` | lista / pannelli |
| `--elevated` | `#1C1C1F` | top bar / transport |
| `--border` | `#2A2A2E` | divisori sottili |
| `--text` | `#F2F2F3` | primario |
| `--text-muted` | `#9A9AA0` | durate, secondari |
| `--accent` | **`#FF7A1A`** (AbleJam) | AbleSet usa verde; noi un **ambra** distintivo (configurabile). Verde resta per "playing" se vogliamo |
| `--playing` | `#34C77B` | evidenzia brano in play / progresso |
| `--pill-bg` | `#28303B` | pill info |
| `--pill-text` | `#9FC0E6` | testo pill (azzurro) |

- **Tipografia**: sans variabile (Inter). Titolo Performance enorme,
  `font-weight 800`, uppercase, dimensione fluida (`clamp`, ~8–12vw). Lista
  ~15–16px medium. Numeri con `font-variant-numeric: tabular-nums`.
- **Raggi**: pill ~8px, card ~12px, pulsanti azione **cerchio pieno**.
- **Icone**: libreria **Lucide** (grip, x, more-vertical, folder, save, eye,
  plus, check, arrow-down-az, rotate-ccw, lock, settings, pencil) — equivalenti
  open-source di quelle viste, così non copiamo asset.

### 9.4 Semantica di stato & micro-interazioni
- **Verde = corrente/attivo/in riproduzione**; tempo **negativo = rimanente**.
- **Color-coding**: il titolo usa il colore assegnato al brano (`[color]`).
- **Tooltip con scorciatoia** su hover (es. "Activate Loop  L",
  "Jump to Next Song →") — riprodurre questo pattern di hint.
- Aggiornamento **live** di countdown, barra di progresso e BPM (anche frazionario,
  es. `154.62 BPM`) via WebSocket dal playhead M4L.

### 9.5 Componenti React (mappa)
`AppShell` · `TopBar` · `NavTabs` · `TransportBar` · `SetlistView` ·
`SongRow` / `EditableSongRow` · `SectionList` · `ActionCluster` /
`EditorToolbar` · `SongDetailsPopover` · `AddSongDialog` (⌘K) ·
`SaveSetlistDialog` / `OpenSetlistDialog` · `PerformanceView` · `InfoPill` ·
`ProgressBar` · `NextSong` · `LyricsView` · `Tooltip` (con hint tasto).

### 9.6 Identità "nostra"
Manteniamo il layout a 3 zone e i 4 schermi (Setlist/Editor/Performance/Lyrics)
perché sono ergonomici e collaudati, ma: logo e wordmark **AbleJam** propri,
accento **ambra** di default, set icone Lucide, micro-stile e spaziature riviste.
Niente screenshot, font proprietari o stringhe di AbleSet nel prodotto.
