// Read-only "is a real audio interface connected?" check, host machine side. The sound card is on
// the machine that runs Ableton (the host) — NOT on a remote tablet — so the check runs here and the
// boolean is broadcast in the app state. The Live API can't expose Ableton's selected audio device, so
// instead of guessing which device Live drives we answer a simpler, honest question: is a real audio
// INTERFACE present on the OS bus? A USB-class audio device (the Audient/Behringer/RME/… an act plugs
// in) qualifies; onboard HD-Audio (Realtek/AMD) and virtual cables (VB-Audio/Voicemeeter/…) do not.
//
// Windows: Win32_SoundDevice whose PNPDeviceID names a USB enumerator — "USB\…" or the Thesycon
// "TUSBAUDIO_ENUM\…" used by many pro interfaces (both contain "USB"); onboard is "HDAUDIO\…/PCI\…",
// virtual is "ROOT\…", neither matches. macOS: a system_profiler audio device on the USB transport.
import { exec } from "node:child_process";
import os from "node:os";

const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$ProgressPreference='SilentlyContinue'",
  "@(Get-CimInstance Win32_SoundDevice|?{$_.Status -eq 'OK' -and $_.PNPDeviceID -match 'USB'}).Count",
].join("\n");

/** True when a USB-class audio interface is present on the host (drives the audio indicator). */
export function hasAudioInterface(): Promise<boolean> {
  const p = os.platform();
  if (p === "win32") return checkWindows();
  if (p === "darwin") return checkMac();
  return Promise.resolve(true); // unknown platform: stay neutral (green), never a false alarm
}

function checkWindows(): Promise<boolean> {
  const enc = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`,
      { timeout: 12000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) { resolve(true); return; } // on a query error stay green (avoid a false disconnect alarm)
        resolve((parseInt(String(stdout).trim(), 10) || 0) > 0);
      },
    );
  });
}

function checkMac(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("system_profiler -json SPAudioDataType", { timeout: 12000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err || !stdout) { resolve(true); return; }
      try {
        const data = JSON.parse(stdout) as { SPAudioDataType?: Array<{ _items?: Array<Record<string, unknown>> }> };
        const items = data.SPAudioDataType?.[0]?._items ?? [];
        const usb = items.some((it) => /usb/i.test(String(it["coreaudio_device_transport"] ?? "")));
        resolve(usb);
      } catch {
        resolve(true);
      }
    });
  });
}
