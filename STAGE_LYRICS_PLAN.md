# AbleJam — Piano "Lyrics" + scheda "STAGE"

> Vincolo clean-room: studiamo SOLO il comportamento pubblico di AbleSet (sito/docs).
> Mai il loro codice o decompilazione. Implementiamo convenzioni nostre.

## 1. Come fa AbleSet (sintesi dai docs pubblici)

- I testi vivono in una **traccia MIDI dedicata** flaggata `+LYRICS` (es. `Vocals +LYRICS`).
- **Una clip per riga**: la POSIZIONE della clip = quando appare la riga; il NOME della clip = il testo.
- **Sync automatico** dalla posizione delle clip (playhead dentro la clip → riga attiva).
- Tool "paste & sync" + import **LRC** che generano la traccia da testo incollato.
- **Offset** di ritardo nel nome traccia: `[+150ms]`, `[-200ms]`, beat `[+1n]`.
- **Formattazione inline**: `*corsivo*`, `**grassetto**`, colori `[blue]`, dimensioni
  `[large] [small] [tiny] [mono]`, layout `[left] [center] [top]`, effetti
  `[nofade] [nozoom] [progress] [linemarker]`, ChordPro per accordi, immagini.
- **Più tracce lyrics** → ogni dispositivo sceglie quale vedere.
- **Multi-device**: ogni dispositivo mostra una vista diversa (cantante=testi, MD=timecode/controllo,
  crew=stato); viste **bloccabili**; navigazione pilotabile via OSC.

## 2. Mappatura sulla nostra architettura (≈70% già pronto)

- Le viste sono **GIÀ per-dispositivo**: la tab attiva (Setlist/Performance) è stato React locale di
  ogni browser. Aggiungere STAGE = ogni device la sceglie indipendentemente. ✓
- Il bridge legge già l'arrangiamento (marker/sezioni/tracce) → può leggere anche le clip di una
  traccia lyrics.
- L'host già fa broadcast dello stato a N client, conosce il tempo-canzone e `currentSectionIndex`.

→ Il lavoro vero è: (a) sorgente + render testi, (b) vista STAGE configurabile, (c) modalità kiosk/gobbo.

## 3. Modello dati testi

```ts
LyricLine { atBeat: number; text: string; section?: string; tags?: string[] }
```

Testi per canzone (delimitati dai confini-brano dell'arrangiamento). Riga corrente = ultima riga con
`atBeat ≤ playhead (+ offset)`. Mini-markdown nostro per grassetto/corsivo/colore/dimensione.

## 4. Sorgente testi — 3 opzioni (decisione chiave)

- **A) Traccia Ableton flaggata (clip-per-riga, stile AbleSet)** — sync migliore, i testi viaggiano col
  Set; authoring in Ableton scomodo → serve un tool "incolla & allinea" che scrive le clip via bridge.
- **B) Gestiti in AbleJam, allineati alle SEZIONI esistenti (Intro/Verse/Chorus)** — authoring facile
  (incolli i testi), sync per-sezione, sfrutta `currentSectionIndex` che abbiamo già. Più rapido.
- **C) Gestiti in AbleJam, LRC per-riga (timestamp)** — sync fine, **tap-align** in riproduzione,
  import/export `.lrc`, salvataggio locale.

Raccomandazione: **B subito** (valore rapido) → **C** (sync fine) → **A** opzionale per chi vuole l'Ableton-native.

> **DECISO (2026-06-27):** sorgente testi = **opzione A — traccia Ableton clip-per-riga**.
> Build order = **scheda STAGE prima (Fase 1)**, poi i testi (che arriveranno via bridge da una traccia `LYRICS`).

## 5. Scheda STAGE

- Terza vista accanto a Setlist / Performance.
- Contenuto **configurabile per dispositivo** (blocchi): Testi, Brano corrente, Brano successivo,
  Tonalità, Sezione, Countdown / tempo rimanente, **Messaggio operatore**.
- Preset: "Gobbo/Teleprompter", "Monitor laterale", "Operatore".
- Funzioni gobbo: font grande, alto contrasto, **mirror** (flip orizzontale), auto-scroll,
  evidenzia riga corrente, fullscreen.
- **Lock vista** (come AbleSet) per evitare tocchi accidentali sui device performer.

## 6. Selezione vista per-dispositivo + display dedicati

- Tab locale (già presente) + **persistenza in localStorage** per device.
- **Pin via URL**: `?view=stage` / `?view=performance` → un Raspberry in kiosk apre l'URL e mostra
  sempre quella vista. Uscita HDMI dedicata = un browser fullscreen su quell'URL.
- `?display=kiosk` nasconde topbar/cromature per gobbo/HDMI.
- (Futuro) comando host "manda il device X alla vista Y".

## 7. Messaggi operatore → STAGE ("invia info a piacimento")

- Campo `AppState.stageMessage` (testo + stile) broadcastato a tutti gli STAGE.
- L'operatore (da Performance/Setlist) digita un cue ("ULTIMO RITORNELLO", "ALLUNGA") → compare
  sui gobbi. Cue rapidi preimpostabili.

## 8. Fasi di sviluppo

| Fase | Contenuto | Valore |
|------|-----------|--------|
| **1** | Scheda STAGE + viste per-device + kiosk/URL + messaggi operatore (NO testi) | Subito utile: gobbo/monitor/cue |
| **2** | Testi opzione **B** (sezione-sync): editor incolla per brano, blocchi per sezione, evidenzia sezione corrente, auto-scroll, salvataggio locale, mini-markdown | Testi funzionanti senza toccare Ableton |
| **3** | Testi opzione **C**: import/export LRC + tap-align in riproduzione (sync per-riga) + offset | Sync fine professionale |
| **4** | Testi opzione **A**: bridge legge traccia `LYRICS` (clip-per-riga) + tool che scrive le clip; formattazione avanzata, ChordPro, immagini | Ableton-native completo |

## 9. Tocchi tecnici per fase (file)

- **shared**: `LyricLine`, `Song.lyrics?` / mappa testi, `AppState.stageMessage`,
  `settings.stageLayout`, `ClientCommand` `setStageMessage` / (fase 4) scrittura testi.
- **bridge** (fase 4): enumera le clip della traccia `LYRICS`, invia `name`+`startBeat`; `BRIDGE_VERSION++`.
- **host**: store/persist/broadcast testi; (opz.) calcolo riga corrente; handler messaggi operatore.
- **web**: `StageView` + `LyricsView` + editor + config per-device + URL/kiosk + i18n.
