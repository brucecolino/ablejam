import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// All persisted user data lives under one root. In dev (run via tsx) this is the repo's
// .ablejam-data. When packaged inside Electron, import.meta.url points into the read-only
// app.asar, so the Electron main process sets ABLEJAM_DATA_DIR to a writable userData dir
// BEFORE this module is imported — every path below derives from it.
const ROOT = process.env.ABLEJAM_DATA_DIR ?? path.resolve(here, "../../../.ablejam-data");
const DIR = path.join(ROOT, "setlists");
const SESSION = path.join(ROOT, "session.json");
const RECENTS = path.join(ROOT, "recents.json");
const IMPORTS = path.join(ROOT, "imports");
const LYRICS = path.join(ROOT, "lyrics");
const STRUCTURE = path.join(ROOT, "structure");
const LYRICS_IMPORT = path.join(ROOT, "lyrics-import.txt");

function ensure(): void {
  mkdirSync(DIR, { recursive: true });
}

/** Auto-saved working setlist (order + medley links + keys + colours) + settings + the
 * current setlist's name. */
export function saveSession(sig: string, items: unknown, settings: unknown, auto = true, name = ""): void {
  ensure();
  writeFileSync(SESSION, JSON.stringify({ sig, items, settings, auto, name }), "utf8");
}
export function loadSession(): { sig: string; items: unknown[]; settings: unknown; auto: boolean; name: string } | null {
  if (!existsSync(SESSION)) return null;
  try {
    const d = JSON.parse(readFileSync(SESSION, "utf8")) as { sig?: string; items?: unknown; settings?: unknown; auto?: unknown; name?: unknown };
    return Array.isArray(d.items)
      ? { sig: String(d.sig ?? ""), items: d.items, settings: d.settings ?? null, auto: d.auto !== false, name: String(d.name ?? "") }
      : null;
  } catch {
    return null;
  }
}

/** Absolute path of a saved setlist's .json (for opening it in the OS default editor). */
export function setlistPath(name: string): string {
  return path.join(DIR, sanitize(name) + ".json");
}

// ---- original imported files (the .docx/.pdf/.txt the user imported from) ----
// We keep a copy so "edit" opens the REAL source (editable in Word) and it can be re-imported.
export function saveImportOriginal(name: string, filename: string, base64: string): void {
  mkdirSync(IMPORTS, { recursive: true });
  const base = sanitize(name);
  const ext = (filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]) || ".txt";
  for (const f of readdirSync(IMPORTS)) { // drop a previous original (maybe a different extension)
    if (f.slice(0, f.lastIndexOf(".") < 0 ? f.length : f.lastIndexOf(".")) === base) {
      try { unlinkSync(path.join(IMPORTS, f)); } catch { /* ignore */ }
    }
  }
  writeFileSync(path.join(IMPORTS, base + ext), Buffer.from(base64, "base64"));
}
/** The directory holding the stored original import files (for watching saves). */
export function importsDir(): string {
  return IMPORTS;
}
/** Path of the stored original for a setlist name, or null. */
export function importOriginalPath(name: string): string | null {
  if (!existsSync(IMPORTS)) return null;
  const base = sanitize(name);
  const f = readdirSync(IMPORTS).find((x) => !x.startsWith("~$") && x.slice(0, x.lastIndexOf(".") < 0 ? x.length : x.lastIndexOf(".")) === base);
  return f ? path.join(IMPORTS, f) : null;
}
/** Read a stored original back (filename + base64) for re-importing. */
export function readImportOriginal(name: string): { path: string; base64: string } | null {
  const p = importOriginalPath(name);
  return p ? { path: p, base64: readFileSync(p).toString("base64") } : null;
}
/** Subset of `names` that have a stored original (so the UI can offer edit / re-import). */
export function namesWithOriginal(names: string[]): string[] {
  if (!existsSync(IMPORTS)) return [];
  const bases = new Set(readdirSync(IMPORTS).filter((x) => !x.startsWith("~$")).map((x) => x.slice(0, x.lastIndexOf(".") < 0 ? x.length : x.lastIndexOf("."))));
  return names.filter((n) => bases.has(sanitize(n)));
}
/** Recently used setlists, most-recent first. */
export function loadRecents(): string[] {
  if (!existsSync(RECENTS)) return [];
  try {
    const d = JSON.parse(readFileSync(RECENTS, "utf8")) as unknown;
    return Array.isArray(d) ? (d as unknown[]).filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function saveRecents(names: string[]): void {
  ensure();
  writeFileSync(RECENTS, JSON.stringify(names), "utf8");
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, "_").trim().slice(0, 80) || "setlist";
}

export function listSetlists(): string[] {
  ensure();
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("~$")) // skip Word/Office lock files
    .map((f) => f.slice(0, -5))
    .sort();
}
/** Delete a saved setlist's .json plus its stored original (if any). */
export function deleteSetlist(name: string): void {
  const p = setlistPath(name);
  if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
  const orig = importOriginalPath(name);
  if (orig) try { unlinkSync(orig); } catch { /* ignore */ }
}
/** Delete ALL saved setlists + their stored originals. */
export function clearSetlists(): void {
  ensure();
  for (const f of readdirSync(DIR)) if (f.endsWith(".json")) { try { unlinkSync(path.join(DIR, f)); } catch { /* ignore */ } }
  if (existsSync(IMPORTS)) for (const f of readdirSync(IMPORTS)) { try { unlinkSync(path.join(IMPORTS, f)); } catch { /* ignore */ } }
}

// ---- lyrics document (AbleJam-authoritative text + timing), keyed by Ableton project name ----
export function saveLyricsDoc(project: string, lines: unknown): void {
  mkdirSync(LYRICS, { recursive: true });
  writeFileSync(path.join(LYRICS, sanitize(project || "default") + ".json"), JSON.stringify(lines), "utf8");
}
export function loadLyricsDoc(project: string): unknown[] | null {
  const p = path.join(LYRICS, sanitize(project || "default") + ".json");
  if (!existsSync(p)) return null;
  try { const d = JSON.parse(readFileSync(p, "utf8")) as unknown; return Array.isArray(d) ? d : null; } catch { return null; }
}
export function deleteLyricsDoc(project: string): void {
  const p = path.join(LYRICS, sanitize(project || "default") + ".json");
  if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
}
// ---- song-structure document (AbleJam-authoritative labels + timing), keyed by project name ----
export function saveStructureDoc(project: string, lines: unknown): void {
  mkdirSync(STRUCTURE, { recursive: true });
  writeFileSync(path.join(STRUCTURE, sanitize(project || "default") + ".json"), JSON.stringify(lines), "utf8");
}
export function loadStructureDoc(project: string): unknown[] | null {
  const p = path.join(STRUCTURE, sanitize(project || "default") + ".json");
  if (!existsSync(p)) return null;
  try { const d = JSON.parse(readFileSync(p, "utf8")) as unknown; return Array.isArray(d) ? d : null; } catch { return null; }
}
export function deleteStructureDoc(project: string): void {
  const p = path.join(STRUCTURE, sanitize(project || "default") + ".json");
  if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
}

/** A drop-in lyrics file (`#Song` headers + lines) that AbleJam watches and auto-imports. */
export function lyricsImportFile(): string {
  ensure();
  if (!existsSync(LYRICS_IMPORT)) writeFileSync(LYRICS_IMPORT, "", "utf8");
  return LYRICS_IMPORT;
}
export function readLyricsImport(): string {
  try { return existsSync(LYRICS_IMPORT) ? readFileSync(LYRICS_IMPORT, "utf8") : ""; } catch { return ""; }
}

export type SavedItem = { title: string; active: boolean; linkedNext: boolean; key: string; color?: string };

/** Save the FULL setlist (medley links + keys), so a reload keeps medleys. */
export function saveSetlist(name: string, items: SavedItem[]): void {
  ensure();
  writeFileSync(path.join(DIR, sanitize(name) + ".json"), JSON.stringify({ name, items }, null, 2), "utf8");
}

export function loadSetlist(name: string): SavedItem[] | null {
  ensure();
  const p = path.join(DIR, sanitize(name) + ".json");
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, "utf8")) as { items?: unknown; titles?: unknown };
    if (Array.isArray(d.items)) return d.items as SavedItem[];
    // Backward compat: the old format stored plain titles (no medley info).
    if (Array.isArray(d.titles)) return (d.titles as unknown[]).map((t) => ({ title: String(t), active: true, linkedNext: false, key: "" }));
    return null;
  } catch {
    return null;
  }
}
