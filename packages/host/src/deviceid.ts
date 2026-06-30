// A stable, privacy-preserving device id for the 3-device activation limit. We hash the OS machine
// GUID (survives reinstalls/format of the SAME computer, so re-activating doesn't burn a slot) and
// fall back to a persisted random UUID so it ALWAYS resolves. Only the HASH ever leaves the machine.
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

let cached: string | null = null;

function rawMachineId(): string | null {
  try {
    if (process.platform === "win32") {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: "utf8", windowsHide: true });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
      return m?.[1] ?? null;
    }
    if (process.platform === "darwin") {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", { encoding: "utf8" });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      return m?.[1] ?? null;
    }
    for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      try { const v = fs.readFileSync(f, "utf8").trim(); if (v) return v; } catch { /* next */ }
    }
  } catch { /* fall through to persisted fallback */ }
  return null;
}

/** A random id persisted in the data dir, used only when the OS machine id can't be read. */
function persistedFallback(): string {
  const dir = process.env.ABLEJAM_DATA_DIR || os.tmpdir();
  const p = path.join(dir, "device.id");
  try { const v = fs.readFileSync(p, "utf8").trim(); if (v) return v; } catch { /* create below */ }
  const v = crypto.randomUUID();
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(p, v); } catch { /* ephemeral */ }
  return v;
}

/** Hashed device id (hex, 40 chars). Stable per machine; cached for the process. */
export function deviceId(): string {
  if (cached) return cached;
  const raw = rawMachineId() ?? persistedFallback();
  cached = crypto.createHash("sha256").update("ablejam:" + raw).digest("hex").slice(0, 40);
  return cached;
}

/** A friendly label for the activation list, e.g. "DESKTOP-ABC · Windows". */
export function deviceName(): string {
  try {
    const plat = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : process.platform;
    return `${os.hostname()} · ${plat}`.slice(0, 80);
  } catch {
    return "AbleJam device";
  }
}
