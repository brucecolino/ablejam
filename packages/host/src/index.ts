import os from "node:os";
import { pathToFileURL } from "node:url";
import { BridgeLink } from "./bridge";
import { Server, type ClientMeta } from "./server";
import { SetlistManager } from "./setlist";
import { listSetlists, saveSetlist, loadSetlist, saveSession, loadSession, loadRecents, saveRecents, setlistPath, saveImportOriginal, importOriginalPath, readImportOriginal, namesWithOriginal, importsDir, deleteSetlist, clearSetlists, saveLyricsDoc, loadLyricsDoc, deleteLyricsDoc, saveStructureDoc, loadStructureDoc, deleteStructureDoc, lyricsImportFile, readLyricsImport, type SavedItem } from "./persist";
import { watch, type FSWatcher } from "node:fs";
import { exec as execChild } from "node:child_process";
import { extractText, textToTitles } from "./import";
import { listOutputs, sendNote as sendMidiNote, isAvailable as midiAvailable, closeOutput } from "./midiout";
import { verifyLicenseKey, isActivatedHere } from "./license";
import { deviceId, deviceName } from "./deviceid";
import { listBluetooth, openBluetoothSettings } from "./bluetooth";
import { hasAudioInterface } from "./audio";
import { defaultSpeechDir, listSpeechFiles, matchSpeechFile, installSpeechFiles, speechFilePath } from "./speech";
import { VOICE_CATALOG, voiceById, installedVoices, engineReady, engineCanRun, ensureEngine, ensureVoice, synthesize, padWavToSeconds, sliceWavToMono16k, ttsCacheDir, type DlProgress } from "./tts";
import { azureRecognize } from "./azurestt";
import { fetchAzureVoices, azureSynthesize, type AzureVoice } from "./azuretts";
import nodePath from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readAbleton } from "./ableton";
import {
  ADDR,
  PORTS,
  LICENSING_ENABLED,
  bestMatch,
  buildSetlist,
  locateCurrent,
  schemeHex,
  translate,
  defaultSettings,
  DEFAULT_STRUCTURE_LABELS,
  initialTransport,
  type AppState,
  type ClientCommand,
  type LyricLine,
  type PluginRule,
  type RawCue,
  type Settings,
  type TrackDevices,
  type Transport,
} from "@ablejam/shared";

const bridge = new BridgeLink();
const mgr = new SetlistManager();
const transport: Transport = { ...initialTransport };
const settings: Settings = { ...defaultSettings };
// Restore persisted settings (emergency, automation, toggles, shortcuts, pedals) across
// restarts AND updates. Deep-merge so nested maps (shortcuts/pedals) keep any NEW default
// keys a newer build adds while still honouring every value the user saved.
const restoredSession = loadSession();
if (restoredSession?.settings && typeof restoredSession.settings === "object") {
  const saved = restoredSession.settings as Record<string, unknown>;
  const target = settings as unknown as Record<string, unknown>;
  for (const k of Object.keys(saved)) {
    const sv = saved[k];
    const bv = target[k];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      Object.assign(bv as object, sv); // merge shortcuts/pedals onto the defaults
    } else if (sv !== undefined) {
      target[k] = sv;
    }
  }
}
// The persisted working setlist (order + medleys + keys + COLOURS). It is re-mapped onto the
// library the first time the bridge sends the project's markers (see buildLibrary), then cleared.
let pendingRestoreItems: SavedItem[] | null =
  Array.isArray(restoredSession?.items) && restoredSession.items.length > 0
    ? (restoredSession.items as SavedItem[])
    : null;
const pendingRestoreAuto = restoredSession?.auto ?? true;
let currentSetlistName = restoredSession?.name ?? ""; // loaded/saved/imported setlist name
/** Open a file in the OS default program (e.g. a .docx opens in Word). */
function openInDefaultApp(file: string): void {
  const p = os.platform();
  if (p === "win32") execChild(`cmd /c start "" "${file}"`, { windowsHide: true }, () => {});
  else if (p === "darwin") execChild(`open "${file}"`, () => {});
  else execChild(`xdg-open "${file}"`, () => {});
}
/** Show the MODERN Windows "Open with" chooser (app list + "Always use this app") so the user
 * picks the program. Uses OpenWith.exe — the native picker — because the old rundll32
 * OpenAs_RunDLL shows a broken/empty legacy popup on Windows 10/11. macOS has no chooser CLI
 * → reveal in Finder so the user can right-click → Open With. */
function openWithPicker(file: string): void {
  const p = os.platform();
  if (p === "win32") execChild(`OpenWith.exe "${file}"`, { windowsHide: true }, () => {});
  else if (p === "darwin") execChild(`open -R "${file}"`, () => {});
  else execChild(`xdg-open "${file}"`, () => {});
}

// Re-import a setlist from its stored original (.docx/.pdf/.txt). `auto` = triggered by a file
// save (quieter on failure, friendlier toast on success).
function doReimport(name: string, auto = false): void {
  const orig = readImportOriginal(name);
  if (!orig) { if (!auto) toast("error", tr("host.reimport.none")); return; }
  extractText(orig.path, orig.base64)
    .then((text) => {
      const r = mgr.applyTitles(textToTitles(text), !settings.splitMedleysOnImport);
      if (r.matched) { if (settings.colorOnImport) mgr.autoColor(settings.setlistColorScheme || "rainbow"); rememberImport(name); }
      if (r.matched || !auto) {
        toast(r.matched ? "info" : "error", auto ? tr("host.reimport.auto", { matched: r.matched, total: r.total }) : tr("host.import.file", { file: name, matched: r.matched, total: r.total }));
      }
      changed();
      server.broadcastMessage({ type: "importResult", result: r });
    })
    .catch((e: Error) => { if (!auto) toast("error", tr("host.import.failed", { msg: e.message })); });
}

// After the user opens an original to edit it, watch the imports folder and AUTO re-import that
// setlist whenever the file is saved (Word writes via a temp+rename, so we watch the dir and
// debounce). Only one file is watched at a time — the last one opened for editing.
let editWatch: { watcher: FSWatcher; clearTimer: () => void } | null = null;
function stopEditWatch(): void {
  if (!editWatch) return;
  try { editWatch.watcher.close(); } catch { /* ignore */ }
  editWatch.clearTimer();
  editWatch = null;
}
function watchOriginalForReimport(name: string, origPath: string): void {
  stopEditWatch();
  const target = origPath.split(/[\\/]/).pop() ?? "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher;
  try {
    watcher = watch(importsDir(), (_event, fname) => {
      if (fname !== target) return; // ignore Word's lock/temp files — only the real original
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => doReimport(name, true), 1200); // let the multi-step save settle
    });
  } catch { return; }
  editWatch = { watcher, clearTimer: () => { if (timer) clearTimeout(timer); } };
}
/** First non-internal IPv4 — the address a tablet on the same WiFi uses to reach us. */
function detectLanIp(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return "";
}
const lanIp = detectLanIp();
let bridgeConnected = false;
let startupClickDone = false; // one-shot guard for "click on at AbleJam startup"
let stageMessage = ""; // operator cue shown on STAGE views
let bridgeVersion = 0;
let tracks: string[] = [];
let midiTracks: string[] = [];
let midiOutPorts: string[] = listOutputs();
let savedSetlists = listSetlists();
let recentSetlists = loadRecents();
function bumpRecent(name: string): void {
  recentSetlists = [name, ...recentSetlists.filter((n) => n !== name)].slice(0, 8);
  saveRecents(recentSetlists);
}
/** Auto-save an imported setlist (so it's reloadable from Recenti / Apri), keyed by the
 * file name (or "Importata" for pasted text). Preserves medley links via serialize(). */
function rememberImport(rawName = ""): void {
  const name = rawName.replace(/\.[^.]+$/, "").trim() || tr("host.import.defaultName");
  saveSetlist(name, mgr.serialize());
  savedSetlists = listSetlists();
  bumpRecent(name);
  currentSetlistName = name;
}

let rawCues: RawCue[] = [];
let stopPoints: number[] = []; // arrangement beats of MIDI "stop" notes (project-based)
let lyricsFromClips: LyricLine[] = []; // lyrics lines read from the lyrics track's clips
let lyricsDoc: LyricLine[] | null = null; // AbleJam-edited lyrics doc (authoritative when present)
const effectiveLyrics = (): LyricLine[] => lyricsDoc ?? lyricsFromClips;
let structureFromClips: LyricLine[] = []; // section changes read from the STRUCTURE track's clips
let structureDoc: LyricLine[] | null = null; // AbleJam-edited structure doc (authoritative when present)
const effectiveStructure = (): LyricLine[] => structureDoc ?? structureFromClips;

let guideAudio: { file: string; label: string }[] = []; // announcement files + matched labels (cached)
let ttsBusy: AppState["ttsBusy"] = null; // in-progress TTS download/preview/generate (for the UI progress bar)
let azureVoiceCache: AzureVoice[] = []; // Azure premium voices for the current key+region (with locale)
/** Active speech folder: the user's custom one (when set and existing), else the bundled defaults. */
function speechDir(): string {
  const custom = (settings.guideAudioFolder || "").trim();
  if (custom && existsSync(custom)) return custom;
  return defaultSpeechDir("it");
}
/** Re-scan the speech folder and match each file to a section label (exact-first). Broadcast on change. */
function refreshGuideAudio(): void {
  const dir = speechDir();
  const files = dir ? listSpeechFiles(dir) : [];
  const byFile = new Map<string, string>();
  // Match against the user's labels PLUS the defaults, so bundled files show their label even on
  // settings persisted before the default list grew.
  const labels = Array.from(new Set([...(settings.structureLabels ?? []), ...DEFAULT_STRUCTURE_LABELS]));
  for (const l of labels) {
    const f = matchSpeechFile(l, files);
    if (f && !byFile.has(f)) byFile.set(f, l);
  }
  const next = files.map((f) => ({ file: f, label: byFile.get(f) ?? "" }));
  const changedList = next.length !== guideAudio.length || next.some((x, i) => x.file !== guideAudio[i]?.file || x.label !== guideAudio[i]?.label);
  guideAudio = next;
  if (changedList) broadcastState();
}
/** Filesystem-safe base name for a generated announcement (matches the palette `item`). */
function ttsFileBase(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "cue";
}

/** The beat where the SONG containing `beat` ends (next song's start, or its own end). */
function songEndAt(beat: number): number {
  const songs = mgr.library;
  for (let i = songs.length - 1; i >= 0; i--) {
    if (songs[i]!.startBeat - 1e-6 <= beat) {
      const next = songs[i + 1];
      return next ? next.startBeat : (songs[i]!.endBeat ?? Infinity);
    }
  }
  return Infinity;
}

/** Annotate each structure/guide item with the beat its clip should END at: the next item's start,
 * but NEVER past the end of the song it belongs to — so a song's last label doesn't bleed across the
 * following songs that have no labels of their own. */
function withClipEnds(items: { s: number; t: string }[]): { s: number; t: string; e: number }[] {
  const ordered = [...items].sort((a, b) => a.s - b.s);
  return ordered.map((it, i) => {
    const nextStart = i + 1 < ordered.length ? ordered[i + 1]!.s : Infinity;
    let e = Math.min(nextStart, songEndAt(it.s));
    if (!isFinite(e) || e <= it.s + 1e-6) e = it.s + 4; // fallback for the very last clip / no song bound
    return { s: it.s, t: it.t, e };
  });
}

/** Export the audio guide. In "folder" mode: match the doc's labels to pre-recorded speech files.
 * In "tts" mode: generate each announcement from its label text with the neural voice. Either way
 * the files are copied into Ableton's User Library and the bridge lays the palette + clips. */
function writeGuideClips(items: { s: number; t: string; e?: number }[]): void {
  if (settings.guideMode === "tts") { void writeGuideClipsTts(items); return; }
  const dir = speechDir();
  const files = dir ? listSpeechFiles(dir) : [];
  if (!files.length) { toast("error", tr("host.guide.nofiles")); return; }
  const labels = Array.from(new Set(items.map((i) => i.t.trim()).filter(Boolean)));
  const palette: { label: string; item: string }[] = [];
  const paths: string[] = [];
  for (const l of labels) {
    const f = matchSpeechFile(l, files);
    if (!f) continue;
    palette.push({ label: l, item: f.replace(/\.[a-z0-9]+$/i, "") });
    paths.push(nodePath.join(dir, f));
  }
  if (!palette.length) { toast("error", tr("host.guide.nomatch")); return; }
  if (installSpeechFiles(paths) === 0) { toast("error", tr("host.guide.nolib")); return; }
  // Send the absolute WAV path per entry so the bridge creates the clip via create_audio_clip
  // (reads the file directly — no browser). Fall back to the source path if the UL copy isn't found.
  const withPaths = palette.map((p, i) => ({ ...p, path: speechFilePath(nodePath.basename(paths[i]!)) || paths[i]! }));
  bridge.send(ADDR.cmdWriteGuide, [JSON.stringify({ track: settings.guideTrack, items, palette: withPaths })]);
}

/** Synthesise one label with whichever TTS engine is selected (Piper offline or Azure premium). */
async function synthLabel(text: string, wav: string): Promise<boolean> {
  if (settings.ttsEngine === "azure") {
    const av = azureVoiceCache.find((v) => v.id === settings.azureVoice);
    if (!av) return false;
    return azureSynthesize(settings.azureKey, settings.azureRegion, av.id, av.locale, text, { rate: settings.ttsSpeed, pitch: settings.ttsPitch }, wav);
  }
  return synthesize(text, { voiceId: settings.ttsVoice, speed: settings.ttsSpeed, expr: settings.ttsExpr, pitch: settings.ttsPitch }, wav);
}

/** TTS mode: synthesise one WAV per unique label with the selected engine, install them into the
 * User Library, then hand the palette to the bridge (same clip-laying path as folder mode). */
async function writeGuideClipsTts(items: { s: number; t: string; e?: number }[]): Promise<void> {
  const azure = settings.ttsEngine === "azure";
  if (azure) {
    await ensureAzureVoices();
    if (!settings.azureKey || !settings.azureRegion || !azureVoiceCache.some((v) => v.id === settings.azureVoice)) { toast("error", tr("host.tts.noazurevoice")); return; }
  } else if (!engineReady() || !voiceById(settings.ttsVoice) || !installedVoices().includes(settings.ttsVoice)) {
    toast("error", tr("host.tts.novoice"));
    return;
  }
  // Each announcement clip fills from its start to `e` (the next change OR the end of its song — so
  // it never bleeds across the following songs). Pad every WAV to the biggest span so the bridge can
  // trim each to its exact length.
  const ordered = withClipEnds(items.map((it) => ({ s: it.s, t: it.t })));
  const gaps = ordered.map((it) => Math.max(0.25, it.e - it.s));
  const maxGapBeats = Math.max(4, ...gaps);
  const tempo = transport.tempo > 0 ? transport.tempo : 120;
  const padSec = (maxGapBeats * 60) / tempo; // pad every announcement long enough to cover the biggest gap
  const labels = Array.from(new Set(ordered.map((i) => i.t.trim()).filter(Boolean)));
  if (!labels.length) { toast("error", tr("host.guide.nomatch")); return; }
  const palette: { label: string; item: string }[] = [];
  const paths: string[] = [];
  ttsBusy = { kind: "generate", pct: 0 };
  broadcastState();
  let done = 0;
  for (const l of labels) {
    const base = ttsFileBase(l);
    const wav = nodePath.join(ttsCacheDir(), `${base}.wav`);
    const ok = await synthLabel(l, wav);
    if (ok) { padWavToSeconds(wav, padSec); palette.push({ label: l, item: base }); paths.push(wav); }
    done++;
    ttsBusy = { kind: "generate", pct: Math.floor((done / labels.length) * 100) };
    broadcastState();
  }
  ttsBusy = null;
  broadcastState();
  if (!palette.length) { toast("error", tr(azure ? "host.tts.azuregenfail" : "host.tts.genfail")); return; }
  if (installSpeechFiles(paths) === 0) { toast("error", tr("host.guide.nolib")); return; }
  // Send the absolute WAV path per entry so the bridge creates the clip via create_audio_clip (reads
  // the file directly — no browser, no async race). Fall back to the source path if the UL copy isn't found.
  const paletteWithPaths = palette.map((p, i) => ({ ...p, path: speechFilePath(nodePath.basename(paths[i]!)) || paths[i]! }));
  // Send each occurrence with its song-bounded end beat `e` so the bridge trims the padded clip to
  // fill exactly up to the next change (or the song end). TTS lands on the SPEECH track (auto-created).
  const outItems = ordered.map((it) => ({ s: it.s, t: it.t, e: it.e }));
  const track = settings.guideTrack || "SPEECH";
  log(`guide TTS: engine=${settings.ttsEngine}, track="${track}", generated ${palette.length}/${labels.length} announcements → sending ${outItems.length} clips to the bridge`);
  bridge.send(ADDR.cmdWriteGuide, [JSON.stringify({ track, items: outItems, palette: paletteWithPaths })]);
}

/** A clip read from a track by the bridge: name + arrangement start beat, plus (for audio clips) the
 * source file and the [fs, fe] SECONDS region it plays — computed bridge-side (fe < 0 = to EOF). */
interface TrackClip {
  t: string; s: number;
  file: string; fs: number; fe: number;
}

/** Clean a raw transcription into a readable label (drop trailing punctuation, collapse whitespace). */
function cleanLabel(s: string): string {
  return s.replace(/[.,;:!?]+$/g, "").trim().replace(/\s+/g, " ");
}

/** Find the known structure label that the transcription CONTAINS (label tokens ⊆ transcription
 * tokens, via the existing token matcher), preferring the most specific (most words). null if none. */
function matchLabelFromTranscription(transcription: string, vocab: string[]): string | null {
  let best: string | null = null, bestTokens = 0;
  for (const label of vocab) {
    if (matchSpeechFile(label, [transcription])) { // label's tokens are all present in the transcription
      const nTokens = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).length; // matches tokens() granularity
      if (nTokens > bestTokens) { bestTokens = nTokens; best = label; }
    }
  }
  return best;
}

/** Transcribe each audio clip of a track (Azure STT), match to a structure label (fallback: cleaned
 * transcription), and write the markers onto the STRUCTURE track for the whole project. */
async function transcribeStructureFromClips(clips: TrackClip[], locale: string): Promise<void> {
  if (!settings.azureKey || !settings.azureRegion) { toast("error", tr("host.stt.nokey")); return; }
  const audio = clips.filter((c) => c.file);
  if (!audio.length) { toast("error", tr("host.stt.noaudio")); return; }
  const loc = locale || "it-IT";
  const vocab = Array.from(new Set([...(settings.structureLabels ?? []), ...DEFAULT_STRUCTURE_LABELS]));
  const sharedFile = new Set(audio.map((c) => c.file)).size < audio.length;
  log(`transcribe: ${audio.length} audio clip(s), locale=${loc}, ${sharedFile ? "shared source file (region slices)" : "separate files"}`);
  const results: { s: number; t: string }[] = [];
  ttsBusy = { kind: "generate", pct: 0 };
  broadcastState();
  let i = 0;
  for (const c of audio) {
    const a = Math.max(0, c.fs);
    const b = (c.fe < 0 || c.fe <= a) ? Infinity : c.fe; // fe < 0 (or invalid) → to end of file
    const wav = nodePath.join(ttsCacheDir(), `stt-${i}.wav`);
    const bLbl = Number.isFinite(b) ? b.toFixed(2) : "end";
    if (!sliceWavToMono16k(c.file, a, b, wav)) {
      log(`transcribe: "${c.t}" @${c.s.toFixed(1)}: could not read/slice the audio (${c.file})`);
    } else {
      const rec = await azureRecognize(settings.azureKey, settings.azureRegion, wav, loc);
      if (!rec || !rec.display.trim()) {
        log(`transcribe: "${c.t}" @${c.s.toFixed(1)} region [${a.toFixed(2)}s,${bLbl}]: no speech recognized (skipped)`);
      } else {
        const matched = matchLabelFromTranscription(rec.display, vocab);
        const label = matched ?? cleanLabel(rec.display);
        log(`transcribe: "${c.t}" @${c.s.toFixed(1)} → "${rec.display}" (conf ${rec.confidence.toFixed(2)}) → ${matched ? `matched "${matched}"` : `label "${label}"`}`);
        if (label) results.push({ s: c.s, t: label });
      }
    }
    i++;
    ttsBusy = { kind: "generate", pct: Math.floor((i / audio.length) * 100) };
    broadcastState();
  }
  ttsBusy = null;
  broadcastState();
  if (!results.length) { toast("error", tr("host.stt.none")); return; }
  const items = withClipEnds(results.map((r) => ({ s: r.s, t: r.t })));
  log(`transcribe: writing ${items.length} structure marker(s) to the STRUCTURE track`);
  bridge.send(ADDR.cmdWriteStructure, [JSON.stringify(items)]);
}

/** Fetch the Azure voice catalog for the current key+region (on key/region change or manual refresh). */
async function refreshAzureVoices(): Promise<void> {
  if (!settings.azureKey || !settings.azureRegion) { azureVoiceCache = []; broadcastState(); return; }
  try {
    azureVoiceCache = await fetchAzureVoices(settings.azureKey, settings.azureRegion);
    broadcastState();
    if (!azureVoiceCache.length) toast("error", tr("host.tts.azurefail"));
    else if (!settings.azureVoice || !azureVoiceCache.some((v) => v.id === settings.azureVoice)) {
      const def = azureVoiceCache.find((v) => v.lang === "it") ?? azureVoiceCache[0];
      if (def) applySetting("azureVoice", def.id); // pick a sensible default voice
    }
  } catch {
    azureVoiceCache = []; broadcastState();
    toast("error", tr("host.tts.azurefail"));
  }
}

/** Lazily (re)fetch the Azure voices if the runtime cache is empty but a key+region are saved — so a
 * preview/export right after a host restart works without the user re-saving the key. */
async function ensureAzureVoices(): Promise<void> {
  if (azureVoiceCache.length === 0 && settings.azureKey && settings.azureRegion) await refreshAzureVoices();
}

/** Download the Piper engine (first time only) + the chosen voice, reporting progress via ttsBusy. */
async function downloadTtsVoice(voiceId: string): Promise<void> {
  const v = voiceById(voiceId);
  if (!v) return;
  if (ttsBusy) { toast("error", tr("host.tts.busy")); return; }
  try {
    ttsBusy = { kind: "engine", voiceId, pct: 0 }; broadcastState();
    if (!engineReady()) {
      const eng = await ensureEngine((p: DlProgress) => { ttsBusy = { kind: "engine", voiceId, pct: p.pct }; broadcastState(); });
      if (!eng) throw new Error("engine");
    }
    ttsBusy = { kind: "voice", voiceId, pct: 0 }; broadcastState();
    const ok = await ensureVoice(voiceId, (p: DlProgress) => { ttsBusy = { kind: "voice", voiceId, pct: p.pct }; broadcastState(); });
    ttsBusy = null; broadcastState();
    if (ok && !(await engineCanRun())) { toast("error", tr("host.tts.macengine")); return; } // downloaded but the OS won't run it (e.g. Apple Silicon w/o Rosetta)
    toast(ok ? "info" : "error", ok ? tr("host.tts.voiceready", { v: v.label }) : tr("host.tts.voicefail"));
  } catch {
    ttsBusy = null; broadcastState();
    toast("error", tr("host.tts.voicefail"));
  }
}

/** Generate a short sample with the selected engine + current settings and send it back (as a data:
 * URL) to the requesting client to play. */
async function previewTtsVoice(client: ClientMeta, text?: string): Promise<void> {
  if (settings.ttsEngine === "azure") {
    await ensureAzureVoices();
    if (!settings.azureKey || !settings.azureRegion || !azureVoiceCache.some((v) => v.id === settings.azureVoice)) { toast("error", tr("host.tts.noazurevoice")); return; }
  } else if (!engineReady() || !installedVoices().includes(settings.ttsVoice)) { toast("error", tr("host.tts.novoice")); return; }
  const sample = (text && text.trim()) || tr("host.tts.previewtext");
  const out = nodePath.join(ttsCacheDir(), "preview.wav");
  ttsBusy = { kind: "preview", pct: 0 }; broadcastState();
  const ok = await synthLabel(sample, out);
  ttsBusy = null; broadcastState();
  if (!ok || !existsSync(out)) { toast("error", tr("host.tts.genfail")); return; }
  try {
    const b64 = readFileSync(out).toString("base64");
    server.sendTo(client.opaqueId, { type: "ttsPreview", data: `data:audio/wav;base64,${b64}` });
  } catch { toast("error", tr("host.tts.genfail")); }
}
let stopDiag = ""; // raw STOP-clip reading values (debug)
let bluetooth: string[] = []; // connected Bluetooth peripherals (host machine)
let trackDevices: TrackDevices[] = []; // Ableton tracks + their device names (plugin-automation picker)
let lastAutomationPlaying: boolean | null = null; // last play-state the plugin automation acted on
/** Apply every enabled plugin rule for the given play state: device ON/OFF per the rule's polarity.
 * Idempotent + de-duped on the play state so it only fires on a real play<->stop transition. */
function applyPluginAutomation(playing: boolean, force = false): void {
  if (!settings.automationEnabled) { lastAutomationPlaying = null; return; }
  if (!force && lastAutomationPlaying === playing) return;
  lastAutomationPlaying = playing;
  for (const r of settings.pluginRules) {
    if (!r.track || !r.device) continue;
    const on = playing ? r.onWhilePlaying : !r.onWhilePlaying;
    bridge.send(ADDR.cmdSetDeviceOn, [r.track, r.device, on ? 1 : 0]);
  }
}
function refreshBT(): void {
  listBluetooth().then((list) => {
    if (list.length !== bluetooth.length || list.some((d, i) => d !== bluetooth[i])) {
      bluetooth = list;
      broadcastState();
    }
  }).catch(() => {});
}
let audioPresent = true; // is a USB audio interface present on the host machine (OS-level)
function refreshAudio(): void {
  hasAudioInterface().then((now) => {
    if (now === audioPresent) return;
    const wasPresent = audioPresent;
    audioPresent = now;
    // Alert when the interface drops WHILE Ableton is connected (i.e. mid-show): that's the case
    // that matters. When Ableton is off there's nothing to be "operational on", so stay quiet.
    if (bridgeConnected && wasPresent && !now) toast("error", tr("host.audio.lost"));
    broadcastState();
  }).catch(() => {});
}
let abletonProject = ""; // open Live Set name (from the Ableton window title)
let abletonVersion = ""; // Ableton edition + version in use
function refreshAbleton(): void {
  readAbleton().then((info) => {
    const project = info?.project ?? "";
    const version = info?.version ?? "";
    if (project !== abletonProject || version !== abletonVersion) {
      const projectChanged = project !== abletonProject;
      abletonProject = project;
      abletonVersion = version;
      if (projectChanged) {
        lyricsDoc = (loadLyricsDoc(project) as LyricLine[] | null); // this project's edited lyrics, if any
        structureDoc = (loadStructureDoc(project) as LyricLine[] | null); // and its edited structure
      }
      broadcastState();
    }
  }).catch(() => {});
}
let lastSig = "";
let lastTempo = 120;
let pendingRebuild = false;
let prevTime = 0;

let activationState = ""; // transient UI status for device activation ("", "busy", "limit", "offline", "invalid")
/** Licensed = the key is valid AND this device holds a matching activation token (offline check, no
 * network). The email is read from the key even before activation, so the UI can show it. */
function licenseInfo(): { licensed: boolean; email: string } {
  const p = verifyLicenseKey(settings.licenseKey || "");
  if (!p) return { licensed: false, email: "" };
  return { licensed: isActivatedHere(settings.licenseKey, settings.activationToken || "", deviceId()), email: p.email };
}
/** Enforce licensing: an UNLICENSED app is locked to the demo setlist — it never drives real
 * Ableton. A licensed app honours the user's own demo toggle. Called at boot and whenever the
 * license or the demo toggle changes. */
function applyDemo(): void {
  // When licensing is OFF (current), only the user's own demo toggle drives demo mode.
  bridge.setDemo((LICENSING_ENABLED && !licenseInfo().licensed) || settings.demoMode);
}

// One-time ONLINE activation: register THIS device against the key (max 3 per key) and store the
// signed token. After this the app verifies the token OFFLINE forever (no internet on stage). Fire
// it when the user enters a key; a network failure leaves them in demo until they retry with WiFi.
const ACTIVATE_URL = "https://ablejam.com/api/activate";
async function activateOnline(key: string): Promise<void> {
  if (!verifyLicenseKey(key)) { activationState = "invalid"; toast("error", tr("license.invalid")); broadcastState(); return; }
  activationState = "busy";
  broadcastState();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(ACTIVATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, deviceId: deviceId(), deviceName: deviceName() }),
      signal: ctrl.signal,
    });
    if (res.status === 409) { // the key's 3 devices are all used
      settings.activationToken = "";
      activationState = "limit";
      toast("error", tr("license.limit"));
      applyDemo(); persistSession(); broadcastState();
      return;
    }
    const data = res.ok ? (await res.json().catch(() => ({}))) as { token?: string; slots?: number; max?: number } : {};
    if (!res.ok || !data.token) { activationState = "offline"; toast("error", tr("license.activate.offline")); broadcastState(); return; }
    settings.activationToken = data.token;
    activationState = "";
    const li = licenseInfo();
    if (li.licensed) toast("info", tr("license.activated.device", { email: li.email, slot: data.slots ?? 1, max: data.max ?? 3 }));
    else toast("error", tr("license.invalid"));
    applyDemo(); persistSession(); broadcastState();
  } catch {
    activationState = "offline";
    toast("error", tr("license.activate.offline"));
    broadcastState();
  } finally {
    clearTimeout(timer);
  }
}

function snapshot(): AppState {
  const li = licenseInfo();
  return {
    bridgeConnected,
    bridgeVersion,
    library: mgr.library,
    setlist: mgr.entries,
    currentEntryIndex: mgr.currentEntry,
    transport,
    settings,
    savedSetlists,
    recentSetlists,
    tracks,
    midiTracks,
    midiOutPorts,
    lanIp,
    stopPoints,
    stopDiag,
    logs,
    bluetooth,
    // Audio is "operational on Ableton" only when Ableton is actually connected AND an interface is
    // present — the Live API can't reveal Live's selected device, so this is the honest proxy.
    audioConnected: bridgeConnected && audioPresent,
    trackDevices,
    abletonProject,
    abletonVersion,
    currentSetlistName,
    recentOriginals: namesWithOriginal(recentSetlists),
    canUndo: mgr.canUndo(),
    canRedo: mgr.canRedo(),
    stageMessage,
    lyrics: effectiveLyrics(),
    lyricsEdited: lyricsDoc != null,
    structure: effectiveStructure(),
    structureEdited: structureDoc != null,
    guideAudio,
    ttsCatalog: VOICE_CATALOG.map((v) => ({ id: v.id, lang: v.lang, gender: v.gender, label: v.label })),
    ttsInstalledVoices: installedVoices(),
    ttsEngineReady: engineReady(),
    ttsBusy,
    azureVoices: azureVoiceCache.map((v) => ({ id: v.id, lang: v.lang, gender: v.gender, label: v.label })),
    azureReady: azureVoiceCache.length > 0,
    licensed: li.licensed,
    licenseEmail: li.email,
    activationState,
    clients: server.clients().map((m) => ({ id: m.opaqueId, name: m.name, isLocal: m.isLocal, isMaster: isMasterClient(m) })),
  };
}

/** Push the configured stop track + note to the bridge so it knows which MIDI notes
 * mark song endings (re-sent on every connect and whenever the setting changes). */
function sendStopConfig(): void {
  bridge.send(ADDR.cmdStopConfig, [settings.stopTrack, settings.stopNote]);
}
/** Tell the bridge which track holds the lyrics clips (re-sent on connect + on setting change). */
function sendLyricsConfig(): void {
  bridge.send(ADDR.cmdLyricsConfig, [settings.lyricsTrack]);
}
/** Tell the bridge which track marks the song structure (re-sent on connect + on setting change). */
function sendStructureConfig(): void {
  bridge.send(ADDR.cmdStructureConfig, [settings.structureTrack]);
}
/** Write the edited lyrics TEXT back onto the lyrics-track clips, matched by position (the bridge
 * pairs each clip with the nearest line). Timing can't be written — Live's API can't move
 * arrangement clips — so it stays in the AbleJam doc. */
function renameLyricClips(doc: LyricLine[]): void {
  bridge.send(ADDR.cmdRenameLyrics, [JSON.stringify(doc.map((l) => ({ s: l.start, t: l.text })))]);
}
/** Create clips on the lyrics track for the doc lines that DON'T already have a clip (so songs
 * imported from notes get real .als clips). Only lines with no clip near their start are sent —
 * existing clips are never duplicated, sidestepping the (impossible) delete/move of arrangement clips. */
/** Parse a drop-in lyrics file (`#Song` headers + lines), match each block to a library song, spread
 * its lines across that song's beat range, merge into the AbleJam doc, persist + broadcast. */
function importLyricsText(text: string): void {
  const lib = mgr.library;
  if (!lib.length || !text.trim()) return;
  const titles = lib.map((s) => s.title);
  const lowered = titles.map((t) => t.toLowerCase());
  const blocks: { title: string; lines: string[] }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*#\s*(.+?)\s*$/) || raw.match(/^\s*\[(.+?)\]\s*$/);
    const tl = raw.trim();
    const header = m ? m[1]!.trim() : (tl && lowered.includes(tl.toLowerCase()) ? tl : null);
    if (header != null) { cur = { title: header, lines: [] }; blocks.push(cur); }
    else if (cur && tl) cur.lines.push(tl);
  }
  let doc: LyricLine[] = (lyricsDoc ?? lyricsFromClips).map((l) => ({ ...l }));
  let matched = 0;
  for (const b of blocks) {
    const mm = bestMatch(b.title, titles, 0.5);
    if (!mm || !b.lines.length) continue;
    const song = lib[mm.index]!;
    const s = song.startBeat;
    const e = song.endBeat ?? song.startBeat + 64;
    const n = b.lines.length;
    const nl: LyricLine[] = b.lines.map((tx, i) => ({ text: tx, start: s + (i / n) * (e - s), end: s + ((i + 1) / n) * (e - s) }));
    doc = doc.filter((l) => !(l.start < e - 1e-6 && l.end > s + 1e-6)).concat(nl);
    matched++;
  }
  if (!matched) return;
  doc.sort((a, b) => a.start - b.start);
  lyricsDoc = doc;
  saveLyricsDoc(abletonProject, lyricsDoc);
  renameLyricClips(lyricsDoc);
  broadcastState();
  toast("info", tr("host.lyrics.imported", { n: matched }));
}
/** Watch the drop-in lyrics file: on a real change, import the songs AND lay them down as clips in
 * Ableton (positioned in each matched song, like the user did by hand for RUSH). */
let lastLyricsImport = "";
function watchLyricsImport(): FSWatcher | undefined {
  const file = lyricsImportFile();
  const run = () => {
    const t = readLyricsImport();
    if (!t.trim() || t === lastLyricsImport || !mgr.library.length) return; // unchanged / library not ready
    lastLyricsImport = t;
    importLyricsText(t); // assign pasted/dropped lyrics to songs (the AbleJam doc) — clips are
                         // created only on demand via Settings → "Import lyrics into project".
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return watch(file, () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 700); });
  } catch { return undefined; /* file not watchable yet */ }
}

function writeLyricsClips(): void {
  if (!lyricsDoc || !lyricsDoc.length) { toast("error", tr("host.lyrics.writeNothing")); return; }
  const clipStarts = lyricsFromClips.map((l) => l.start);
  const toCreate = lyricsDoc.filter((l) => l.text.trim() && !clipStarts.some((cs) => Math.abs(cs - l.start) < 0.25));
  if (!toCreate.length) { toast("info", tr("host.lyrics.writeNothing")); return; } // every line already has a clip
  bridge.send(ADDR.cmdWriteLyrics, [JSON.stringify(toCreate.map((l) => ({ s: l.start, t: l.text })))]);
}

let colorizeNonce = 0; // only advanced for the "random" scheme, so re-pressing reshuffles
/** Tell the bridge to paint each song's arrangement clips, one colour per timeline song,
 * using the configured colour scheme (default "contrast" = adjacent songs maximally
 * distinct). Each song spans [startBeat, NEXT song's startBeat) — the first starts at 0,
 * the last extends to the end — so EVERY clip gets a colour. The bridge reports the count. */
function colorizeAbleton(): void {
  const songs = mgr.library;
  if (songs.length === 0) { toast("error", tr("host.colorize.noSongs")); return; }
  const scheme = settings.colorScheme || "contrast";
  if (scheme === "random") colorizeNonce++;
  const ranges = songs.map((s, i) => ({
    s: i === 0 ? 0 : s.startBeat,
    e: i + 1 < songs.length ? songs[i + 1]!.startBeat : (s.endBeat ?? s.startBeat + 1e9), // older bridge (<=v34) still needs it
    c: parseInt(schemeHex(scheme, i, songs.length, colorizeNonce).slice(1), 16),
  }));
  bridge.send(ADDR.cmdColorize, [JSON.stringify(ranges)]);
}

/** Rename every arrangement clip "<Song> - <Track>" for a tidy project. Each clip is matched to the
 * song whose [startBeat, NEXT startBeat) range contains it; the lyrics track is skipped (its clip
 * names ARE the lyrics). The bridge does the renaming and reports the count. */
function cleanProjectClips(): void {
  const songs = mgr.library;
  if (songs.length === 0) { toast("error", tr("host.clean.noSongs")); return; }
  const ranges = songs.map((s, i) => ({
    s: i === 0 ? 0 : s.startBeat,
    e: i + 1 < songs.length ? songs[i + 1]!.startBeat : (s.endBeat ?? s.startBeat + 1e9),
    t: s.title,
  }));
  bridge.send(ADDR.cmdCleanClips, [JSON.stringify({ songs: ranges, skipTrack: settings.lyricsTrack })]);
}

/** When "colour on import" is on, colour the active setlist at EVERY (re)load — but don't
 * clobber a setlist that already carries colours (manual or saved). */
function ensureColoredIfSet(): void {
  if (settings.colorOnImport && !mgr.entries.some((e) => e.active && e.color)) {
    mgr.autoColor(settings.setlistColorScheme || "rainbow");
  }
}

/** Insert a musical key into a raw locator name, BEFORE any trailing medley "/" (or "-"):
 * "BAD BOYS" -> "BAD BOYS (Am)";  "GET BUSY /" -> "GET BUSY (Fm) /". */
function insertKeyInName(raw: string, key: string): string {
  const trimmed = raw.replace(/\s+$/, "");
  if (/[/-]$/.test(trimmed) && trimmed.length > 1) {
    return trimmed.slice(0, -1).replace(/\s+$/, "") + ` (${key}) ` + trimmed.slice(-1);
  }
  return trimmed + ` (${key})`;
}
/** Write the keys AbleJam knows (parsed from an import) into the Ableton locator names, so
 * Ableton becomes the source of truth. Only songs WITHOUT an existing marker key get one. */
function writeKeysToMarkers(): void {
  const keyForSong = new Map<number, string>();
  for (const e of mgr.entries) {
    const song = mgr.library[e.libIndex];
    if (song && !song.key && e.key && !keyForSong.has(e.libIndex)) keyForSong.set(e.libIndex, e.key);
  }
  const renames: { time: number; name: string }[] = [];
  mgr.library.forEach((song, i) => {
    const key = keyForSong.get(i);
    if (!key) return;
    const cue = rawCues.find((c) => Math.abs(c.time - song.startBeat) < 0.01);
    if (!cue) return;
    const name = insertKeyInName(cue.name, key);
    if (name !== cue.name) renames.push({ time: cue.time, name });
  });
  if (renames.length === 0) { toast("info", tr("host.keys.none")); return; }
  bridge.send(ADDR.cmdRenameCues, [JSON.stringify(renames)]);
}

const server = new Server(snapshot);
// LAN clients never see the license secrets nor the raw master device ids (anti-spoofing: a
// viewer that could read a master's id could replay it in its own hello and self-promote).
server.redactForRemote = (s) => ({ ...s, settings: { ...s.settings, licenseKey: "", activationToken: "", masterDevices: [], azureKey: "" } });
/** Master = the host PC itself (loopback) or one of the (max 2) authorized remote devices. */
function isMasterClient(client: ClientMeta): boolean {
  return client.isLocal || (!!client.deviceId && settings.masterDevices.some((m) => m.id === client.deviceId));
}
// The desktop app silently (re)installs the bundled bridge on startup and passes its version here.
// If Ableton is still running an OLDER bridge, prompt (once) to restart Ableton to load the new one.
let bridgeRestartWarned = false;
function maybeWarnBridgeRestart(): void {
  const bundled = Number(process.env.ABLEJAM_BRIDGE_VERSION ?? 0);
  if (!bridgeRestartWarned && bundled > 0 && bridgeVersion > 0 && bridgeVersion < bundled) {
    bridgeRestartWarned = true;
    toast("info", tr("host.bridge.restartNeeded"));
  }
}
/** Tell every connected client its own role (sent on hello and on every master change). */
function sendRoles(): void {
  for (const m of server.clients()) server.sendTo(m.opaqueId, { type: "role", isMaster: isMasterClient(m), selfId: m.opaqueId });
}
server.onClientsChanged = () => { sendRoles(); broadcastState(); };
function broadcastState(): void {
  server.broadcast(snapshot());
}
function broadcastTransport(): void {
  server.broadcastMessage({ type: "transport", transport, currentEntryIndex: mgr.currentEntry, bridgeConnected });
}
// Diagnostic log ring buffer (host events + bridge messages), shown in Settings → Logs so the user
// can see what happened during an export/connect without a console. Broadcast is debounced.
let logs: string[] = [];
let logBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
// Set while we've asked the bridge to read a track's clips and are waiting for the /ablejam/trackclips
// reply. The mode decides what to do with the clips: "guide" = generate the audio guide from them;
// "stt" = transcribe each clip's audio (Azure STT) into STRUCTURE markers.
let pendingTrackRead: null | { mode: "guide" } | { mode: "stt"; locale: string } = null;
let trackReadTimer: ReturnType<typeof setTimeout> | null = null;
/** Arm a pending track read, with a timeout so a never-arriving reply (bridge dropped/errored)
 * doesn't leave the UI stuck on "Reading…". Returns false if a read is already in flight. */
function armTrackRead(mode: NonNullable<typeof pendingTrackRead>): boolean {
  if (pendingTrackRead) return false; // one at a time — avoids a reply misrouting to the wrong mode
  pendingTrackRead = mode;
  if (trackReadTimer) clearTimeout(trackReadTimer);
  trackReadTimer = setTimeout(() => {
    trackReadTimer = null;
    if (pendingTrackRead) { pendingTrackRead = null; toast("error", tr("host.stt.timeout")); }
  }, 10000);
  return true;
}
function clearTrackRead(): void {
  pendingTrackRead = null;
  if (trackReadTimer) { clearTimeout(trackReadTimer); trackReadTimer = null; }
}
function log(msg: string): void {
  logs.push(`${new Date().toLocaleTimeString()}  ${msg}`);
  if (logs.length > 300) logs = logs.slice(-300);
  if (!logBroadcastTimer) logBroadcastTimer = setTimeout(() => { logBroadcastTimer = null; broadcastState(); }, 400);
}
function toast(level: "info" | "error", message: string): void {
  log(`${level === "error" ? "⚠ " : ""}${message}`);
  server.broadcastMessage({ type: "toast", level, message });
}
/** Translate a toast in the user's chosen interface language. */
function tr(key: string, params?: Record<string, string | number>): string {
  return translate(settings.language, key, params);
}

function buildLibrary(): void {
  const lib = buildSetlist(rawCues, lastTempo);
  // Signature on STRUCTURE (song start beats), NOT titles: a pure marker RENAME keeps
  // the same structure, so we refreshLibrary (updates the displayed names while keeping
  // the user's order + medley). A structural change (add/remove/move of markers) used to
  // reset everything — losing medley links, keys and order. Instead, PRESERVE the user's
  // setlist by re-mapping it onto the new library by title.
  const sig = lib.map((s) => s.startBeat.toFixed(3)).join("|");
  if (sig === lastSig) {
    mgr.refreshLibrary(lib);
    return;
  }
  // First build after a (re)start: re-map the PERSISTED session (colours + order + medleys +
  // keys) onto the library. Subsequent rebuilds re-map the live in-memory setlist instead.
  const fromDisk = pendingRestoreItems != null;
  const saved = fromDisk ? pendingRestoreItems! : mgr.serialize();
  const wasAuto = fromDisk ? pendingRestoreAuto : mgr.medleysAreAuto; // restore/keep the auto flag
  pendingRestoreItems = null; // consume the disk snapshot once
  mgr.setLibrary(lib);
  if (saved.length > 0) {
    const r = mgr.restoreFromSession(saved); // re-map onto the new library
    // Unmatched items are dropped silently by the re-map (title no longer in the library) —
    // warn, because a dropped entry also breaks any medley link that pointed into it.
    if (r.matched < r.total) toast("error", tr("host.restore.dropped", { n: r.total - r.matched }));
  }
  mgr.medleysAreAuto = wasAuto;
  mgr.autoDetectMedleys(); // on a fresh/auto setlist, derive medleys from the `-` locator marks
  ensureColoredIfSet(); // colour the (re)built setlist if "colour on import" is on
  lastSig = sig;
}

function persistSession(): void {
  saveSession(lastSig, mgr.serialize(), settings, mgr.medleysAreAuto, currentSetlistName);
}
/** Setlist changed: persist it (survives restarts) and broadcast. */
function changed(): void {
  persistSession();
  broadcastState();
}

function doJumpToEntry(i: number): void {
  if (i < 0 || i >= mgr.entries.length) return;
  mgr.setCurrentEntry(i);
  const beat = mgr.jumpBeatForEntry(i);
  if (beat != null) bridge.send(ADDR.cmdJumpToTime, [beat]);
  if (settings.reenableAutomationOnSongStart) bridge.send(ADDR.cmdReenableAutomation);
  broadcastTransport();
}

/** Turn Live's metronome (click) ON at playback start, when the setting is enabled. */
function startClickIfSet(): void {
  if (settings.clickOnAtStart) bridge.send(ADDR.cmdMetronome, [1]);
}
/** Explicit user navigation — honours the autoplay setting. */
function userJumpToEntry(i: number): void {
  doJumpToEntry(i);
  if (settings.autoplay && !transport.isPlaying) { bridge.send(ADDR.cmdPlay); startClickIfSet(); }
}

/** Send the panic note out the configured MIDI port. Plan B: the host sends it itself.
 * We fall back to the bridge's control-surface output ONLY when the native MIDI lib
 * isn't available at all — never just because no port resolved (that would leak the
 * note out as control-surface MIDI to the Windows GM synth — a surprise piano). */
function firePanicNote(): void {
  const port = sendMidiNote(settings.emergencyPort, settings.emergencyNote);
  if (!port && !midiAvailable()) bridge.send(ADDR.cmdSendNote, [settings.emergencyNote]);
}
/** Stop playback and park the cursor at the START of the shown song (stays stopped).
 * Always returns to the song marker, even if a rehearsal seek point was set. */
/** Stop and park the cursor at the start of `entryIndex`'s song. ALWAYS sends cmdStop
 * first (every bridge version understands it, so playback always stops); cmdStopToStart
 * (v24+) then atomically parks the cursor. Neither re-arms play, so there is no race. */
function stopAtEntry(entryIndex: number): void {
  bridge.send(ADDR.cmdStop);
  const s = mgr.songOf(entryIndex);
  if (s) bridge.send(ADDR.cmdStopToStart, [s.startBeat]);
}
/** PULL UP: park at the start of the CURRENTLY SHOWN song (within a medley, the song
 * in execution — not the medley start). */
function stopToSongStart(): void {
  stopAtEntry(mgr.currentEntry);
}
/** STOP: in a medley, park at the start of the medley (its FIRST song) and show it, so
 * Play restarts the whole medley; for a standalone song it's just the current song. */
function stopToMedleyStart(): void {
  const start = mgr.medleyStartEntry(mgr.currentEntry);
  if (start >= 0 && start !== mgr.currentEntry) {
    mgr.setCurrentEntry(start);
    broadcastTransport();
  }
  stopAtEntry(mgr.currentEntry);
}

/** Arm (or clear) the bridge's precise stop beat. Sent UNCONDITIONALLY on every transport tick
 * (10 Hz, one tiny UDP datagram; bridge-side it's a plain assignment): the old change-debounced
 * version skipped re-sending the DISARM after bridge reloads/jumps, leaving stale arms that
 * stopped manually-linked medleys. The bridge halts EXACTLY at this beat via its fast playhead
 * listener, so there is no 10 Hz detection lag and no OSC round-trip. */
function armStop(beat: number | null): void {
  bridge.send(ADDR.cmdArmStop, [beat == null ? -1 : beat]);
}

/** A song just stopped (at its MIDI note or its end): advance the selection to the next
 * song and park the cursor there (no auto-play). Shared by the bridge's precise stop
 * notification AND the host-side crossing fallback — debounced so the two never advance
 * twice (skip a song) when both fire within a beat of each other. */
let lastStopAdvanceMs = 0;
function prepareNextAfterStop(fromEntry: number): void {
  const now = Date.now();
  if (now - lastStopAdvanceMs < 500) return; // bridge notify + host fallback -> one advance
  lastStopAdvanceMs = now;
  const next = mgr.nextActiveAfter(fromEntry);
  if (next >= 0) {
    mgr.setCurrentEntry(next);
    const nb = mgr.jumpBeatForEntry(next);
    bridge.send(ADDR.cmdStopToStart, [nb ?? 0]); // atomic stop + park at next, no play re-arm
    if (settings.reenableAutomationOnSongStart) bridge.send(ADDR.cmdReenableAutomation);
  } else {
    bridge.send(ADDR.cmdStop); // last song: just stop
  }
  broadcastTransport();
}

/** Auto behaviour at the end of a song. Run BEFORE re-syncing the current entry to the
 * playhead, so it sees the song that is actually ending. `songIndex` = library index of the
 * song UNDER THE PLAYHEAD (locateCurrent): everything below derives from THAT song's entry,
 * not from the user selection — after a setlist rebuild `currentEntry` can lag or point at a
 * duplicate, and arming a stop from the wrong entry is exactly what used to kill manually
 * linked medleys ("stops after the first song"). */
function handleAuto(time: number, isPlaying: boolean, songIndex: number): void {
  if (!isPlaying) { armStop(null); return; }
  // Resolve the entry that actually contains the playhead; fall back to the selection.
  const at = mgr.entryAtPlayhead(songIndex);
  const ce = at.index >= 0 ? at.index : mgr.currentEntry;
  if (ce < 0) { armStop(null); return; }
  if (at.ambiguous) { armStop(null); return; } // duplicates disagree on the link -> NEVER stop a possible medley
  const s = mgr.songOf(ce);
  if (!s || s.endBeat == null) { armStop(null); return; }
  if (prevTime < s.startBeat - 1e-6) return; // playhead not inside this song yet

  const next = mgr.nextActiveAfter(ce);
  // Medley: continuous. The resolved entry's link is authoritative; the song's own
  // continuesNext only counts when the playhead song has NO entry at all (unresolvable) —
  // ORing it in always would override a deliberate manual unlink.
  const entryLinked = at.index >= 0 ? !!mgr.entries[ce]?.linkedNext : !!(mgr.entries[ce]?.linkedNext || s.continuesNext);
  const linked = entryLinked && next >= 0;
  const songEnd = s.endBeat;
  // A MIDI "stop" note inside this song stops it precisely. ARM the bridge to halt exactly
  // at that beat (bridge-side, no latency); it notifies us (/ablejam/midistop) to advance.
  // Ignored inside a medley (which continues).
  const midiStop = linked ? undefined : stopPoints.find((p) => p > s.startBeat + 1e-6 && p <= songEnd + 1e-6);
  armStop(midiStop ?? null);

  // Host-side crossing: for a MIDI-note song this stops AT the note (a few clicks late at
  // 10 Hz) as a SAFETY NET — the bridge (v32+) stops tight on the note first and the debounce
  // drops this one; an OLDER bridge that ignores the arm still stops at the note here instead
  // of overrunning to the song end. Songs WITHOUT a note stop/continue at the end as usual.
  const stopAt = midiStop !== undefined ? midiStop : songEnd;
  const continuePlaying = midiStop === undefined && !settings.alwaysStop && (linked || (settings.autoContinue && !s.stopAfter));
  if (!(prevTime < stopAt && time >= stopAt)) return; // hasn't reached the stop point
  if (continuePlaying && next >= 0) {
    doJumpToEntry(next); // roll into the next song (medley / auto-continue)
  } else {
    prepareNextAfterStop(ce);
  }
}

bridge.on("error", (err) => console.error("[host] bridge socket error:", err));

bridge.on("osc", (address: string, args: (number | string)[]) => {
  if (!bridgeConnected) {
    bridgeConnected = true;
    // "Click on at AbleJam startup": fire once, the first time we reach Ableton this run.
    if (settings.clickOnStartup && !startupClickDone) { startupClickDone = true; bridge.send(ADDR.cmdMetronome, [1]); }
    broadcastState();
  }
  switch (address) {
    case ADDR.hello:
      // hello carries the version (also re-sent on refresh, so a host restart
      // doesn't get stuck at v0). Don't request a refresh here — that would loop.
      bridgeVersion = Number(args[1] ?? 0);
      console.log(`[host] bridge: ${args[0]} (v${bridgeVersion})`);
      log(`bridge connected: v${bridgeVersion}`);
      maybeWarnBridgeRestart(); // the app auto-installed a newer bridge but Ableton still runs the old one
      sendStopConfig(); // let the (re)connected bridge know which track/note marks stops
      sendLyricsConfig(); // and which track holds the lyrics clips
      sendStructureConfig(); // and which track marks the song structure
      broadcastState();
      break;
    case ADDR.setlist:
      try {
        rawCues = JSON.parse(String(args[0] ?? "[]")) as RawCue[];
        buildLibrary();
        pendingRebuild = true;
        broadcastState();
      } catch (e) {
        console.error("[host] bad setlist payload", e);
      }
      break;
    case ADDR.tracks:
      try {
        tracks = JSON.parse(String(args[0] ?? "[]")) as string[];
        broadcastState();
      } catch {
        // ignore
      }
      break;
    case ADDR.midiTracks:
      try {
        midiTracks = JSON.parse(String(args[0] ?? "[]")) as string[];
        broadcastState();
      } catch {
        // ignore
      }
      break;
    case ADDR.devices:
      try {
        trackDevices = JSON.parse(String(args[0] ?? "[]")) as TrackDevices[];
        broadcastState();
      } catch {
        // ignore
      }
      break;
    case ADDR.midiStop: {
      // The bridge halted on an ARMED stop beat (only _check_armed_stop emits this — the user's
      // stop/panic commands never do). Resolve the song FROM the stop beat itself: stop notes
      // often sit exactly on endBeat == the next song's startBeat, so probe a hair before it.
      const stopBeat = Number(args[0]);
      const probe = Number.isFinite(stopBeat) ? stopBeat - 0.05 : transport.time;
      const at = mgr.entryAtPlayhead(locateCurrent(mgr.library, probe).songIndex);
      const fromEntry = at.index >= 0 ? at.index : mgr.currentEntry;
      const next = mgr.nextActiveAfter(fromEntry);
      if (!settings.alwaysStop && next >= 0 && !!mgr.entries[fromEntry]?.linkedNext) {
        // SPURIOUS stop: the host never arms a stop for a linked song, so this came from a
        // stale arm (old bridge, race). Resume the medley immediately — worst case a
        // micro-hiccup, never a dead stop mid-show.
        doJumpToEntry(next);
        bridge.send(ADDR.cmdPlay);
      } else {
        prepareNextAfterStop(fromEntry);
      }
      break;
    }
    case ADDR.stopDiag: {
      const d = String(args[0] ?? "");
      if (d !== stopDiag) { stopDiag = d; broadcastState(); }
      break;
    }
    case ADDR.colorized: {
      const n = Number(args[0] ?? 0);
      const total = Number(args[1] ?? n);
      toast(n > 0 ? "info" : "error", n > 0 ? tr("host.colorize.done", { n, total }) : tr("host.colorize.empty"));
      break;
    }
    case ADDR.cleaned: {
      const n = Number(args[0] ?? 0);
      const total = Number(args[1] ?? n);
      toast(n > 0 ? "info" : "error", n > 0 ? tr("host.clean.done", { n, total }) : tr("host.clean.empty"));
      break;
    }
    case ADDR.beat:
      server.broadcastMessage({ type: "beat", beat: Number(args[0] ?? 0) }); // tight metronome beat → CLICK visual
      break;
    case ADDR.renamed: {
      const n = Number(args[0] ?? 0);
      const total = Number(args[1] ?? n);
      toast(n > 0 ? "info" : "error", n > 0 ? tr("host.keys.done", { n, total }) : tr("host.keys.unsupported"));
      break;
    }
    case ADDR.autotuneDiag:
      console.log("[host] AUTOTUNE diag:", String(args[0] ?? ""));
      break;
    case ADDR.lyricsWrite: {
      const n = Number(args[0] ?? 0);
      const total = Number(args[1] ?? n);
      const reason = String(args[2] ?? "");
      if (n > 0) toast("info", tr("host.lyrics.written", { n, total }));
      else if (reason === "notrack" || reason === "empty") toast("error", tr("host.lyrics.writeFail"));
      else toast("info", tr("host.lyrics.writeNothing")); // items sent but all positions already had a clip
      break;
    }
    case ADDR.lyrics:
      try {
        const next = (JSON.parse(String(args[0] ?? "[]")) as LyricLine[]).filter((l) => l && typeof l.text === "string");
        const changed = next.length !== lyricsFromClips.length || next.some((l, i) => l.text !== lyricsFromClips[i]?.text || l.start !== lyricsFromClips[i]?.start || l.end !== lyricsFromClips[i]?.end);
        const firstLoad = next.length > 0 && lyricsFromClips.length === 0;
        lyricsFromClips = next;
        // An AbleJam-edited doc is authoritative — clip changes don't override it; we only broadcast
        // when the EFFECTIVE lyrics (doc ?? clips) actually changed.
        if (changed && lyricsDoc == null) { if (firstLoad) toast("info", tr("host.lyrics.read", { n: next.length })); broadcastState(); }
      } catch {
        // ignore
      }
      break;
    case ADDR.structure:
      try {
        const next = (JSON.parse(String(args[0] ?? "[]")) as LyricLine[]).filter((l) => l && typeof l.text === "string");
        const changed = next.length !== structureFromClips.length || next.some((l, i) => l.text !== structureFromClips[i]?.text || l.start !== structureFromClips[i]?.start || l.end !== structureFromClips[i]?.end);
        structureFromClips = next;
        // An AbleJam-edited doc is authoritative — clip changes don't override it.
        if (changed && structureDoc == null) broadcastState();
      } catch {
        // ignore
      }
      break;
    case ADDR.structureWrite: {
      const n = Number(args[0] ?? 0);
      const total = Number(args[1] ?? n);
      const reason = String(args[2] ?? "");
      log(`structureWrite: created=${n}/${total} reason="${reason}"`);
      if (n > 0) toast("info", tr("host.structure.written", { n, total }));
      else if (reason === "notrack" || reason === "empty") toast("error", tr("host.structure.writeFail"));
      else toast("info", tr("host.structure.writeNothing"));
      break;
    }
    case ADDR.guideWrite: {
      const n = Number(args[0] ?? 0);
      const total = Number(args[1] ?? n);
      const reason = String(args[2] ?? "");
      log(`guideWrite: created=${n}/${total} reason="${reason}"`);
      if (n > 0) toast("info", tr("host.guide.written", { n, total }));
      else if (reason === "notrack") toast("error", tr("host.guide.notrack"));
      else if (reason === "nopalette" || reason === "error") toast("error", tr("host.guide.nopalette")); // both point to the Log
      break;
    }
    case ADDR.trackClips: {
      // Reply to a track read. "guide" → generate the audio guide from the clip names; "stt" →
      // transcribe each clip's audio into STRUCTURE markers.
      const pending = pendingTrackRead;
      if (!pending) break;
      clearTrackRead();
      let clips: TrackClip[] = [];
      try {
        const arr = JSON.parse(String(args[0] ?? "[]")) as Array<Record<string, unknown>>;
        clips = arr.map((c) => ({
          t: String(c.t ?? "").trim(),
          s: Number(c.s) || 0,
          file: typeof c.file === "string" ? c.file : "",
          fs: Number(c.fs) || 0,
          fe: typeof c.fe === "number" ? c.fe : -1,
        })).filter((c) => c.t.length > 0);
      } catch { /* ignore malformed */ }
      if (pending.mode === "guide") {
        log(`trackClips: received ${clips.length} named clip(s) → generating guide audio (whole project)`);
        if (!clips.length) { toast("error", tr("host.guide.notrackclips")); break; }
        writeGuideClips(clips.map((c) => ({ s: c.s, t: c.t }))); // routes by guideMode; song-bounded ends via withClipEnds
      } else {
        void transcribeStructureFromClips(clips, pending.locale);
      }
      break;
    }
    case ADDR.log:
      log(`[bridge] ${String(args[0] ?? "")}`); // free-text diagnostic from the control surface
      break;
    case ADDR.stopPoints:
      try {
        const next = (JSON.parse(String(args[0] ?? "[]")) as unknown[]).map(Number).filter((n) => Number.isFinite(n));
        const changed = next.length !== stopPoints.length || next.some((p, i) => p !== stopPoints[i]);
        if (next.length !== stopPoints.length) toast("info", tr("host.stop.read", { n: next.length }));
        stopPoints = next;
        if (changed) broadcastState();
      } catch {
        // ignore
      }
      break;
    case ADDR.transport: {
      const [playing, time, tempo, sn, sd, , metro] = args;
      lastTempo = Number(tempo) || lastTempo;
      if (pendingRebuild) {
        pendingRebuild = false;
        buildLibrary();
      }
      const tnum = Number(time);
      const isPlaying = Number(playing) !== 0;
      applyPluginAutomation(isPlaying); // fires only on a real play<->stop transition (de-duped)
      // locateCurrent BEFORE handleAuto: the auto-stop logic resolves its entry from the song
      // actually under the playhead (not the possibly-lagging selection). Sync stays AFTER.
      const { songIndex, sectionIndex } = locateCurrent(mgr.library, tnum);
      handleAuto(tnum, isPlaying, songIndex); // before syncing the current entry
      mgr.syncFromPlayhead(songIndex, isPlaying);
      transport.isPlaying = isPlaying;
      transport.time = tnum;
      transport.tempo = lastTempo;
      transport.sigNumerator = Number(sn);
      transport.sigDenominator = Number(sd);
      transport.metronome = Number(metro) !== 0;
      transport.currentSongIndex = songIndex;
      transport.currentSectionIndex = sectionIndex;
      prevTime = tnum;
      broadcastTransport();
      break;
    }
    default:
      break;
  }
});

function applySetting(key: keyof Settings, value: boolean | string | number): void {
  const target = settings as unknown as Record<string, boolean | string | number>;
  if (key === "emergencyNote" || key === "stopNote" || key === "ttsSpeed" || key === "ttsExpr" || key === "ttsPitch") target[key] = Number(value);
  else if (key === "emergencyPort" || key === "stopTrack" || key === "lyricsTrack" || key === "structureTrack" || key === "guideTrack" || key === "guideAudioFolder" || key === "guideMode" || key === "ttsVoice" || key === "ttsEngine" || key === "azureKey" || key === "azureRegion" || key === "azureVoice" || key === "colorScheme" || key === "setlistColorScheme" || key === "panicLabel" || key === "panicColor" || key === "language" || key === "medleyDisplay" || key === "clickIndicator" || key === "licenseKey") target[key] = String(value);
  else target[key] = Boolean(value);
}

// Manual editor edits that participate in undo/redo. Bulk load/import/reset-from-Ableton are NOT
// here — those clear the history inside the manager (their old snapshots reference a stale library).
const EDITOR_EDITS = new Set(["reorder", "moveBlock", "setActive", "toggleLink", "setEntryColor", "autoColorSetlist", "addSong", "clear", "addAll", "resetToTimeline", "sortAZ"]);

const lastViewerToastMs = new Map<string, number>(); // rate-limit the "view only" toast per client
server.onCommand = (c: ClientCommand, client: ClientMeta) => {
  // MASTER GATE (server-side — the UI lockdown is only cosmetic): every command mutates, so a
  // non-master device gets nothing through. Checked BEFORE pushHistory so rejected edits never
  // pollute the undo stack. The host PC (loopback) is always master.
  if (!isMasterClient(client)) {
    const now = Date.now();
    if (now - (lastViewerToastMs.get(client.opaqueId) ?? 0) > 3000) {
      lastViewerToastMs.set(client.opaqueId, now);
      server.sendTo(client.opaqueId, { type: "toast", level: "error", message: tr("viewer.blocked") });
    }
    return;
  }
  const navBlocked = settings.safeMode && transport.isPlaying;
  if (EDITOR_EDITS.has(c.command)) mgr.pushHistory(); // record state BEFORE applying the edit
  switch (c.command) {
    case "setClientMaster": {
      // Any MASTER (the host PC — always master — or an already-authorized device) can assign roles
      // to the CONNECTED devices, by opaque connection id (raw device ids never leave the server).
      const target = server.clients().find((m) => m.opaqueId === c.clientId);
      if (!target || !target.deviceId || target.isLocal) break; // the host PC is always master
      const already = settings.masterDevices.some((m) => m.id === target.deviceId);
      if (c.master) {
        if (already) break;
        if (settings.masterDevices.length >= 2) { server.sendTo(client.opaqueId, { type: "toast", level: "error", message: tr("master.limit") }); break; }
        settings.masterDevices = [...settings.masterDevices, { id: target.deviceId, name: target.name }];
      } else {
        settings.masterDevices = settings.masterDevices.filter((m) => m.id !== target.deviceId);
      }
      sendRoles();
      changed();
      break;
    }
    case "undo": if (mgr.undo()) changed(); break;
    case "redo": if (mgr.redo()) changed(); break;
    case "setStageMessage": stageMessage = c.text.slice(0, 200); broadcastState(); break;
    case "setLyrics":
      lyricsDoc = c.lines.map((l) => ({ text: String(l.text ?? ""), start: Number(l.start) || 0, end: Number(l.end) || 0 }));
      saveLyricsDoc(abletonProject, lyricsDoc);
      renameLyricClips(lyricsDoc); // user opted in: keep the .als clip names in sync (position-matched)
      broadcastState();
      break;
    case "clearLyrics":
      lyricsDoc = null;
      deleteLyricsDoc(abletonProject);
      broadcastState(); // fall back to the raw clips
      break;
    case "writeLyricsClips":
      // Carry the editor's exact lines so the write never races the debounced setLyrics / a stale doc.
      if (c.lines && c.lines.length) {
        lyricsDoc = c.lines.map((l) => ({ text: String(l.text ?? ""), start: Number(l.start) || 0, end: Number(l.end) || 0 }));
        saveLyricsDoc(abletonProject, lyricsDoc);
        broadcastState();
      }
      writeLyricsClips();
      break;
    case "setStructure":
      structureDoc = c.lines.map((l) => ({ text: String(l.text ?? ""), start: Number(l.start) || 0, end: Number(l.end) || 0 }));
      saveStructureDoc(abletonProject, structureDoc);
      broadcastState();
      break;
    case "clearStructure":
      structureDoc = null;
      deleteStructureDoc(abletonProject);
      broadcastState(); // fall back to the raw clips
      break;
    case "writeStructureClips": {
      // Export the structure to the project: named clips on the STRUCTURE track (auto-created if
      // missing), and — when the audio guide is enabled AND the user confirmed it (c.guide) — the
      // audio announcements on the guide track at the same beats.
      // The write (and auto-create) needs the current control surface. If Ableton isn't connected or
      // the bridge is stale, nothing would happen silently — tell the user exactly what to do.
      if (!bridgeConnected) { toast("error", tr("host.structure.noableton")); break; }
      if (bridgeVersion > 0 && bridgeVersion < 50) { toast("error", tr("host.structure.oldbridge")); break; }
      if (c.lines && c.lines.length) {
        structureDoc = c.lines.map((l) => ({ text: String(l.text ?? ""), start: Number(l.start) || 0, end: Number(l.end) || 0 }));
        saveStructureDoc(abletonProject, structureDoc);
        broadcastState();
      }
      // Compute song-bounded ends on the FULL structure (so each clip stops at its own song),
      // then keep only the labels of the song the user is editing: the editor is per-song and
      // must not rewrite the other songs' clips.
      const allItems = withClipEnds(effectiveStructure().map((l) => ({ s: l.start, t: l.text })));
      const items = c.scope
        ? allItems.filter((it) => it.s >= c.scope!.start - 1e-6 && it.s < c.scope!.end - 1e-6)
        : allItems;
      log(`writeStructureClips: ${items.length}/${allItems.length} labels${c.scope ? ` (current song, beats ${c.scope.start.toFixed(1)}–${c.scope.end.toFixed(1)})` : " (all songs)"}, guide=${settings.guideAudioEnabled && !!c.guide}`);
      if (!items.length) { toast("error", tr("host.structure.nolabels")); break; }
      bridge.send(ADDR.cmdWriteStructure, [JSON.stringify(items)]); // each item carries its `e` (song-bounded end)
      if (settings.guideAudioEnabled && c.guide) writeGuideClips(items);
      break;
    }
    case "generateGuideFromTrack": {
      // Read a track's named clips from Ableton (STRUCTURE by default, or c.track) and generate the
      // audio guide for the WHOLE project from them — no re-typing labels in the editor.
      if (!bridgeConnected) { toast("error", tr("host.structure.noableton")); break; }
      if (bridgeVersion > 0 && bridgeVersion < 60) { toast("error", tr("host.structure.oldbridge")); break; }
      if (!armTrackRead({ mode: "guide" })) { toast("info", tr("host.stt.busy")); break; }
      log(`generateGuideFromTrack: reading track="${c.track || "(structure)"}" from Ableton`);
      bridge.send(ADDR.cmdReadClips, [String(c.track ?? "")]);
      toast("info", tr("host.guide.reading"));
      break;
    }
    case "transcribeStructureFromTrack": {
      // Read an audio track's clips, transcribe each clip's audio (Azure STT), match to a structure
      // label, and write the markers onto the STRUCTURE track (whole project).
      if (!bridgeConnected) { toast("error", tr("host.structure.noableton")); break; }
      if (bridgeVersion > 0 && bridgeVersion < 61) { toast("error", tr("host.structure.oldbridge")); break; }
      if (!armTrackRead({ mode: "stt", locale: String(c.locale ?? "it-IT") })) { toast("info", tr("host.stt.busy")); break; }
      log(`transcribeStructureFromTrack: reading track="${c.track || "(structure)"}" (locale=${c.locale || "it-IT"})`);
      bridge.send(ADDR.cmdReadClips, [String(c.track ?? "")]);
      toast("info", tr("host.stt.reading"));
      break;
    }
    case "setStructureLabels":
      settings.structureLabels = Array.from(new Set((c.labels || []).map((l) => String(l).trim()).filter(Boolean))).slice(0, 64);
      changed();
      refreshGuideAudio(); // new labels may match different files
      break;
    case "play": {
      // PLAY plays the song SHOWN in the UI. If the playhead is already inside that song
      // — at its start (just navigated) OR at a rehearsal seek point set by clicking the
      // progress bar — we trust the bridge's selected position. Only when the playhead
      // has drifted OUTSIDE the shown song do we force it onto the song's start.
      const i = mgr.currentEntry;
      const s = mgr.songOf(i);
      if (s) {
        const end = s.endBeat ?? Number.POSITIVE_INFINITY;
        const inside = transport.time >= s.startBeat - 0.5 && transport.time < end - 0.05;
        if (!inside) bridge.send(ADDR.cmdJumpToTime, [s.startBeat]);
        mgr.setCurrentEntry(i); // re-arm the reconciliation guard
      }
      bridge.send(ADDR.cmdPlay);
      startClickIfSet();
      break;
    }
    case "pause":
      if (settings.stopInsteadOfPause) stopToMedleyStart();
      else bridge.send(ADDR.cmdPause);
      break;
    case "stop": stopToMedleyStart(); break; // medley -> first song; else current song. NEVER MIDI
    case "panic":
      // PULL UP: stop first, then fire the note a moment LATER so the transport has
      // settled — a monitored track then reliably hears it every time (no more
      // "once yes once no"). The note is independent of the stop.
      stopToSongStart();
      setTimeout(firePanicNote, 150);
      break;
    case "seek": bridge.send(ADDR.cmdJumpToTime, [c.beat]); break; // click the bar to set a start point
    case "setShortcut": settings.shortcuts[c.action] = c.key; changed(); break;
    case "setPedal": settings.pedals[c.action] = c.key; changed(); break;
    case "refresh": bridge.send(ADDR.cmdRefresh); break;
    case "next": if (!navBlocked) { const n = mgr.nextActiveAfter(mgr.currentEntry); if (n >= 0) userJumpToEntry(n); } break;
    case "prev":
      if (!navBlocked) {
        const cur = mgr.currentEntry;
        const s = mgr.songOf(cur);
        if (settings.restartBeforeJumpBack && transport.isPlaying && s && transport.time > s.startBeat + 2) {
          userJumpToEntry(cur); // restart the current song first
        } else {
          const p = mgr.prevActiveBefore(cur < 0 ? mgr.entries.length : cur);
          // Going back INTO a medley lands on the medley's first entry (not its last sub-song);
          // medleyStartEntry returns p unchanged for a normal song. Matches stop's behaviour.
          if (p >= 0) userJumpToEntry(mgr.medleyStartEntry(p));
        }
      }
      break;
    case "jumpToEntry": if (!navBlocked) userJumpToEntry(c.index); break;
    case "reorder": mgr.reorder(c.from, c.to); changed(); break;
    case "moveBlock": mgr.moveBlock(c.from, c.count, c.to); changed(); break;
    case "setActive": mgr.setActive(c.index, c.active); changed(); break;
    case "toggleLink": mgr.toggleLink(c.index); changed(); break;
    case "setEntryColor": mgr.setEntryColor(c.index, c.color); changed(); break;
    case "autoColorSetlist": mgr.autoColor(settings.setlistColorScheme || "rainbow"); changed(); break;
    case "addSong": mgr.addSong(c.libIndex, c.at); changed(); break;
    case "clear": mgr.clear(); changed(); break;
    case "addAll": mgr.addAll(); changed(); break;
    case "resetToTimeline":
      mgr.resetToTimeline(); // back to timeline order; entries unlinked, medleysAreAuto = true
      if (settings.splitMedleysOnImport) mgr.medleysAreAuto = false; // honor "split medleys" → keep them separate
      else mgr.autoDetectMedleys(); // otherwise derive medleys from the `/` locators now
      if (settings.colorOnImport) mgr.autoColor(settings.setlistColorScheme || "rainbow"); // honor "color"
      currentSetlistName = "";
      changed();
      break;
    case "sortAZ": mgr.sortAZ(); changed(); break;
    case "saveSetlist":
      saveSetlist(c.name, mgr.serialize());
      savedSetlists = listSetlists();
      bumpRecent(c.name);
      currentSetlistName = c.name;
      toast("info", tr("host.setlist.saved", { name: c.name }));
      broadcastState();
      break;
    case "editSetlistFile": {
      const orig = importOriginalPath(c.name); // the real source (.docx/.pdf/.txt) we imported from
      if (orig) { openInDefaultApp(orig); watchOriginalForReimport(c.name, orig); } // edit in Word + auto re-import on save
      else openWithPicker(setlistPath(c.name)); // no original (pasted/manual) → the .json, chooser
      break;
    }
    case "reimportSetlist": doReimport(c.name); break;
    case "removeRecent":
      recentSetlists = recentSetlists.filter((n) => n !== c.name);
      saveRecents(recentSetlists);
      broadcastState();
      break;
    case "clearRecents":
      recentSetlists = [];
      saveRecents(recentSetlists);
      broadcastState();
      break;
    case "deleteSetlist":
      deleteSetlist(c.name);
      savedSetlists = listSetlists();
      recentSetlists = recentSetlists.filter((n) => n !== c.name);
      saveRecents(recentSetlists);
      broadcastState();
      break;
    case "clearSetlists":
      clearSetlists();
      savedSetlists = listSetlists();
      recentSetlists = [];
      saveRecents(recentSetlists);
      broadcastState();
      break;
    case "loadSetlist": {
      const items = loadSetlist(c.name);
      if (items) {
        const r = mgr.restoreFromSession(items);
        mgr.medleysAreAuto = false; // a loaded setlist carries its own medleys
        ensureColoredIfSet(); // colour it on load if "colour on import" is on and it has no colours
        bumpRecent(c.name);
        currentSetlistName = c.name;
        toast("info", tr("host.setlist.loaded", { name: c.name, matched: r.matched, total: r.total }));
        changed();
        server.broadcastMessage({ type: "importResult", result: { matched: r.matched, total: r.total, unmatched: [] } });
      } else {
        toast("error", tr("host.setlist.notFound", { name: c.name }));
      }
      break;
    }
    case "importText": {
      const r = mgr.applyTitles(textToTitles(c.text), !settings.splitMedleysOnImport);
      if (r.matched) { if (settings.colorOnImport) mgr.autoColor(settings.setlistColorScheme || "rainbow"); rememberImport(); }
      toast(r.matched ? "info" : "error", tr("host.import.result", { matched: r.matched, total: r.total, extra: r.unmatched.length ? tr("host.import.result.extra", { u: r.unmatched.length }) : "" }));
      changed();
      server.broadcastMessage({ type: "importResult", result: r });
      break;
    }
    case "importFile":
      extractText(c.filename, c.dataBase64)
        .then((text) => {
          const r = mgr.applyTitles(textToTitles(text), !settings.splitMedleysOnImport);
          if (r.matched) {
            if (settings.colorOnImport) mgr.autoColor(settings.setlistColorScheme || "rainbow");
            rememberImport(c.filename);
            saveImportOriginal(currentSetlistName, c.filename, c.dataBase64); // keep the source for edit / re-import
          }
          toast(r.matched ? "info" : "error", tr("host.import.file", { file: c.filename, matched: r.matched, total: r.total }));
          changed();
          server.broadcastMessage({ type: "importResult", result: r });
        })
        .catch((e: Error) => toast("error", tr("host.import.failed", { msg: e.message })));
      break;
    case "colorizeAbleton": colorizeAbleton(); break;
    case "cleanProjectClips": cleanProjectClips(); break;
    case "writeKeysToMarkers": writeKeysToMarkers(); break;
    case "setMetronome": bridge.send(ADDR.cmdMetronome, [c.on ? 1 : 0]); break;
    case "refreshBluetooth": refreshBT(); break;
    case "openBluetoothSettings": openBluetoothSettings(); break;
    case "setPluginRules":
      settings.pluginRules = (c.rules || []).map((r) => ({
        id: String(r.id ?? ""),
        track: String(r.track ?? ""),
        device: String(r.device ?? ""),
        onWhilePlaying: Boolean(r.onWhilePlaying),
      }));
      applyPluginAutomation(transport.isPlaying, true); // apply the new rules now, don't wait for a transition
      changed();
      break;
    case "setVoicePresets":
      settings.voicePresets = (c.presets || []).map((p) => ({
        name: String(p.name ?? ""),
        engine: p.engine === "azure" ? "azure" : "piper",
        voiceId: String(p.voiceId ?? ""),
        speed: Number(p.speed) || 1,
        expr: Number(p.expr ?? 0.667),
        pitch: Number(p.pitch) || 0,
      }));
      changed();
      break;
    case "downloadTtsVoice":
      void downloadTtsVoice(String(c.voiceId));
      break;
    case "previewTtsVoice":
      void previewTtsVoice(client, c.text);
      break;
    case "refreshAzureVoices":
      void refreshAzureVoices();
      break;
    case "clearLogs":
      logs = [];
      broadcastState();
      break;
    case "setSetting":
      applySetting(c.key, c.value);
      if (c.key === "stopTrack" || c.key === "stopNote") sendStopConfig(); // re-read with the new track/note
      if (c.key === "lyricsTrack") sendLyricsConfig(); // re-read lyrics from the new track
      if (c.key === "structureTrack") sendStructureConfig(); // re-read the structure from the new track
      if (c.key === "guideAudioFolder") refreshGuideAudio(); // re-scan + re-match the announcement files
      if (c.key === "azureKey" || c.key === "azureRegion") void refreshAzureVoices(); // re-fetch premium voices
      if (c.key === "automationEnabled") applyPluginAutomation(transport.isPlaying, true); // enforce on toggle
      if (c.key === "demoMode") applyDemo(); // honour the toggle (only effective when licensed)
      if (c.key === "licenseKey") {
        if (settings.licenseKey) {
          void activateOnline(settings.licenseKey); // register this device online + store the token
        } else {
          settings.activationToken = ""; activationState = ""; // key cleared -> drop activation, back to demo
          applyDemo();
        }
      }
      changed();
      break;
  }
};

// ---- Lifecycle ---------------------------------------------------------------------
// All runtime side effects live in startHost() so the Electron wrapper can boot the host
// AFTER setting ABLEJAM_DATA_DIR / ABLEJAM_WEB_DIST, and tear it down cleanly on quit.
// Run standalone (tsx src/index.ts / pnpm start / pnpm live), the guard at the bottom of
// the file calls it — preserving the original behaviour exactly.
let scanId: ReturnType<typeof setInterval> | undefined;
let btId: ReturnType<typeof setInterval> | undefined;
let audioId: ReturnType<typeof setInterval> | undefined;
let abletonId: ReturnType<typeof setInterval> | undefined;
let lyricsWatcher: FSWatcher | undefined;

export function startHost(): { ready: Promise<void>; close: () => Promise<void> } {
  lyricsWatcher = watchLyricsImport(); // drop-in lyrics file watcher (capturable for teardown)

  scanId = setInterval(() => {
    const c = bridge.isConnected();
    if (c !== bridgeConnected) {
      bridgeConnected = c;
      if (c) refreshAbleton(); // bridge just connected -> read the open Set name promptly
      broadcastState();
    }
    // Re-scan MIDI ports so a freshly-installed loopMIDI appears without a restart.
    const ports = listOutputs();
    if (ports.length !== midiOutPorts.length || ports.some((p, i) => p !== midiOutPorts[i])) {
      midiOutPorts = ports;
      broadcastState();
    }
  }, 1000);

  // ready resolves the instant the HTTP+WS listener is accepting on :3700 — the Electron
  // wrapper awaits this before pointing its window at http://127.0.0.1:3700 (race-free).
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  server.listen(() => resolveReady());
  if (lanIp) console.log(`[host] tablet/iPad (stessa WiFi) -> apri  http://${lanIp}:${PORTS.http}  (dopo 'pnpm build:web')`);
  bridge.send(ADDR.cmdRefresh);
  refreshBT();
  btId = setInterval(refreshBT, 20000); // keep the connected-Bluetooth list fresh
  refreshGuideAudio(); // scan the announcement audio (bundled or custom folder) once at boot
  void refreshAzureVoices(); // repopulate the Azure voice list from the SAVED key+region (the cache is
  //                            runtime-only, so without this a restart leaves "no voice" despite a saved key)
  refreshAudio();
  audioId = setInterval(refreshAudio, 5000); // watch the audio interface so a disconnect alerts fast
  refreshAbleton();
  abletonId = setInterval(refreshAbleton, 3000); // fast enough that the unsaved "*" clears right after a save
  applyDemo(); // enforce licensing (unlicensed -> locked to demo) + restore the demo toggle across restarts
  console.log("[host] AbleJam host started — waiting for the bridge (Ableton or mock)...");

  return { ready, close };
}

/** Release everything startHost() acquired: the 4 timers, the lyrics + edit watchers, the
 * cached MIDI out port, the UDP socket (39062) and the http+ws listener (3700). Called by
 * the Electron wrapper before quit so a relaunch never hits a held port. */
async function close(): Promise<void> {
  if (scanId) { clearInterval(scanId); scanId = undefined; }
  if (btId) { clearInterval(btId); btId = undefined; }
  if (audioId) { clearInterval(audioId); audioId = undefined; }
  if (abletonId) { clearInterval(abletonId); abletonId = undefined; }
  try { lyricsWatcher?.close(); } catch { /* ignore */ }
  lyricsWatcher = undefined;
  stopEditWatch();
  try { closeOutput(); } catch { /* ignore */ }
  try { bridge.close(); } catch { /* ignore */ }
  await server.close();
}

// Standalone run (tsx src/index.ts / pnpm start / pnpm live / pnpm dev:host): boot directly.
// Skipped when imported as a module — the Electron main process calls startHost() itself.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHost();
}
