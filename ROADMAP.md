# AbleJam — Roadmap verso la release

> Stato: feature-complete per **Windows / single-machine**. Questo piano porta da
> "beta usabile" a **1.0 da palco** (cross-platform + ridondanza + hardening + packaging).
> La parità con AbleSet è basata su ricerca delle loro funzioni pubbliche (clean-room: nessun
> loro codice). Le sezioni marcate _[ricerca]_ vanno rifinite con l'esito del recon AbleSet.

---

## Dove siamo (fatto)
- Core: locator → brani (titolo/tonalità/medley/sezioni/fine), follow del brano, transport.
- Setlist: riordino, rimuovi/ripristina, medley (marker + manuali), numeri, colori, import (txt/pdf/docx), preset (salva/salva-come/Ctrl+S/recenti), stampa con opzioni.
- 3 viste per-dispositivo (Setlist/Performance/Stage), kiosk, accesso LAN (tablet/telefono).
- Testi sincronizzati (editor per-brano, registrazione, tipografia, teleprompter, import clip MIDI).
- CLICK + indicatore visivo (beat reale), STOP automatici (note MIDI), PANIC/PULL UP (nota MIDI).
- 4 lingue (IT/EN/ES/FR), scorciatoie tastiera + pedali Bluetooth, pulizia progetto (rinomina clip).
- Bridge Python v46 (control surface), host Node, web React. Monorepo pnpm.

---

## Fase A — Supporto macOS (porting layer)  ·  priorità ALTA
Obiettivo: AbleJam gira identico su MacBook. Architettura già cross-platform; mancano i punti Windows-only.

- [ ] **Percorso bridge per OS.** Install path: Win `…/OneDrive/Documenti/Ableton/User Library/Remote Scripts/AbleJam`; mac `~/Music/Ableton/User Library/Remote Scripts/AbleJam`. Script di install che rileva l'OS.
- [ ] **MIDI PANIC port.** Win = loopMIDI; mac = **IAC Driver** (Audio MIDI Setup). Il selettore porte (`emergencyPort`) deve elencare le porte mac. Verificare `midiAvailable()`/invio nota su mac (host: `index.ts`, gestione porte MIDI).
- [ ] **"Apri impostazioni Bluetooth".** Comando host `openBluetoothSettings` è Windows-only → ramo mac (o nascondere il pulsante su mac).
- [ ] **Apri file / editor esterno.** `editSetlistFile`/`openInDefaultApp` usano comandi Win → equivalente mac (`open`).
- [ ] **Installer.** `install.ps1` (PowerShell) → aggiungere `install.command`/`install.sh` per mac (copia bridge, avvia host).
- [ ] **Rilevamento progetto/percorsi** in `ableton.ts`: verificare i path su mac.
- [ ] **Test end-to-end su MacBook**: bridge si connette, transport, stage, testi, PANIC via IAC, accesso LAN.

_Esito: AbleJam installabile e funzionante su macOS._

## Fase B — Multi-dispositivo & multi-computer (test + hardening)  ·  priorità ALTA
Già funziona: 1 host = 1 Ableton, N dispositivi in LAN. Da irrobustire e testare con più macchine.

- [ ] **Test multi-client reale**: Mac (operatore) + tablet (cantante) + telefono + gobbo simultanei sullo stesso host. Verificare latenza, sync stato, indicatore CLICK su tutti.
- [ ] **Riconnessione WS robusta**: il client già ritenta ogni 1s; testare drop WiFi, sospensione, cambio rete. Stato "disconnesso" chiaro nella UI.
- [ ] **mDNS / nome host friendly** (opz.): `ablejam.local` invece dell'IP, per non dipendere dall'IP che cambia.
- [ ] **QR code dell'indirizzo** in Impostazioni → Tablet (scan veloce da telefono).
- [ ] **Gestione "chi comanda"**: se due operatori navigano insieme può confondere — valutare un indicatore di "ultimo comando da <device>" (leggero).

_Esito: setup multi-schermo stabile e testato._

## Fase C — Ridondanza / failover ("AbleNet" di AbleSet)  ·  priorità MEDIA-ALTA
Loro lo chiamano **AbleNet** (tier Standard $179+). Come funziona — verificato sulle loro docs (clean-room, replichiamo solo il concetto):
- **Decentralizzato**: 2+ computer aprono lo **stesso set** Ableton; uno qualsiasi può crashare, finché uno è online il sistema continua. Nessun master singolo.
- **Discovery** via **Bonjour/mDNS** (automatico) + fallback "Connetti a IP custom".
- **Failover**: il browser viene **reindirizzato automaticamente** al prossimo computer disponibile (UI raggiungibile da qualsiasi IP).
- **Drift correction**: usa i **Phase Nudge** di Live per rallentare/accelerare il **backup** finché è in sync col main (solo sul backup; richiede **clip warpate** — Texture/Beats).
- **Sync Playback Now** (re-sync manuale dopo crash) + sync di **ordine setlist** e **quantizzazione** tra le macchine.
- L'**audio** in failover è gestito da interfacce ridondanti (iConnectivity/DAD/DirectOut), fuori da AbleSet.

Design AbleJam:
- [ ] **Peer discovery** tra host (mDNS, con fallback IP manuale) — nuovo modulo host `redundancy.ts`.
- [ ] **Relay comandi**: ogni nav (jump/seek/play/stop/metronomo) replicata ai peer → tutti gli Ableton allo stesso punto.
- [ ] **Failover UI**: il client web si riconnette automaticamente a un peer vivo (lista IP peer).
- [ ] **Drift correction** via Phase Nudge di Live, pilotati dal bridge, attivabile solo sul backup.
- [ ] **Sync setlist + quantizzazione** all'ingresso nella rete.
- [ ] **Pannello stato peer**: online, brano/posizione, in-sync sì/no, drift.
- [ ] **Sync Playback Now** manuale.

_Esito: backup live pronto a subentrare. È la feature più complessa — candidata a **1.1** salvo priorità diversa._

## Fase D — Gap di parità con AbleSet (prioritizzati dal recon)
**ALTA — core live, ci manca:**
- [ ] **Jump modes + quantizzazione**: AbleSet ha 5 modi (Quantized / End of Section / End of Song / Dynamic / Manual) + jump-by-bars/beats + pulsanti "istantaneo vs quantizzato" che rispettano la quantizzazione globale di Live. Noi: next/prev/jump + auto-continue medley + STOP. → aggiungere il **salto quantizzato**.
- [ ] **Loop di sezione**: `+LOOP` / `+LOOPFULL` / `+LOOP:4` (ripeti una sezione N volte, quantizzato). Molto usato dal vivo.
- [ ] **Notazione locator estesa**: `+SKIP`, `+PAUSE`, `.` stop-al-prossimo, `>>` quick-section, `>>>` auto-jump, tag `#`.

**MEDIA — integrazioni pro:**
- [ ] **API OSC esterna** (next/prev/jump/play via OSC documentato) + **OSC tracks** (`+OSC` clip MIDI che lanciano OSC al playhead → mixer/luci/video).
- [ ] **MIDI mapping completo** (note/CC/PC → funzioni, Press/Hold/Double) oltre a pedali/tastiera attuali.
- [ ] **Stream Deck / Bitfocus Companion**.
- [ ] **Timecode LTC/MTC** (display + generazione per luci/video).

**BASSA / opzionale:**
- [ ] **Più tracce testi** (lead/cori/accordi, per-dispositivo) — noi una sola LYRICS.
- [ ] **Sections track** (`+SECTIONS` clip MIDI) come alternativa ai locator.
- [ ] **Multi-file projects** (un progetto Live per brano, switch automatico).
- [ ] **Mixer** (volumi tracce dalla UI) · **Canvas** (interfacce custom) — tier Pro di AbleSet.

**DOVE SIAMO AVANTI:** editor testi per-brano con tipografia ricca + registrazione in-app; **4 lingue** (loro solo inglese); import **PDF/DOCX**; PANIC/campione; indicatore CLICK a barre.

## Fase E — Hardening / QA / stabilità  ·  priorità ALTA (pre-release)
- [ ] **Edge cases setlist**: progetti senza locator, locator fuori-griglia, time signature ≠ 4/4, set lunghissimi.
- [ ] **Resilienza bridge**: reload control surface a metà set, crash Ableton, riconnessione pulita.
- [ ] **Test automatici**: estendere i test esistenti (notation, setlist) a medley/lyrics/stop/preset.
- [ ] **Performance**: set da 40+ brani, molte clip (abbiamo 768 clip nel progetto reale), molti dispositivi.
- [ ] **Logging/diagnostica** per supporto (già c'è `support@ablejam.com`).

## Fase F — Packaging, installer, docs, release  ·  priorità ALTA (finale)
- [ ] **Installer 1-click** Win (esiste `installer/` + `install.ps1`) — rifinire; **+ macOS** (.command/.dmg).
- [ ] **Avvio host come servizio/app** (no terminale per l'utente finale): wrapper (es. piccola app tray, o `pkg`/`tauri` per impacchettare host+web).
- [ ] **Onboarding**: prima esecuzione → guida all'installazione bridge + selezione control surface.
- [ ] **Firma/notarizzazione** (mac) e SmartScreen (Win) per evitare warning.
- [ ] **Licenza/pricing** se commerciale (tiers tipo AbleSet?), gestione attivazione.
- [ ] **Sito + docs**; la guida in-app c'è già (12 sezioni + contatto).
- [ ] **Beta pubblica** con un gruppo ristretto.

---

## Sequenza consigliata
1. **A (macOS)** + **B (multi-device test)** → sblocca i tuoi test sul MacBook subito.
2. **E (hardening)** in parallelo (continuo).
3. **C (ridondanza)** o **D (parità)** secondo priorità dal recon AbleSet.
4. **F (packaging/release)** come ultimo miglio.

**Tempistica indicativa**: A+B ≈ 1 blocco di lavoro; E continuo; C ≈ il blocco più grosso; F ≈ 1 blocco.
Beta Windows molto vicina; 1.0 cross-platform = A+B+E+F (C/D possono essere 1.1).
