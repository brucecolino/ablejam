import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { translate, bestMatch, type AppState, type ClientCommand, type ImportResult, type Lang, type LyricLine, type Settings, type SetlistEntry, type ShortcutMap, type Song } from "@ablejam/shared";
import { useAbleJam, type Toast, type Beat } from "./ws";
import { formatDuration, formatClock, colorOf } from "./format";

type View = "setlist" | "performance" | "stage";
type Panel = "none" | "import" | "load" | "print";
type Send = (c: ClientCommand) => void;
type TFn = (key: string, params?: Record<string, string | number>) => string;

declare const __APP_VERSION__: string; // injected by Vite from the desktop package version
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const SITE_URL = "https://ablejam.com"; // also ablejam.it
const SITE_LABEL = "ablejam.com";

// Interface language flows through context: the App sets it from settings, every component
// reads it with useT() and translates against the shared dictionary.
const LangCtx = createContext<Lang>("it");
const BeatCtx = createContext<Beat>({ inBar: -1, n: 0 }); // tight metronome beat from the bridge (CLICK visual)
function useT(): { lang: Lang; tr: TFn } {
  const lang = useContext(LangCtx);
  return { lang, tr: (key, params) => translate(lang, key, params) };
}

function songOf(state: AppState, entry: SetlistEntry | undefined): Song | undefined {
  return entry ? state.library[entry.libIndex] : undefined;
}
function nextActive(setlist: SetlistEntry[], from: number): number {
  for (let k = from + 1; k < setlist.length; k++) if (setlist[k]!.active) return k;
  return -1;
}
function beatsToSec(beats: number, tempo: number): number {
  return tempo > 0 ? (beats * 60) / tempo : 0;
}
/** Fraction 0..1 of the playhead within [start, end]; 0 when the playhead is OUTSIDE the
 * range — so a stale playhead during a navigation jump can't flash the bar full then empty. */
function rangeFrac(time: number, start: number, end: number): number {
  return end > start && time >= start && time <= end ? (time - start) / (end - start) : 0;
}
/** Performance title size that shrinks for long titles so they never dominate. */
function perfTitleFont(title: string): string {
  const len = title.length;
  if (len > 44) return "clamp(24px, 3vw, 44px)";
  if (len > 30) return "clamp(30px, 4vw, 60px)";
  if (len > 18) return "clamp(38px, 5.5vw, 82px)";
  return "clamp(46px, 7vw, 104px)";
}
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 2} (${n})`; // Ableton: C3 = 60
}
function keyName(key: string, tr: TFn): string {
  if (!key) return "—";
  const map: Record<string, string> = {
    " ": tr("key.space"), ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
    Enter: tr("key.enter"), Escape: tr("key.esc"), Backspace: "⌫", Tab: "Tab",
  };
  return map[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}
function ShortcutRow({ label, action, current, send, command = "setShortcut" }: { label: string; action: keyof ShortcutMap; current: string; send: Send; command?: "setShortcut" | "setPedal" }) {
  const { tr } = useT();
  const [listening, setListening] = useState(false);
  const isPedal = command === "setPedal";
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      send({ type: "command", command, action, key: e.key === "Escape" ? "" : e.key });
      setListening(false);
    };
    window.addEventListener("keydown", onKey, true); // capture, so the global handler is skipped
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, action, send, command]);
  return (
    <div className="setting">
      <span className="setting-text"><span className="setting-label">{label}</span></span>
      <button className={"shortcut-btn" + (listening ? " listening" : "")} onClick={() => setListening(true)}>
        {listening ? (isPedal ? tr("shortcut.pressPedal") : tr("shortcut.pressKey")) : keyName(current, tr)}
      </button>
    </div>
  );
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      res(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => rej(new Error("read error"));
    r.readAsDataURL(file);
  });
}

function BluetoothIcon({ size = 13 }: { size?: number }) {
  // Feather "bluetooth" glyph — the recognizable Bluetooth rune, drawn in the current colour.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" />
    </svg>
  );
}

// Small national flags (SVG) for the language picker.
function FlagIcon({ lang }: { lang: string }) {
  const c = { w: 26, h: 18 };
  if (lang === "it") return (
    <svg className="flag" width={c.w} height={c.h} viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#ce2b37" /></svg>
  );
  if (lang === "fr") return (
    <svg className="flag" width={c.w} height={c.h} viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#0055a4" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#ef4135" /></svg>
  );
  if (lang === "es") return (
    <svg className="flag" width={c.w} height={c.h} viewBox="0 0 4 3" aria-hidden="true"><rect width="4" height="3" fill="#aa151b" /><rect y="0.75" width="4" height="1.5" fill="#f1bf00" /></svg>
  );
  // en — simplified Union Jack
  return (
    <svg className="flag" width={c.w} height={c.h} viewBox="0 0 60 36" aria-hidden="true">
      <rect width="60" height="36" fill="#012169" />
      <path d="M0,0 60,36 M60,0 0,36" stroke="#fff" strokeWidth="7" />
      <path d="M0,0 60,36 M60,0 0,36" stroke="#c8102e" strokeWidth="4" />
      <path d="M30,0 V36 M0,18 H60" stroke="#fff" strokeWidth="11" />
      <path d="M30,0 V36 M0,18 H60" stroke="#c8102e" strokeWidth="6.5" />
    </svg>
  );
}

// One consistent stroke-icon set for the setlist action bar (same weight, round joins).
function ActionIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "edit" && <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />}
      {name === "done" && <polyline points="20 6 9 17 4 12" />}
      {name === "import" && <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>}
      {name === "save" && <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></>}
      {name === "open" && <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />}
      {name === "clock" && <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>}
      {name === "print" && <><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></>}
      {name === "reset" && <><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></>}
      {name === "eye" && <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>}
      {name === "color" && <path d="M12 2.7l5.66 5.65a8 8 0 1 1-11.32 0z" />}
      {name === "lock" && <><rect x="3.5" y="11" width="17" height="10.5" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>}
      {name === "unlock" && <><rect x="3.5" y="11" width="17" height="10.5" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1.2" /></>}
      {name === "undo" && <><polyline points="9 7 4 12 9 17" /><path d="M4 12h11a4 4 0 0 1 0 8h-2" /></>}
      {name === "redo" && <><polyline points="15 7 20 12 15 17" /><path d="M20 12H9a4 4 0 0 0 0 8h2" /></>}
      {name === "close" && <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>}
      {name === "play" && <polygon points="7 5 19 12 7 19" />}
      {name === "skip" && <><polygon points="6 5 16 12 6 19" /><line x1="19" y1="5" x2="19" y2="19" /></>}
      {name === "up" && <polyline points="6 14 12 8 18 14" />}
      {name === "down" && <polyline points="6 10 12 16 18 10" />}
      {name === "dup" && <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
    </svg>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return <span className="clock" title={now.toLocaleString()}>{hh}:{mm}</span>;
}

function RemoteChip({ ip }: { ip: string }) {
  const { tr } = useT();
  const port = typeof location !== "undefined" ? (location.port || "3700") : "3700";
  const url = `http://${ip}:${port}`;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  // Hidden by default to keep the bar tidy. The main button toggles the address on/off; when
  // shown, a separate copy icon sits beside it.
  const copy = () => { try { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* ignore */ } };
  return (
    <span className="remote-chip">
      <button className="remote-toggle" title={revealed ? tr("remote.hide.title") : tr("remote.show.title")} onClick={() => setRevealed((v) => !v)}>
        📱 {revealed ? `${ip}:${port}` : tr("remote.show.label")}
      </button>
      {revealed && (
        <button className="remote-copy" title={tr("remote.copy.title")} onClick={copy}>{copied ? "✓" : "📋"}</button>
      )}
    </span>
  );
}

function isView(v: string | null): v is View {
  return v === "setlist" || v === "performance" || v === "stage";
}
/** A dedicated display (teleprompter/HDMI) can pin a view and hide all chrome via the URL:
 *   ?view=stage&kiosk=1   (also ?display=kiosk). Otherwise we restore the last view per device. */
function readUrl(): { view: View | null; kiosk: boolean } {
  try {
    const p = new URLSearchParams(window.location.search);
    const v = p.get("view");
    return { view: isView(v) ? v : null, kiosk: p.get("kiosk") === "1" || p.get("display") === "kiosk" };
  } catch { return { view: null, kiosk: false }; }
}
const KIOSK = readUrl().kiosk;
function initialView(): View {
  const u = readUrl();
  if (u.view) return u.view;
  try { const s = localStorage.getItem("ablejam.view"); if (isView(s)) return s; } catch { /* ignore */ }
  return "setlist";
}

export function App() {
  const { state, toasts, importResult, clearImportResult, send, beat } = useAbleJam();
  const [view, setView] = useState<View>(initialView);
  useEffect(() => { try { localStorage.setItem("ablejam.view", view); } catch { /* ignore */ } }, [view]);
  const [edit, setEdit] = useState(false);
  const [panel, setPanel] = useState<Panel>("none");
  const [showSettings, setShowSettings] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const { bridgeConnected } = state;
  const lang = state.settings.language;
  const tr: TFn = (key, params) => translate(lang, key, params);

  // Global transport keyboard shortcuts. Disabled while typing in a field or while the
  // settings panel is open (so binding a key there doesn't also fire the action).
  const scRef = useRef<ShortcutMap>(state.settings.shortcuts);
  scRef.current = state.settings.shortcuts;
  const pedalRef = useRef<ShortcutMap>(state.settings.pedals);
  pedalRef.current = state.settings.pedals;
  const sendRef = useRef(send);
  sendRef.current = send;
  const settingsOpenRef = useRef(showSettings);
  settingsOpenRef.current = showSettings;
  const playingRef = useRef(state.transport.isPlaying);
  playingRef.current = state.transport.isPlaying;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || settingsOpenRef.current) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const sc = scRef.current;
      const pd = pedalRef.current;
      const k = e.key;
      // A keyboard shortcut OR a Bluetooth pedal mapped to the same action both fire it.
      const hit = (a: keyof ShortcutMap) => (sc[a] !== "" && k === sc[a]) || (pd[a] !== "" && k === pd[a]);
      let command: "prev" | "play" | "stop" | "next" | "panic" | null = null;
      // Play key is a play/stop toggle (Ableton-style): press to play, press again to stop.
      if (hit("play")) command = playingRef.current ? "stop" : "play";
      else if (hit("prev")) command = "prev";
      else if (hit("stop")) command = "stop";
      else if (hit("next")) command = "next";
      else if (hit("panic")) command = "panic";
      if (command) { e.preventDefault(); sendRef.current({ type: "command", command }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Quick-save the setlist with Ctrl/Cmd+S: overwrite the loaded preset, or prompt if none is loaded.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const onSave = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        const st = stateRef.current;
        const name = st.currentSetlistName || window.prompt(translate(st.settings.language, "save.prompt")) || "";
        if (name) sendRef.current({ type: "command", command: "saveSetlist", name });
      }
    };
    window.addEventListener("keydown", onSave);
    return () => window.removeEventListener("keydown", onSave);
  }, []);

  return (
    <LangCtx.Provider value={lang}>
    <BeatCtx.Provider value={beat}>
    <div className={"app" + (getBridge()?.platform === "darwin" ? " mac" : "") + (KIOSK ? " kiosk" : "")}>
      {!KIOSK && <header className="topbar">
        <span className="brand" title={`AbleJam v${APP_VERSION} · Bridge ${state.bridgeVersion ? tr("settings.bridge.connected", { n: state.bridgeVersion }) : tr("settings.bridge.disconnected")}`}>
          <img className="brand-mark" src="/logo-grid.svg" width={26} height={26} alt="" />
          <span className="brand-name">Able<span className="jam">Jam</span></span>
        </span>
        <nav className="tabs">
          <button className={view === "setlist" ? "tab on" : "tab"} onClick={() => setView("setlist")}>{tr("tab.setlist")}</button>
          <button className={view === "performance" ? "tab on" : "tab"} onClick={() => setView("performance")}>{tr("tab.performance")}</button>
          <button className={view === "stage" ? "tab on" : "tab"} onClick={() => setView("stage")}>{tr("tab.stage")}</button>
        </nav>
        <span className="status">
          {state.settings.showClock && <Clock />}
          <button className={"bt-chip" + (state.bluetooth.length ? " on" : "")}
            title={state.bluetooth.length ? tr("bt.connected.title", { list: state.bluetooth.join("\n• ") }) : tr("bt.none.title")}
            onClick={() => { send({ type: "command", command: "refreshBluetooth" }); send({ type: "command", command: "openBluetoothSettings" }); }}>
            <BluetoothIcon /> {state.bluetooth.length}
          </button>
          {state.lanIp && <RemoteChip ip={state.lanIp} />}
          <Dot ok={bridgeConnected} label="Live"
            title={state.abletonVersion ? (state.abletonProject ? `${tr("live.project")}: ${state.abletonProject}\n` : "") + state.abletonVersion : undefined} />
          <button className="gear" onClick={() => setShowInfo(true)} title={tr("info.title")} aria-label={tr("info.title")}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.5" x2="12.01" y2="7.5" /></svg>
          </button>
          <button className="gear" onClick={() => setShowSettings(true)} title={tr("gear.title")}>⚙</button>
        </span>
      </header>}

      <div className="body">
        {view === "setlist" && <SetlistView state={state} send={send} edit={edit} setEdit={setEdit} openPanel={setPanel} />}
        {view === "performance" && <PerformanceView state={state} send={send} />}
        {view === "stage" && <StageView state={state} send={send} kiosk={KIOSK} />}
        {view === "setlist" && <SongProgressBar state={state} />}
        {view === "setlist" && <TransportBar state={state} send={send} />}
      </div>

      {panel === "import" && <ImportPanel send={send} importResult={importResult} onClose={() => { setPanel("none"); clearImportResult(); }} />}
      {panel === "print" && <PrintView state={state} onClose={() => setPanel("none")} />}
      {showSettings && <SettingsPanel state={state} send={send} onClose={() => setShowSettings(false)} />}
      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}
      <Toasts toasts={toasts} />
    </div>
    </BeatCtx.Provider>
    </LangCtx.Provider>
  );
}

function SetlistView({ state, send, edit, setEdit, openPanel }: { state: AppState; send: Send; edit: boolean; setEdit: (b: boolean) => void; openPanel: (p: Panel) => void }) {
  const { tr } = useT();
  const { library, setlist, currentEntryIndex, transport } = state;
  const [drag, setDrag] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [medleysLocked, setMedleysLocked] = useState(true); // medley order is locked by default
  const [lyricsFor, setLyricsFor] = useState<number | null>(null); // entry index whose lyrics we're editing
  const songHasLyrics = (i: number) => {
    const e = setlist[i]; const sg = e ? library[e.libIndex] : undefined;
    if (!sg) return false;
    const end = sg.endBeat ?? sg.startBeat + 64;
    return state.lyrics.some((l) => l.start < end - 1e-6 && l.end > sg.startBeat + 1e-6);
  };

  // An entry "links into" the next when its SONG continues (marker "/") or it's manually linked.
  const linksInto = (k: number) => { const e = setlist[k]; const sg = e ? library[e.libIndex] : undefined; return !!(sg?.continuesNext || e?.linkedNext); };
  const inMedley = (i: number) => linksInto(i) || (i > 0 && linksInto(i - 1)); // entry is part of a medley chain
  const medleyGroup = (i: number): [number, number] => { let s = i, e = i; while (s > 0 && linksInto(s - 1)) s--; while (linksInto(e) && setlist[e + 1]) e++; return [s, e]; };
  // Normal view: "joined" collapses a medley into one row; otherwise (default "split") each song is
  // shown separately, grouped by the orange tint. Comparing to "joined" keeps split as the fallback.
  const joinMedleys = state.settings.medleyDisplay === "joined";

  // While dragging a LOCKED medley, the whole block (not just the grabbed row) shows as "dragging".
  const draggedBlock = drag != null && medleysLocked && inMedley(drag) ? medleyGroup(drag) : null;
  const isDragging = (k: number) => k === drag || (draggedBlock != null && k >= draggedBlock[0] && k <= draggedBlock[1]);

  // Ctrl/Cmd+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); send({ type: "command", command: "undo" }); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); send({ type: "command", command: "redo" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  const { activeCount, totalSec, trackCount } = useMemo(() => {
    let n = 0;
    let sec = 0;
    let tracks = 0; // medley group = one track (same grouping the rows use in the non-edit view)
    for (let i = 0; i < setlist.length; i++) {
      const e = setlist[i]!;
      if (!e.active) continue;
      n++;
      sec += library[e.libIndex]?.durationSec ?? 0;
      const prev = setlist[i - 1];
      const prevLinks = prev?.active && (library[prev.libIndex]?.continuesNext || prev.linkedNext);
      if (!prevLinks) tracks++;
    }
    return { activeCount: n, totalSec: sec, trackCount: tracks };
  }, [setlist, library]);

  // 1-based number per displayed row: per active entry in edit mode, per active medley group
  // (one number for the whole medley) in the normal/grouped view — like the printed setlist.
  const rowNumbers = useMemo(() => {
    const m = new Map<number, number>();
    let n = 0;
    if (edit) {
      setlist.forEach((e, i) => { if (e.active) m.set(i, ++n); });
    } else {
      for (let i = 0; i < setlist.length; i++) {
        if (!setlist[i]!.active) continue;
        const prev = setlist[i - 1];
        if (prev?.active && linksInto(i - 1)) continue; // a medley continuation shares its group's row
        m.set(i, ++n);
      }
    }
    return m;
  }, [setlist, edit, library]);

  const remainingSec = (() => {
    const s = songOf(state, setlist[currentEntryIndex]);
    return s && s.endBeat != null ? beatsToSec(s.endBeat - transport.time, transport.tempo) : null;
  })();

  const saveAs = () => {
    const name = window.prompt(tr("save.prompt"), state.currentSetlistName || "");
    if (name) send({ type: "command", command: "saveSetlist", name });
  };
  const saveOver = () => {
    if (state.currentSetlistName) send({ type: "command", command: "saveSetlist", name: state.currentSetlistName });
  };

  return (
    <main className="setlist">
      <div className="list-actions">
        <button className={"act" + (edit ? " on" : "")} title={edit ? tr("act.editDone") : tr("act.edit")} onClick={() => setEdit(!edit)}><ActionIcon name={edit ? "done" : "edit"} /></button>
        <button className="act" title={tr("act.import")} onClick={() => openPanel("import")}><ActionIcon name="import" /></button>
        <details className="savemenu">
          <summary className="act" title={tr("act.save")}><ActionIcon name="save" /></summary>
          <div className="save-menu" onClick={(e) => { const d = e.currentTarget.closest("details") as HTMLDetailsElement | null; if (d) d.open = false; }}>
            <button className="save-opt" disabled={!state.currentSetlistName} onClick={saveOver}>
              {tr("save.over")}
              {state.currentSetlistName && <span className="so-sub">{state.currentSetlistName}</span>}
            </button>
            <button className="save-opt" onClick={saveAs}>{tr("save.as")}</button>
          </div>
        </details>
        <details className="recents">
          <summary className="act" title={tr("act.recents.title")}><ActionIcon name="clock" /></summary>
          <div className="recents-menu" onClick={(e) => { const d = e.currentTarget.closest("details") as HTMLDetailsElement | null; if (d) d.open = false; }}>
            {state.recentSetlists.length === 0 ? (
              <div className="recents-empty">{tr("recents.empty")}</div>
            ) : (
              <>
                {state.recentSetlists.map((name) => (
                  <div key={name} className="recents-row">
                    <button className="recents-load" onClick={() => send({ type: "command", command: "loadSetlist", name })}>{name}</button>
                    <button className="recents-edit" title={tr("recents.edit")} onClick={() => send({ type: "command", command: "editSetlistFile", name })}><ActionIcon name="edit" /></button>
                    {state.recentOriginals.includes(name) && (
                      <button className="recents-edit" title={tr("recents.reimport")} onClick={() => send({ type: "command", command: "reimportSetlist", name })}><ActionIcon name="reset" /></button>
                    )}
                    <button className="recents-del" title={tr("recents.delete")} onClick={(e) => { e.stopPropagation(); send({ type: "command", command: "removeRecent", name }); }}>✕</button>
                  </div>
                ))}
                <button className="recents-clear" onClick={(e) => { e.stopPropagation(); send({ type: "command", command: "clearRecents" }); }}>{tr("recents.clear")}</button>
              </>
            )}
          </div>
        </details>
        <button className="act" onClick={() => openPanel("print")} title={tr("act.print.title")}><ActionIcon name="print" /></button>
        <button className="act" onClick={() => send({ type: "command", command: "resetToTimeline" })} title={tr("act.original.title")}><ActionIcon name="reset" /></button>
        {edit && <button className="act" disabled={!state.canUndo} onClick={() => send({ type: "command", command: "undo" })} title={tr("act.undo.title")}><ActionIcon name="undo" /></button>}
        {edit && <button className="act" disabled={!state.canRedo} onClick={() => send({ type: "command", command: "redo" })} title={tr("act.redo.title")}><ActionIcon name="redo" /></button>}
        {edit && <button className={"act" + (showRemoved ? " on" : "")} onClick={() => setShowRemoved(!showRemoved)} title={tr("act.removed.title")}><ActionIcon name="eye" /></button>}
        {edit && <button className="act" onClick={() => send({ type: "command", command: "autoColorSetlist" })} title={tr("act.autoColor.title")}><ActionIcon name="color" /></button>}
        {edit && <button className={"act" + (medleysLocked ? " on" : "")} onClick={() => setMedleysLocked(!medleysLocked)} title={medleysLocked ? tr("medley.lock.locked") : tr("medley.lock.unlocked")}><ActionIcon name={medleysLocked ? "lock" : "unlock"} /></button>}
        <span className="list-title">
          <button className="lt-set" onClick={saveAs} title={tr("list.saveTitle")}>
            <span className="lt-k">{tr("list.setlist")}</span>{state.currentSetlistName || tr("setlist.unknown")}
          </button>
          {state.abletonProject && <span className="lt-item"><span className="lt-k">{tr("list.project")}</span>{state.abletonProject}</span>}
        </span>
        <span className="count">{tr(trackCount < activeCount ? "count.songsTracks" : "count.songs", { n: activeCount, t: trackCount, clock: formatClock(totalSec) })}</span>
      </div>

      <div className={"rows" + (edit ? " editing" : "")}>
        {library.length === 0 && <p className="empty">{tr("empty.noSongs")}</p>}
        {setlist.map((entry, i) => {
          const song = library[entry.libIndex];
          if (!song) return null;
          if (!entry.active && (!edit || !showRemoved)) return null;

          // Non-edit: "joined" collapses a medley into ONE row (titles by " / "); "split" keeps each
          // song on its own row, grouped by an orange tint (the medley "lock" look, read-only here).
          if (!edit) {
            const prev = setlist[i - 1];
            if (joinMedleys && prev?.active && linksInto(i - 1)) return null; // a continuation — shown in its group's row
            const group: { e: typeof entry; idx: number }[] = [{ e: entry, idx: i }];
            if (joinMedleys) { let j = i; while (linksInto(j) && setlist[j + 1]?.active) { j++; group.push({ e: setlist[j]!, idx: j }); } }
            const isMedley = group.length > 1;
            const splitMedley = !joinMedleys && inMedley(i); // single song that belongs to a medley chain
            const isCur = group.some((g) => g.idx === currentEntryIndex);
            const joined = group.map((g) => { const sg = library[g.e.libIndex]; const ti = sg?.title ?? "—"; const k = sg?.key || g.e.key; return k ? `${ti} (${k})` : ti; }).join("  /  ");
            const totalDur = group.reduce((s, g) => s + (library[g.e.libIndex]?.durationSec ?? 0), 0);
            const rowColor = entry.color ?? colorOf(song.color);
            return (
              <div key={i} className={"row" + (isCur ? " current" : "") + (isMedley ? " medley-row" : "") + (splitMedley ? " medley-grouped" : "")}>
                <span className="row-num">{rowNumbers.get(i)}</span>
                <button className="row-main" onClick={() => send({ type: "command", command: "jumpToEntry", index: i })}>
                  <span className="row-text">
                    <span className="title" style={!isCur && rowColor ? { color: rowColor, fontWeight: 700 } : { fontWeight: 700 }}>{joined}</span>
                    {!isMedley && song.description && <span className="desc">{song.description}</span>}
                  </span>
                  {(isMedley || song.continuesNext) && <span className="medley-mark" title={isMedley ? tr("medley.oneRow.title") : tr("medley.continuesNext.title")}>⛓</span>}
                  <span className="dur">{isCur && remainingSec != null ? formatDuration(remainingSec) : formatDuration(totalDur)}</span>
                </button>
              </div>
            );
          }

          // Edit mode: one row per entry, with all the per-song controls.
          const isCur = i === currentEntryIndex;
          const rowColor = entry.color ?? colorOf(song.color);
          return (
            <div
              key={i}
              className={"row" + (isCur ? " current" : "") + (entry.active ? "" : " removed") + (isDragging(i) ? " dragging" : "") + (dragOver === i && !isDragging(i) ? " dragover" : "") + (linksInto(i) ? " linked-next" : "") + (linksInto(i - 1) ? " linked-prev" : "") + (medleysLocked && inMedley(i) ? " medley-locked" : "")}
              draggable={edit}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
                // Locked medley: drag a ghost of the WHOLE block, so the preview shows it moving as one.
                if (medleysLocked && inMedley(i)) {
                  const [gs, ge] = medleyGroup(i);
                  if (ge > gs) {
                    const ghost = document.createElement("div");
                    ghost.className = "drag-ghost";
                    for (let k = gs; k <= ge; k++) { const e2 = setlist[k]; const s2 = e2 ? library[e2.libIndex] : undefined; const ln = document.createElement("div"); ln.textContent = s2?.title ?? "—"; ghost.appendChild(ln); }
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 14, 14);
                    setTimeout(() => ghost.remove(), 0);
                  }
                }
              }}
              onDragOver={(e) => { if (edit && !(medleysLocked && i > 0 && linksInto(i - 1))) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(i); } }}
              onDrop={() => {
                if (drag != null && drag !== i) {
                  if (medleysLocked && inMedley(drag)) {
                    // a locked medley moves as ONE block; snap the target out of any medley it lands in
                    const [gs, ge] = medleyGroup(drag);
                    let to = i;
                    while (to > 0 && linksInto(to - 1)) to--;
                    if (to < gs || to > ge) send({ type: "command", command: "moveBlock", from: gs, count: ge - gs + 1, to });
                  } else if (!(medleysLocked && i > 0 && linksInto(i - 1))) {
                    send({ type: "command", command: "reorder", from: drag, to: i });
                  }
                }
                setDrag(null); setDragOver(null);
              }}
              onDragEnd={() => { setDrag(null); setDragOver(null); }}
            >
              <span className="row-num">{entry.active ? rowNumbers.get(i) : ""}</span>
              <span className="grip" title={tr("grip.title")}>⠿</span>
              <button className="rm" title={entry.active ? tr("row.remove") : tr("row.restore")} onClick={() => send({ type: "command", command: "setActive", index: i, active: !entry.active })}>
                {entry.active ? "✕" : "＋"}
              </button>
              <ColorPicker value={entry.color ?? "#888888"} onChange={(c) => send({ type: "command", command: "setEntryColor", index: i, color: c })} />
              <button className="row-main">
                <span className="row-text">
                  <span className="title" style={!isCur && rowColor ? { color: rowColor, fontWeight: 700 } : { fontWeight: 700 }}>{song.title}{(song.key || entry.key) && <span className="key"> · {song.key || entry.key}</span>}</span>
                  {song.description && <span className="desc">{song.description}</span>}
                </span>
                {inMedley(i) && (
                  <>
                    <span className="row-lock" title={medleysLocked ? tr("medley.locked.row") : undefined}>{medleysLocked ? <ActionIcon name="lock" /> : null}</span>
                    <span className="medley-mark" title={(entry.linkedNext || song.continuesNext) ? tr("medley.continuesNext.title") : undefined}>{(entry.linkedNext || song.continuesNext) ? "⛓" : null}</span>
                  </>
                )}
                <span className="dur">{formatDuration(song.durationSec)}</span>
              </button>
              {entry.active && (
                <button className={"link lyr-btn" + (songHasLyrics(i) ? " on" : "")} title={songHasLyrics(i) ? tr("row.lyrics.edit") : tr("row.lyrics.add")} onClick={() => setLyricsFor(i)}>♪</button>
              )}
              {entry.active && (
                <button className={"link" + (entry.linkedNext ? " on" : "")} title={tr("medley.linkToggle.title")} onClick={() => send({ type: "command", command: "toggleLink", index: i })}>🔗</button>
              )}
            </div>
          );
        })}
      </div>

      {lyricsFor != null && <LyricsEditor state={state} send={send} entryIndex={lyricsFor} onClose={() => setLyricsFor(null)} />}
    </main>
  );
}


function ImportPanel({ send, importResult, onClose }: { send: Send; importResult: ImportResult | null; onClose: () => void }) {
  const { tr } = useT();
  const [text, setText] = useState("");
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const dataBase64 = await fileToBase64(f);
    send({ type: "command", command: "importFile", filename: f.name, dataBase64 });
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tr("import.title")}</h3>
        <p className="hint">{tr("import.hint")}</p>
        <textarea className="import-text" rows={8} placeholder={"One Love\nBuffalo Soldier\nGet Up Stand Up\n…"} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="modal-actions">
          <label className="filebtn">
            {tr("import.loadFile")}
            <input type="file" accept=".txt,.pdf,.docx,text/plain" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <span className="spacer" />
          <button onClick={onClose}>{tr("common.close")}</button>
          <button className="primary" disabled={!text.trim()} onClick={() => send({ type: "command", command: "importText", text })}>{tr("import.importText")}</button>
        </div>

        {importResult && (
          <div className="import-result">
            <div className="ir-summary">{tr("import.result.summary", { matched: importResult.matched, total: importResult.total })}</div>
            {importResult.unmatched.length > 0 ? (
              <>
                <div className="ir-title">{tr("import.result.unmatched", { n: importResult.unmatched.length })}</div>
                <ul className="ir-list">
                  {importResult.unmatched.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="ir-ok">{tr("import.result.allOk")}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadPanel({ state, send, onClose }: { state: AppState; send: Send; onClose: () => void }) {
  const { tr } = useT();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tr("load.title")}</h3>
        {state.savedSetlists.length === 0 && <p className="hint">{tr("load.none")}</p>}
        <div className="saved-list">
          {state.savedSetlists.map((name) => (
            <div key={name} className="saved-row">
              <button className="saved-load" onClick={() => { send({ type: "command", command: "loadSetlist", name }); onClose(); }}>{name}</button>
              <button className="saved-act" title={tr("recents.edit")} onClick={() => send({ type: "command", command: "editSetlistFile", name })}><ActionIcon name="edit" /></button>
              <button className="saved-act saved-del" title={tr("load.delete")} onClick={() => { if (confirm(tr("load.deleteConfirm", { name }))) send({ type: "command", command: "deleteSetlist", name }); }}>✕</button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          {state.savedSetlists.length > 0 && <button className="danger" onClick={() => { if (confirm(tr("load.clearConfirm"))) send({ type: "command", command: "clearSetlists" }); }}>{tr("load.clear")}</button>}
          <span className="spacer" />
          <button onClick={onClose}>{tr("common.close")}</button>
        </div>
      </div>
    </div>
  );
}

const INFO_SECTIONS = ["intro", "markers", "stops", "bridge", "midi", "main", "lyrics", "stage", "views", "presets", "print", "secondary", "trouble", "updates"];
function InfoPanel({ onClose }: { onClose: () => void }) {
  const { tr } = useT();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3>{tr("info.title")}</h3>
          <button className="settings-close" onClick={onClose} title={tr("common.close")}>✕</button>
        </div>
        <div className="info-body">
          {INFO_SECTIONS.map((k) => (
            <section key={k} className="info-section">
              <h4>{tr("info." + k + ".h")}</h4>
              <p>{tr("info." + k + ".b")}</p>
            </section>
          ))}
          <section className="info-section info-contact">
            <h4>{tr("info.contact.h")}</h4>
            <p>{tr("info.contact.b")}</p>
            <div className="info-links">
              <a className="info-mail" href="mailto:support@ablejam.com">support@ablejam.com</a>
              <a className="info-mail info-web" href={SITE_URL} target="_blank" rel="noopener noreferrer">{SITE_LABEL}</a>
            </div>
          </section>
        </div>
        <div className="settings-version">AbleJam v{APP_VERSION}</div>
      </div>
    </div>
  );
}

interface UpdateCheck { current: string; latest: string; available: boolean; notes: string; assetName: string | null; platform: string; noAsset: boolean }
interface UpdateProgress { pct: number; mb: number; total: number }
interface AbleJamBridge {
  platform?: string;
  version: () => Promise<string>;
  installBridge?: () => Promise<void>;
  checkUpdate?: () => Promise<UpdateCheck>;
  installUpdate?: () => Promise<{ ok: boolean; error?: string }>;
  onUpdateProgress?: (cb: (p: UpdateProgress) => void) => () => void;
}
function getBridge(): AbleJamBridge | undefined {
  return typeof window !== "undefined" ? (window as unknown as { ablejam?: AbleJamBridge }).ablejam : undefined;
}

/** Settings → Updates. Only rendered inside the desktop app (the preload exposes
 * window.ablejam); on a phone/tablet browser there's no preload, so this is hidden. */
function UpdatesCard() {
  const { tr } = useT();
  const api = getBridge();
  const [ver, setVer] = useState("");
  const [info, setInfo] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "install">("");
  const [prog, setProg] = useState<UpdateProgress | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api?.version().then(setVer).catch(() => {}); }, [api]);
  if (!api?.checkUpdate) return null;
  const check = async () => {
    setBusy("check"); setMsg(""); setInfo(null);
    try { setInfo(await api.checkUpdate!()); } catch { setMsg(tr("update.error")); }
    setBusy("");
  };
  const install = async () => {
    setBusy("install"); setMsg(""); setProg(null);
    const off = api.onUpdateProgress?.((p) => setProg(p));
    try { const r = await api.installUpdate!(); if (!r?.ok) setMsg(tr("update.error")); } catch { setMsg(tr("update.error")); }
    off?.(); setProg(null); setBusy("");
  };
  return (
    <section className="settings-card">
      <div className="settings-section">{tr("settings.section.updates")}</div>
      <div className="settings-desc-small">{tr("update.current", { v: ver || info?.current || "—" })}</div>
      {info && (
        <div style={{ fontWeight: 700, margin: "4px 0 10px", color: info.available ? "var(--accent)" : "var(--text-muted)" }}>
          {info.available ? tr("update.available", { v: info.latest }) : tr("update.uptodate", { v: info.latest })}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="settings-btn" style={{ marginTop: 0 }} disabled={busy !== ""} onClick={check}>{busy === "check" ? tr("update.checking") : tr("update.check")}</button>
        {info?.available && <button className="settings-btn" style={{ marginTop: 0 }} disabled={busy !== ""} onClick={install}>⬇ {busy === "install" ? tr("update.installing") : tr("update.install")}</button>}
      </div>
      {busy === "install" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 7, borderRadius: 999, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: (prog?.pct ?? 0) + "%", background: "var(--accent)", transition: "width 0.2s linear" }} />
          </div>
          <div className="settings-desc-small" style={{ marginTop: 4 }}>{prog ? `${prog.pct}% · ${prog.mb}/${prog.total} MB` : tr("update.installing")}</div>
        </div>
      )}
      {info?.available && info.platform === "darwin" && <div className="settings-desc-small" style={{ marginTop: 8 }}>{tr("update.macNote")}</div>}
      {msg && <div className="settings-desc-small" style={{ color: "#d66", marginTop: 8 }}>{msg}</div>}
    </section>
  );
}

function SettingsPanel({ state, send, onClose }: { state: AppState; send: Send; onClose: () => void }) {
  const { tr } = useT();
  const s = state.settings;
  const productParts = tr("settings.product").split("APICE"); // APICE rendered as a styled brand span
  const [showStopDetails, setShowStopDetails] = useState(false);
  const setBool = (key: keyof Settings, v: boolean) => send({ type: "command", command: "setSetting", key, value: v });
  // Lyrics backup: download the whole project's lyrics (text + timing) to a JSON file, and
  // restore it later (after an update, or on another computer) — survives data-dir changes.
  const exportLyrics = () => {
    const proj = (state.abletonProject || "ablejam").replace(/[^\w.-]+/g, "_") || "ablejam";
    const blob = new Blob([JSON.stringify(state.lyrics)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ablejam-lyrics-${proj}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importLyricsBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(reader.result)); } catch { return; }
      const lines = (Array.isArray(parsed) ? parsed : []).map((l) => ({ text: String((l as { text?: unknown })?.text ?? ""), start: Number((l as { start?: unknown })?.start) || 0, end: Number((l as { end?: unknown })?.end) || 0 }));
      if (lines.length && confirm(tr("lyrics.import.confirm"))) send({ type: "command", command: "setLyrics", lines });
    };
    reader.readAsText(file);
  };
  const row = (k: keyof Settings, labelKey: string, descKey: string) => (
    <label className="setting" key={k}>
      <input type="checkbox" checked={Boolean(s[k])} onChange={(e) => setBool(k, e.target.checked)} />
      <span className="setting-text">
        <span className="setting-label">{tr(labelKey)}</span>
        <span className="setting-desc">{tr(descKey)}</span>
      </span>
    </label>
  );
  const t = state.transport;
  const bpb = t.sigNumerator > 0 && t.sigDenominator > 0 ? (t.sigNumerator * 4) / t.sigDenominator : 4;
  const bar = (beat: number) => Math.round(beat / bpb) + 1;
  const pts = state.stopPoints;
  const stopRows = pts.map((p) => ({ p, song: state.library.find((sg) => sg.startBeat - 1e-6 <= p && (sg.endBeat == null || p < sg.endBeat + 1e-6)) }));
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h3>{tr("settings.title")}</h3>
          <button className="settings-close" onClick={onClose} title={tr("common.close")}>✕</button>
        </div>
        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.playback")}</div>
            {row("autoplay", "set.autoplay.label", "set.autoplay.desc")}
            {row("autoContinue", "set.autoContinue.label", "set.autoContinue.desc")}
            {row("alwaysStop", "set.alwaysStop.label", "set.alwaysStop.desc")}
            {row("restartBeforeJumpBack", "set.restartBeforeJumpBack.label", "set.restartBeforeJumpBack.desc")}
            {row("stopInsteadOfPause", "set.stopInsteadOfPause.label", "set.stopInsteadOfPause.desc")}
            {row("safeMode", "set.safeMode.label", "set.safeMode.desc")}
            {row("reenableAutomationOnSongStart", "set.reenableAutomation.label", "set.reenableAutomation.desc")}
            {row("showClock", "set.showClock.label", "set.showClock.desc")}
            {row("clickOnStartup", "set.clickOnStartup.label", "set.clickOnStartup.desc")}
            {row("clickOnAtStart", "set.clickOnAtStart.label", "set.clickOnAtStart.desc")}
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("set.medleyDisplay.label")}</span>
                <span className="setting-desc">{tr("set.medleyDisplay.desc")}</span>
              </span>
              <select className="setting-select" value={s.medleyDisplay} onChange={(e) => send({ type: "command", command: "setSetting", key: "medleyDisplay", value: e.target.value })}>
                <option value="joined">{tr("medleyDisplay.joined")}</option>
                <option value="split">{tr("medleyDisplay.split")}</option>
              </select>
            </label>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("set.clickIndicator.label")}</span>
                <span className="setting-desc">{tr("set.clickIndicator.desc")}</span>
              </span>
              <select className="setting-select" value={s.clickIndicator} onChange={(e) => send({ type: "command", command: "setSetting", key: "clickIndicator", value: e.target.value })}>
                <option value="off">{tr("clickIndicator.off")}</option>
                <option value="blink">{tr("clickIndicator.blink")}</option>
                <option value="bars">{tr("clickIndicator.bars")}</option>
              </select>
            </label>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.lyrics")}</div>
            <div className="settings-desc-small">{tr("settings.lyrics.desc")}</div>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("set.lyricsTrack.label")}</span>
                <span className="setting-desc">{tr("set.lyricsTrack.desc")}</span>
              </span>
              <select className="setting-select" value={s.lyricsTrack} onChange={(e) => send({ type: "command", command: "setSetting", key: "lyricsTrack", value: e.target.value })}>
                <option value="">{tr("set.lyricsTrack.auto")}</option>
                {state.tracks.map((tk) => <option key={tk} value={tk}>{tk}</option>)}
              </select>
            </label>
            <div className="stop-diag-head">
              <span style={{ color: state.lyrics.length ? "var(--accent)" : "#d66", fontWeight: 700 }}>{state.lyrics.length ? tr("lyrics.diag.read", { n: state.lyrics.length }) : tr("lyrics.diag.none")}</span>
              <button className="settings-btn" onClick={() => send({ type: "command", command: "refresh" })}><ActionIcon name="reset" /> {tr("stop.diag.reread")}</button>
            </div>
            <div className="settings-desc-small">{tr("lyricsImport.desc")}</div>
            <button className="settings-btn" onClick={() => { if (confirm(tr("lyricsImport.confirm"))) send({ type: "command", command: "writeLyricsClips", lines: state.lyrics }); }}>✚ {tr("lyricsImport.btn")}</button>
            <div className="settings-desc-small" style={{ marginTop: 12 }}>{tr("lyrics.backup.desc")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="settings-btn" disabled={!state.lyrics.length} onClick={exportLyrics}>⬇ {tr("lyrics.export.btn")}</button>
              <label className="settings-btn" style={{ cursor: "pointer" }}>⬆ {tr("lyrics.import.btn")}
                <input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importLyricsBackup(f); e.currentTarget.value = ""; }} />
              </label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.stop")}</div>
            <div className="settings-desc-small">{tr("settings.stop.desc")}</div>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("set.stopTrack.label")}</span>
                <span className="setting-desc">{tr("set.stopTrack.desc")}</span>
              </span>
              <select className="setting-select" value={s.stopTrack} onChange={(e) => send({ type: "command", command: "setSetting", key: "stopTrack", value: e.target.value })}>
                <option value="">{tr("set.stopTrack.auto")}</option>
                {(state.midiTracks.length ? state.midiTracks : state.tracks).map((tk) => (
                  <option key={tk} value={tk}>{tk}</option>
                ))}
              </select>
            </label>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("set.stopNote.label")}</span>
                <span className="setting-desc">{tr("set.stopNote.desc")}</span>
              </span>
              <select className="setting-select" value={s.stopNote} onChange={(e) => send({ type: "command", command: "setSetting", key: "stopNote", value: Number(e.target.value) })}>
                <option value={-1}>{tr("set.stopNote.any")}</option>
                {Array.from({ length: 128 }, (_, n) => (
                  <option key={n} value={n}>{noteName(n)}</option>
                ))}
              </select>
            </label>
            <div className="stop-diag">
              <div className="stop-diag-head">
                <span style={{ color: pts.length ? "var(--accent)" : "#d66", fontWeight: 700 }}>{pts.length ? tr("stop.diag.read", { n: pts.length }) : tr("stop.diag.none")}</span>
                {pts.length > 0 && (
                  <label className="stop-diag-toggle"><input type="checkbox" checked={showStopDetails} onChange={(e) => setShowStopDetails(e.target.checked)} /> {tr("stop.diag.details")}</label>
                )}
                <button className="settings-btn" onClick={() => send({ type: "command", command: "refresh" })}><ActionIcon name="reset" /> {tr("stop.diag.reread")}</button>
              </div>
              {!pts.length && <div style={{ fontSize: 12, color: "#d66" }}>{tr("stop.diag.hint", { cur: s.stopNote >= 0 ? tr("stop.diag.hint.cur", { note: noteName(s.stopNote) }) : "" })}</div>}
              {pts.length > 0 && showStopDetails && (
                <div className="stop-diag-list">
                  {stopRows.map((r, i) => (
                    <div key={i}>• bar <b>{bar(r.p)}</b> → {r.song ? <>«{r.song.title}» (bar {bar(r.song.startBeat)}–{r.song.endBeat != null ? bar(r.song.endBeat) : "?"})</> : <span style={{ color: "#d66" }}>{tr("stop.diag.outside")}</span>}</div>
                  ))}
                  {state.stopDiag && <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>debug: {state.stopDiag}</div>}
                </div>
              )}
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.colorSongs")}</div>
            <div className="settings-desc-small">{tr("colorSongs.desc")}</div>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("set.colorScheme.label")}</span>
                <span className="setting-desc">{tr("set.colorScheme.desc")}</span>
              </span>
              <select className="setting-select" value={s.colorScheme} onChange={(e) => send({ type: "command", command: "setSetting", key: "colorScheme", value: e.target.value })}>
                <option value="rainbow">{tr("colorScheme.rainbow")}</option>
                <option value="contrast">{tr("colorScheme.contrast")}</option>
                <option value="warm-cold">{tr("colorScheme.warmCold")}</option>
                <option value="random">{tr("colorScheme.random")}</option>
              </select>
            </label>
            <button className="settings-btn" onClick={() => send({ type: "command", command: "colorizeAbleton" })}>{tr("colorSongs.btn")}</button>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.setlistColors")}</div>
            <div className="settings-desc-small">{tr("setlistColors.desc")}</div>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("set.colorScheme.label")}</span>
                <span className="setting-desc">{tr("set.colorScheme.desc")}</span>
              </span>
              <select className="setting-select" value={s.setlistColorScheme} onChange={(e) => send({ type: "command", command: "setSetting", key: "setlistColorScheme", value: e.target.value })}>
                <option value="rainbow">{tr("colorScheme.rainbow")}</option>
                <option value="contrast">{tr("colorScheme.contrast")}</option>
                <option value="warm-cold">{tr("colorScheme.warmCold")}</option>
                <option value="random">{tr("colorScheme.random")}</option>
              </select>
            </label>
            <button className="settings-btn" onClick={() => send({ type: "command", command: "autoColorSetlist" })}>{tr("setlistColors.btn")}</button>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.project")}</div>
            <div className="settings-desc-small">{tr("project.clean.desc")}</div>
            <button className="settings-btn" onClick={() => { if (confirm(tr("project.clean.confirm"))) send({ type: "command", command: "cleanProjectClips" }); }}>{tr("project.clean.btn")}</button>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.import")}</div>
            {row("splitMedleysOnImport", "set.splitMedleys.label", "set.splitMedleys.desc")}
            {row("colorOnImport", "set.colorOnImport.label", "set.colorOnImport.desc")}
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.panic")}</div>
            <div className="settings-desc-small">{tr("panic.desc")}</div>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("panic.name.label")}</span>
                <span className="setting-desc">{tr("panic.name.desc")}</span>
              </span>
              <input className="setting-select" style={{ maxWidth: 150 }} value={s.panicLabel} placeholder="PULL UP" onChange={(e) => send({ type: "command", command: "setSetting", key: "panicLabel", value: e.target.value })} />
            </label>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("panic.color.label")}</span>
                <span className="setting-desc">{tr("panic.color.desc")}</span>
              </span>
              <ColorPicker value={s.panicColor || "#e01e1e"} onChange={(c) => send({ type: "command", command: "setSetting", key: "panicColor", value: c })} />
            </label>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("panic.note.label")}</span>
                <span className="setting-desc">{tr("panic.note.desc")}</span>
              </span>
              <select className="setting-select" value={s.emergencyNote} onChange={(e) => send({ type: "command", command: "setSetting", key: "emergencyNote", value: Number(e.target.value) })}>
                {Array.from({ length: 128 }, (_, n) => (
                  <option key={n} value={n}>{noteName(n)}</option>
                ))}
              </select>
            </label>
            <label className="setting">
              <span className="setting-text">
                <span className="setting-label">{tr("panic.port.label")}</span>
                <span className="setting-desc">{tr("panic.port.desc")}</span>
              </span>
              <select className="setting-select" value={s.emergencyPort} onChange={(e) => send({ type: "command", command: "setSetting", key: "emergencyPort", value: e.target.value })}>
                <option value="">{tr("common.automatic")}</option>
                {state.midiOutPorts.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.shortcuts")}</div>
            <div className="settings-desc-small">{tr("shortcuts.desc")}</div>
            <ShortcutRow label={tr("action.prev")} action="prev" current={s.shortcuts.prev} send={send} />
            <ShortcutRow label={tr("action.play")} action="play" current={s.shortcuts.play} send={send} />
            <ShortcutRow label={tr("action.stop")} action="stop" current={s.shortcuts.stop} send={send} />
            <ShortcutRow label={tr("action.next")} action="next" current={s.shortcuts.next} send={send} />
            <ShortcutRow label={s.panicLabel || "PULL UP"} action="panic" current={s.shortcuts.panic} send={send} />
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.pedals")}</div>
            <div className="settings-desc-small">{tr("pedals.desc.a")}<b>{tr("pedals.desc.b")}</b>{tr("pedals.desc.c")}</div>
            <ShortcutRow label={tr("action.prev")} action="prev" current={s.pedals.prev} send={send} command="setPedal" />
            <ShortcutRow label={tr("action.play")} action="play" current={s.pedals.play} send={send} command="setPedal" />
            <ShortcutRow label={tr("action.stop")} action="stop" current={s.pedals.stop} send={send} command="setPedal" />
            <ShortcutRow label={tr("action.next")} action="next" current={s.pedals.next} send={send} command="setPedal" />
            <ShortcutRow label={s.panicLabel || "PULL UP"} action="panic" current={s.pedals.panic} send={send} command="setPedal" />
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.bluetooth")}</div>
            <div className="settings-desc-small">{tr("bluetooth.desc")}</div>
            {state.bluetooth.length
              ? <ul className="bt-list">{state.bluetooth.map((d) => <li key={d}><BluetoothIcon /> {d}</li>)}</ul>
              : <div className="settings-desc-small">{tr("bluetooth.none")}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button className="settings-btn" onClick={() => send({ type: "command", command: "refreshBluetooth" })}><ActionIcon name="reset" /> {tr("bluetooth.refresh")}</button>
              <button className="settings-btn" onClick={() => send({ type: "command", command: "openBluetoothSettings" })}>{tr("bluetooth.openSettings")}</button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.tablet")}</div>
            <div className="settings-desc-small">{tr("tablet.desc")}</div>
            {state.lanIp
              ? <div className="lan-url">http://{state.lanIp}:{typeof location !== "undefined" ? (location.port || "3700") : "3700"}</div>
              : <div className="settings-desc-small">{tr("tablet.noIp")}</div>}
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.demo")}</div>
            <div className="settings-desc-small">{tr("demo.desc")}</div>
            {row("demoMode", "set.demoMode.label", "set.demoMode.desc")}
          </section>

          <section className="settings-card">
            <div className="settings-section">{tr("settings.section.language")}</div>
            <div className="settings-desc-small">{tr("language.desc")}</div>
            <div className="lang-row">
              {([["it", "Italiano"], ["en", "English"], ["es", "Español"], ["fr", "Français"]] as const).map(([code, name]) => (
                <button key={code} className={"lang-btn" + (s.language === code ? " on" : "")} onClick={() => send({ type: "command", command: "setSetting", key: "language", value: code })}>
                  <FlagIcon lang={code} /><span>{name}</span>
                </button>
              ))}
            </div>
          </section>
          <UpdatesCard />
        </div>
        <div className="settings-version">AbleJam v{APP_VERSION}</div>
        <a className="settings-web" href={SITE_URL} target="_blank" rel="noopener noreferrer">{SITE_LABEL}</a>
        <div className="settings-product">{productParts[0]}<span className="apice">APICE</span>{productParts[1]}</div>
      </div>
    </div>
  );
}

interface PrintItem { num: number; isMedley: boolean; songs: { title: string; key: string; color: string | null }[] }
function buildPrintItems(state: AppState, groupMedley: boolean): PrintItem[] {
  const { setlist, library } = state;
  const items: PrintItem[] = [];
  let num = 1;
  const info = (idx: number) => {
    const e = setlist[idx]!; const lib = library[e.libIndex];
    return { title: lib?.title ?? "—", key: lib?.key || e.key, color: e.color ?? colorOf(lib?.color) ?? null };
  };
  // A song flows into the next via the Ableton "/" marker (continuesNext) OR a manual link (linkedNext).
  // Group on TIMELINE adjacency (iterate the full setlist; a removed song between two actives breaks the
  // chain) — exactly like the on-screen non-edit numbering, so the printout matches the app.
  const links = (idx: number) => !!(library[setlist[idx]!.libIndex]?.continuesNext || setlist[idx]!.linkedNext);
  for (let i = 0; i < setlist.length; i++) {
    if (!setlist[i]!.active) continue;
    const group = [i];
    if (groupMedley) { let j = i; while (links(j) && setlist[j + 1]?.active) { j++; group.push(j); } i = j; }
    const songs = group.map(info);
    items.push({ num, isMedley: songs.length > 1, songs });
    num++;
  }
  return items;
}

// Per-device print preferences (medley grouping, title size, colours, keys, tags) — persisted locally.
type PrintCfg = { groupMedley: boolean; titleSize: "auto" | "s" | "m" | "l" | "xl"; colors: boolean; showKeys: boolean; showTags: boolean };
const PRINT_DEFAULT: PrintCfg = { groupMedley: true, titleSize: "auto", colors: false, showKeys: true, showTags: true };
function usePrintConfig(): [PrintCfg, (c: PrintCfg) => void] {
  const [cfg, setCfg] = useState<PrintCfg>(() => {
    try { const raw = localStorage.getItem("ablejam.print.v1"); if (raw) return { ...PRINT_DEFAULT, ...(JSON.parse(raw) as Partial<PrintCfg>) }; } catch { /* ignore */ }
    return PRINT_DEFAULT;
  });
  const update = (c: PrintCfg) => { setCfg(c); try { localStorage.setItem("ablejam.print.v1", JSON.stringify(c)); } catch { /* ignore */ } };
  return [cfg, update];
}
const PRINT_SIZES: Record<Exclude<PrintCfg["titleSize"], "auto">, number> = { s: 13, m: 16, l: 20, xl: 24 };

function PrintView({ state, onClose }: { state: AppState; onClose: () => void }) {
  const { lang, tr } = useT();
  const [pc, setPc] = usePrintConfig();
  const items = useMemo(() => buildPrintItems(state, pc.groupMedley), [state, pc.groupMedley]);
  const autoSize = items.length > 30 ? 13 : items.length > 22 ? 15 : items.length > 14 ? 17 : 20;
  const fontSize = pc.titleSize === "auto" ? autoSize : PRINT_SIZES[pc.titleSize];
  const today = new Date().toLocaleDateString(lang === "en" ? "en-GB" : "it-IT");
  const [band, setBand] = useState(() => localStorage.getItem("ablejam.band") ?? "");
  const [evt, setEvt] = useState(() => localStorage.getItem("ablejam.event") ?? "");
  useEffect(() => { localStorage.setItem("ablejam.band", band); }, [band]);
  useEffect(() => { localStorage.setItem("ablejam.event", evt); }, [evt]);
  return (
    <div className="overlay print-overlay" onClick={onClose}>
      <div className="print-modal" onClick={(e) => e.stopPropagation()}>
        <div className="print-toolbar no-print">
          <input className="print-input" placeholder={tr("print.band")} value={band} onChange={(e) => setBand(e.target.value)} />
          <input className="print-input" placeholder={tr("print.event")} value={evt} onChange={(e) => setEvt(e.target.value)} />
          <span className="spacer" />
          <button className="primary" onClick={() => window.print()}>{tr("print.print")}</button>
          <button onClick={onClose}>{tr("common.close")}</button>
        </div>
        <div className="print-opts no-print">
          <span className="po-head">{tr("print.opts")}</span>
          <button className={"po-chip" + (pc.groupMedley ? " on" : "")} onClick={() => setPc({ ...pc, groupMedley: !pc.groupMedley })}>{tr("print.opt.groupMedley")}</button>
          <label className="po-field">{tr("print.opt.size")}
            <select className="po-select" value={pc.titleSize} onChange={(e) => setPc({ ...pc, titleSize: e.target.value as PrintCfg["titleSize"] })}>
              <option value="auto">{tr("print.size.auto")}</option>
              <option value="s">S</option><option value="m">M</option><option value="l">L</option><option value="xl">XL</option>
            </select>
          </label>
          <button className={"po-chip" + (pc.colors ? " on" : "")} onClick={() => setPc({ ...pc, colors: !pc.colors })}>{tr("print.opt.colors")}</button>
          <button className={"po-chip" + (pc.showKeys ? " on" : "")} onClick={() => setPc({ ...pc, showKeys: !pc.showKeys })}>{tr("print.opt.keys")}</button>
          <button className={"po-chip" + (pc.showTags ? " on" : "")} onClick={() => setPc({ ...pc, showTags: !pc.showTags })}>{tr("print.opt.tags")}</button>
        </div>
        <div className={"print-page" + (pc.colors ? " colored" : "")} style={{ fontSize }}>
          <div className="print-head">
            <div className="print-head-l">
              <h1>{band.trim() || tr("print.defaultTitle")}</h1>
              {evt.trim() && <div className="print-event">{evt}</div>}
            </div>
            <span className="print-meta">{tr("print.entries", { n: items.length, unit: tr(items.length === 1 ? "print.entry.one" : "print.entry.many"), date: today })}</span>
          </div>
          <ol className="print-list">
            {items.map((it) => (
              <li key={it.num} className={it.isMedley ? "pmedley" : "pmanual"}>
                <span className="pnum">{it.num}</span>
                <span className="ptitles">
                  {it.songs.map((sg, k) => (
                    <span key={k} className="psong">
                      {k > 0 && <span className="psep"> / </span>}
                      <span className="pname" style={pc.colors && sg.color ? { color: sg.color } : undefined}>{sg.title}</span>
                      {pc.showKeys && sg.key && <span className="pkey"> ({sg.key})</span>}
                    </span>
                  ))}
                </span>
                {pc.showTags && <span className="ptag">{it.isMedley ? tr("print.tag.medley") : tr("print.tag.manual")}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

// Which elements the PERFORMANCE view shows — toggled per device from the ⚙ (like the Stage). All
// on by default = current behaviour; the merge with PERF_DEFAULT keeps old saves forward-compatible.
type PerfBlocks = { pos: boolean; title: boolean; key: boolean; desc: boolean; tempo: boolean; meter: boolean; duration: boolean; remaining: boolean; click: boolean; sections: boolean; bar: boolean; medleyList: boolean; medleyBanner: boolean; next: boolean; setInfo: boolean; clock: boolean; transport: boolean; cue: boolean };
const PERF_DEFAULT: PerfBlocks = { pos: true, title: true, key: true, desc: true, tempo: true, meter: true, duration: true, remaining: true, click: true, sections: true, bar: true, medleyList: true, medleyBanner: true, next: true, setInfo: true, clock: true, transport: true, cue: true };
function usePerfConfig(): [PerfBlocks, (c: PerfBlocks) => void] {
  const [cfg, setCfg] = useState<PerfBlocks>(() => {
    try { const raw = localStorage.getItem("ablejam.perf.v1"); if (raw) return { ...PERF_DEFAULT, ...(JSON.parse(raw) as Partial<PerfBlocks>) }; } catch { /* ignore */ }
    return PERF_DEFAULT;
  });
  const update = (c: PerfBlocks) => { setCfg(c); try { localStorage.setItem("ablejam.perf.v1", JSON.stringify(c)); } catch { /* ignore */ } };
  return [cfg, update];
}
function PerfConfig({ cfg, setCfg, onClose }: { cfg: PerfBlocks; setCfg: (c: PerfBlocks) => void; onClose: () => void }) {
  const { tr } = useT();
  const toggle = (k: keyof PerfBlocks) => setCfg({ ...cfg, [k]: !cfg[k] });
  const items: [keyof PerfBlocks, string][] = [["pos", "perf.block.pos"], ["title", "perf.block.title"], ["key", "perf.block.key"], ["desc", "perf.block.desc"], ["tempo", "perf.block.tempo"], ["meter", "perf.block.meter"], ["duration", "perf.block.duration"], ["remaining", "perf.block.remaining"], ["click", "perf.block.click"], ["sections", "perf.block.sections"], ["bar", "perf.block.bar"], ["medleyList", "perf.block.medleyList"], ["medleyBanner", "perf.block.medleyBanner"], ["next", "perf.block.next"], ["setInfo", "perf.block.setInfo"], ["clock", "perf.block.clock"], ["transport", "perf.block.transport"], ["cue", "perf.block.cue"]];
  return (
    <div className="stage-config">
      <div className="stage-config-head">{tr("perf.config.title")}</div>
      <div className="stage-blocks">
        {items.map(([k, lbl]) => <button key={k} className={"chip" + (cfg[k] ? " on" : "")} onClick={() => toggle(k)}>{tr(lbl)}</button>)}
      </div>
      <button className="stage-config-close" onClick={onClose}>{tr("stage.config.close")}</button>
    </div>
  );
}

function PerformanceView({ state, send }: { state: AppState; send: Send }) {
  const { tr } = useT();
  const [b, setPcfg] = usePerfConfig();
  const [showCfg, setShowCfg] = useState(false);
  const { library, setlist, currentEntryIndex, transport } = state;
  const curEntry = setlist[currentEntryIndex];
  const curSong = songOf(state, curEntry);
  const nextIdx = nextActive(setlist, currentEntryIndex);
  const nextSong = songOf(state, setlist[nextIdx]);
  const nextKey = nextSong ? (nextSong.key || setlist[nextIdx]?.key || "") : "";
  const accent = curEntry?.color ?? colorOf(curSong?.color) ?? "var(--playing)";
  const remainingSec = curSong && curSong.endBeat != null ? beatsToSec(curSong.endBeat - transport.time, transport.tempo) : null;
  // This song flows into the next (medley) — from the Ableton marker "/" OR a manual link, so
  // the medley UI shows regardless of how the setlist was loaded.
  const curContinues = !!(curSong?.continuesNext || curEntry?.linkedNext);

  const progress = curSong && curSong.endBeat != null ? rangeFrac(transport.time, curSong.startBeat, curSong.endBeat) : 0;
  // MIDI stop note inside the current song (ignored in a medley) — shown on the bar.
  const curStop = curSong && curSong.endBeat != null && !curContinues
    ? state.stopPoints.find((p) => p > curSong.startBeat + 1e-6 && p <= (curSong.endBeat as number) + 1e-6)
    : undefined;
  const stopBpb = transport.sigNumerator > 0 && transport.sigDenominator > 0 ? (transport.sigNumerator * 4) / transport.sigDenominator : 4;

  // If the current song is part of a medley, gather the whole group so the progress bar
  // can span all its songs with clickable markers (start any song of the medley from 0).
  const medley = useMemo(() => {
    if (currentEntryIndex < 0) return null;
    // An entry links into the next when its SONG continues (marker "/") or it's manually linked.
    const links = (k: number) => { const sg = songOf(state, setlist[k]); return !!(sg?.continuesNext || setlist[k]?.linkedNext); };
    const inM = links(currentEntryIndex) || (currentEntryIndex > 0 && links(currentEntryIndex - 1));
    if (!inM) return null;
    let start = currentEntryIndex;
    while (start > 0 && links(start - 1)) start--;
    let end = currentEntryIndex;
    while (links(end) && setlist[end + 1]) end++;
    const songs: { idx: number; song: Song; key: string }[] = [];
    for (let k = start; k <= end; k++) {
      const sg = songOf(state, setlist[k]);
      if (sg) songs.push({ idx: k, song: sg, key: sg.key || setlist[k]!.key });
    }
    if (songs.length < 2) return null;
    const spanStart = songs[0]!.song.startBeat;
    const spanEnd = songs[songs.length - 1]!.song.endBeat ?? spanStart + 1;
    return spanEnd > spanStart ? { songs, spanStart, spanEnd } : null;
  }, [state, setlist, currentEntryIndex]);

  let setRemaining = remainingSec ?? 0;
  let songsLeft = 0;
  for (let k = Math.max(currentEntryIndex, 0); k < setlist.length; k++) {
    if (!setlist[k]!.active) continue;
    if (k > currentEntryIndex) setRemaining += library[setlist[k]!.libIndex]?.durationSec ?? 0;
    songsLeft++;
  }
  let totalSec = 0;
  for (const e of setlist) if (e.active) totalSec += library[e.libIndex]?.durationSec ?? 0;
  const elapsedSec = Math.max(0, totalSec - setRemaining);

  const curSection = curSong?.sections[transport.currentSectionIndex];
  const nextSection = curSong?.sections[transport.currentSectionIndex + 1];
  const pos = currentEntryIndex >= 0 ? `${currentEntryIndex + 1} / ${setlist.filter((e) => e.active).length || setlist.length}` : "";

  const headOn = b.pos || b.title || b.key || b.desc || b.tempo || b.meter || b.duration || b.remaining || b.click || b.sections;
  const pillsOn = b.tempo || b.meter || b.duration || b.remaining || b.click;

  return (
    <main className="perf">
      {!KIOSK && <button className="stage-cfg-btn" onClick={() => setShowCfg((s) => !s)} title={tr("perf.config.title")}>⚙</button>}
      {showCfg && <PerfConfig cfg={b} setCfg={setPcfg} onClose={() => setShowCfg(false)} />}
      <div className="perf-hero">
        {!curSong ? (
          <div className="perf-wait">{tr("perf.waiting")}</div>
        ) : (
          <>
            {headOn && (
            <div className="perf-head">
            {b.pos && <div className="perf-pos">{pos}</div>}
            {b.title && <div className="perf-title" style={{ color: accent, fontSize: perfTitleFont(curSong.title) }}>{curSong.title}</div>}
            {b.key && (curSong?.key || curEntry?.key) && <div className="perf-key">{curSong?.key || curEntry?.key}</div>}
            {b.desc && curSong.description && <div className="perf-desc">{curSong.description}</div>}
            {pillsOn && (
            <div className="pills">
              {b.tempo && <span className="pill">{Math.round(transport.tempo)} BPM</span>}
              {b.meter && <span className="pill">{transport.sigNumerator}/{transport.sigDenominator}</span>}
              {b.duration && <span className="pill">{formatDuration(curSong.durationSec)}</span>}
              {b.remaining && <span className="pill strong">{formatDuration(remainingSec)}</span>}
              {b.click && <button
                className={"pill click-pill" + (transport.metronome ? " on" : "")}
                onClick={() => send({ type: "command", command: "setMetronome", on: !transport.metronome })}
                title={transport.metronome ? tr("click.on.title") : tr("click.off.title")}
              ><ClickViz state={state} /><span className="ck-txt">CLICK {transport.metronome ? "ON" : "OFF"}</span></button>}
            </div>
            )}
            {b.sections && (curSection || nextSection) && (
              <div className="perf-sections">
                {curSection && <span className="now" style={{ color: accent }}>{curSection.title}</span>}
                {nextSection && <span className="then">→ {nextSection.title}</span>}
              </div>
            )}
            </div>
            )}
            <div className="perf-body">
            {medley ? (
              <>
                {b.bar && <div
                  className="progress medley-bar seekable"
                  title={tr("perf.seekMedley.title")}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                    send({ type: "command", command: "seek", beat: medley.spanStart + frac * (medley.spanEnd - medley.spanStart) });
                  }}
                >
                  <div className="progress-fill" style={{ width: `${rangeFrac(transport.time, medley.spanStart, medley.spanEnd) * 100}%`, background: accent }} />
                  {medley.songs.map((sg) => {
                    const left = ((sg.song.startBeat - medley.spanStart) / (medley.spanEnd - medley.spanStart)) * 100;
                    if (left < 0.5) return null;
                    return (
                      <span
                        key={sg.idx}
                        className="medley-tick"
                        style={{ left: `${left}%` }}
                        title={tr("perf.tick.title", { title: sg.song.title })}
                        onClick={(ev) => { ev.stopPropagation(); send({ type: "command", command: "jumpToEntry", index: sg.idx }); }}
                      />
                    );
                  })}
                </div>}
                {b.medleyList && <div className="medley-list">
                  {medley.songs.map((sg, n) => (
                    <button
                      key={sg.idx}
                      className={"medley-chip" + (sg.idx === currentEntryIndex ? " on" : "")}
                      onClick={() => send({ type: "command", command: "jumpToEntry", index: sg.idx })}
                      title={tr("perf.medleyChip.title")}
                    >
                      <span className="mc-num">{n + 1}</span>
                      <span className="mc-name">{sg.song.title}</span>
                      {sg.key && <span className="mc-key">{sg.key}</span>}
                    </button>
                  ))}
                </div>}
              </>
            ) : (
              b.bar && <div
                className="progress seekable"
                title={tr("perf.seek.title")}
                onClick={(e) => {
                  if (!curSong || curSong.endBeat == null || curSong.endBeat <= curSong.startBeat) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                  send({ type: "command", command: "seek", beat: curSong.startBeat + frac * (curSong.endBeat - curSong.startBeat) });
                }}
              >
                <div className="progress-fill" style={{ width: `${progress * 100}%`, background: accent }} />
                {curStop != null && curSong && curSong.endBeat != null && curSong.endBeat > curSong.startBeat && (
                  <span
                    className="stop-mark"
                    style={{ left: `${Math.min(100, Math.max(0, ((curStop - curSong.startBeat) / (curSong.endBeat - curSong.startBeat)) * 100))}%` }}
                    title={tr("perf.stopMark.title", { bar: Math.round(curStop / stopBpb) + 1 })}
                  />
                )}
              </div>
            )}
            {b.medleyBanner && <div className={"perf-medley " + (curContinues ? "cont" : "stops")}>
              {curContinues ? tr("perf.medley.continues") : tr("perf.medley.stops")}
            </div>}
            {b.next && <div className="next">
              <div className="next-label">{curContinues ? tr("perf.next.thenMedley") : tr("perf.next.label")}</div>
              <div className="next-title">{nextSong ? <><span className="nt-text">{nextSong.title}</span>{nextKey && <span className="next-key">({nextKey})</span>}</> : tr("perf.next.end")}</div>
            </div>}
            {(b.setInfo || b.clock) && <div className="perf-foot">
              {b.setInfo && <div>{tr("perf.foot.set", { clock: formatClock(totalSec), n: songsLeft })}</div>}
              {b.clock && <div className="perf-time">{tr("perf.foot.time", { elapsed: formatClock(elapsedSec), remaining: formatClock(setRemaining) })}</div>}
            </div>}
            </div>
          </>
        )}
      </div>
      {b.transport && <PerformanceTransport state={state} send={send} />}
      {b.cue && <StageCueBar send={send} current={state.stageMessage} />}
    </main>
  );
}

// ---- Lyric formatting: **bold** *italic*, a leading [color] line tint, and [Chord] (ChordPro) ----
const NAMED_COLORS = new Set(["red", "orange", "yellow", "green", "blue", "cyan", "purple", "pink", "white", "gray", "grey", "gold", "lime", "magenta", "teal", "violet"]);
function isChordTag(s: string): boolean {
  return /^[A-G][#b]?(maj7|maj9|maj|min|dim7|dim|aug|sus2|sus4|sus|add9|m|M|\+)?\d{0,2}(\/[A-G][#b]?)?$/.test(s.trim());
}
function colorOfTag(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (NAMED_COLORS.has(t)) return t;
  if (/^#?[0-9a-f]{3}$/.test(t) || /^#?[0-9a-f]{6}$/.test(t)) return t.startsWith("#") ? t : "#" + t;
  return null;
}
const SIZE_MUL: Record<string, number> = { xs: 0.62, s: 0.82, l: 1.28, xl: 1.7 };
type LyricStyle = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; transform: "" | "up" | "low"; color: string | null; sizeKey: string };
/** Parse leading line-level style tags ([b] [i] [u] [strike] [up]/[low] [s/l/xl/xs] [colour]) + chord/text chunks. */
function parseLyricLine(raw: string): LyricStyle & { rest: string; chunks: { chord: string | null; text: string }[] } {
  let text = raw;
  let bold = false, italic = false, underline = false, strike = false, color: string | null = null, sizeKey = "";
  let transform: "" | "up" | "low" = "";
  let m: RegExpMatchArray | null;
  while ((m = text.match(/^\s*\[([^\]]+)\]\s*/))) {
    const raw2 = m[1]!.trim(); const t = raw2.toLowerCase();
    if (t === "b") bold = true;
    else if (t === "i") italic = true;
    else if (t === "u") underline = true;
    else if (t === "strike") strike = true;
    else if (t === "up") transform = "up";
    else if (t === "low") transform = "low";
    else if (t === "xs" || t === "s" || t === "l" || t === "xl") sizeKey = t;
    else { const c = colorOfTag(raw2); if (c && !isChordTag(raw2)) color = c; else break; }
    text = text.slice(m[0].length);
  }
  const rest = text;
  const re = /\[([^\]]+)\]/g;
  const marks: { idx: number; len: number; chord: string }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text)) !== null) { const inner = mm[1]!.trim(); if (isChordTag(inner)) marks.push({ idx: mm.index, len: mm[0].length, chord: inner }); }
  const chunks: { chord: string | null; text: string }[] = [];
  if (!marks.length) chunks.push({ chord: null, text });
  else {
    if (marks[0]!.idx > 0) chunks.push({ chord: null, text: text.slice(0, marks[0]!.idx) });
    for (let i = 0; i < marks.length; i++) { const cur = marks[i]!; const next = i + 1 < marks.length ? marks[i + 1]!.idx : text.length; chunks.push({ chord: cur.chord, text: text.slice(cur.idx + cur.len, next) }); }
  }
  return { bold, italic, underline, strike, transform, color, sizeKey, rest, chunks };
}
/** Re-encode the leading style tags for a line (used by the typography toolbar). */
function buildStyleTags(s: LyricStyle): string {
  return (s.bold ? "[b]" : "") + (s.italic ? "[i]" : "") + (s.underline ? "[u]" : "") + (s.strike ? "[strike]" : "") + (s.transform ? `[${s.transform}]` : "") + (s.sizeKey ? `[${s.sizeKey}]` : "") + (s.color ? `[${s.color}]` : "");
}
/** Render **bold** / *italic* inside a plain text segment. */
function formatInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) nodes.push(<b key={k++}>{m[1]}</b>);
    else nodes.push(<i key={k++}>{m[2]}</i>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
/** A formatted lyric line for the stage: line bold/italic/size/colour, and chords above the words. */
function LyricText({ text }: { text: string }) {
  const { bold, italic, underline, strike, transform, color, sizeKey, chunks } = parseLyricLine(text);
  const style: CSSProperties = {};
  if (color) style.color = color;
  if (bold) style.fontWeight = 800;
  if (italic) style.fontStyle = "italic";
  const deco = [underline ? "underline" : "", strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) style.textDecoration = deco;
  if (transform === "up") style.textTransform = "uppercase";
  else if (transform === "low") style.textTransform = "lowercase";
  if (sizeKey) style.fontSize = `${SIZE_MUL[sizeKey] ?? 1}em`;
  if (!chunks.some((c) => c.chord)) return <span style={style}>{formatInline(chunks.map((c) => c.text).join(""))}</span>;
  return (
    <span className="lyr-chorded" style={style}>
      {chunks.map((c, i) => (
        <span key={i} className="lyr-chunk">
          <span className="lyr-chord">{c.chord ?? ""}</span>
          <span className="lyr-syl">{formatInline(c.text)}</span>
        </span>
      ))}
    </span>
  );
}

// ---- STAGE view: a configurable big-screen display ----
type StageBlocks = { lyrics: boolean; message: boolean; section: boolean; title: boolean; key: boolean; remaining: boolean; next: boolean; bar: boolean; transport: boolean };
type StageCfg = { blocks: StageBlocks; scale: number; mirror: boolean; offsetMs: number };
// For now the stage is minimal: title + lyrics + a small "next". The rest is off by default but
// can be re-enabled per device from the ⚙. (message stays on — it's invisible unless a cue is pushed.)
const STAGE_DEFAULT: StageCfg = { blocks: { lyrics: true, message: true, section: false, title: true, key: false, remaining: false, next: true, bar: false, transport: false }, scale: 1, mirror: false, offsetMs: 0 };

/** Per-DEVICE stage layout (which blocks, font scale, mirror) — stored in this browser's localStorage. */
function useStageConfig(): [StageCfg, (c: StageCfg) => void] {
  const [cfg, setCfg] = useState<StageCfg>(() => {
    try {
      const raw = localStorage.getItem("ablejam.stage.v2");
      if (raw) { const p = JSON.parse(raw) as Partial<StageCfg>; return { ...STAGE_DEFAULT, ...p, blocks: { ...STAGE_DEFAULT.blocks, ...(p.blocks ?? {}) } }; }
    } catch { /* ignore */ }
    return STAGE_DEFAULT;
  });
  const update = (c: StageCfg) => { setCfg(c); try { localStorage.setItem("ablejam.stage.v2", JSON.stringify(c)); } catch { /* ignore */ } };
  return [cfg, update];
}

/** Operator cue bar: push a free message (or a preset) to every STAGE view; clear with ✕. */
function StageCueBar({ send, current }: { send: Send; current: string }) {
  const { tr } = useT();
  const [text, setText] = useState("");
  const presets = tr("stage.cue.presets").split("|").map((s) => s.trim()).filter(Boolean);
  const push = (t: string) => { send({ type: "command", command: "setStageMessage", text: t }); setText(""); };
  return (
    <div className="cue-bar">
      <span className="cue-tag">{tr("stage.cue.tag")}</span>
      <input className="cue-input" value={text} placeholder={tr("stage.cue.placeholder")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") push(text); }} />
      <button className="cue-send" onClick={() => push(text)} disabled={!text.trim()}>{tr("stage.cue.send")}</button>
      <button className="cue-clear" onClick={() => push("")} disabled={!current}>{tr("stage.cue.clear")}</button>
      <div className="cue-presets">{presets.map((p) => <button key={p} onClick={() => push(p)}>{p}</button>)}</div>
    </div>
  );
}

function StageConfig({ cfg, setCfg, send, message, onOpenEditor, onClose }: { cfg: StageCfg; setCfg: (c: StageCfg) => void; send: Send; message: string; onOpenEditor: () => void; onClose: () => void }) {
  const { tr } = useT();
  const toggle = (k: keyof StageBlocks) => setCfg({ ...cfg, blocks: { ...cfg.blocks, [k]: !cfg.blocks[k] } });
  const items: [keyof StageBlocks, string][] = [["lyrics", "stage.block.lyrics"], ["bar", "stage.block.bar"], ["transport", "stage.block.transport"], ["title", "stage.block.title"], ["key", "stage.block.key"], ["section", "stage.block.section"], ["remaining", "stage.block.remaining"], ["next", "stage.block.next"], ["message", "stage.block.message"]];
  return (
    <div className="stage-config">
      <div className="stage-config-head">{tr("stage.config.title")}</div>
      <div className="stage-blocks">
        {items.map(([k, lbl]) => <button key={k} className={"chip" + (cfg.blocks[k] ? " on" : "")} onClick={() => toggle(k)}>{tr(lbl)}</button>)}
        <button className={"chip" + (cfg.mirror ? " on" : "")} onClick={() => setCfg({ ...cfg, mirror: !cfg.mirror })}>{tr("stage.mirror")}</button>
      </div>
      <div className="stage-sliders">
        <span className="ss-lbl">{tr("stage.scale")}</span>
        <input className="ui-range" type="range" min={0.6} max={2.2} step={0.1} value={cfg.scale} style={{ "--p": `${((cfg.scale - 0.6) / 1.6) * 100}%` } as CSSProperties} onChange={(e) => setCfg({ ...cfg, scale: Number(e.target.value) })} />
        <span className="ss-end ss-val">{cfg.scale.toFixed(1)}×</span>
        <span className="ss-lbl">{tr("stage.offset")}</span>
        <input className="ui-range" type="range" min={-500} max={500} step={10} value={cfg.offsetMs} style={{ "--p": `${((cfg.offsetMs + 500) / 1000) * 100}%` } as CSSProperties} onChange={(e) => setCfg({ ...cfg, offsetMs: Number(e.target.value) })} />
        <span className="ss-end ss-val">{cfg.offsetMs > 0 ? "+" : ""}{cfg.offsetMs} ms</span>
      </div>
      <button className="stage-config-close" onClick={onOpenEditor}><ActionIcon name="edit" /> {tr("lyricsEd.open")}</button>
      <button className="stage-config-close" onClick={onClose}>{tr("stage.config.close")}</button>
    </div>
  );
}

function StageView({ state, send, kiosk }: { state: AppState; send: Send; kiosk: boolean }) {
  const { tr } = useT();
  const { setlist, currentEntryIndex, transport } = state;
  const curEntry = setlist[currentEntryIndex];
  const curSong = songOf(state, curEntry);
  const nextIdx = nextActive(setlist, currentEntryIndex);
  const nextSong = songOf(state, setlist[nextIdx]);
  const nextKey = nextSong ? (nextSong.key || setlist[nextIdx]?.key || "") : "";
  const accent = curEntry?.color ?? colorOf(curSong?.color) ?? "var(--playing)";
  const remainingSec = curSong && curSong.endBeat != null ? beatsToSec(curSong.endBeat - transport.time, transport.tempo) : null;
  const curKey = curSong?.key || curEntry?.key || "";
  const curSection = curSong?.sections[transport.currentSectionIndex];
  const [cfg, setCfg] = useStageConfig();
  const [showCfg, setShowCfg] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const msg = state.stageMessage.trim();
  const b = cfg.blocks;

  // Only the CURRENT song's lyrics (clips inside its beat range) — a song with no clips (everything
  // except RUSH, for now) just shows the title. The active line is the last one the playhead reached.
  const songLyrics = useMemo(() => {
    if (!curSong) return [] as typeof state.lyrics;
    const end = curSong.endBeat ?? Number.POSITIVE_INFINITY;
    // Overlap, not "starts inside": a first line whose clip begins a hair before the song marker
    // must still count (otherwise the first verse is dropped).
    return state.lyrics.filter((l) => l.start < end - 1e-6 && l.end > curSong.startBeat + 1e-6);
  }, [state.lyrics, curSong]);
  // Display offset (per device): shift the effective playhead to compensate the gobbo's video/audio
  // latency. A positive offset shows each line earlier.
  const effTime = transport.time + (cfg.offsetMs / 1000) * (transport.tempo / 60);
  let activeIdx = -1;
  for (let i = 0; i < songLyrics.length; i++) { if (songLyrics[i]!.start <= effTime + 1e-6) activeIdx = i; else break; }
  const activeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [activeIdx]);
  const showLyrics = b.lyrics && songLyrics.length > 0;
  // Reference bar: line ticks + playhead across the current song (toggle "bar" in Configure screen).
  const bStart = curSong ? curSong.startBeat : 0;
  const bEnd = curSong ? (curSong.endBeat ?? curSong.startBeat + 64) : 64;
  const barPct = (beat: number) => Math.max(0, Math.min(100, ((beat - bStart) / ((bEnd - bStart) || 1)) * 100));
  const showBar = b.bar && !!curSong; // the reference bar/seek works with or without lyrics
  // Drag a tick on the stage bar to nudge a verse's start (last-minute tweaks straight from the stage).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragBeat, setDragBeat] = useState(0);
  const dragBeatRef = useRef(0); dragBeatRef.current = dragBeat;
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (dragIdx == null) return;
    const onMove = (e: MouseEvent) => { const r = barRef.current?.getBoundingClientRect(); if (!r || r.width <= 0) return; const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); setDragBeat(bStart + f * (bEnd - bStart)); };
    const onUp = () => {
      const line = songLyrics[dragIdx]; const nb = dragBeatRef.current;
      if (line && Math.abs(nb - line.start) > 1e-6) send({ type: "command", command: "setLyrics", lines: state.lyrics.map((l) => l === line ? { ...l, start: nb } : l).sort((a, b) => a.start - b.start) });
      setDragIdx(null);
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragIdx, bStart, bEnd, songLyrics, state.lyrics, send]);

  return (
    <main className={"stage" + (cfg.mirror ? " mirror" : "")} style={{ "--stage-scale": cfg.scale } as CSSProperties}>
      {!kiosk && <button className="stage-cfg-btn" onClick={() => setShowCfg((s) => !s)} title={tr("stage.config.title")}>⚙</button>}
      {showCfg && <StageConfig cfg={cfg} setCfg={setCfg} send={send} message={state.stageMessage} onOpenEditor={() => { setShowCfg(false); setShowEditor(true); }} onClose={() => setShowCfg(false)} />}
      {showEditor && <LyricsEditor state={state} send={send} entryIndex={state.currentEntryIndex} onClose={() => setShowEditor(false)} />}
      {msg && b.message && <div className="stage-msg">{msg}</div>}
      {showLyrics ? (
        <div className="stage-lyrics-wrap">
          {(b.section || b.title || b.key || b.remaining) && (
            <div className="stage-ly-head">
              {b.section && curSection && <span className="lh-section">{curSection.title}</span>}
              {b.title && curSong && <span className="lh-title" style={{ color: accent }}>{curSong.title}</span>}
              {b.key && curKey && <span className="lh-key">{curKey}</span>}
              {b.remaining && remainingSec != null && <span className="lh-rem">{formatDuration(remainingSec)}</span>}
            </div>
          )}
          <div className="stage-lyrics">
            {songLyrics.map((l, i) => (
              <div key={i} ref={i === activeIdx ? activeRef : undefined} className={"ly-line" + (i === activeIdx ? " active" : i < activeIdx ? " past" : "")}><LyricText text={l.text} /></div>
            ))}
          </div>
          {b.next && <div className="stage-ly-next">{nextSong ? <>{tr("stage.next")} <b>{nextSong.title}</b>{nextKey && <span className="stage-next-key"> · {nextKey}</span>}</> : tr("perf.next.end")}</div>}
        </div>
      ) : !curSong ? (
        <div className="stage-wait">{tr("perf.waiting")}</div>
      ) : (
        <div className="stage-main">
          {b.section && curSection && <div className="stage-section">{curSection.title}</div>}
          {b.title && <div className="stage-title" style={{ color: accent }}>{curSong.title}</div>}
          {b.key && curKey && <div className="stage-key">{curKey}</div>}
          {b.remaining && remainingSec != null && <div className="stage-remaining">{formatDuration(remainingSec)}</div>}
          {b.next && <div className="stage-next">{nextSong ? <>{tr("stage.next")} <b>{nextSong.title}</b>{nextKey && <span className="stage-next-key"> · {nextKey}</span>}</> : tr("perf.next.end")}</div>}
        </div>
      )}
      {/* Reference bar + transport live at the stage level so they show with OR without lyrics. */}
      {showBar && (
        <div className="stage-bar" ref={barRef} title={tr("stage.bar.title")}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); send({ type: "command", command: "seek", beat: bStart + f * (bEnd - bStart) }); }}
          onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); send({ type: "command", command: "seek", beat: bStart + f * (bEnd - bStart) }); send({ type: "command", command: "play" }); }}>
          {songLyrics.map((l, i) => (
            <span key={i} className={"sb-tick" + (i === activeIdx ? " on" : "") + (i === dragIdx ? " drag" : "")}
              style={{ left: barPct(i === dragIdx ? dragBeat : l.start) + "%" }} title={l.text}
              onMouseDown={(e) => { e.preventDefault(); setDragBeat(l.start); setDragIdx(i); }} onClick={(e) => e.stopPropagation()} />
          ))}
          <span className="sb-ph" style={{ left: barPct(effTime) + "%" }} />
        </div>
      )}
      {b.transport && <div className="stage-transport"><ClickButton state={state} send={send} cls="pill click-pill" /><TransportButtons state={state} send={send} cls="pt" /></div>}
    </main>
  );
}

/** Split a pasted block into lyric lines, spread evenly across a song's [s,e] beat range. */
function splitLyricLines(text: string, s: number, e: number): LyricLine[] {
  const raw = text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const n = raw.length || 1;
  const span = (e - s) || 16;
  return raw.map((t, i) => ({ text: t, start: s + (i / n) * span, end: s + ((i + 1) / n) * span }));
}
/** Parse pasted notes into song blocks. A header is `#Title`, `[Title]`, or a line that exactly
 * matches a known song title. Lines before the first header are ignored (single-song path handles them). */
function parseLyricsBlocks(text: string, titles: string[]): { title: string; lines: string[] }[] {
  const lowered = titles.map((t) => t.toLowerCase());
  const blocks: { title: string; lines: string[] }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*#\s*(.+?)\s*$/) || line.match(/^\s*\[(.+?)\]\s*$/);
    const t = line.trim();
    const header = m ? m[1]!.trim() : (t && lowered.includes(t.toLowerCase()) ? t : null);
    if (header != null) { cur = { title: header, lines: [] }; blocks.push(cur); }
    else if (cur && t) cur.lines.push(t);
  }
  return blocks;
}
/** Replace the doc lines overlapping [s,e] with `newLines`, keeping everything else (per-song merge). */
function mergeLyricDoc(existing: LyricLine[], s: number, e: number, newLines: LyricLine[]): LyricLine[] {
  const kept = existing.filter((l) => !(l.start < e && l.end > s));
  return [...kept, ...newLines].sort((a, b) => a.start - b.start);
}

// ---- Bulk lyrics import: paste notes (with #Title headers, or one note for the current song) ----
function LyricsImport({ state, currentLines, onApply, onClose }: { state: AppState; currentLines: LyricLine[]; onApply: (doc: LyricLine[]) => void; onClose: () => void }) {
  const { tr } = useT();
  const [text, setText] = useState("");
  const lib = state.library;
  const titles = lib.map((s) => s.title);
  const cur = state.setlist[state.currentEntryIndex];
  const curSong = cur ? lib[cur.libIndex] : undefined;

  const blocks = parseLyricsBlocks(text, titles);
  const hasHeaders = blocks.length > 0;
  const matched = blocks.map((b) => { const m = bestMatch(b.title, titles, 0.5); return { title: b.title, lines: b.lines, song: m ? lib[m.index] : undefined }; });

  const songEnd = (sg: Song) => sg.endBeat ?? sg.startBeat + 64; // fallback span for a song with no end marker
  const doImport = () => {
    let doc = currentLines.map((l) => ({ ...l }));
    if (hasHeaders) {
      for (const mt of matched) {
        if (!mt.song || !mt.lines.length) continue;
        const e = songEnd(mt.song);
        doc = mergeLyricDoc(doc, mt.song.startBeat, e, splitLyricLines(mt.lines.join("\n"), mt.song.startBeat, e));
      }
    } else if (curSong && text.trim()) {
      const e = songEnd(curSong);
      doc = mergeLyricDoc(doc, curSong.startBeat, e, splitLyricLines(text, curSong.startBeat, e));
    }
    onApply(doc);
  };
  const canImport = hasHeaders ? matched.some((m) => m.song && m.lines.length) : !!(curSong && text.trim());

  return (
    <div className="overlay" onClick={onClose}>
      <div className="lyrics-import" onClick={(e) => e.stopPropagation()}>
        <div className="le-head"><span className="le-title">{tr("lyricsImp.title")}</span><span className="le-spacer" /><button className="le-btn" onClick={onClose}>{tr("lyricsEd.close")}</button></div>
        <div className="li-hint">{tr("lyricsImp.hint")}</div>
        <textarea className="li-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("lyricsImp.placeholder")} />
        {hasHeaders && (
          <div className="li-preview">
            {matched.map((m, i) => (
              <div key={i} className={"li-row" + (m.song ? "" : " miss")}>{m.song ? "✓" : "✕"} <b>{m.title}</b> → {m.song ? `${m.song.title} · ${tr("lyricsImp.nLines", { n: m.lines.length })}` : tr("lyricsImp.noMatch")}</div>
            ))}
          </div>
        )}
        <div className="li-foot">
          <span className="le-hint">{hasHeaders ? tr("lyricsImp.modeMulti") : tr("lyricsImp.modeSingle", { song: curSong?.title ?? "—" })}</span>
          <button className="le-next" onClick={doImport} disabled={!canImport}>{tr("lyricsImp.import")}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Lyrics editor: edit text + record line timing (AbleJam-authoritative; text written back to clips) ----
function LyricsEditor({ state, send, entryIndex, onClose }: { state: AppState; send: Send; entryIndex: number; onClose: () => void }) {
  const { tr } = useT();
  // Scope the editor to the song selected when it OPENED — edit only that song. Other songs' lines
  // are kept aside and merged back on every save, so editing one song never drops the others.
  const scopeRef = useRef<{ entryIndex: number; song: Song | undefined; start: number; end: number } | null>(null);
  if (scopeRef.current === null) {
    const ei = entryIndex;
    const e = state.setlist[ei];
    const sg = e ? state.library[e.libIndex] : undefined;
    const start = sg ? sg.startBeat : 0;
    const end = sg ? (sg.endBeat ?? sg.startBeat + 64) : start + 64;
    scopeRef.current = { entryIndex: ei, song: sg, start, end };
  }
  const scope = scopeRef.current;
  const inSong = (l: LyricLine) => l.start < scope.end - 1e-6 && l.end > scope.start + 1e-6; // overlap

  const [lines, setLines] = useState<LyricLine[]>(() => state.lyrics.filter(inSong).map((l) => ({ ...l })));
  const [recording, setRecording] = useState(false);
  const [recIdx, setRecIdx] = useState(0);
  const [sel, setSel] = useState(-1);
  const [showImport, setShowImport] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragRow, setDragRow] = useState<number | null>(null); // drag-and-drop reordering of verses
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const otherLinesRef = useRef<LyricLine[]>(state.lyrics.filter((l) => !inSong(l)).map((l) => ({ ...l })));

  // Live refs so the Space hotkey never reads stale lines / index / playhead.
  const linesRef = useRef(lines); linesRef.current = lines;
  const recIdxRef = useRef(recIdx); recIdxRef.current = recIdx;
  const timeRef = useRef(state.transport.time); timeRef.current = state.transport.time;
  const saveTimer = useRef<number | null>(null);

  // Full authoritative doc = the other songs' lines + this song's edited lines.
  const fullDoc = (songLines: LyricLine[]) => [...otherLinesRef.current, ...songLines].sort((a, b) => a.start - b.start);
  const save = (ls: LyricLine[]) => {
    if (saveTimer.current != null) clearTimeout(saveTimer.current);
    const full = fullDoc(ls);
    saveTimer.current = window.setTimeout(() => send({ type: "command", command: "setLyrics", lines: full }), 400);
  };

  // Local undo/redo history for THIS song's edits (text, timing, add/remove).
  const histRef = useRef<LyricLine[][]>([]);
  const histPosRef = useRef(0);
  const coalesceRef = useRef(false); // consecutive typing collapses into one history entry
  const [histPos, setHistPos] = useState(0);
  if (histRef.current.length === 0) histRef.current = [lines.map((l) => ({ ...l }))];
  const setPos = (p: number) => { histPosRef.current = p; setHistPos(p); };

  // Every edit: set lines, record onto history (truncating any redo branch), debounce-save.
  const push = (next: LyricLine[], coalesce = false) => {
    setLines(next);
    const h = histRef.current.slice(0, histPosRef.current + 1);
    if (coalesce && coalesceRef.current && h.length > 1) h[h.length - 1] = next.map((l) => ({ ...l })); // replace top (same typing run)
    else { h.push(next.map((l) => ({ ...l }))); while (h.length > 40) h.shift(); }
    coalesceRef.current = coalesce;
    histRef.current = h;
    setPos(h.length - 1);
    save(next);
  };
  const restore = (p: number) => { coalesceRef.current = false; const ls = histRef.current[p]!.map((l) => ({ ...l })); setPos(p); setLines(ls); save(ls); };
  const undo = () => { if (histPosRef.current > 0) restore(histPosRef.current - 1); };
  const redo = () => { if (histPosRef.current < histRef.current.length - 1) restore(histPosRef.current + 1); };
  const canUndo = histPos > 0;
  const canRedo = histPos < histRef.current.length - 1;

  const rangeStart = scope.start;
  const rangeEnd = scope.end;
  const span = rangeEnd - rangeStart || 1;
  const pct = (beat: number) => Math.max(0, Math.min(100, ((beat - rangeStart) / span) * 100));
  const fmt = (beat: number) => formatDuration(Math.max(0, beatsToSec(beat - rangeStart, state.transport.tempo)));

  const stamp = () => {
    const idx = recIdxRef.current;
    const ls = linesRef.current.map((l) => ({ ...l }));
    if (idx >= ls.length) { setRecording(false); return; }
    const t = timeRef.current;
    ls[idx]!.start = t;
    ls[idx]!.end = Math.max(ls[idx]!.end, t + 2); // placeholder; overwritten when the next line is stamped
    if (idx > 0) ls[idx - 1]!.end = t;
    push(ls);
    setSel(idx);
    const ni = idx + 1;
    setRecIdx(ni);
    if (ni >= ls.length) setRecording(false);
  };

  // While recording, Space / Enter stamps the next line — capture phase so the transport keys don't also fire.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); stamp(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  // Drag a marker on the bar to move that line's start (live; sorted + saved on release).
  useEffect(() => {
    if (dragIdx == null) return;
    const onMove = (e: MouseEvent) => {
      const r = barRef.current?.getBoundingClientRect(); if (!r || r.width <= 0) return;
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const ls = linesRef.current.map((l) => ({ ...l }));
      if (dragIdx < ls.length) ls[dragIdx]!.start = rangeStart + f * span;
      setLines(ls);
    };
    const onUp = () => { push(linesRef.current.map((l) => ({ ...l })).sort((a, b) => a.start - b.start)); setDragIdx(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragIdx, rangeStart, span]);

  // Ctrl/Cmd+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo. Capture phase so it beats the setlist handler;
  // skipped while typing in a field so the input's own undo still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); redo(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const setText = (i: number, text: string) => { const ls = lines.map((l) => ({ ...l })); ls[i]!.text = text; push(ls, true); };
  const setStartHere = (i: number) => { const ls = lines.map((l) => ({ ...l })); ls[i]!.start = state.transport.time; ls.sort((a, b) => a.start - b.start); push(ls); };
  const addLine = () => { const at = Math.max(scope.start, Math.min(scope.end - 1, state.transport.time)); push([...lines.map((l) => ({ ...l })), { text: "", start: at, end: at + 4 }].sort((a, b) => a.start - b.start)); };
  const delLine = (i: number) => push(lines.filter((_, k) => k !== i));
  // Move a verse up/down by swapping its timing with the neighbour (text travels with it).
  const moveLine = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= lines.length) return;
    const ls = lines.map((l) => ({ ...l }));
    const s = ls[i]!.start, e = ls[i]!.end; ls[i]!.start = ls[j]!.start; ls[i]!.end = ls[j]!.end; ls[j]!.start = s; ls[j]!.end = e;
    push(ls.sort((a, b) => a.start - b.start));
  };
  const dupLine = (i: number) => {
    const ls = lines.map((l) => ({ ...l })); const cur = ls[i]!; const nxt = ls[i + 1];
    const ns = nxt ? (cur.start + nxt.start) / 2 : cur.start + 2;
    push([...ls, { text: cur.text, start: ns, end: ns + 2 }].sort((a, b) => a.start - b.start));
  };
  const clearAll = () => { if (lines.length && confirm(tr("lyricsEd.clearAll.confirm"))) push([]); };
  // Drag-and-drop reorder: move the verse's TEXT to the new slot, keeping the timeline (times stay
  // in order and are re-assigned to the new sequence) — same model as the up/down buttons.
  const reorderLines = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const ls = lines.map((l) => ({ ...l }));
    const times = ls.map((l) => ({ start: l.start, end: l.end }));
    const [moved] = ls.splice(from, 1); if (!moved) return;
    ls.splice(to, 0, moved);
    ls.forEach((l, i) => { l.start = times[i]!.start; l.end = times[i]!.end; });
    push(ls);
  };
  // Typography toolbar: change the leading style tags of the selected verse (reflects its current style).
  const setLineStyle = (i: number, changes: Partial<LyricStyle>) => {
    if (i < 0 || i >= lines.length) return;
    const p = parseLyricLine(lines[i]!.text);
    const next: LyricStyle = { bold: p.bold, italic: p.italic, underline: p.underline, strike: p.strike, transform: p.transform, color: p.color, sizeKey: p.sizeKey, ...changes };
    const ls = lines.map((l) => ({ ...l }));
    ls[i]!.text = buildStyleTags(next) + p.rest;
    push(ls);
  };
  const selStyle = sel >= 0 && sel < lines.length ? parseLyricLine(lines[sel]!.text) : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="lyrics-editor" onClick={(e) => e.stopPropagation()}>
        <div className="le-head">
          <span className="le-title">{tr("lyricsEd.title")}</span>
          {scope.song && <span className="le-song">{scope.song.title}</span>}
          <span className="le-spacer" />
          <button className="act" disabled={!canUndo} onClick={undo} title={tr("act.undo.title")}><ActionIcon name="undo" /></button>
          <button className="act" disabled={!canRedo} onClick={redo} title={tr("act.redo.title")}><ActionIcon name="redo" /></button>
          <button className="act" onClick={() => setShowImport(true)} title={tr("lyricsEd.import")}><ActionIcon name="import" /></button>
          <button className="act" onClick={() => { if (confirm(tr("lyricsEd.revert.confirm"))) { send({ type: "command", command: "clearLyrics" }); onClose(); } }} title={tr("lyricsEd.revert.title")}><ActionIcon name="reset" /></button>
          <button className="act" onClick={onClose} title={tr("lyricsEd.close")}><ActionIcon name="close" /></button>
        </div>
        {showImport && <LyricsImport state={state} currentLines={fullDoc(lines)} onApply={(doc) => {
          otherLinesRef.current = doc.filter((l) => !inSong(l)).map((l) => ({ ...l }));
          setLines(doc.filter(inSong).map((l) => ({ ...l })));
          send({ type: "command", command: "setLyrics", lines: doc });
          setShowImport(false);
        }} onClose={() => setShowImport(false)} />}

        <div className="le-bar" ref={barRef} title={tr("lyricsEd.bar.title")}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; send({ type: "command", command: "seek", beat: rangeStart + f * span }); }}>
          {lines.map((l, i) => (
            <span key={i} className={"le-tick" + (i === sel ? " sel" : "") + (recording && i === recIdx ? " next" : "") + (i === dragIdx ? " drag" : "")} style={{ left: pct(l.start) + "%" }}
              title={tr("lyricsEd.tick.title")}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setSel(i); setDragIdx(i); }} />
          ))}
          <span className="le-playhead" style={{ left: pct(state.transport.time) + "%" }} />
        </div>

        <div className="le-typo">
          <button className={"le-tbtn" + (selStyle?.bold ? " on" : "")} disabled={!selStyle} onClick={() => setLineStyle(sel, { bold: !selStyle?.bold })} title={tr("typo.bold")}><b>B</b></button>
          <button className={"le-tbtn" + (selStyle?.italic ? " on" : "")} disabled={!selStyle} onClick={() => setLineStyle(sel, { italic: !selStyle?.italic })} title={tr("typo.italic")}><i>I</i></button>
          <button className={"le-tbtn" + (selStyle?.underline ? " on" : "")} disabled={!selStyle} onClick={() => setLineStyle(sel, { underline: !selStyle?.underline })} title={tr("typo.underline")}><u>U</u></button>
          <button className={"le-tbtn" + (selStyle?.strike ? " on" : "")} disabled={!selStyle} onClick={() => setLineStyle(sel, { strike: !selStyle?.strike })} title={tr("typo.strike")}><s>S</s></button>
          <button className={"le-tbtn le-tcase" + (selStyle?.transform === "up" ? " on" : "")} disabled={!selStyle} onClick={() => setLineStyle(sel, { transform: selStyle?.transform === "up" ? "" : "up" })} title={tr("typo.upper")}>AA</button>
          <button className={"le-tbtn le-tcase" + (selStyle?.transform === "low" ? " on" : "")} disabled={!selStyle} onClick={() => setLineStyle(sel, { transform: selStyle?.transform === "low" ? "" : "low" })} title={tr("typo.lower")}>aa</button>
          <select className="le-tsize" disabled={!selStyle} value={selStyle?.sizeKey ?? ""} onChange={(e) => setLineStyle(sel, { sizeKey: e.target.value })} title={tr("typo.size")}>
            <option value="xs">XS</option><option value="s">S</option><option value="">M</option><option value="l">L</option><option value="xl">XL</option>
          </select>
          <ColorPicker value={selStyle?.color && selStyle.color.startsWith("#") ? selStyle.color : "#ffffff"} onChange={(c) => setLineStyle(sel, { color: c })} />
          <button className="le-tbtn" disabled={!selStyle || !selStyle.color} onClick={() => setLineStyle(sel, { color: null })} title={tr("typo.colorClear")}><ActionIcon name="close" /></button>
          <span className="le-typo-sp" />
          <span className="le-typo-actions">
            <button className="le-play le-iconbtn" onClick={() => { if (scope.song) { send({ type: "command", command: "jumpToEntry", index: scope.entryIndex }); send({ type: "command", command: "play" }); } }}><ActionIcon name="play" /> {tr("lyricsEd.playSong")}</button>
            {!recording ? (
              <button className="le-recbtn le-iconbtn" onClick={() => { setRecIdx(0); setSel(-1); setRecording(true); }} disabled={!lines.length} title={tr("lyricsEd.record.title")}><span className="rec-dot" /> {tr("lyricsEd.record")}</button>
            ) : (
              <>
                <button className="le-next le-iconbtn" onClick={stamp}><ActionIcon name="skip" /> {tr("lyricsEd.next")} ⎵</button>
                <span className="le-reccount">{Math.min(recIdx + 1, lines.length)} / {lines.length}</span>
                <button className="le-btn" onClick={() => setRecording(false)}>{tr("lyricsEd.stopRec")}</button>
              </>
            )}
          </span>
        </div>

        <div className="le-lines">
          {lines.length === 0 && <div className="le-empty">{tr("lyricsEd.empty")}</div>}
          {lines.map((l, i) => (
            <div key={i} className={"le-line" + (i === sel ? " sel" : "") + (recording && i === recIdx ? " next" : "") + (dragRow === i ? " dragging" : "") + (dragOverRow === i && dragRow !== i ? " dragover" : "")} onMouseDown={() => setSel(i)}
              onDragOver={(e) => { if (dragRow != null) { e.preventDefault(); setDragOverRow(i); } }}
              onDrop={() => { if (dragRow != null && dragRow !== i) reorderLines(dragRow, i); setDragRow(null); setDragOverRow(null); }}>
              <span className="le-grip" draggable onDragStart={() => setDragRow(i)} onDragEnd={() => { setDragRow(null); setDragOverRow(null); }} title={tr("lyricsEd.drag")}>⠿</span>
              <span className="le-num">{i + 1}</span>
              <input className="le-text" value={l.text} placeholder={tr("lyricsEd.linePlaceholder")} onChange={(e) => setText(i, e.target.value)} />
              <button className="le-time" onClick={() => setStartHere(i)} title={tr("lyricsEd.setStart.title")}>{fmt(l.start)}</button>
              <button className="le-rowbtn" onClick={() => moveLine(i, -1)} disabled={i === 0} title={tr("lyricsEd.moveUp")}><ActionIcon name="up" /></button>
              <button className="le-rowbtn" onClick={() => moveLine(i, 1)} disabled={i === lines.length - 1} title={tr("lyricsEd.moveDown")}><ActionIcon name="down" /></button>
              <button className="le-rowbtn" onClick={() => dupLine(i)} title={tr("lyricsEd.dup")}><ActionIcon name="dup" /></button>
              <button className="le-rowbtn le-rowdel" onClick={() => delLine(i)} title={tr("lyricsEd.del")}><ActionIcon name="close" /></button>
            </div>
          ))}
          <div className="le-lines-foot">
            <button className="le-add" onClick={addLine}>＋ {tr("lyricsEd.add")}</button>
            <button className="le-clear" onClick={clearAll} disabled={!lines.length} title={tr("lyricsEd.clearAll")}>{tr("lyricsEd.clearAll")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TIcon({ name }: { name: "prev" | "play" | "pause" | "next" | "stop" }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      {name === "prev" && <path d="M7 6h2.4v12H7zM19 6v12l-8.6-6z" />}
      {name === "play" && <path d="M8 5.5v13l11-6.5z" />}
      {name === "pause" && <><rect x="7" y="5" width="3.4" height="14" rx="1" /><rect x="13.6" y="5" width="3.4" height="14" rx="1" /></>}
      {name === "next" && <path d="M5 6l8.6 6L5 18zM14.6 6H17v12h-2.4z" />}
      {name === "stop" && <rect x="6" y="6" width="12" height="12" rx="2" />}
    </svg>
  );
}

/** The 5 transport buttons (Back · Play · Next · Stop · PULL UP). Shared by the
 * Performance footer (cls="pt", big) and the Setlist footer (cls="ctl", compact) so the
 * two views are visually consistent. */
function TransportButtons({ state, send, cls }: { state: AppState; send: Send; cls: string }) {
  const { tr } = useT();
  const playing = state.transport.isPlaying;
  const cmd = (command: "prev" | "next" | "stop" | "panic") => () => send({ type: "command", command });
  const pc = state.settings.panicColor || "#e01e1e";
  const panicStyle = { background: `color-mix(in srgb, ${pc} 16%, transparent)`, color: `color-mix(in srgb, ${pc} 60%, white)`, borderColor: `color-mix(in srgb, ${pc} 50%, transparent)` };
  const panicLabel = state.settings.panicLabel || "PULL UP";
  return (
    <>
      <button className={cls} onClick={cmd("prev")} title={tr("transport.prev.title")}><TIcon name="prev" /></button>
      <button className={cls + " play" + (playing ? " on" : "")} onClick={() => send({ type: "command", command: playing ? "pause" : "play" })} title={tr("transport.play.title")}><TIcon name={playing ? "pause" : "play"} /></button>
      <button className={cls} onClick={cmd("next")} title={tr("transport.next.title")}><TIcon name="next" /></button>
      <button className={cls} onClick={cmd("stop")} title={tr("transport.stop.title")}><TIcon name="stop" /></button>
      <button className={cls + " pullup-btn"} style={panicStyle} onClick={cmd("panic")} title={tr("transport.panic.title", { label: panicLabel })}>{panicLabel}</button>
    </>
  );
}

function PerformanceTransport({ state, send }: { state: AppState; send: Send }) {
  return <footer className="perf-transport"><TransportButtons state={state} send={send} cls="pt" /></footer>;
}

function SongProgressBar({ state }: { state: AppState }) {
  const { setlist, currentEntryIndex, transport } = state;
  const cur = songOf(state, setlist[currentEntryIndex]);
  if (!cur || cur.endBeat == null || cur.endBeat <= cur.startBeat) return <div className="song-progress" />;
  const progress = rangeFrac(transport.time, cur.startBeat, cur.endBeat);
  return (
    <div className="song-progress">
      <div className="song-progress-fill" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

function TransportBar({ state, send }: { state: AppState; send: Send }) {
  const { tr } = useT();
  const { transport, currentEntryIndex } = state;
  const entry = state.setlist[currentEntryIndex];
  const song = entry ? state.library[entry.libIndex] : undefined;
  const inMedley = !!(entry?.linkedNext || song?.continuesNext); // current song flows into the next
  const nextIdx = nextActive(state.setlist, currentEntryIndex);
  const nextSong = nextIdx >= 0 ? state.library[state.setlist[nextIdx]!.libIndex] : undefined;
  return (
    <footer className="transport">
      <div className="meta">
        <div className="meta-title"><span className="mt-text">{song?.title ?? "—"}</span>{inMedley && <span className="medley-mark">⛓</span>}</div>
        <div className="meta-bpm">{(song?.key || entry?.key) ? (song?.key || entry?.key) + " · " : ""}{Math.round(transport.tempo)} BPM / {transport.sigNumerator}/{transport.sigDenominator}</div>
        {inMedley && nextSong && <div className="meta-next">{tr("perf.next.thenMedley")}: {nextSong.title}</div>}
      </div>
      <div className="controls">
        <ClickButton state={state} send={send} cls="ctl click-pill" />
        <TransportButtons state={state} send={send} cls="ctl" />
      </div>
    </footer>
  );
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.level}>{t.message}</div>
      ))}
    </div>
  );
}

function Dot({ ok, label, title }: { ok: boolean; label: string; title?: string }) {
  return <span className={"dot" + (ok ? " ok" : "")} title={title}>{label}</span>;
}
/** Metronome visual that overlays the CLICK button. "blink" flashes each beat (2 & 4 stronger),
 * "bars" fills one vertical bar per beat (earlier bars stay, dimmed). Active only while the click is
 * ON and playback is running. The beat is counted from the CURRENT SONG's downbeat (its locator), so
 * the song's first beat is always "1" — Ableton locators often don't sit on a global bar line, so the
 * global beat there could be e.g. 3. Render as the FIRST child of a position:relative button. */
function ClickViz({ state }: { state: AppState }) {
  const { transport } = state;
  const mode = state.settings.clickIndicator;
  const active = (mode === "blink" || mode === "bars") && transport.metronome && transport.isPlaying;
  if (!active) return null;
  const sig = transport.sigNumerator > 0 ? Math.min(transport.sigNumerator, 12) : 4;
  const cur = songOf(state, state.setlist[state.currentEntryIndex]);
  const songStart = cur ? cur.startBeat : 0;
  const count = Math.floor(transport.time - songStart + 1e-6); // whole beats since the song's downbeat
  const inBar = ((count % sig) + sig) % sig;
  if (mode === "bars") {
    return (
      <span className="ck-bars" aria-hidden="true">
        {Array.from({ length: sig }, (_, k) => (
          <span key={k} className={"ck-bar" + (k === inBar ? " on" : k < inBar ? " dim" : "")} />
        ))}
      </span>
    );
  }
  // blink — remount on each beat (key) restarts the fade; beats 2 & 4 (odd index) flash stronger.
  return <span key={count} className={"ck-blink" + (inBar % 2 === 1 ? " strong" : "")} aria-hidden="true" />;
}


/** CLICK toggle for a transport row — caller passes the full class (e.g. the Performance "pill click-pill"). */
function ClickButton({ state, send, cls }: { state: AppState; send: Send; cls: string }) {
  const { tr } = useT();
  const on = state.transport.metronome;
  return (
    <button
      className={cls + (on ? " on" : "")}
      onClick={() => send({ type: "command", command: "setMetronome", on: !on })}
      title={on ? tr("metronome.on.title") : tr("metronome.off.title")}
    ><ClickViz state={state} /><span className="ck-txt">CLICK {on ? "ON" : "OFF"}</span></button>
  );
}

const COLOR_PALETTE = [
  "#e23b3b", "#e2683b", "#e2953b", "#e2c23b", "#b5e23b", "#6be23b", "#3be268", "#3be2b5",
  "#3bc2e2", "#3b8fe2", "#3b5ae2", "#6b3be2", "#953be2", "#c23be2", "#e23bb5", "#e23b6b",
  "#cfcfcf", "#9a9a9a", "#5a5a5a", "#2a2a2a",
];
/** In-app colour picker: a palette grid + a "Custom" hex field. Replaces the native
 * OS colour dialog (which didn't match the app). */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { tr } = useT();
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const cur = (value || "#888888").toLowerCase();
  return (
    <div className="cp">
      <button className="cp-swatch" style={{ background: value || "#888888" }} title={tr("cp.swatch.title")} onClick={() => setOpen((o) => !o)} />
      {open && (
        <>
          <div className="cp-backdrop" onClick={() => setOpen(false)} />
          <div className="cp-pop">
            <div className="cp-grid">
              {COLOR_PALETTE.map((c) => (
                <button key={c} className={"cp-cell" + (c === cur ? " on" : "")} style={{ background: c }} title={c}
                  onClick={() => { onChange(c); setOpen(false); }} />
              ))}
            </div>
            <div className="cp-custom">
              <span className="cp-label">{tr("cp.custom")}</span>
              <span className="cp-preview" style={{ background: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "transparent" }} />
              <input className="cp-hex" value={hex} placeholder="#rrggbb" spellCheck={false}
                onChange={(e) => { const v = e.target.value; setHex(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v); }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
