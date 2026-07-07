// In-app neural TTS via Piper (rhasspy/piper 2023.11.14-2, MIT). Generates the guide/structure
// announcements from text so the user doesn't need a folder of pre-recorded files.
//
// The engine binary + voice models are downloaded on first use into the writable data dir
// (ABLEJAM_DATA_DIR/piper) — no installer bloat and no per-OS CI step. The Piper archive is
// self-contained (bundles espeak-ng-data + onnxruntime), so once extracted it just runs.
// Output is 16 kHz mono 16-bit PCM WAV, loaded into Ableton exactly like the folder announcements.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, renameSync } from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import type { Lang } from "@ablejam/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.ABLEJAM_DATA_DIR ?? path.resolve(here, "../../../.ablejam-data");
const PIPER_ROOT = path.join(DATA_ROOT, "piper");
const BIN_DIR = path.join(PIPER_ROOT, "bin");     // the engine archive extracts a "piper/" folder here
const VOICES_DIR = path.join(PIPER_ROOT, "voices");
const UA = "AbleJam-TTS";

// ---- engine (Piper binary) ------------------------------------------------

const PIPER_RELEASE = "2023.11.14-2";

function piperArchiveUrl(): string | null {
  const base = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/`;
  if (process.platform === "win32") return base + "piper_windows_amd64.zip";
  if (process.platform === "darwin") return base + (process.arch === "arm64" ? "piper_macos_aarch64.tar.gz" : "piper_macos_x64.tar.gz");
  if (process.platform === "linux") return base + (process.arch === "arm64" ? "piper_linux_aarch64.tar.gz" : "piper_linux_x86_64.tar.gz");
  return null;
}

export function piperExe(): string {
  // Bundled override wins (ABLEJAM_PIPER_DIR points at a folder holding piper[.exe]); else the
  // copy we downloaded (the archive extracts to a "piper/" subdir).
  const name = process.platform === "win32" ? "piper.exe" : "piper";
  const bundled = process.env.ABLEJAM_PIPER_DIR;
  if (bundled && existsSync(path.join(bundled, name))) return path.join(bundled, name);
  return path.join(BIN_DIR, "piper", name);
}

export function engineReady(): boolean {
  return existsSync(piperExe());
}

/** Where generated WAVs live (guide clips + the preview sample). */
export function ttsCacheDir(): string {
  return path.join(PIPER_ROOT, "cache");
}

// ---- voice catalog (rhasspy/piper-voices on Hugging Face) ------------------

export interface Voice {
  id: string;          // e.g. "it_IT-paola-medium"
  lang: Lang;
  gender: "M" | "F";
  label: string;       // human name shown in the UI
  onnxUrl: string;
  jsonUrl: string;
}

function hfVoiceUrls(key: string): { onnxUrl: string; jsonUrl: string } {
  // key = "<locale>-<name>-<quality>" → path "<lang>/<locale>/<name>/<quality>/<key>"
  const [locale, name, quality] = key.split("-");
  const lang2 = (locale ?? "").split("_")[0];
  const rel = `${lang2}/${locale}/${name}/${quality}/${key}`;
  const base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
  return { onnxUrl: `${base}${rel}.onnx`, jsonUrl: `${base}${rel}.onnx.json` };
}

function mkVoice(id: string, lang: Lang, gender: "M" | "F", label: string): Voice {
  return { id, lang, gender, label, ...hfVoiceUrls(id) };
}

// Curated: one male + one female per supported language (medium quality where available).
export const VOICE_CATALOG: Voice[] = [
  mkVoice("it_IT-paola-medium", "it", "F", "Paola"),
  mkVoice("it_IT-riccardo-x_low", "it", "M", "Riccardo"),
  mkVoice("en_US-amy-medium", "en", "F", "Amy"),
  mkVoice("en_US-ryan-medium", "en", "M", "Ryan"),
  mkVoice("es_ES-davefx-medium", "es", "M", "Dave"),
  mkVoice("es_AR-daniela-high", "es", "F", "Daniela"),
  mkVoice("fr_FR-siwis-medium", "fr", "F", "Siwis"),
  mkVoice("fr_FR-tom-medium", "fr", "M", "Tom"),
];

export function voiceById(id: string): Voice | undefined {
  return VOICE_CATALOG.find((v) => v.id === id);
}

export function installedVoices(): string[] {
  // A voice is usable once both its model and config are present.
  return VOICE_CATALOG.filter((v) => existsSync(voiceModelPath(v.id)) && existsSync(voiceModelPath(v.id) + ".json")).map((v) => v.id);
}

function voiceModelPath(id: string): string {
  return path.join(VOICES_DIR, `${id}.onnx`);
}

// ---- downloads (https with redirects + progress; mirrors update.ts) --------

export interface DlProgress { pct: number; mb: number; total: number }

function download(url: string, dest: string, onProgress?: (p: DlProgress) => void, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error("too many redirects")); return; }
    https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // Resolve relative redirects (Hugging Face 302s to a relative /api/resolve-cache/… path).
        const next = new URL(res.headers.location, url).toString();
        resolve(download(next, dest, onProgress, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const total = parseInt(String(res.headers["content-length"] || "0"), 10);
      let got = 0;
      let lastPct = -1;
      res.on("data", (chunk: Buffer) => {
        got += chunk.length;
        if (onProgress && total > 0) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct) { lastPct = pct; onProgress({ pct, mb: Math.round(got / 1e6), total: Math.round(total / 1e6) }); }
        }
      });
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => {
        if (total > 0 && got !== total) { try { rmSync(dest); } catch { /* ignore */ } reject(new Error("incomplete download")); return; }
        resolve();
      }));
      file.on("error", reject);
    }).on("error", reject);
  });
}

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { windowsHide: true });
    c.on("error", reject);
    c.on("close", (code) => resolve(code ?? 0));
  });
}

function extract(archive: string, destDir: string): Promise<number> {
  // Windows .zip → PowerShell Expand-Archive; macOS/Linux .tar.gz → tar.
  if (process.platform === "win32") {
    return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}' -Force`]);
  }
  return run("tar", ["-xzf", archive, "-C", destDir]);
}

// ---- public API -----------------------------------------------------------

/** Ensure the Piper engine is present (download + extract on first use). */
export async function ensureEngine(onProgress?: (p: DlProgress) => void): Promise<boolean> {
  if (engineReady()) return true;
  const url = piperArchiveUrl();
  if (!url) return false;
  mkdirSync(BIN_DIR, { recursive: true });
  const archive = path.join(BIN_DIR, path.basename(url));
  await download(url, archive, onProgress);
  await extract(archive, BIN_DIR);
  try { rmSync(archive); } catch { /* ignore */ }
  if (process.platform !== "win32") {
    // Downloaded macOS binaries are quarantined by Gatekeeper; strip it and ensure +x.
    try { await run("xattr", ["-dr", "com.apple.quarantine", path.join(BIN_DIR, "piper")]); } catch { /* ignore */ }
    try { await run("chmod", ["+x", piperExe()]); } catch { /* ignore */ }
  }
  return engineReady();
}

/** Ensure a voice model is downloaded. Returns true when both .onnx and .onnx.json are present. */
export async function ensureVoice(id: string, onProgress?: (p: DlProgress) => void): Promise<boolean> {
  const v = voiceById(id);
  if (!v) return false;
  mkdirSync(VOICES_DIR, { recursive: true });
  const onnx = voiceModelPath(id);
  const json = onnx + ".json";
  if (!existsSync(json)) {
    const tmp = json + ".tmp";
    await download(v.jsonUrl, tmp);
    renameSync(tmp, json);
  }
  if (!existsSync(onnx) || statSync(onnx).size < 1_000_000) {
    const tmp = onnx + ".tmp";
    await download(v.onnxUrl, tmp, onProgress);
    renameSync(tmp, onnx);
  }
  return existsSync(onnx) && existsSync(json);
}

export interface SynthOpts { voiceId: string; speed?: number; expr?: number }

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

/** Synthesize `text` to a WAV at `outPath`. `speed` (0.5..2.0, 1 = normal) maps to Piper's
 * length_scale (inverse); `expr` (0..1.5, ~0.667 default) maps to noise_scale. */
export async function synthesize(text: string, opts: SynthOpts, outPath: string): Promise<boolean> {
  const v = voiceById(opts.voiceId);
  if (!v || !engineReady()) return false;
  const model = voiceModelPath(v.id);
  if (!existsSync(model)) return false;
  const lengthScale = clamp(1 / (opts.speed && opts.speed > 0 ? opts.speed : 1), 0.3, 3);
  const noise = clamp(opts.expr ?? 0.667, 0, 1.5);
  mkdirSync(path.dirname(outPath), { recursive: true });
  const ok = await new Promise<boolean>((resolve) => {
    const c = spawn(piperExe(), [
      "--model", model,
      "--length_scale", String(lengthScale),
      "--noise_scale", String(noise),
      "--output_file", outPath,
    ], { windowsHide: true });
    c.on("error", () => resolve(false));
    c.on("close", (code) => resolve(code === 0 || code === null));
    try { c.stdin.write(text.replace(/\r?\n/g, " ").trim() + "\n"); c.stdin.end(); } catch { resolve(false); }
  });
  return ok && existsSync(outPath);
}
