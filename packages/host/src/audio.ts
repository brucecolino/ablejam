// Read-only audio-interface presence, host machine side. The sound card is on the machine that
// runs Ableton (the host) — NOT on a remote tablet — so enumeration happens here and the result is
// broadcast in the app state, like the Bluetooth list. The Live API can't expose Ableton's selected
// audio device, so we can't know which one Live drives; instead the user picks the interface to WATCH
// (Settings → Audio) and AbleJam flags it red + alerts when that device drops off the OS bus.
//
// Windows: Win32_SoundDevice gives one clean name per physical/virtual sound device ("Audient iD14",
// "Behringer …"); a present device has Status 'OK' and an unplugged USB interface disappears from the
// list entirely. macOS: system_profiler SPAudioDataType. Everywhere else: [] (no watcher).
import { exec } from "node:child_process";
import os from "node:os";

const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$ProgressPreference='SilentlyContinue'",
  "Get-CimInstance Win32_SoundDevice|?{$_.Status -eq 'OK'}|Select-Object -ExpandProperty Name|Sort-Object -Unique",
].join("\n");

/** Names of the audio devices currently present on the host machine (for the Audio watcher). [] off-host. */
export function listAudioDevices(): Promise<string[]> {
  const p = os.platform();
  if (p === "win32") return listWindows();
  if (p === "darwin") return listMac();
  return Promise.resolve([]);
}

function listWindows(): Promise<string[]> {
  const enc = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`,
      { timeout: 12000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }
        const names = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
        resolve(Array.from(new Set(names)));
      },
    );
  });
}

function listMac(): Promise<string[]> {
  return new Promise((resolve) => {
    exec("system_profiler -json SPAudioDataType", { timeout: 12000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      try {
        const data = JSON.parse(stdout) as { SPAudioDataType?: Array<{ _items?: Array<{ _name?: string }> }> };
        const items = data.SPAudioDataType?.[0]?._items ?? [];
        const names = items.map((it) => String(it?._name ?? "").trim()).filter((n) => n.length > 0);
        resolve(Array.from(new Set(names)));
      } catch {
        resolve([]);
      }
    });
  });
}
