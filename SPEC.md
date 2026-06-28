# AbleJam — Specifica funzionale (clean-room)

> Distillata dall'osservazione del **comportamento documentato** (docs + 18
> tutorial ufficiali). Descrive *cosa* deve fare AbleJam, non il codice di
> AbleSet. È il riferimento di implementazione. Vedi [PLAN.md](PLAN.md) per
> architettura e roadmap, e `.ui-analysis/` per i materiali grezzi.

## Principio generale
Una sessione Ableton Live (arrangement) viene letta da AbleJam: ogni **locator**
diventa un **brano**; **clip MIDI** su tracce speciali definiscono **sezioni**,
**lyrics**, **measures**, **OSC**. Le impostazioni di vista sono **per-device**
(ogni client connesso ha le proprie). Setlist/canvas/mapping vivono in file nella
cartella di progetto (cartella "AbleJam").

---

## 1. Brani & locator
- Ogni locator in arrangement = un brano; il nome del locator = titolo.
- Mettere i locator **all'inizio di una battuta**. Automazione di tempo per brano.
- `SONG END` (maiuscolo) a fine brano → calcola la durata e abilita il jump al
  successivo. `STOP`/`AUTOSTOP` → stop forzato (disabilita il toggle "stop dopo
  brano", non sovrascrivibile). Prefisso `.` sul brano successivo = stop prima.
- Notazione nel nome locator (default, sovrascrivibile nell'editor):
  - `#tag` · `[mm:ss]` durata custom (placeholder per brani senza stem) ·
    `[colore]` · `{descrizione}` · `[.classe]` CSS.
  - `*` prefisso → locator ignorato. Locator ClyphX → ignorati.
- La setlist attiva è salvata **con il set di Ableton** (riapre com'era).

## 2. Setlist editor
- Riordino drag; **reset all'ordine di Ableton** (auto-salvato); **ordina A–Z**;
  **revert** modifiche.
- `✕` rimuove (brano grigio) → al salvataggio esce dalla setlist; `＋` re-inserisce.
- **👁 eye**: nasconde i brani esclusi (WYSIWYG).
- `＋`/`⌘K`: ricerca per nome/acronimo/parola/**tag** (tag → aggiungi tutti).
  `＋` da vista normale inserisce **dopo** il brano selezionato.
- Info in basso: n° brani + tempo rimanente; in edit: durata totale.
- Toggle **stop globale** (attenzione: tocca anche brani fuori setlist).
- **Svuota tutto** / (su setlist vuota) **aggiungi tutti**.
- Salva (💾/`⇧S`, nome, in cartella progetto, o export file); Apri (📁/`⇧O`,
  import file). Dopo il load: salvare in AbleJam **e** salvare il set di Ableton.
- `⌘C` copia setlist come testo; `⌘V` incolla testo → **fuzzy match** brani.
- `⌘P` stampa → PDF formattato.
- **Menu ⋮ per-brano** (override salvati nella setlist): colore, descrizione,
  **stop dopo brano** (barra nera; stay vs jump), **delay** tra brani (se stop
  off → countdown nel prossimo in coda), **stop description** (nota sotto, legata
  al brano).

## 3. Sezioni
- Traccia MIDI "Sections"; clip MIDI vuote (`⌘⇧M`) marcano l'inizio sezione; nome
  clip = nome sezione (durata = fino alla clip successiva).
- Click sezione → playback da lì (**solo da fermo**). `↑/↓` = sezione prec/succ
  (MIDI-mappabili). Descrizione `{…}`, durata `[…]`, colori con flag `+CC`/`+CLIPCOLORS`.
- Impostazioni vista: **auto-expand current song**, **auto-scroll to current**
  (segue il playhead, anche cliccando in Ableton), **mostra nomi sezioni** in una
  progress bar, **numerazione** brani/sezioni (teatro/corporate).
- **Jump durante il playback** richiede un **locator** all'inizio della sezione.
  Tool: Settings → *Place Locators on Section Clips* (e *Remove…*). Mix & match.
  Sezioni senza locator appaiono **grigie** (non saltabili). Serve **Safe Mode off**.

### 3.1 Jump modes (5)
`Quantize` (segue la global quantization di Live, consigliato 1 bar) ·
`End of Section` · `End of Song` (opz. "continua sempre quando salti a un brano
in coda", sovrascrive lo stop) · `Dynamic` (sezione→end-of-section,
brano→end-of-song) · `Manual` (2 step: cue poi trigger; `J` jump quantizzato,
`⇧J` jump istantaneo). I due **jump button** sono sempre disponibili come
override temporaneo. Indicatore **glowing** quando sta per saltare.

### 3.2 Flag di sezione
- `+PAUSE` (fine sezione) → pausa (icona pausa in setlist); play per continuare.
- `+LOOPFULL` → loop completo della sezione (loop button glowing); escape =
  disabilita i loop bracket e prosegue. `+LOOPFULL:4` → 4 giri poi esce
  (indicatore di giro). `+LOOP` → escape **interrompe** saltando alla sezione
  successiva (timing = jump mode; richiede locator; non riattivabile dopo escape).
- Loop spontaneo: loop button mentre suona (tasto `L`). MIDI: toggle/escape/enable
  loop (più sicuro mappare escape + enable separati).
- `+SKIP` → sezione saltata (freccia grigia, senza colore); skip consecutivi
  saltano il blocco. `>>> Target` → salto a sezione specifica (avanti/indietro;
  richiede locator; indicazione se manca).
- Guide tracks: `+GUIDE` (mutata in loop/jump, attiva normalmente; mettere i cue
  a fine sezione, disabilitare loop a inizio sezione) · `+LOOPGUIDE` (inverso:
  attiva in loop) · `+JUMPGUIDE` (attiva in sezioni con jump a fine).

### 3.3 Count-In
Settings → *Section Count-In*. Mette il playhead 1/2/4 bar prima della sezione,
**solo del click**, pre-roll, poi unsolo. Opz. disabilitare il solo (rehearsal).
Click = traccia chiamata "click"; flag `+CLICK` per altre (es. "metronome"); più
click possibili. Solo/mute click MIDI-mappabili.

## 4. Impostazioni di playback
Autoplay · Auto-Jump al successivo (globale, override per-brano) · Always Stop at
End (override globale) · Restart Song Before Jumping Back (media-player) · Stop
by Default Instead of Pausing (pausa = riprende dal punto; stop = da capo) ·
Disable loop when jumping (on di default) · Re-enable automation on song jump ·
**Safe Mode** (jump solo da fermo; doppio stop per confermare; next/prev ignorati
mentre suona).

## 5. MIDI mapping
- Lista controller connessi; mapping **device-specific o globale** (any input).
- `＋` learn → funzione da dropdown (molte funzioni + Custom OSC + Custom Script).
- Play/Pause/Stop separati o combinati (spacebar-like); Next/Prev.
- Tipo pulsante: **press / double-press / hold** (anti-trigger accidentale).
- Toggle AbleNet per input (forward in rete). Mapping manuale Note/CC/PC.
- **Script per input MIDI** (qualunque MIDI in ingresso).

## 6. Rete & controllo remoto
- UI su phone/tablet/altro computer sulla stessa rete (hostname o IP dal menu).
  Più device contemporaneamente. **Impostazioni per-device**.
- 🔒 Lock (`⇧L`): controlli disabilitati, vista continua ad aggiornarsi (view-only,
  device-wide). **Web App Password**. **Add to Home Screen** (PWA).
- Wired consigliato per il core; router WiFi (senza internet); switch.

## 7. Setlist view — opzioni
Show audio interfaces · remaining song/set time (vs totale) · info brano in basso
(BPM, time signature, beat 1-2-3-4) · **visual metronome** · hide time signature ·
show global quantization · record indicator · **bar jump buttons** (±1 bar) ·
re-enable automation button.

## 8. Performance view (full-screen, per-device)
Titolo brano gigante nel **colore del brano**; song info (tag, sezione corrente
+ successiva, descrizioni song/sezione/next); tempo, time sig, quantization;
durata totale + **rimanente** (segue i jump); **song progress bar** (nomi+colori
sezioni, cliccabile per navigare); **section progress bar**; clock; **LTC
timecode** (device M4L *LTC Display*, Pro); **current measure** (traccia
"Measures": clip da 1 bar nominate col numero; generatore sul sito; una sola
traccia measures); **Quickplay** (prefisso `>>` → badge/mini-progress);
**track groups** (mute/solo); next/queued song; n° brani + tempo set rimanente;
visual metronome full-screen; **lyrics**; **setlist view embedded** (lyrics a dx,
setlist a sx); pulsanti re-enable/record/loop.

## 9. Lyrics
- Traccia MIDI flag `+LYRICS`; **una clip = una riga** (nome = testo; start/length
  = timing). Generatore lyrics sul sito (incolla testo, sync ad audio). Più tracce
  `+LYRICS` → dropdown di selezione, ognuna personalizzabile; per-device.
- Vista Lyrics: righe avvolte in **blob di sezione**. Da fermo: jump nel timeline
  sincronizza; click riga → vai lì; `,`/`.` riga prec/succ; `⇧M` pin (anchor /
  *line override*); `M`/`N` muovi il pin (scroll indipendente dal playhead).
- Attributi `[...]` (traccia o riga): allineamento `[left]/[center]`; size
  `[large|medium|small|tiny]`; `[mono]`; colore (come i brani); `*corsivo*`,
  `**grassetto**` (anche parole singole); `\` line break manuale; `[nozoom]`
  `[nofade]`; `[linemarker]` (freccia); `[progress]` (karaoke); `[top]`/`[top+N]`
  (spinge la riga su / nasconde le passate); `[nosections]`; `[allsongs]` (intera
  setlist, scroll/jump tra brani); spostamento riga `[<]`/`[>]`; offset timing
  `[+50ms]`/`[-50ms]`, `[+2n]`/`[-1n]` (beat). Colori per-riga via `+CC`.
- **ChordPro**: accordi in `[...]` dentro la clip → sopra il testo; layout a sx.
  Posizione per offset (spazio → tra parole; in mezzo → sopra la sillaba). Colore
  `[chords:blue]`. **Trasposizione** in semitoni sul locator (per brano) o sulla
  traccia (globale).
- **Immagini**: cartella `Lyrics` nel progetto; `[img:path.png]` (con estensione);
  `[full]` full-screen; per-clip o globale. No PDF → generatore immagini sul sito
  (PDF → JPG/PNG per pagina + traccia lyrics).
- Settings vista: mostra play/pause, loop, record, re-enable; mostra sempre line
  override; mostra/nascondi next song; **flip verticale** (teleprompter a specchio).

## 10. Mixer / track groups
- `+G:NOME` (no spazio dopo `:`) o `+GROUP:NOME` → slider nel mixer. Su tracce e
  group track. Stesso nome su più tracce → controlla tutte (livelli **relativi**
  preservati). Una traccia in più gruppi. Colore gruppo = traccia più in alto.
  Riflette le automazioni (edit → disattiva automazione, usare re-enable).
- `+NEVERMUTE`/`+NM` → resta attiva quando si fa solo (timecode, click). Su
  qualsiasi traccia. Mute funziona anche su tracce MIDI. Click = group automatico.
- Mixer anche in performance view (solo mute/solo). Setting: includi Main/master.

## 11. Multi-file projects
Cartella di file ALS, ognuno = **un brano** (song-start + song-end + stem).
Settings → scegli cartella. **Nome brano dal nome FILE** (non dal locator);
descrizione/colore/durata nel nome file (`.` al posto di `:`). Edit setlist come
sempre. Salva/scarta modifiche all'apertura/chiusura. Jump **solo da fermo**
(gap breve al load; no transizioni seamless → file "medley"). Poco flessibile per
routing/click (modificare ogni sessione).

## 12. OSC
- AbleJam invia e riceve. Indirizzo + parametri (spazio). Leading `/` → ad AbleJam;
  prefisso `IP:port` → esterno. Più comandi separati da `;` o newline (macro).
- Map OSC su MIDI (Custom OSC; `/` per suggerimenti).
- **OSC track**: MIDI track flag `+OSC`; comando nel nome clip (inviato quando il
  playhead attraversa lo start, o piazzandolo da fermo). Attributi: `[playing]`
  (solo mentre suona), **prefix** (evita ripetizioni), `[single]`/virgolette
  (clip come singolo parametro).
- Tester OSC nei settings + **log uscite**. Comandi `//`: `//sleep`, `//awaitJump`,
  `//awaitFileLoad`, `//if`. **Device name** per-remote (più nomi separati da `,`
  → gruppi, es. "stage").
- Server OSC su porta **39051** (TouchOSC ecc.). **Subscribe** (IP, port, name;
  `auto` = mittente; 4° arg `true` → fine updates ~30/s playhead). Connessioni in
  ingresso (IP/port). AbleNet: dedup con `uuid=…`, `net=false` per non inoltrare.

## 13. Canvas (UI custom)
- Editor: nome, size (tablet/landscape/custom), bg color; `＋`/`⌘K` elementi; grid;
  zoom; test con `⌘+click` o "View Canvas". Più canvas, accessibili da ogni device.
- Elementi: setlist, song/section progress, audio interfaces, clock, timecode,
  visual metronome, lyrics (seleziona traccia), play/stop, loop, **button**,
  **slider**, **label**, **panel**, **divider**, **embed** (iframe), **input
  field**, current measure. **Preset** pronti.
- **Button**: invia OSC; bg/icona/label; **template dinamici** (condizione →
  colore/icona/label/value, valori via `osc(...)`, 2° valore vuoto = nascondi);
  link a pagina; trigger **script**; comandi **press/release** (es. solo true→false).
- **Slider**: orientamento, stile thumb/bar, snap-to-pointer, min/max/step, value
  (template), azione su release, **linked variable**, script on change.
- **Variabili**: locali (browser, condivise tra canvas) via "Linked Variable";
  **shared** (ovunque). Input field: placeholder, nascondi edit/close (kiosk).

## 14. Scripting (JavaScript)
- Trigger da: MIDI mapping (Custom Script, accesso al `midi`), porta MIDI (any
  input), Canvas (button/slider/input), **Project Script** (settings; gira al load
  /restart; ascolta OSC). Editor con autocomplete + error highlighting.
- Funzioni: `log()`, `sleep()`, invio OSC/MIDI, `osc()` (read). Variabili: JS
  (durata script), **local** (browser, tra canvas), **shared** (ovunque; opz.
  **persist** tra restart). Esempi: velocity>110→stop; doppio-press<500ms→safe
  stop; toast su cue; notifica failover.

## 15. Settings (riferimento)
- Globali (menu bar): browser vs **floating window**; licenza / manage / deactivate;
  web app password; multi-file; **Add plugin to Ableton** (installa il control
  surface); M4L controller (legacy); **custom styles**; **AbleJam folder**
  (settings/setlists/canvases/midi-mappings importabili-condivisibili); hostname;
  preferred network; versione/update; feedback; **log package**; quit.
- Main: show in dock; **default view** (setlist/performance/lyrics); open on start;
  window type; auto-launch last project; playback (§4); jump modes (§3.1);
  count-in (§3.3); MIDI/OSC/scripting (§5/§12/§14); LTC; **remove played songs**
  (vecchia feature, attenzione); mixer (main group + tool: converti color attr →
  clip color, place/remove locator su section clip); **debug** (device connessi,
  latency, device settings, log streaming); AbleNet/redundancy.

## 16. AbleNet / ridondanza (v3 — fuori scope iniziale, qui per completezza)
Due computer A (verde) / B (rosso), stessa rete, sessioni identiche. Toggle Enable
AbleNet; auto-discovery (conteggio host). Navigare **via AbleJam** per restare in
sync (non da Ableton). Remote connesso a un host; **auto-failover** allo switch.
Preferred network. MIDI: toggle forward o MIDI indipendente a entrambi (RTP, stesso
nome porta). Connect to custom IPs (evita host indesiderati). Connected scene
(A/B). **Automatic drift correction** (phase nudge, primi 10s, solo computer B,
clip warpate). **Sync Playback Now** (sincronizza host fermo a quello che suona).
Interfacce: iConnectivity PlayAUDIO, DirectOut EXBOX/Andiamo/Maven/Prodigy, DAD
Core256/AX (dot verde/rosso, arm failover, switch manuale, follow scene su remote,
flag `+HIDE`/`+SHOW`/`+MAIN` per i control pack DAD).
