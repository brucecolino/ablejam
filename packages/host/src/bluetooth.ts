// Read-only Bluetooth status + a shortcut to the OS pairing UI. An app can't PAIR a
// pedal — that is an OS operation — so we only LIST the connected ones and open the OS
// Bluetooth settings for pairing/disconnecting.
//
// We show ONLY input CONTROLLERS, never audio (headphones/speakers). Bluetooth foot
// controllers on the market speak one of two protocols:
//   • Bluetooth HID  (keyboard/consumer mode) — AirTurn, PageFlip, Donner, Coda, iKKEGOL…
//     the dominant kind; it enumerates as a Keyboard/HID/Mouse device on the Bluetooth bus.
//   • Bluetooth LE-MIDI — iRig BlueBoard, M-Vave, etc.; it shows up as a MIDI input port.
// AbleJam drives pedals in keyboard mode (keystrokes captured by the shortcuts), so the
// list filters to HID input devices on the Bluetooth bus and resolves each to its real
// product name. Every audio profile (A2DP/AVRCP/Hands-Free/MEDIA) is left out.
import { exec } from "node:child_process";
import os from "node:os";

// PowerShell: collect the 12-hex address of every Bluetooth HID input device, then return
// the friendly names of the paired peripherals (DEV_ roots) whose address matches one of
// them. The address is the LAST 12-hex group of the InstanceId (the leading groups are the
// service UUID, whose tail 00805F9B34FB is the Bluetooth base — explicitly ignored).
const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$ProgressPreference='SilentlyContinue'", // keep Get-PnpDevice progress out of stdout
  "function Addr($id){ $m=[regex]::Matches($id,'[0-9A-Fa-f]{12}'); if($m.Count){ $m[$m.Count-1].Value.ToUpperInvariant() } }",
  "$ctrl=Get-PnpDevice -PresentOnly|?{$_.Status -eq 'OK' -and $_.Class -in 'Keyboard','HIDClass','Mouse' -and $_.InstanceId -like 'BTH*'}",
  "$addrs=@($ctrl|%{Addr $_.InstanceId}|?{$_ -and $_ -ne '00805F9B34FB'}|Sort-Object -Unique)",
  // '*\\DEV_*' matches only the paired-device ROOT nodes (BTHENUM\\DEV_, BTHLE\\DEV_) — never
  // the BLE GATT service sub-nodes under BTHLEDevice\\Dev_, which would leak generic names.
  "$roots=Get-PnpDevice -PresentOnly|?{$_.Status -eq 'OK' -and $_.InstanceId -like 'BTH*' -and $_.InstanceId -like '*\\DEV_*'}",
  "$roots|?{$a=Addr $_.InstanceId; $a -and ($addrs -contains $a)}|Select-Object -ExpandProperty FriendlyName|Sort-Object -Unique",
].join("\n");

/** Names of the currently-connected Bluetooth CONTROLLERS (pedals/keyboards). [] elsewhere. */
export function listBluetooth(): Promise<string[]> {
  if (os.platform() !== "win32") return Promise.resolve([]);
  // -EncodedCommand (UTF-16LE base64) sidesteps every cmd.exe quoting pitfall.
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

/** Open the OS Bluetooth settings (where the user pairs / disconnects devices). explorer.exe
 * reliably launches the ms-settings: URI (plain `start` mis-parses the colon as a title). */
export function openBluetoothSettings(): void {
  const p = os.platform();
  if (p === "win32") exec('explorer.exe "ms-settings:bluetooth"', { windowsHide: true }, () => {});
  else if (p === "darwin") exec("open 'x-apple.systempreferences:com.apple.preference.Bluetooth'", () => {});
}
