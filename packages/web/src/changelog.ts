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
