// Direct MIDI output from the host (Plan B): AbleJam opens a MIDI port itself and
// sends the panic note — so no control-surface "Output" needs configuring in Live.
// Uses @julusian/midi (ships prebuilt binaries; no build tools). Fails soft: if the
// native lib or a port is unavailable, every call no-ops/returns false and the
// caller falls back to the bridge's own MIDI path.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let midiMod: any = null;
let tried = false;
function getMidi(): any {
  if (tried) return midiMod;
  tried = true;
  try {
    const m = require("@julusian/midi");
    midiMod = m?.default ?? m;
  } catch (e) {
    console.warn("[host] uscita MIDI diretta non disponibile:", (e as Error)?.message);
    midiMod = null;
  }
  return midiMod;
}

/** True when the native MIDI lib loaded (so the host can open ports itself). */
export function isAvailable(): boolean {
  return getMidi() != null;
}

function names(out: any): string[] {
  const n = out.getPortCount();
  const list: string[] = [];
  for (let i = 0; i < n; i++) list.push(String(out.getPortName(i)));
  return list;
}

/** Names of all MIDI output ports the host can see. */
export function listOutputs(): string[] {
  const m = getMidi();
  if (!m) return [];
  let out: any = null;
  try {
    out = new m.Output();
    return names(out);
  } catch {
    return [];
  } finally {
    try { out?.closePort?.(); } catch { /* not opened */ }
  }
}

/** Pick the port index. Explicit name (exact, then substring) is used as-is — so the
 * user can deliberately pick the Windows GM synth for a quick test. "Automatic" ("")
 * only ever targets a virtual/loopback port (loopMIDI): it must NEVER fall back to
 * the GM synth, which would make a surprise piano instead of driving the user's rig.
 * Returns -1 when nothing suitable is found. */
function pickIndex(list: string[], preferred: string): number {
  if (preferred) {
    const exact = list.indexOf(preferred);
    if (exact >= 0) return exact;
    return list.findIndex((n) => n.toLowerCase().includes(preferred.toLowerCase()));
  }
  const loop = list.findIndex((n) => /loop|virtual|iac|ablejam/i.test(n));
  if (loop >= 0) return loop;
  return list.findIndex((n) => !/wavetable|microsoft gs/i.test(n)); // -1 if only GM-like
}

// Keep the chosen output OPEN and reuse it. Re-opening a Windows MIDI port on every
// note is what made the Panic fire only intermittently (open/close churn + the 200 ms
// close racing the next note). We resolve the port by name each call (cheap, no open)
// and only (re)open when the selection actually changes.
let openOut: { name: string; preferred: string; out: any } | null = null;

function ensureOpen(m: any, preferred: string): { name: string; out: any } | null {
  if (openOut && openOut.preferred === preferred) return openOut; // reuse without re-enumerating
  const scan = new m.Output();
  const list = names(scan);
  try { scan.closePort?.(); } catch { /* not opened */ }
  if (list.length === 0) return null;
  const idx = pickIndex(list, preferred || "");
  if (idx < 0) return null;
  if (openOut) { try { openOut.out.closePort(); } catch { /* ignore */ } openOut = null; }
  const out = new m.Output();
  out.openPort(idx);
  openOut = { name: list[idx]!, preferred, out };
  return openOut;
}

/** Fire a short panic/PULL UP note on the chosen (or auto) port. Built to fire EVERY
 * time: the port is opened once and reused, a held note is cleared before each hit so it
 * always retriggers, and a failure (e.g. loopMIDI restarted) drops the cache + retries. */
export function sendNote(preferred: string, note: number): string | null {
  const m = getMidi();
  if (!m) return null;
  const pitch = Math.max(0, Math.min(127, Math.round(note)));
  const fire = (): string | null => {
    const target = ensureOpen(m, preferred || "");
    if (!target) return null;
    const out = target.out;
    out.sendMessage([0x80, pitch, 0]);   // clear any held note -> guarantees a retrigger
    out.sendMessage([0x90, pitch, 110]); // note on, channel 1
    setTimeout(() => { try { out.sendMessage([0x80, pitch, 0]); } catch { /* ignore */ } }, 200);
    return target.name;
  };
  try {
    return fire();
  } catch {
    try { openOut?.out.closePort(); } catch { /* ignore */ }
    openOut = null;                      // stale port (loopMIDI restarted?) -> reopen + retry once
    try { return fire(); } catch { openOut = null; return null; }
  }
}

/** Close the cached MIDI out port (Electron quit teardown). No-op if none is open. */
export function closeOutput(): void {
  try { openOut?.out.closePort(); } catch { /* ignore */ }
  openOut = null;
}
