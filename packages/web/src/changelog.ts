// "What's new" data + helpers. The modal (in App.tsx) shows the notes for every version newer
// than the one the user last saw, so a skipped update still surfaces everything that changed.
import type { Lang } from "@ablejam/shared";

export interface ChangelogEntry {
  version: string;
  notes: Partial<Record<Lang, string[]>>;
}

// Newest first. Keep the top entry's version in sync with the desktop package version.
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.11.0",
    notes: {
      it: [
        "\"Scrivi su Ableton\" ora esporta SOLO il brano su cui stai lavorando, non più tutti i brani della scaletta. Le etichette degli altri brani restano salvate ma non vengono più riscritte sulla traccia.",
        "Nuova sezione \"Log\" (Impostazioni → Progetto Ableton): mostra i segnali dell'app e del bridge Ableton, così puoi vedere cosa succede durante un'esportazione e diagnosticare i problemi (con pulsanti Copia e Svuota).",
        "Audio guida: aggiunte diagnostiche dettagliate nel bridge quando gli annunci non si caricano — il Log ora dice esattamente dove si ferma (cartella \"AbleJam Speech\" non trovata nel browser di Ableton, nessun file corrispondente, caricamento fallito…). Se l'audio guida non viene generato, apri il Log e mandami cosa c'è scritto.",
        "⚠ Richiede il bridge v55: si installa da solo all'avvio dell'app — poi esci COMPLETAMENTE e riapri Ableton per caricarlo.",
      ],
      en: [
        "\"Write to Ableton\" now exports ONLY the song you're working on, no longer every song in the setlist. The other songs' labels stay saved but are no longer rewritten onto the track.",
        "New \"Logs\" section (Settings → Ableton Project): shows the app's and the Ableton bridge's signals, so you can see what happens during an export and diagnose problems (with Copy and Clear buttons).",
        "Audio guide: added detailed bridge diagnostics when announcements fail to load — the Log now says exactly where it stops (\"AbleJam Speech\" folder not found in Ableton's browser, no matching file, load failed…). If the audio guide isn't generated, open the Log and send me what it says.",
        "⚠ Requires bridge v55: it auto-installs on app launch — then FULLY quit and reopen Ableton to load it.",
      ],
    },
  },
  {
    version: "1.10.0",
    notes: {
      it: [
        "Clip di struttura (e audio guida) ora si fermano al confine del brano: l'ultima etichetta di una canzone NON invade più i brani successivi. Prima riempiva fino alla prossima etichetta, anche se in un altro brano — ora ogni clip finisce al massimo alla fine della sua canzone.",
        "Audio guida Azure: messaggio d'errore più chiaro se la generazione fallisce pur avendo le voci caricate (di solito quota esaurita o regione della chiave).",
        "⚠ Richiede il bridge v54: si installa da solo all'avvio dell'app — poi esci COMPLETAMENTE e riapri Ableton per caricarlo.",
      ],
      en: [
        "Structure clips (and audio guide) now stop at the song boundary: a song's last label NO longer bleeds into the following songs. It used to fill up to the next label even in another song — now every clip ends at most at the end of its own song.",
        "Azure audio guide: clearer error when generation fails despite the voices being loaded (usually exhausted quota or the key's region).",
        "⚠ Requires bridge v54: it auto-installs on app launch — then FULLY quit and reopen Ableton to load it.",
      ],
    },
  },
  {
    version: "1.9.0",
    notes: {
      it: [
        "Nuovo pulsante \"Aggiorna tracce da Ableton\" (Impostazioni → Struttura): rilegge le tracce del progetto, così una traccia appena creata (STRUCTURE/SPEECH…) compare subito nei menu a tendina invece di \"non trovata\".",
        "Chiusura app configurabile (Impostazioni → Generali → \"Alla chiusura, resta in background\"): scegli se chiudendo la finestra AbleJam continua a girare — dispositivi e Ableton restano collegati, riapri dall'icona nella barra di sistema o rilanciando l'app — oppure si chiude del tutto.",
      ],
      en: [
        "New \"Refresh tracks from Ableton\" button (Settings → Structure): re-reads the project's tracks, so a just-created track (STRUCTURE/SPEECH…) shows up in the dropdowns right away instead of \"not found\".",
        "Configurable app close (Settings → General → \"On close, keep running in the background\"): choose whether closing the window keeps AbleJam running — devices and Ableton stay linked, reopen from the system-tray icon or by relaunching — or quits entirely.",
      ],
    },
  },
  {
    version: "1.8.1",
    notes: {
      it: [
        "Voci Azure: risolto il caso in cui, pur avendo la chiave salvata, all'export usciva \"Imposta chiave e regione Azure\". Ora le voci vengono ricaricate da sole all'avvio dalla chiave salvata (e comunque appena prima di generare/ascoltare), quindi la chiave salvata funziona sempre, anche dopo un riavvio.",
      ],
      en: [
        "Azure voices: fixed the case where, even with a saved key, export said \"Set your Azure key and region\". The voices are now reloaded automatically on startup from the saved key (and just before generating/previewing anyway), so a saved key always works, even after a restart.",
      ],
    },
  },
  {
    version: "1.8.0",
    notes: {
      it: [
        "🔌 Bridge Ableton automatico (plug & play): quando un aggiornamento dell'app include un nuovo bridge, viene installato DA SOLO all'avvio. Tu installi solo l'app; se serve, ti chiediamo soltanto di riavviare Ableton. Basta \"Installa bridge\" a mano.",
        "Voci Azure: nuovo pulsante \"Salva\". Chiave e Regione ora restano salvate per sempre — non le reinserisci mai più. Premi Salva e le voci si caricano.",
        "Etichette medley più chiare sulla barra: i nomi dei BRANI sono arancioni in grassetto, le SEZIONI bianche più piccole (tutto maiuscolo) — distingui a colpo d'occhio un nuovo brano da un cambio di sezione.",
      ],
      en: [
        "🔌 Automatic Ableton bridge (plug & play): when an app update ships a new bridge, it's installed BY ITSELF on launch. You just install the app; if needed we only ask you to restart Ableton. No more manual \"Install bridge\".",
        "Azure voices: new \"Save\" button. Key and Region now stay saved forever — you never re-enter them. Press Save and the voices load.",
        "Clearer medley labels on the bar: SONG names are orange bold, SECTIONS are smaller white (all uppercase) — tell a new song from a section change at a glance.",
      ],
    },
  },
  {
    version: "1.7.3",
    notes: {
      it: [
        "Nomi delle sezioni sulla barra Performance: risolto il problema per cui i nomi non si vedevano (comparivano vuoti o solo un frammento tipo \"fi\"). Ora si leggono correttamente sopra la barra.",
      ],
      en: [
        "Section names on the Performance bar: fixed a problem where the names weren't visible (blank or just a fragment like \"fi\"). They now read correctly above the bar.",
      ],
    },
  },
  {
    version: "1.7.2",
    notes: {
      it: [
        "Nomi delle sezioni sulla barra Performance: le etichette di struttura ora sono sempre visibili SOPRA la barra di avanzamento (ogni nome riempie la sua regione fino al cambio successivo) e sono CLICCABILI per saltare direttamente a quel punto. Prima la tacca era troppo sottile per passarci sopra col mouse.",
      ],
      en: [
        "Section names on the Performance bar: structure labels are now always visible ABOVE the progress bar (each name fills its region up to the next change) and are CLICKABLE to jump straight there. Before, the tick was too thin to hover.",
      ],
    },
  },
  {
    version: "1.7.1",
    notes: {
      it: [
        "Clip vocali (SPEECH) contigue: gli annunci generati ora riempiono la timeline dall'inizio all'inizio del cambio successivo, come le clip di struttura — non più clip minuscole. L'annuncio si sente all'inizio di ogni sezione, il resto è silenzio.",
        "⚠ Richiede il bridge v53: Impostazioni → Progetto Ableton → \"Installa / aggiorna bridge Ableton\", poi ESCI COMPLETAMENTE e riapri Ableton.",
      ],
      en: [
        "Contiguous voice (SPEECH) clips: generated announcements now fill the timeline from each change to the next one's start, like the structure clips — no more tiny clips. The announcement plays at the start of each section, the rest is silence.",
        "⚠ Requires bridge v53: Settings → Ableton project → \"Install / update Ableton bridge\", then FULLY QUIT and reopen Ableton.",
      ],
    },
  },
  {
    version: "1.7.0",
    notes: {
      it: [
        "🎙️ Voci premium (Azure): nel Generatore voce puoi ora scegliere il motore \"Premium (Azure)\" e usare le stesse voci di alta qualità di Luvvoice — centinaia, inclusa Jenny — in tutte le lingue. Nessun download: sono tutte pronte. Ti basta creare una risorsa Azure Speech gratuita (free tier: 500.000 caratteri/mese), incollare Chiave e Regione, e le voci compaiono da sole.",
        "Nuovo slider Tono (pitch) nelle impostazioni voce, per entrambi i motori.",
        "Selettore voce migliorato: prima scegli la lingua, poi la voce fra tutte quelle disponibili (con indicazione uomo/donna). Piper resta come opzione offline gratuita.",
      ],
      en: [
        "🎙️ Premium voices (Azure): the Voice generator now has a \"Premium (Azure)\" engine with the same high-quality voices as Luvvoice — hundreds, Jenny included — in every language. No downloads: all ready. Just create a free Azure Speech resource (free tier: 500,000 chars/month), paste the Key and Region, and the voices appear automatically.",
        "New Pitch slider in the voice settings, for both engines.",
        "Improved voice picker: choose the language first, then the voice among all available (with male/female marker). Piper stays as the free offline option.",
      ],
    },
  },
  {
    version: "1.6.1",
    notes: {
      it: [
        "Generatore voce (TTS): reso affidabile su macOS. Su Apple Silicon la voce gira tramite Rosetta 2, che l'app installa da sola al primo uso se manca; se non è possibile, ora te lo dice chiaramente invece di fallire in silenzio.",
        "Corretto il rilevamento degli errori di generazione: un motore che non parte non viene più scambiato per un successo.",
      ],
      en: [
        "Voice generator (TTS): made reliable on macOS. On Apple Silicon the voice runs through Rosetta 2, which the app installs by itself on first use if missing; if that's not possible it now tells you clearly instead of failing silently.",
        "Fixed generation error detection: an engine that can't start is no longer mistaken for success.",
      ],
    },
  },
  {
    version: "1.6.0",
    notes: {
      it: [
        "🎙️ Generatore voce integrato (TTS): crea gli annunci di struttura (ritornello, bridge, mix…) direttamente dall'app, senza una cartella di file. Scegli lingua (IT/EN/ES/FR) e voce (uomo/donna), regola velocità ed espressività, ascolta l'anteprima (\"Ascolta\") e salva i tuoi preset.",
        "In Impostazioni → Struttura, con l'audio guida attivo, scegli \"Genera voce (TTS)\": all'export la struttura crea da sola le clip vocali sul canale SPEECH (creato se manca).",
        "Voce neurale offline (Piper): al primo uso l'app scarica il motore (~25 MB) e la voce scelta; poi funziona senza internet. La cartella di file resta disponibile come alternativa.",
      ],
      en: [
        "🎙️ Built-in voice generator (TTS): create the structure announcements (chorus, bridge, mix…) straight from the app, no folder of files needed. Pick a language (IT/EN/ES/FR) and voice (male/female), tune speed and expressiveness, preview it (\"Listen\") and save your presets.",
        "In Settings → Structure, with the audio guide on, choose \"Generate voice (TTS)\": on export the structure creates the voice clips by itself on the SPEECH track (created if missing).",
        "Offline neural voice (Piper): on first use the app downloads the engine (~25 MB) and the chosen voice; then it works with no internet. The file-folder mode stays available as an alternative.",
      ],
    },
  },
  {
    version: "1.5.0",
    notes: {
      it: [
        "Struttura → \"Scrivi su Ableton\": le clip ora sono CONTIGUE — ogni etichetta dura dal suo inizio all'inizio della successiva, invece di essere tutte piccole e uguali. Progetto più ordinato e clip che non si spostano per sbaglio.",
        "⚠ Richiede il bridge v52: Impostazioni → Progetto Ableton → \"Installa / aggiorna bridge Ableton\", poi ESCI COMPLETAMENTE e riapri Ableton.",
      ],
      en: [
        "Structure → \"Write to Ableton\": clips are now CONTIGUOUS — each label spans from its start to the next one's start, instead of all being small and equal. Tidier project and clips that don't get nudged out of place.",
        "⚠ Requires bridge v52: Settings → Ableton project → \"Install / update Ableton bridge\", then FULLY QUIT and reopen Ableton.",
      ],
    },
  },
  {
    version: "1.4.3",
    notes: {
      it: [
        "Controllo aggiornamenti più affidabile: non fallisce più quando GitHub limita temporaneamente le richieste (rate limit). Se l'API è occupata, l'app trova comunque l'ultima versione da un canale alternativo.",
        "Messaggio d'errore aggiornamenti più chiaro: suggerisce di riprovare tra qualche minuto, non solo di controllare la connessione.",
      ],
      en: [
        "More reliable update check: it no longer fails when GitHub temporarily rate-limits requests. If the API is busy, the app still finds the latest version via a fallback channel.",
        "Clearer update error message: it suggests retrying in a few minutes, not just checking your connection.",
      ],
    },
  },
  {
    version: "1.4.2",
    notes: {
      it: [
        "Il pulsante \"Installa / aggiorna bridge Ableton\" ora funziona davvero e te lo conferma: copia la control surface (anche nella cartella OneDrive\\Documenti da cui Ableton la carica) e mostra una finestra con i percorsi e la versione installata. Prima, su Windows, poteva non fare nulla in silenzio.",
        "Versione del bridge ora VISIBILE: in Impostazioni → Progetto Ableton vedi \"Bridge caricato in Ableton: vNN\" — così capisci subito se l'aggiornamento è andato a buon fine o se Ableton sta ancora caricando una copia vecchia.",
        "Anche Ableton lo mostra: alla connessione, nella barra di stato di Live compare \"AbleJam bridge vNN connesso\".",
        "⚠ Richiede il bridge v51: Impostazioni → Progetto Ableton → \"Installa / aggiorna bridge Ableton\", poi ESCI COMPLETAMENTE e riapri Ableton.",
      ],
      en: [
        "The \"Install / update Ableton bridge\" button now actually works and confirms it: it copies the control surface (including into the OneDrive\\Documents folder Ableton loads from) and shows a dialog with the paths and installed version. On Windows it could previously do nothing silently.",
        "Bridge version is now VISIBLE: Settings → Ableton project shows \"Bridge loaded in Ableton: vNN\" — so you instantly know whether the update took or Ableton is still loading an old copy.",
        "Ableton shows it too: on connect, Live's status bar reads \"AbleJam bridge vNN connesso\".",
        "⚠ Requires bridge v51: Settings → Ableton project → \"Install / update Ableton bridge\", then FULLY QUIT and reopen Ableton.",
      ],
    },
  },
  {
    version: "1.4.1",
    notes: {
      it: [
        "Nuovo pulsante \"Installa / aggiorna bridge Ableton\" in Impostazioni → Progetto Ableton: su Windows la barra dei menù è nascosta, quindi il vecchio \"menù AbleJam → Installa bridge\" non si trovava. Ora è un pulsante sempre visibile nell'app.",
        "I messaggi che chiedono di aggiornare il bridge ora indicano il percorso giusto (Impostazioni → Progetto Ableton), non più un menù invisibile.",
      ],
      en: [
        "New \"Install / update Ableton bridge\" button in Settings → Ableton project: on Windows the menu bar is hidden, so the old \"AbleJam menu → Install bridge\" was impossible to find. It's now an always-visible button in the app.",
        "Messages asking to update the bridge now point to the right place (Settings → Ableton project), no longer to an invisible menu.",
      ],
    },
  },
  {
    version: "1.4.0",
    notes: {
      it: [
        "Struttura → \"Scrivi su Ableton\" ora crea da solo la traccia STRUCTURE (e la traccia GUIDA audio) se non esistono: prima, senza quelle tracce, il pulsante non faceva nulla in silenzio. Ora scrive sempre le clip.",
        "Se qualcosa impedisce la scrittura te lo diciamo subito: Ableton non collegato, bridge da aggiornare o nessuna etichetta da esportare — niente più clic \"a vuoto\".",
        "Lettura dei marker all'avvio di nuovo immediata: i titoli e le posizioni compaiono subito, le analisi pesanti (dispositivi, autotune) sono spostate appena dopo e non bloccano più la partenza.",
        "⚠ Richiede il bridge v50: Impostazioni → Progetto Ableton → \"Installa / aggiorna bridge Ableton\" e riavvia Ableton.",
      ],
      en: [
        "Structure → \"Write to Ableton\" now creates the STRUCTURE track (and the audio GUIDE track) by itself when missing: previously, without those tracks, the button silently did nothing. It now always writes the clips.",
        "If anything blocks the write we tell you right away: Ableton not connected, bridge needs updating, or no labels to export — no more dead clicks.",
        "Marker reading at startup is immediate again: titles and positions show up instantly; the heavy scans (devices, autotune) now run just after and no longer block the start.",
        "⚠ Requires bridge v50: Settings → Ableton project → \"Install / update Ableton bridge\" and restart Ableton.",
      ],
    },
  },
  {
    version: "1.3.1",
    notes: {
      it: [
        "Impostazioni: risolte le card che sembravano tagliate in basso — ora l'elenco scorre correttamente in ogni scheda.",
        "Dispositivi (Impostazioni → Rete): nuova gestione Master/Visualizzazione — vedi ogni dispositivo connesso per nome, con interruttore per assegnare il controllo (max 2 oltre al PC). La lista si aggiorna dal vivo e si gestisce anche dai dispositivi Master, non solo dal PC.",
        "Editor struttura raggiungibile direttamente dalla Performance (pulsante \"Struttura\"): aggiungi, sposta, modifica i cambi ed esportali su Ableton (clip + audio guida) senza passare dalle impostazioni. Più etichette pronte, allineate agli audio inclusi.",
      ],
      en: [
        "Settings: fixed cards that looked cut off at the bottom — the list now scrolls properly in every tab.",
        "Devices (Settings → Network): new Master/View management — see every connected device by name, with a switch to assign control (max 2 besides the PC). The list updates live and can be managed from Master devices too, not only the PC.",
        "Structure editor reachable straight from Performance (a \"Structure\" button): add, move, edit changes and export them to Ableton (clips + audio guide) without going through Settings. More ready-made labels, aligned with the bundled audio.",
      ],
    },
  },
  {
    version: "1.3.0",
    notes: {
      it: [
        "Annunci vocali inclusi (italiano): 21 audio pronti (strofa, ritornello, mix, riddim, stacco, solo…) dentro AbleJam. All'export della struttura, se l'audio guida è attiva, l'app chiede conferma e poi fa TUTTO da sola: copia gli annunci nella User Library di Ableton, li carica sulla traccia guida e crea le clip a ogni cambio.",
        "Cartella annunci personalizzata: incolla il percorso della tua cartella e vedi subito quali file si abbinano a quali etichette (abbinamento automatico per nome, es. \"SOLO DI CHITARRA\" → \"solo chitarra\").",
        "Più etichette pronte nell'editor struttura: mix, riddim, dub, pausa, stacco, stop, colpo secco, ancora, entriamo tutti, re-intro, pre-chorus, solo tastiera.",
        "⚠ Richiede il bridge v49: menù AbleJam → \"Installa bridge\" e riavvia Ableton.",
      ],
      en: [
        "Bundled voice announcements (Italian): 21 ready-made audio cues (verse, chorus, mix, riddim, breaks, solos…) inside AbleJam. On structure export, with the audio guide enabled, the app asks for confirmation and then does EVERYTHING by itself: copies the announcements into Ableton's User Library, loads them onto the guide track and creates the clips at every change.",
        "Custom announcements folder: paste your folder's path and instantly see which files match which labels (auto-match by name, e.g. \"SOLO DI CHITARRA\" → \"solo chitarra\").",
        "More ready-made labels in the structure editor: mix, riddim, dub, pausa, stacco, stop, colpo secco, ancora, entriamo tutti, re-intro, pre-chorus, solo tastiera.",
        "⚠ Requires bridge v49: AbleJam menu → \"Install bridge\" and restart Ableton.",
      ],
    },
  },
  {
    version: "1.2.0",
    notes: {
      it: [
        "Medley a prova di palco: i brani legati a mano non si fermano più a metà (difese multiple contro le note stop residue; se uno stop spurio sfugge, il medley riparte da solo). I link manuali sopravvivono anche al re-import della scaletta.",
        "Struttura brani: nuovo editor (Impostazioni → Progetto Ableton) con etichette pronte (strofa, ritornello, bridge…) e personalizzate — premi Play e tocca l'etichetta a ogni cambio. Esporta tutto sul progetto come clip nominate e, se vuoi, genera anche la traccia audio-guida con i tuoi annunci. Sezioni visibili in Performance/Stage e come tacche sulla barra.",
        "iPad e touch: le barre di avanzamento ora si trascinano col dito — il cursore ti segue e al rilascio il Play parte esattamente da lì. Barre più alte sui touch screen.",
        "Master e spettatori: solo il PC e fino a 2 dispositivi autorizzati (Impostazioni → Rete) controllano AbleJam; chiunque altro conosca l'IP può solo guardare.",
        "Nuovo wizard al primo avvio (soprattutto per Mac): installa il bridge e ti guida passo-passo, confermando da solo quando Ableton si collega.",
        "⚠ Per medley robusto e struttura: menù AbleJam → \"Installa bridge\" e riavvia Ableton (bridge v48).",
      ],
      en: [
        "Stage-proof medleys: hand-linked songs no longer stop mid-way (multiple defenses against stale stop notes; if a spurious stop slips through, the medley resumes by itself). Manual links now survive setlist re-imports too.",
        "Song structure: new editor (Settings → Ableton project) with ready-made labels (verse, chorus, bridge…) and custom ones — press Play and tap the label at every change. Export everything to the project as named clips and, optionally, generate the audio guide track with your announcements. Sections show in Performance/Stage and as ticks on the bar.",
        "iPad & touch: the progress bars now scrub under your finger — the cursor follows and on release Play starts exactly there. Taller bars on touch screens.",
        "Masters & viewers: only the PC and up to 2 authorized devices (Settings → Network) control AbleJam; anyone else with the IP can only watch.",
        "New first-run wizard (especially for Mac): installs the bridge and walks you through, confirming by itself when Ableton connects.",
        "⚠ For robust medleys and structure: AbleJam menu → \"Install bridge\" and restart Ableton (bridge v48).",
      ],
    },
  },
  {
    version: "1.1.1",
    notes: {
      it: [
        "macOS: ora si può incollare la chiave di licenza (e in qualsiasi campo) con ⌘V e con tasto destro → Incolla. Aggiunti il menu Modifica e il menu contestuale (prima su Mac mancavano).",
      ],
      en: [
        "macOS: you can now paste the license key (and into any field) with ⌘V and right-click → Paste. Added the Edit menu and a context menu (they were missing on Mac).",
      ],
    },
  },
  {
    version: "1.1.0",
    notes: {
      it: [
        "Attivazione per dispositivo: ogni chiave funziona su un massimo di 3 computer. La prima attivazione richiede internet una volta; dopo, l'app funziona offline su quel dispositivo con tutte le funzioni Pro.",
        "Importante: dopo l'aggiornamento reinserisci la tua chiave una volta (con internet) per attivare questo dispositivo. Puoi gestire i dispositivi dalla tua area clienti.",
      ],
      en: [
        "Per-device activation: each key works on up to 3 computers. The first activation needs internet once; afterwards the app runs offline on that device with all Pro features.",
        "Important: after updating, re-enter your key once (online) to activate this device. You can manage devices from your customer area.",
      ],
    },
  },
  {
    version: "1.0.1",
    notes: {
      it: [
        "Impostazioni più curate: schede in un'unica colonna verticale (niente barra orizzontale), interruttori più piccoli, card più chiare per un contrasto migliore, e la scheda \"Aggiornamenti e licenza\" spostata in fondo.",
      ],
      en: [
        "Tidier settings: cards in a single vertical column (no horizontal bar), smaller switches, lighter cards for better contrast, and the \"Updates & license\" tab moved to the bottom.",
      ],
    },
  },
  {
    version: "1.0.0",
    notes: {
      it: [
        "Versione 1.0 — prima release stabile.",
        "La finestra delle impostazioni ora ha una dimensione fissa: non cambia più passando da una categoria all'altra (scorre solo l'elenco interno).",
      ],
      en: [
        "Version 1.0 — first stable release.",
        "The settings window now has a fixed size: it no longer resizes when you switch categories (only the inner list scrolls).",
      ],
    },
  },
  {
    version: "0.1.24",
    notes: {
      it: [
        "Impostazioni riorganizzate in categorie con schede laterali (Generali, Rete, MIDI, Aggiornamenti e licenza, Controlli rapidi, Testi, Progetto Ableton): più ordinate e veloci da navigare.",
        "La card \"Connetti un dispositivo\" ora si apre centrata (prima compariva in alto).",
        "Indicatore scheda audio: verde solo quando Ableton è collegato e c'è un'interfaccia audio (prima restava verde anche con Ableton scollegato).",
      ],
      en: [
        "Settings reorganized into categories with side tabs (General, Network, MIDI, Updates & license, Quick controls, Lyrics, Ableton project): tidier and faster to navigate.",
        "The \"Connect a device\" card now opens centered (it used to appear at the top).",
        "Audio-interface indicator: green only when Ableton is connected and an interface is present (it used to stay green even with Ableton disconnected).",
      ],
    },
  },
  {
    version: "0.1.23",
    notes: {
      it: [
        "Medley creati a mano (unendo due brani nella setlist): la barra di avanzamento ora copre l'intero medley — la somma dei brani — invece del solo primo, anche quando i brani non sono adiacenti nel timeline di Ableton.",
        "Medley: cliccando un punto sulla barra il playhead va esattamente lì, non più al marker del brano.",
      ],
      en: [
        "Hand-made medleys (joining two songs in the setlist): the progress bar now spans the whole medley — the sum of its songs — instead of just the first, even when the songs aren't adjacent in the Ableton timeline.",
        "Medley: clicking a point on the bar now seeks exactly there instead of jumping to the song's marker.",
      ],
    },
  },
  {
    version: "0.1.22",
    notes: {
      it: [
        "Indicatore scheda audio semplificato: ora è sempre presente e diventa verde/rosso da solo (rileva se è collegata un'interfaccia audio USB) — niente più selezione manuale nelle impostazioni.",
        "L'indirizzo per tablet/telefono è ora un'icona compatta verde/rossa: cliccala per aprire al volo QR e indirizzo, senza passare dalle impostazioni. Indicatori in alto più uniformi.",
      ],
      en: [
        "Audio-interface indicator simplified: it's always shown now and turns green/red on its own (detects whether a USB audio interface is connected) — no more manual pick in Settings.",
        "The tablet/phone address is now a compact green/red icon: click it to pop the QR and address straight up, no Settings detour. Top-bar indicators are more uniform.",
      ],
    },
  },
  {
    version: "0.1.21",
    notes: {
      it: [
        "Automazione plugin su play/stop: in Impostazioni → Automazione plugin scegli una traccia, un plugin e se dev'essere acceso quando suoni o quando sei fermo. Caso tipico: autotune ON col click/sequenza, OFF quando parli tra un brano e l'altro.",
        "Per attivarla: menù AbleJam → \"Installa bridge\" e riavvia Ableton (serve il nuovo bridge).",
      ],
      en: [
        "Plugin automation on play/stop: in Settings → Plugin automation pick a track, a plugin and whether it's on while playing or while stopped. Classic case: autotune ON with the click/sequence, OFF when you talk between songs.",
        "To enable it: AbleJam menu → \"Install bridge\" and restart Ableton (the new bridge is required).",
      ],
    },
  },
  {
    version: "0.1.20",
    notes: {
      it: [
        "Nuovo indicatore scheda audio: scegli la tua interfaccia in Impostazioni → Scheda audio e AbleJam mostra una spia verde/rossa in alto, avvisandoti subito se si scollega durante il live.",
      ],
      en: [
        "New audio-interface indicator: pick your interface in Settings → Audio and AbleJam shows a green/red light up top, alerting you the moment it disconnects during the show.",
      ],
    },
  },
  {
    version: "0.1.19",
    notes: {
      it: [
        "Card \"Connetti un dispositivo\": pulsante copia a icona e descrizione che va a capo — niente più testo che esce dalla card.",
        "Tornando indietro (prev) o con Stop dentro un medley si va all'inizio del medley, non all'ultimo brano.",
        "Risolto: il nome del pulsante PANIC ora è modificabile.",
        "STAGE: i testi sfumano nel buio dietro la barra e il \"Prossimo\" non la tocca più; spazi sistemati.",
        "Tap più reattivi su telefoni e tablet.",
      ],
      en: [
        "\"Connect a device\" card: icon copy button and the description wraps — no more text spilling out of the card.",
        "Going back (prev) or Stop into a medley now lands on the medley start, not its last song.",
        "Fixed: the PANIC button label is now editable.",
        "STAGE: lyrics fade into the dark behind the bar and \"Next\" no longer touches it; spacing fixed.",
        "Snappier taps on phones and tablets.",
      ],
    },
  },
  {
    version: "0.1.18",
    notes: {
      it: ["Card \"Connetti un dispositivo\": pulsante copia compatto (icona) e indirizzo su una riga — niente più testo che sborda dalla card."],
      en: ["\"Connect a device\" card: compact icon copy button and the address on one line — no more text spilling out of the card."],
    },
  },
  {
    version: "0.1.17",
    notes: {
      it: ["Sistemata la card \"Connetti un dispositivo\": i pulsanti Copia indirizzo / Salva QR ora sono in stile (prima il testo sbordava)."],
      en: ["Fixed the \"Connect a device\" card: the Copy address / Save QR buttons are now properly styled (the label used to clip)."],
    },
  },
  {
    version: "0.1.16",
    notes: {
      it: ["Risolta la schermata di avvio trasparente su Windows: ora il logo di caricamento si vede correttamente."],
      en: ["Fixed the transparent splash screen on Windows: the loading logo now shows correctly."],
    },
  },
  {
    version: "0.1.15",
    notes: {
      it: [
        'Attivazione con un clic dall\'area clienti: sul sito premi "Attiva su AbleJam" e la chiave entra subito nell\'app.',
        "Sezione Attivazione spostata in fondo alle impostazioni, con il pulsante rifatto.",
      ],
      en: [
        'One-click activation from your customer area: press "Activate in AbleJam" on the site and the key lands in the app.',
        "Activation moved to the bottom of Settings, with a redesigned button.",
      ],
    },
  },
  {
    version: "0.1.14",
    notes: {
      it: ["Risolto lo sfarfallio del transport (BPM e brano attivo che saltavano) in modalità demo con Ableton collegato: la demo ora è completamente isolata dal bridge reale."],
      en: ["Fixed transport flicker (BPM and active song jumping) in demo mode while connected to Ableton: demo is now fully isolated from the real bridge."],
    },
  },
  {
    version: "0.1.13",
    notes: {
      it: [
        'Nuova schermata "Novità": dopo ogni aggiornamento vedi subito cosa è cambiato.',
        "Attivazione della versione completa con la tua licenza (Impostazioni → Attivazione).",
        "Correzioni e migliorie di stabilità.",
      ],
      en: [
        'New "What\'s new" screen: after each update you instantly see what changed.',
        "Full-version activation with your license (Settings → Activation).",
        "Stability fixes and improvements.",
      ],
    },
  },
  {
    version: "0.1.12",
    notes: {
      it: [
        "Pannello connessione: copia l'IP, QR code per collegare tablet e telefoni, salva il QR come immagine.",
        "Accesso da tutta la rete WiFi: chiunque sulla stessa rete può controllare AbleJam.",
      ],
      en: [
        "Connection panel: copy the IP, QR code to connect tablets and phones, save the QR as an image.",
        "Whole-network access: anyone on the same WiFi can control AbleJam.",
      ],
    },
  },
  {
    version: "0.1.11",
    notes: {
      it: ["QR code per l'accesso via rete locale.", "Migliorie interne."],
      en: ["QR code for local-network access.", "Internal improvements."],
    },
  },
  {
    version: "0.1.10",
    notes: {
      it: ["Icona nella barra delle applicazioni di Windows.", "Nota MIDI di sicurezza (panic) su macOS."],
      en: ["Windows taskbar icon.", "macOS safety (panic) MIDI note."],
    },
  },
];

export const WHATS_NEW_TITLE: Record<Lang, string> = {
  it: "Novità di questa versione",
  en: "What's new in this version",
  es: "Novedades de esta versión",
  fr: "Nouveautés de cette version",
};

export const WHATS_NEW_CTA: Record<Lang, string> = {
  it: "Continua",
  en: "Got it",
  es: "Entendido",
  fr: "Continuer",
};

/** Localized notes for one entry, falling back to EN then IT. */
export function notesFor(entry: ChangelogEntry, lang: Lang): string[] {
  return entry.notes[lang] ?? entry.notes.en ?? entry.notes.it ?? [];
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Entries newer than `since` (exclusive) up to and including `current`, newest first. */
export function entriesSince(since: string, current: string): ChangelogEntry[] {
  return CHANGELOG.filter((e) => cmp(e.version, since) > 0 && cmp(e.version, current) <= 0);
}
