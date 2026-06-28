// AbleJam locator/clip notation parser (clean-room, from SPEC.md §1-3).
// Parses one locator/clip name into structured data. Pure & browser-safe.

export interface Flag {
  name: string; // upper-case, e.g. PAUSE, LOOP, LOOPFULL, SKIP, END, GUIDE
  count?: number; // e.g. +LOOPFULL:4 -> 4
}

export interface ParsedLocator {
  raw: string;
  /** `*` prefix — ignored by AbleJam. */
  ignored: boolean;
  /** `.` prefix — the PREVIOUS song should stop before this one. */
  dotPrefix: boolean;
  /** `/` (or `-`) prefix — this song CONTINUES from the previous one (medley; opposite of
   * `.`). `/` matches the medley separator used in the setlist/print. */
  medleyPrefix: boolean;
  /** `/` (or `-`) SUFFIX — this song continues INTO the next one (medley). e.g. "COME AROUND /". */
  medleyNext: boolean;
  /** SONG END / STOP markers (not a song or section themselves). */
  marker: "songEnd" | "stop" | null;
  /** `>` section, `>>` quick-access section, or null for a song. */
  section: "section" | "quickSection" | null;
  title: string;
  /** Musical key written in parentheses at the end of the marker, e.g. "Am", "Em-Am". */
  key: string | null;
  color: string | null;
  description: string | null;
  className: string | null;
  tags: string[];
  durationSec: number | null;
  nosong: boolean;
  flags: Flag[];
  /** `A >>> B` transition target. */
  transitionTarget: string | null;
}

export const COLORS: ReadonlySet<string> = new Set([
  "gray", "red", "orange", "amber", "yellow", "lime", "green", "emerald",
  "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia",
  "pink", "rose",
]);

function applyBracket(p: ParsedLocator, token: string): void {
  const tok = token.trim();
  if (!tok) return;
  if (/^\d+:[0-5]?\d$/.test(tok)) {
    const [m, s] = tok.split(":");
    p.durationSec = Number(m) * 60 + Number(s);
    return;
  }
  if (tok.startsWith(".")) {
    p.className = tok.slice(1);
    return;
  }
  const low = tok.toLowerCase();
  if (low === "nosong") {
    p.nosong = true;
    return;
  }
  if (COLORS.has(low)) {
    p.color = low;
    return;
  }
  // unknown bracket token: ignored
}

export function parseLocator(raw: string): ParsedLocator {
  const p: ParsedLocator = {
    raw,
    ignored: false,
    dotPrefix: false,
    medleyPrefix: false,
    medleyNext: false,
    marker: null,
    section: null,
    title: "",
    key: null,
    color: null,
    description: null,
    className: null,
    tags: [],
    durationSec: null,
    nosong: false,
    flags: [],
    transitionTarget: null,
  };

  let s = (raw ?? "").trim();

  if (s.startsWith("*")) {
    p.ignored = true;
    p.title = s.slice(1).trim();
    return p;
  }
  if (/^\.\s*\S/.test(s) && !s.startsWith("..")) {
    p.dotPrefix = true;
    s = s.slice(1).trim();
  } else if (/^[/-]\s*\S/.test(s) && !s.startsWith("//") && !s.startsWith("--")) {
    // `/` (or `-`) prefix: this song continues from the previous (medley). Strip it.
    p.medleyPrefix = true;
    s = s.replace(/^[/-]\s*/, "");
  }

  // transition  A >>> B
  const t = s.split(/\s*>>>\s*/);
  if (t.length >= 2) {
    s = (t[0] ?? "").trim();
    p.transitionTarget = t.slice(1).join(" >>> ").trim();
  }

  // section markers
  if (s.startsWith(">>")) {
    p.section = "quickSection";
    s = s.slice(2).trim();
  } else if (s.startsWith(">")) {
    p.section = "section";
    s = s.slice(1).trim();
  }

  // {description}
  s = s.replace(/\{([^}]*)\}/g, (_m, d: string) => {
    p.description = d.trim();
    return " ";
  });

  // [brackets]
  s = s.replace(/\[([^\]]*)\]/g, (_m, tok: string) => {
    applyBracket(p, tok);
    return " ";
  });

  // #tags
  s = s.replace(/(^|\s)#([^\s#]+)/g, (_m, _pre: string, tag: string) => {
    p.tags.push(tag);
    return " ";
  });

  // +FLAG or +FLAG:n
  s = s.replace(/(^|\s)\+([A-Za-z]+)(?::(\d+))?/g, (_m, _pre: string, name: string, num?: string) => {
    p.flags.push(num !== undefined ? { name: name.toUpperCase(), count: Number(num) } : { name: name.toUpperCase() });
    return " ";
  });

  // trailing `/` (or `-`) -> this song continues INTO the next (medley). Strip it from the title.
  const trimmed = s.replace(/\s+$/, "");
  if (/[/-]$/.test(trimmed) && trimmed.length > 1) {
    p.medleyNext = true;
    s = trimmed.slice(0, -1);
  }

  // trailing musical key in parens (kept by the Ableton marker, BEFORE any `/`): "(Am)",
  // "(F#m)", "(Em-Am)". Only note-based tokens are taken as a key, so "(Live)" etc. stay in
  // the title. The key is shown next to the title; AbleJam no longer needs it from the import.
  const km = s.match(/\(\s*([A-Ga-g][#b♯♭]?m?(?:\s*[-/]\s*[A-Ga-g][#b♯♭]?m?)*)\s*\)\s*$/);
  if (km) {
    p.key = (km[1] ?? "").replace(/\s+/g, "");
    s = s.slice(0, km.index);
  }

  const title = s.replace(/\s+/g, " ").trim();
  p.title = title;

  if (!p.section) {
    const upper = title.toUpperCase();
    if (upper === "SONG END" || upper === "SONGEND") p.marker = "songEnd";
    else if (upper === "STOP" || upper === "AUTOSTOP") p.marker = "stop";
  }

  return p;
}
