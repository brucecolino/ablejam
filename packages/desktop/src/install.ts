// Main-process helpers wired into the app menu. No string interpolation into a shell —
// install.ps1 is invoked via spawn() with an args array.
import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** Resolve a bundled resource (install.ps1 / installer/ / bridge/) in both dev and packaged
 * builds. In dev it sits at the repo root; packaged it's an extraResource under resourcesPath. */
function resolveResource(resourcesRoot: string, rel: string): string {
  return path.join(resourcesRoot, rel);
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

/** Windows: run the bundled installer (loopMIDI + control surface, with its own UAC). */
function installBridgeWin(resourcesRoot: string): void {
  const ps1 = resolveResource(resourcesRoot, "install.ps1");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { detached: true, stdio: "ignore", windowsHide: false },
  );
  child.on("error", (err) => {
    void dialog.showMessageBox({ type: "error", title: "AbleJam", message: "Avvio installer fallito", detail: String(err) });
  });
  child.unref();
}

/** macOS: copy the control surface into ~/Music/Ableton/User Library/Remote Scripts/AbleJam.
 * No loopMIDI on mac — the PANIC note uses the built-in IAC Driver (the user enables it once
 * in Audio MIDI Setup; midiout.ts auto-picks any port matching /iac|virtual/). */
function installBridgeMac(resourcesRoot: string): void {
  const src = resolveResource(resourcesRoot, path.join("bridge", "AbleJam"));
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
    type: "info", title: "AbleJam", message: "Bridge installato",
    detail:
      `Control surface copiato in:\n${dest}\n\n` +
      "Passi finali:\n" +
      "1. Esci e riapri Ableton Live 12.\n" +
      "2. Settings → Link, Tempo & MIDI → Control Surface: seleziona \"AbleJam\".\n" +
      "3. Per il PANIC: Audio MIDI Setup → finestra IAC Driver → spunta \"Device is online\".\n" +
      "4. In Live instrada la traccia drum: MIDI From = IAC Driver, Monitor = In.\n" +
      "5. In AbleJam → Impostazioni → Panic: porta = IAC Driver (o Automatico).",
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
