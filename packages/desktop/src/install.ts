// Main-process helpers wired into the app menu. No string interpolation into a shell —
// install.ps1 is invoked via spawn() with an args array.
import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** Resolve a bundled resource (install.ps1 / installer/ / bridge/) in both dev and packaged
 * builds. In dev it sits at the repo root; packaged it's an extraResource under resourcesPath. */
function resolveResource(resourcesRoot: string, rel: string): string {
  return path.join(resourcesRoot, rel);
}

/** Read BRIDGE_VERSION from the bundled ablejam.py so install dialogs can show exactly which
 * bridge version is being copied (the user can then compare it to what Live reports). */
function bundledBridgeVersion(src: string): string {
  try {
    const py = readFileSync(path.join(src, "ablejam.py"), "utf8");
    const m = py.match(/BRIDGE_VERSION\s*=\s*(\d+)/);
    return m ? `v${m[1]}` : "?";
  } catch {
    return "?";
  }
}

/** Candidate "Documents" bases where an Ableton User Library might live, most reliable first.
 * OneDrive-aware: Windows commonly redirects Documents into OneDrive\Documenti (or \Documents),
 * and Live loads its control surfaces from THAT copy — the classic "my update didn't take" trap. */
function documentsBases(): string[] {
  const bases: string[] = [];
  try { bases.push(app.getPath("documents")); } catch { /* ignore */ }
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
  if (oneDrive) {
    bases.push(path.join(oneDrive, "Documenti"));
    bases.push(path.join(oneDrive, "Documents"));
  }
  bases.push(path.join(os.homedir(), "Documents"));
  return [...new Set(bases.filter(Boolean))];
}

/** Copy the control surface into EVERY Documents base that already has an Ableton User Library
 * (mirrors bridge/install.ps1), so the copy Live actually loads gets overwritten. Returns the
 * destination paths written. Reliable + synchronous — no PowerShell needed for the bridge itself. */
function copyControlSurfaceWin(src: string): string[] {
  const written: string[] = [];
  for (const base of documentsBases()) {
    const userLib = path.join(base, "Ableton", "User Library");
    if (!existsSync(userLib)) continue;
    const dest = path.join(userLib, "Remote Scripts", "AbleJam");
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      written.push(dest);
    } catch { /* try the next base */ }
  }
  if (written.length === 0) {
    // No existing User Library found — seed one under the (possibly redirected) Documents folder.
    const dest = path.join(documentsBases()[0] ?? path.join(os.homedir(), "Documents"), "Ableton", "User Library", "Remote Scripts", "AbleJam");
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      written.push(dest);
    } catch { /* reported by caller */ }
  }
  return written;
}

/** Run the Windows installer (loopMIDI + AbleJam control surface into Ableton's User Library).
 * install.ps1 uses $PSScriptRoot to find installer\loopMIDISetup.exe and bridge\install.ps1 as
 * SIBLINGS — extraResources preserves that layout. macOS uses the IAC Driver instead. */
export function installBridge(resourcesRoot: string): void {
  if (process.platform === "win32") { installBridgeWin(resourcesRoot); return; }
  if (process.platform === "darwin") { installBridgeMac(resourcesRoot); return; }
  void dialog.showMessageBox({
    type: "info", title: "AbleJam", message: "Installazione bridge",
    detail: "Copia la cartella bridge/AbleJam nella User Library di Ableton (Remote Scripts) e riavvia Live.",
  });
}

/** Windows: copy the control surface ourselves (reliable, with clear feedback), then kick off the
 * loopMIDI setup as a best-effort side task. The old flow ran the whole install.ps1 detached with
 * NO feedback, and its loopMIDI step could abort ($ErrorActionPreference=Stop) BEFORE the bridge
 * copy — so the button looked like it did nothing and the bridge never updated. */
function installBridgeWin(resourcesRoot: string): void {
  const src = resolveResource(resourcesRoot, path.join("bridge", "AbleJam"));
  const ver = bundledBridgeVersion(src);
  if (!existsSync(src)) {
    void dialog.showMessageBox({ type: "error", title: "AbleJam", message: "Installazione bridge fallita", detail: `Sorgente bridge non trovata: ${src}` });
    return;
  }
  const dests = copyControlSurfaceWin(src);
  if (dests.length === 0) {
    void dialog.showMessageBox({ type: "error", title: "AbleJam", message: "Installazione bridge fallita", detail: "Impossibile copiare la control surface nella User Library di Ableton. Chiudi Ableton e riprova." });
    return;
  }

  // loopMIDI (virtual port for the Panic note) is secondary — run it detached, and never let it
  // block or undo the bridge copy above. install.ps1 -SkipBridge only touches loopMIDI now.
  try {
    const ps1 = resolveResource(resourcesRoot, "install.ps1");
    if (existsSync(ps1)) {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-SkipBridge"],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      child.on("error", () => { /* loopMIDI is optional; the bridge is already installed */ });
      child.unref();
    }
  } catch { /* optional */ }

  void dialog.showMessageBox({
    type: "info", title: "AbleJam", message: `Bridge installato (${ver})`,
    detail:
      `Control surface copiata in:\n${dests.join("\n")}\n\n` +
      "Passi finali:\n" +
      "1. Esci COMPLETAMENTE e riapri Ableton Live 12.\n" +
      "2. Settings → Link, Tempo & MIDI → Superficie di controllo: seleziona \"AbleJam\".\n" +
      `3. Nella barra di stato di Live comparirà \"AbleJam bridge ${ver} connesso\".\n` +
      "4. In AbleJam (Impostazioni → Progetto Ableton) controlla che la versione bridge combaci.",
  });
}

/** macOS: copy the control surface into ~/Music/Ableton/User Library/Remote Scripts/AbleJam.
 * No loopMIDI on mac — the PANIC note uses the built-in IAC Driver (the user enables it once
 * in Audio MIDI Setup; midiout.ts auto-picks any port matching /iac|virtual/). */
function installBridgeMac(resourcesRoot: string): void {
  const src = resolveResource(resourcesRoot, path.join("bridge", "AbleJam"));
  const ver = bundledBridgeVersion(src);
  const dest = path.join(os.homedir(), "Music", "Ableton", "User Library", "Remote Scripts", "AbleJam");
  try {
    if (!existsSync(src)) throw new Error(`Sorgente bridge non trovata: ${src}`);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  } catch (err) {
    void dialog.showMessageBox({ type: "error", title: "AbleJam", message: "Installazione bridge fallita", detail: String(err) });
    return;
  }
  void dialog.showMessageBox({
    type: "info", title: "AbleJam", message: `Bridge installato (${ver})`,
    detail:
      `Control surface copiato in:\n${dest}\n\n` +
      "Passi finali:\n" +
      "1. Esci e riapri Ableton Live 12.\n" +
      "2. Settings → Link, Tempo & MIDI → Control Surface: seleziona \"AbleJam\".\n" +
      `3. Nella barra di stato di Live comparirà \"AbleJam bridge ${ver} connesso\".\n` +
      "4. La porta MIDI \"AbleJam\" viene creata automaticamente all'avvio dell'app (niente IAC/loopMIDI).\n" +
      "5. Per il PANIC: nella traccia drum imposta MIDI From = AbleJam, Monitor = In.",
  });
}

/** Open the writable data folder (setlists, lyrics, session) in the OS file manager. */
export function openDataFolder(): void {
  void shell.openPath(path.join(app.getPath("userData"), "ablejam-data"));
}

/** http://<first LAN IPv4>:<port> — the URL a tablet/phone on the same WiFi uses. */
export function lanUrl(port: number): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return `http://${ni.address}:${port}`;
    }
  }
  return `http://127.0.0.1:${port}`;
}
