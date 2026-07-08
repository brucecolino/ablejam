// Audio-guide speech files: the announcements ("RITORNELLO!", "STROFA!") laid on the guide track
// at every structure change. Source = the folder the user configured (Settings.guideAudioFolder) or
// the bundled defaults (resources/speech/<lang>, Italian for now — ABLEJAM_SPEECH_DIR when packaged).
// For Live's browser to load them they must live in Ableton's USER LIBRARY, so on export the matched
// files are copied into "<User Library>/AbleJam Speech/" (OneDrive-aware, same probing as install.ps1).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const AUDIO_EXT = new Set([".aif", ".aiff", ".wav", ".mp3", ".flac", ".m4a", ".ogg"]);
/** Connector words dropped when matching a label to a file name ("SOLO DI CHITARRA" ↔ "solo chitarra"). */
const FILLER = new Set(["di", "de", "del", "della", "the", "of"]);

/** Bundled default speech folder for a language ("" when missing). */
export function defaultSpeechDir(lang = "it"): string {
  const root = process.env.ABLEJAM_SPEECH_DIR ?? path.resolve(here, "../../../resources/speech");
  const dir = path.join(root, lang);
  return existsSync(dir) ? dir : "";
}

/** Audio files in a folder (non-recursive). [] when the folder is missing/unreadable. */
export function listSpeechFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Label/file-name → meaningful lowercase tokens (extension, accents, dashes and fillers dropped). */
function tokens(s: string): string[] {
  return s
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !FILLER.has(t));
}

/** Best speech file for a label. Exact token-set match wins ("solo chitarra" = "SOLO DI CHITARRA");
 * fallback: the file whose tokens are a superset with the FEWEST extras (so "intro" never grabs
 * "RE-INTRO" while "INTRO" exists). null when nothing plausible matches. */
export function matchSpeechFile(label: string, files: string[]): string | null {
  const want = tokens(label);
  if (!want.length) return null;
  const wantSet = new Set(want);
  let best: string | null = null;
  let bestExtras = Infinity;
  for (const f of files) {
    const have = new Set(tokens(f));
    if (![...wantSet].every((t) => have.has(t))) continue; // must contain every label token
    const extras = have.size - wantSet.size;
    if (extras === 0) return f; // exact set match — done
    if (extras < bestExtras) { bestExtras = extras; best = f; }
  }
  return best;
}

/** Every Ableton User Library present on this machine (OneDrive-redirected Documents included). */
export function userLibraryDirs(): string[] {
  const bases: string[] = [];
  const home = os.homedir();
  if (process.platform === "darwin") {
    bases.push(path.join(home, "Music", "Ableton"));
  } else {
    const oneDrive = process.env.OneDrive;
    if (oneDrive) {
      bases.push(path.join(oneDrive, "Documenti", "Ableton"));
      bases.push(path.join(oneDrive, "Documents", "Ableton"));
    }
    bases.push(path.join(home, "Documents", "Ableton"));
    bases.push(path.join(home, "OneDrive", "Documenti", "Ableton"));
    bases.push(path.join(home, "OneDrive", "Documents", "Ableton"));
  }
  const found: string[] = [];
  for (const b of bases) {
    const ul = path.join(b, "User Library");
    if (existsSync(ul) && !found.includes(ul)) found.push(ul);
  }
  return found;
}

/** Absolute path of an installed speech file, from the FIRST User Library that actually has it
 * ("" if none). The bridge's ClipSlot.create_audio_clip references this path directly, so it must
 * be a real file on disk — prefer the (permanent, app-managed) User Library copy. */
export function speechFilePath(basename: string): string {
  for (const ul of userLibraryDirs()) {
    const p = path.join(ul, "AbleJam Speech", basename);
    if (existsSync(p)) return p;
  }
  return "";
}

/** Copy the given speech files into "<User Library>/AbleJam Speech/" of EVERY User Library found
 * (skip up-to-date copies). Returns the number of libraries written to (0 = none found). */
export function installSpeechFiles(paths: string[]): number {
  const libs = userLibraryDirs();
  for (const ul of libs) {
    const dest = path.join(ul, "AbleJam Speech");
    try {
      mkdirSync(dest, { recursive: true });
      for (const p of paths) {
        const target = path.join(dest, path.basename(p));
        try {
          if (existsSync(target) && statSync(target).size === statSync(p).size) continue; // up to date
          copyFileSync(p, target);
        } catch { /* skip unreadable file */ }
      }
    } catch { /* skip unwritable library */ }
  }
  return libs.length;
}
