// AbleJam shared protocol — browser-safe (no Node Buffer here).
// The OSC wire codec lives in ./osc (host-only, uses Node Buffer).
import { parseLocator, type Flag } from "./notation";
import type { Lang } from "./i18n";

export * from "./notation";
export * from "./match";
export * from "./i18n";

export const PORTS = {
  bridgeRecv: 39061,
  hostRecv: 39062,
  http: 3700,
} as const;

/** Master switch for the licensing/activation gate. While FALSE the app never locks to demo
 * and the Activation settings card is hidden — the verification code + UI ship dormant. Flip to
 * TRUE only once the store is live (so buyers can actually get a key). */
export const LICENSING_ENABLED = false;

export const ADDR = {
  hello: "/ablejam/hello",
  setlist: "/ablejam/setlist",
  tracks: "/ablejam/tracks",
  midiTracks: "/ablejam/miditracks",
  stopPoints: "/ablejam/stoppoints",
  stopDiag: "/ablejam/stopdiag",
  colorized: "/ablejam/colorized",
  cleaned: "/ablejam/cleaned",
  beat: "/ablejam/beat",
  renamed: "/ablejam/renamed",
  autotuneDiag: "/ablejam/autotunediag",
  lyrics: "/ablejam/lyrics",
  lyricsWrite: "/ablejam/lyricswrite",
  midiStop: "/ablejam/midistop",
  transport: "/ablejam/transport",
  cmdPlay: "/ablejam/cmd/play",
  cmdPause: "/ablejam/cmd/pause",
  cmdStop: "/ablejam/cmd/stop",
  cmdJumpToTime: "/ablejam/cmd/jumpToTime",
  cmdStopToStart: "/ablejam/cmd/stopToStart",
  cmdSetSelected: "/ablejam/cmd/setSelected",
  cmdStopConfig: "/ablejam/cmd/stopConfig",
  cmdLyricsConfig: "/ablejam/cmd/lyricsConfig",
  cmdRenameLyrics: "/ablejam/cmd/renameLyrics",
  cmdWriteLyrics: "/ablejam/cmd/writeLyrics",
  cmdColorize: "/ablejam/cmd/colorize",
  cmdCleanClips: "/ablejam/cmd/cleanClips",
  cmdRenameCues: "/ablejam/cmd/renameCues",
  cmdMetronome: "/ablejam/cmd/metronome",
  cmdArmStop: "/ablejam/cmd/armStop",
  cmdFireClip: "/ablejam/cmd/fireClip",
  cmdSendNote: "/ablejam/cmd/sendNote",
  cmdReenableAutomation: "/ablejam/cmd/reenableAutomation",
  cmdRefresh: "/ablejam/cmd/refresh",
} as const;

export interface Section {
  title: string;
  startBeat: number;
  kind: "section" | "quickSection";
  color: string | null;
  description: string | null;
  flags: Flag[];
  transitionTarget: string | null;
}

/** One lyrics line = one arrangement clip on the lyrics track. Times are absolute arrangement
 * beats (same frame as Transport.time), so the active line is `start ≤ time < end`. */
export interface LyricLine {
  text: string;
  start: number;
  end: number;
}

export interface Song {
  title: string;
  /** Musical key from the marker name, e.g. "Am" ("" = none). */
  key: string;
  startBeat: number;
  endBeat: number | null;
  durationSec: number | null;
  color: string | null;
  description: string | null;
  tags: string[];
  isSong: boolean;
  stopAfter: boolean;
  /** This song flows into the next without stopping (medley) — set when the NEXT locator
   * has a `-` prefix. Drives the auto-medley detection at load. */
  continuesNext: boolean;
  sections: Section[];
}

/** One position in the performance setlist, referencing a library song. */
export interface SetlistEntry {
  libIndex: number;
  active: boolean;
  /** Medley: play continuously into the next entry (no stop between). */
  linkedNext: boolean;
  /** Musical key parsed from an imported setlist, e.g. "Am" (display only). */
  key: string;
  /** Per-entry colour override ("#rrggbb") for the setlist/performance UI. Falls back to
   * the song's locator colour when unset. Set manually or by the medley-aware auto-colour. */
  color?: string;
}

export interface Transport {
  isPlaying: boolean;
  time: number;
  tempo: number;
  sigNumerator: number;
  sigDenominator: number;
  /** Live's metronome (click) on/off — toggled from AbleJam, reflected live. */
  metronome: boolean;
  /** Library index of the song under the playhead (timeline), or -1. */
  currentSongIndex: number;
  currentSectionIndex: number;
}

/** Keyboard shortcuts for transport actions. Values are KeyboardEvent.key (e.g.
 * "ArrowLeft", " ", "s"); "" = unset. */
export interface ShortcutMap {
  prev: string;
  play: string;
  stop: string;
  next: string;
  panic: string;
}

export interface Settings {
  /** Selecting a song starts playback immediately. */
  autoplay: boolean;
  /** At song end, continue into the next song instead of stopping + queuing. */
  autoContinue: boolean;
  /** Always stop at the end of every song (overrides per-song / autoContinue). */
  alwaysStop: boolean;
  /** Prev restarts the current song first (media-player style) before jumping back. */
  restartBeforeJumpBack: boolean;
  /** Play/Pause acts as Stop (from the top) instead of pause/resume. */
  stopInsteadOfPause: boolean;
  /** Block song jumps while playing; require double-stop. */
  safeMode: boolean;
  /** Re-enable Live automation at the start of every song (keeps e.g. autotune in key). */
  reenableAutomationOnSongStart: boolean;
  /** On Stop, send a MIDI note (panic) — like a connected MIDI keyboard. */
  emergencyEnabled: boolean;
  /** MIDI note sent on Stop, e.g. 51. */
  emergencyNote: number;
  /** MIDI output port the host sends the panic note to. "" = automatic
   * (prefers a loopMIDI-style port, else the first available). */
  emergencyPort: string;
  /** Label shown on the panic button (default "PULL UP"; e.g. "PANIC"). */
  panicLabel: string;
  /** Colour of the panic button ("#rrggbb"). */
  panicColor: string;
  /** Name of the Ableton MIDI track whose notes mark where each song must auto-stop.
   * "" = automatic (the first track with "stop" in its name). */
  stopTrack: string;
  /** MIDI note (pitch) that counts as a stop on the stop track. -1 = any note. */
  stopNote: number;
  /** Name of the Ableton track whose arrangement clips hold the lyrics (one clip per line).
   * "" = automatic (the first track with "lyrics" in its name). */
  lyricsTrack: string;
  /** Colour scheme for the "colora brani" features: "contrast" | "rainbow" | "warm-cold"
   * | "random". "contrast" makes adjacent songs maximally distinct (golden-angle hue). */
  colorScheme: string;
  /** Keyboard shortcuts for transport actions. */
  shortcuts: ShortcutMap;
  /** Bluetooth foot-pedal mapping (keyboard-mode pedals send keys). Independent of
   * `shortcuts`, so a key and a pedal can both trigger the same action. */
  pedals: ShortcutMap;
  /** Interface language ("it" | "en"). */
  language: Lang;
  /** Colour scheme for auto-colouring the SETLIST entries (independent of the Ableton-clip
   * scheme `colorScheme`): "rainbow" | "contrast" | "warm-cold" | "random". */
  setlistColorScheme: string;
  /** On import, keep each song as its own numbered entry instead of collapsing "/"-joined
   * parts into one medley row. */
  splitMedleysOnImport: boolean;
  /** On import, auto-colour the setlist songs (using `setlistColorScheme`). */
  colorOnImport: boolean;
  /** Show the current wall-clock time in the top bar (handy for musicians during a live). */
  showClock: boolean;
  /** Turn Live's metronome (click) ON every time playback starts. */
  clickOnAtStart: boolean;
  /** Turn Live's metronome (click) ON once, when AbleJam starts up and connects to the bridge. */
  clickOnStartup: boolean;
  /** How medleys are shown in the NORMAL setlist view: "joined" = one collapsed row, or
   * "split" = each song on its own row (grouped). Edit mode always shows them split. */
  medleyDisplay: string;
  /** Metronome visual on the CLICK button: "off", "blink" (flash each beat, 2&4 stronger),
   * or "bars" (vertical bars fill in sequence per beat). Client-rendered. */
  clickIndicator: string;
  /** Demo mode: drive the app with a fictional setlist + a simulated playhead (no Ableton
   * needed), so new users can practice and see how everything works. */
  demoMode: boolean;
  /** License key (signed by ablejam.com). Empty / invalid = unlicensed → the app is locked to
   * the demo setlist (it won't drive real Ableton) until a valid key is entered. */
  licenseKey: string;
}

export const defaultSettings: Settings = {
  autoplay: false,
  autoContinue: false,
  alwaysStop: false,
  restartBeforeJumpBack: true,
  stopInsteadOfPause: false,
  safeMode: false,
  reenableAutomationOnSongStart: false,
  emergencyEnabled: false,
  emergencyNote: 36,
  emergencyPort: "",
  panicLabel: "PULL UP",
  panicColor: "#e01e1e",
  stopTrack: "",
  stopNote: -1,
  lyricsTrack: "LYRICS",
  colorScheme: "rainbow",
  shortcuts: { prev: "", play: "", stop: "", next: "", panic: "" },
  pedals: { prev: "", play: "", stop: "", next: "", panic: "" },
  language: "it",
  setlistColorScheme: "rainbow",
  splitMedleysOnImport: true,
  colorOnImport: true,
  showClock: false,
  clickOnAtStart: false,
  clickOnStartup: false,
  medleyDisplay: "split",
  clickIndicator: "off",
  demoMode: false,
  licenseKey: "",
};

/** A colour ("#rrggbb") for item `i` of `n` under a scheme. "contrast" (default) uses the
 * golden angle so adjacent items are maximally distinct; "random" varies with `nonce`. */
export function schemeHex(scheme: string, i: number, n: number, nonce = 0): string {
  const frac = (x: number) => x - Math.floor(x);
  let h: number;
  if (scheme === "rainbow") h = n > 1 ? (i / n) * 0.92 : 0;
  else if (scheme === "warm-cold") h = n > 1 ? (i / n) * 0.66 : 0;
  else if (scheme === "random") h = frac(Math.sin((i + 1 + nonce * 7.3) * 12.9898) * 43758.5453);
  else h = frac((i + nonce) * 0.61803398875); // "contrast" — golden-angle hue
  const s = 0.62, l = 0.52;
  const k = (x: number) => (x + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (x: number) => l - a * Math.max(-1, Math.min(k(x) - 3, Math.min(9 - k(x), 1)));
  const ch = (x: number) => Math.round(255 * f(x)).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(8)}${ch(4)}`;
}

export interface AppState {
  bridgeConnected: boolean;
  /** Version of the Ableton control surface currently loaded (0 = none yet). */
  bridgeVersion: number;
  /** Full repertoire, parsed from locators, timeline order. */
  library: Song[];
  /** Performance order (reorderable, removable). */
  setlist: SetlistEntry[];
  /** Index into `setlist` of the active position, or -1. */
  currentEntryIndex: number;
  transport: Transport;
  settings: Settings;
  savedSetlists: string[];
  /** Recently loaded/saved setlists, most-recent first (quick reload). */
  recentSetlists: string[];
  /** Ableton track names (for the emergency-sample track selector). */
  tracks: string[];
  /** Ableton MIDI track names (for the stop-track selector). */
  midiTracks: string[];
  /** MIDI output ports the host can send the panic note to (Plan B). */
  midiOutPorts: string[];
  /** The host machine's LAN IP, so a tablet on the same WiFi can open AbleJam (""=unknown). */
  lanIp: string;
  /** Arrangement beats of the MIDI "stop" notes read from the STOP track (diagnostic). */
  stopPoints: number[];
  /** Raw STOP-clip reading values (clipStart/startMarker/note0/beat) — debug only. */
  stopDiag: string;
  /** Names of the Bluetooth peripherals currently connected to the host machine. */
  bluetooth: string[];
  /** Name of the Ableton Live Set currently open (from the app window title; "" = unknown). */
  abletonProject: string;
  /** Ableton edition + version in use, e.g. "Ableton Live 12 Suite (12.2)" ("" = unknown). */
  abletonVersion: string;
  /** Name of the currently loaded/saved/imported setlist ("" = raw timeline order). */
  currentSetlistName: string;
  /** Recent names that have a stored original import file (so "edit" opens it / it can be re-imported). */
  recentOriginals: string[];
  /** Whether the editor has undoable / redoable history (drives the ↶/↷ buttons). */
  canUndo: boolean;
  canRedo: boolean;
  /** Operator cue broadcast to the STAGE view(s) — a free message ("LAST CHORUS"). "" = none. */
  stageMessage: string;
  /** Lyrics lines: the AbleJam-edited document if there is one, else read from the track's clips. */
  lyrics: LyricLine[];
  /** True when `lyrics` is an AbleJam-edited document (timing recorded in AbleJam), not raw clips. */
  lyricsEdited: boolean;
  /** True when a valid license key is stored — the full version is unlocked. When false the app
   * is locked to the demo setlist. */
  licensed: boolean;
  /** Email the stored license is registered to ("" when unlicensed). */
  licenseEmail: string;
}

export const initialTransport: Transport = {
  isPlaying: false,
  time: 0,
  tempo: 120,
  sigNumerator: 4,
  sigDenominator: 4,
  metronome: false,
  currentSongIndex: -1,
  currentSectionIndex: -1,
};

export const initialState: AppState = {
  bridgeConnected: false,
  bridgeVersion: 0,
  library: [],
  setlist: [],
  currentEntryIndex: -1,
  transport: initialTransport,
  settings: defaultSettings,
  savedSetlists: [],
  recentSetlists: [],
  tracks: [],
  midiTracks: [],
  midiOutPorts: [],
  lanIp: "",
  stopPoints: [],
  stopDiag: "",
  bluetooth: [],
  abletonProject: "",
  abletonVersion: "",
  currentSetlistName: "",
  recentOriginals: [],
  canUndo: false,
  canRedo: false,
  stageMessage: "",
  lyrics: [],
  lyricsEdited: false,
  licensed: false,
  licenseEmail: "",
};

export interface ImportResult {
  matched: number;
  total: number;
  unmatched: string[];
}

export type ServerMessage =
  | { type: "state"; state: AppState }
  | { type: "transport"; transport: Transport; currentEntryIndex: number; bridgeConnected: boolean }
  | { type: "beat"; beat: number } // 0-based beat-in-bar from Live, for the CLICK metronome visual
  | { type: "toast"; level: "info" | "error"; message: string }
  | { type: "importResult"; result: ImportResult };

export type ClientCommand =
  | { type: "command"; command: "play" | "pause" | "stop" | "next" | "prev" | "refresh" | "panic" }
  | { type: "command"; command: "seek"; beat: number }
  | { type: "command"; command: "setShortcut"; action: keyof ShortcutMap; key: string }
  | { type: "command"; command: "setPedal"; action: keyof ShortcutMap; key: string }
  | { type: "command"; command: "jumpToEntry"; index: number }
  | { type: "command"; command: "reorder"; from: number; to: number }
  | { type: "command"; command: "moveBlock"; from: number; count: number; to: number }
  | { type: "command"; command: "setActive"; index: number; active: boolean }
  | { type: "command"; command: "addSong"; libIndex: number; at?: number }
  | { type: "command"; command: "clear" }
  | { type: "command"; command: "addAll" }
  | { type: "command"; command: "resetToTimeline" }
  | { type: "command"; command: "sortAZ" }
  | { type: "command"; command: "undo" }
  | { type: "command"; command: "redo" }
  | { type: "command"; command: "setStageMessage"; text: string }
  | { type: "command"; command: "setLyrics"; lines: LyricLine[] }
  | { type: "command"; command: "clearLyrics" }
  | { type: "command"; command: "writeLyricsClips"; lines: LyricLine[] }
  | { type: "command"; command: "saveSetlist"; name: string }
  | { type: "command"; command: "loadSetlist"; name: string }
  | { type: "command"; command: "editSetlistFile"; name: string }
  | { type: "command"; command: "reimportSetlist"; name: string }
  | { type: "command"; command: "removeRecent"; name: string }
  | { type: "command"; command: "clearRecents" }
  | { type: "command"; command: "deleteSetlist"; name: string }
  | { type: "command"; command: "clearSetlists" }
  | { type: "command"; command: "importText"; text: string }
  | { type: "command"; command: "importFile"; filename: string; dataBase64: string }
  | { type: "command"; command: "toggleLink"; index: number }
  | { type: "command"; command: "colorizeAbleton" }
  | { type: "command"; command: "cleanProjectClips" }
  | { type: "command"; command: "writeKeysToMarkers" }
  | { type: "command"; command: "setEntryColor"; index: number; color: string }
  | { type: "command"; command: "autoColorSetlist" }
  | { type: "command"; command: "setMetronome"; on: boolean }
  | { type: "command"; command: "refreshBluetooth" }
  | { type: "command"; command: "openBluetoothSettings" }
  | { type: "command"; command: "setSetting"; key: keyof Settings; value: boolean | string | number };

// ---- setlist model builders (pure) ----

export interface RawCue {
  name: string;
  time: number;
}

/** Build the song library from raw locators. */
export function buildSetlist(cues: RawCue[], tempo: number): Song[] {
  const sorted = [...cues]
    .sort((a, b) => a.time - b.time)
    .map((c) => ({ time: c.time, p: parseLocator(c.name) }));

  const songs: Song[] = [];
  let cur: Song | null = null;

  for (const { time, p } of sorted) {
    if (p.ignored) continue;
    if (p.marker === "songEnd" || p.marker === "stop") {
      if (cur && cur.endBeat == null) cur.endBeat = time;
      if (cur && p.marker === "stop") cur.stopAfter = true;
      continue;
    }
    if (p.section) {
      if (cur) {
        cur.sections.push({
          title: p.title,
          startBeat: time,
          kind: p.section,
          color: p.color,
          description: p.description,
          flags: p.flags,
          transitionTarget: p.transitionTarget,
        });
      }
      continue;
    }
    if (p.dotPrefix && cur) cur.stopAfter = true;
    if (p.medleyPrefix && cur) cur.continuesNext = true; // the PREVIOUS song flows into this one
    cur = {
      title: p.title || "(senza nome)",
      key: p.key ?? "",
      startBeat: time,
      endBeat: null,
      durationSec: p.durationSec,
      color: p.color,
      description: p.description,
      tags: p.tags,
      isSong: !p.nosong,
      stopAfter: false,
      continuesNext: p.medleyNext, // trailing `/` on THIS locator -> continues into the next
      sections: [],
    };
    songs.push(cur);
  }

  for (let i = 0; i < songs.length; i++) {
    const s = songs[i]!;
    if (s.endBeat == null) {
      const next = songs[i + 1];
      if (next) s.endBeat = next.startBeat;
    }
    if (s.durationSec == null && s.endBeat != null && tempo > 0) {
      s.durationSec = ((s.endBeat - s.startBeat) * 60) / tempo;
    }
  }

  return songs;
}

/** Locate the current song + section in the library for a playhead position. */
export function locateCurrent(songs: Song[], time: number): { songIndex: number; sectionIndex: number } {
  let songIndex = -1;
  for (let i = 0; i < songs.length; i++) {
    if (songs[i]!.startBeat <= time + 1e-6) songIndex = i;
    else break;
  }
  let sectionIndex = -1;
  const s = songs[songIndex];
  if (s) {
    for (let j = 0; j < s.sections.length; j++) {
      if (s.sections[j]!.startBeat <= time + 1e-6) sectionIndex = j;
      else break;
    }
  }
  return { songIndex, sectionIndex };
}
