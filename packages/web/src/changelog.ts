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
