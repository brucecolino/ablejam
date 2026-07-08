// In-app neural TTS via Piper (rhasspy/piper 2023.11.14-2, MIT). Generates the guide/structure
// announcements from text so the user doesn't need a folder of pre-recorded files.
//
// The engine binary + voice models are downloaded on first use into the writable data dir
// (ABLEJAM_DATA_DIR/piper) — no installer bloat and no per-OS CI step. The Piper archive is
// self-contained (bundles espeak-ng-data + onnxruntime), so once extracted it just runs.
// Output is 16 kHz mono 16-bit PCM WAV, loaded into Ableton exactly like the folder announcements.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, renameSync, readFileSync, writeFileSync } from "node:fs";
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
  // BOTH macOS archives ship an x86_64 Mach-O (the "aarch64" one is mislabeled — verified by header),
  // so always take the x64 build; on Apple Silicon it runs under Rosetta 2 (ensured after extract).
  if (process.platform === "darwin") return base + "piper_macos_x64.tar.gz";
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

/** Is Rosetta 2 able to run x86 code on this machine? (`arch -x86_64 true` succeeds only if so.) */
function rosettaOk(): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn("/usr/bin/arch", ["-x86_64", "/usr/bin/true"], { windowsHide: true });
    c.on("error", () => resolve(false));
    c.on("close", (code) => resolve(code === 0));
  });
}

/** Apple Silicon runs the x86_64 Piper binary through Rosetta 2 — install it if missing (best-effort;
 * needs network + admin the first time, so it may prompt or fail, in which case synthesis surfaces it). */
async function ensureRosetta(): Promise<void> {
  if (process.arch !== "arm64") return;
  if (await rosettaOk()) return;
  try { await run("/usr/sbin/softwareupdate", ["--install-rosetta", "--agree-to-license"]); } catch { /* surfaced on synth failure */ }
}

// Make the downloaded macOS Piper binary actually runnable. `tar` (unlike Finder) does NOT propagate
// the archive's quarantine to extracted files, and Piper's Mach-O carries a clang ad-hoc signature, so
// on an untouched binary this is mostly belt-and-suspenders. The real Apple-Silicon requirement is
// Rosetta 2 (the binary is x86_64). chmod does not invalidate signatures; codesign is best-effort
// (it's a no-op on Macs without the Xcode command-line tools, and unnecessary when the embedded
// signature is intact).
async function prepareMac(dir: string): Promise<void> {
  try { await run("xattr", ["-dr", "com.apple.quarantine", dir]); } catch { /* ignore */ }
  for (const exe of ["piper", "piper_phonemize", "espeak-ng"]) {
    try { await run("chmod", ["+x", path.join(dir, exe)]); } catch { /* ignore */ }
  }
  try {
    await run("/bin/sh", ["-c",
      'cd "$1" || exit 0; for f in piper piper_phonemize espeak-ng *.dylib; do [ -f "$f" ] && codesign --force --sign - "$f" 2>/dev/null; done; true',
      "ablejam", dir]);
  } catch { /* ignore */ }
  await ensureRosetta();
}

// Safety net: re-prepare once per host session before the first synthesis, so a Mac that was missing
// Rosetta at download time (engineReady stays true) gets it ensured before piper is spawned.
let macPrepared = false;
async function ensureMacReady(): Promise<void> {
  if (process.platform !== "darwin" || macPrepared || !engineReady()) return;
  macPrepared = true;
  await prepareMac(path.join(BIN_DIR, "piper"));
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
  if (process.platform === "darwin") await prepareMac(path.join(BIN_DIR, "piper"));
  else if (process.platform === "linux") { try { await run("chmod", ["+x", piperExe()]); } catch { /* ignore */ } }
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

export interface SynthOpts { voiceId: string; speed?: number; expr?: number; pitch?: number }

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

/** Pitch-shift a 16-bit mono PCM WAV by resampling its data by `factor` samples (keeps the declared
 * sample rate). Paired with a compensating length_scale at generation, this shifts pitch while
 * leaving duration ~unchanged — dependency-free, fine for short cue words. Rewrites the WAV in place. */
function pitchResampleWav(wavPath: string, factor: number): void {
  const b = readFileSync(wavPath);
  // Locate the fmt + data chunks (don't assume a fixed 44-byte header).
  let off = 12, dataOff = -1, dataLen = 0, sampleRate = 22050, channels = 1, bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") { channels = b.readUInt16LE(off + 10); sampleRate = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
    else if (id === "data") { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  if (dataOff < 0 || bits !== 16 || channels !== 1) return; // only the canonical piper output
  const n = Math.floor(dataLen / 2);
  const src = new Int16Array(b.buffer, b.byteOffset + dataOff, n);
  const outN = Math.max(1, Math.round(n * factor));
  const out = new Int16Array(outN);
  for (let i = 0; i < outN; i++) {
    const p = i / factor;             // input position for output sample i
    const i0 = Math.floor(p);
    const frac = p - i0;
    const s0 = src[i0] ?? 0;
    const s1 = src[Math.min(i0 + 1, n - 1)] ?? 0;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s0 + (s1 - s0) * frac)));
  }
  // Write a canonical 44-byte-header WAV.
  const body = Buffer.from(out.buffer, out.byteOffset, outN * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + body.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(body.length, 40);
  writeFileSync(wavPath, Buffer.concat([h, body]));
}

/** Append trailing silence so the WAV lasts at least `targetSec`. Used to make each guide
 * announcement long enough to fill its section (the bridge then trims the clip to the exact gap),
 * so the SPEECH clips abut like the STRUCTURE clips instead of being tiny. Any sample rate / mono 16-bit. */
export function padWavToSeconds(wavPath: string, targetSec: number): void {
  try {
    const b = readFileSync(wavPath);
    let off = 12, dataOff = -1, dataLen = 0, sampleRate = 22050, channels = 1, bits = 16;
    while (off + 8 <= b.length) {
      const id = b.toString("ascii", off, off + 4);
      const sz = b.readUInt32LE(off + 4);
      if (id === "fmt ") { channels = b.readUInt16LE(off + 10); sampleRate = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
      else if (id === "data") { dataOff = off + 8; dataLen = sz; break; }
      off += 8 + sz + (sz & 1);
    }
    if (dataOff < 0 || bits !== 16 || channels !== 1) return;
    const curSec = dataLen / 2 / sampleRate;
    if (targetSec <= curSec + 0.01) return;
    const padSamples = Math.round((targetSec - curSec) * sampleRate);
    const audio = b.subarray(dataOff, dataOff + dataLen);
    const silence = Buffer.alloc(padSamples * 2); // zeroed 16-bit samples
    const body = Buffer.concat([audio, silence]);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + body.length, 4); h.write("WAVE", 8);
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(body.length, 40);
    writeFileSync(wavPath, Buffer.concat([h, body]));
  } catch { /* leave the WAV as-is on any parse failure */ }
}

/** Synthesize `text` to a WAV at `outPath`. `speed` (0.5..2.0, 1 = normal) maps to Piper's
 * length_scale (inverse); `expr` (0..1.5, ~0.667 default) maps to noise_scale; `pitch` (semitones,
 * −12..12) is applied by a host-side varispeed resample. */
export async function synthesize(text: string, opts: SynthOpts, outPath: string): Promise<boolean> {
  const v = voiceById(opts.voiceId);
  if (!v || !engineReady()) return false;
  await ensureMacReady(); // macOS: unquarantine + ensure Rosetta 2 (x86_64 binary) before spawning
  const model = voiceModelPath(v.id);
  if (!existsSync(model)) return false;
  const semis = clamp(opts.pitch ?? 0, -12, 12);
  const ratio = Math.pow(2, semis / 12);                 // >1 = pitch up
  const baseLen = 1 / (opts.speed && opts.speed > 0 ? opts.speed : 1);
  // Generate `ratio`x longer so that decimating by `ratio` (pitch shift) restores the intended duration.
  const lengthScale = clamp(baseLen * ratio, 0.3, 4);
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
    // Success = clean exit 0. A signal (code null + signal, e.g. Apple-Silicon SIGKILL on a binary
    // that can't run without Rosetta) must count as failure, not success.
    c.on("close", (code, signal) => resolve(code === 0 && !signal));
    try { c.stdin.write(text.replace(/\r?\n/g, " ").trim() + "\n"); c.stdin.end(); } catch { resolve(false); }
  });
  if (!ok || !existsSync(outPath)) return false;
  if (Math.abs(semis) >= 0.5) { try { pitchResampleWav(outPath, 1 / ratio); } catch { /* keep unshifted on failure */ } }
  return true;
}

/** Can the Piper binary actually execute here? Detects an OS that kills it at exec (e.g. Apple
 * Silicon with no Rosetta 2, or a bad signature) — a clean diagnostic vs. a silent synth failure. */
export async function engineCanRun(): Promise<boolean> {
  if (!engineReady()) return false;
  await ensureMacReady();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const c = spawn(piperExe(), ["--help"], { windowsHide: true });
    c.on("error", () => finish(false));
    c.on("close", (_code, signal) => finish(!signal)); // any exit WITHOUT a kill-signal = it can execute
    try { c.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { try { c.kill(); } catch { /* ignore */ } finish(true); }, 4000); // still running → it ran
  });
}

/** Slice [startSec, endSec] out of a WAV and write a new 16 kHz mono 16-bit PCM WAV — exactly the
 * format Azure Speech-to-Text short-audio wants. Dependency-free (same chunk-walker idiom as
 * padWavToSeconds), handling arbitrary rate/channels, 16/24/32-bit int and 32/64-bit float PCM
 * (incl. WAVE_FORMAT_EXTENSIBLE), multiple pre-data chunks, odd-chunk padding. endSec may be
 * Infinity to take from startSec to end of file. Returns false on any parse failure/empty window. */
export function sliceWavToMono16k(srcPath: string, startSec: number, endSec: number, outPath: string): boolean {
  try {
    const b = readFileSync(srcPath);
    if (b.length < 12 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return false;
    let off = 12, dataOff = -1, dataLen = 0;
    let fmtTag = 1, channels = 1, sampleRate = 44100, bits = 16;
    while (off + 8 <= b.length) {
      const id = b.toString("ascii", off, off + 4);
      const sz = b.readUInt32LE(off + 4);
      if (id === "fmt ") {
        fmtTag = b.readUInt16LE(off + 8);
        channels = b.readUInt16LE(off + 10);
        sampleRate = b.readUInt32LE(off + 12);
        bits = b.readUInt16LE(off + 22);
        if (fmtTag === 0xfffe && sz >= 40) fmtTag = b.readUInt16LE(off + 8 + 16 + 8); // EXTENSIBLE: real tag in sub-format GUID
      } else if (id === "data") {
        dataOff = off + 8;
        dataLen = Math.min(sz, b.length - dataOff); // clamp to what's really present (truncated/streamed files)
        break;
      }
      off += 8 + sz + (sz & 1);
    }
    if (dataOff < 0 || channels < 1) return false;
    const bytesPerSample = bits >> 3;
    const frameBytes = bytesPerSample * channels;
    if (frameBytes <= 0) return false;
    const totalFrames = Math.floor(dataLen / frameBytes);
    const srcDurSec = totalFrames / sampleRate;
    const isFloat = fmtTag === 3;
    const readSample = (frame: number, ch: number): number => {
      const p = dataOff + frame * frameBytes + ch * bytesPerSample;
      if (isFloat && bits === 32) return b.readFloatLE(p);
      if (isFloat && bits === 64) return b.readDoubleLE(p);
      if (bits === 16) return b.readInt16LE(p) / 32768;
      if (bits === 24) { let v = b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16); if (v & 0x800000) v -= 0x1000000; return v / 8388608; }
      if (bits === 32) return b.readInt32LE(p) / 2147483648;
      if (bits === 8) return (b[p]! - 128) / 128;
      return 0;
    };
    const s0 = Math.max(0, Math.min(startSec, srcDurSec));
    const s1 = Math.max(s0, Math.min(endSec, srcDurSec));
    const startFrame = Math.floor(s0 * sampleRate);
    const endFrame = Math.min(totalFrames, Math.ceil(s1 * sampleRate));
    const winFrames = Math.max(0, endFrame - startFrame);
    if (winFrames === 0) return false;
    const winSec = winFrames / sampleRate;
    const OUT_RATE = 16000;
    const outFrames = Math.max(1, Math.round(winSec * OUT_RATE));
    const out = new Int16Array(outFrames);
    const mono = (frame: number): number => {
      let acc = 0;
      for (let ch = 0; ch < channels; ch++) acc += readSample(frame, ch);
      return acc / channels; // average → downmix (avoids the clipping of summing)
    };
    for (let i = 0; i < outFrames; i++) {
      const srcPos = (i / OUT_RATE) * sampleRate; // window-relative fractional source frame
      const i0 = Math.floor(srcPos);
      const frac = srcPos - i0;
      const f0 = startFrame + i0;
      const f1 = Math.min(endFrame - 1, f0 + 1);
      const v = mono(f0) + (mono(f1) - mono(f0)) * frac;
      out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    const body = Buffer.from(out.buffer, out.byteOffset, outFrames * 2);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + body.length, 4); h.write("WAVE", 8);
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); // PCM, mono
    h.writeUInt32LE(OUT_RATE, 24); h.writeUInt32LE(OUT_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(body.length, 40);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.concat([h, body]));
    return true;
  } catch {
    return false;
  }
}
