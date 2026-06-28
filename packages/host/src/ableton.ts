// Read the open Ableton Live Set name + the Live version straight from the running process
// (same machine as the host) — no bridge/LOM round-trip needed. The window title is
// "<ProjectName> - Ableton Live 12 Suite"; the precise build comes from the exe's version info.
import { exec, execFile } from "node:child_process";
import os from "node:os";

export interface AbletonInfo { project: string; version: string }

const PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$ProgressPreference='SilentlyContinue'",
  "$p=Get-Process -Name '*Ableton*'|?{$_.MainWindowTitle}|Select-Object -First 1",
  "if($p){",
  "  $t=[string]$p.MainWindowTitle",
  // strip the trailing " - Ableton Live ..." (hyphen / en-dash / em-dash) to leave the Set name
  "  $proj=($t -replace '\\s*[-\\u2013\\u2014]\\s*Ableton.*$','').Trim()",
  "  if($proj -match 'Ableton'){ $proj='' }",
  "  $ver=''",
  "  try{ $ver=[string]$p.MainModule.FileVersionInfo.ProductVersion }catch{}",
  "  [pscustomobject]@{project=$proj;edition=[string]$p.Name;version=$ver}|ConvertTo-Json -Compress",
  "}",
].join("\n");

function readAbletonWin(): Promise<AbletonInfo | null> {
  const enc = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`,
      { timeout: 12000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) { resolve(null); return; }
        try {
          const d = JSON.parse(stdout) as { project?: string; edition?: string; version?: string };
          const edition = (d.edition || "Ableton Live").trim();
          const ver = (d.version || "").trim();
          const version = ver && !edition.includes(ver) ? `${edition} (${ver})` : edition;
          // Strip the trailing "*" Ableton adds for unsaved changes, so the project name (and the
          // lyrics-doc key) stays stable whether or not the Set has unsaved edits.
          resolve({ project: (d.project || "").trim().replace(/\*+$/, "").trim(), version });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// macOS: Ableton runs as the process "Live"; its front window title is the open Set's name
// (sometimes "Name — Ableton Live 12 Suite"). We read it via System Events. This needs the
// host (or the packaged AbleJam app) to be granted Automation/Accessibility permission the
// first time — until then osascript errors and we resolve null (the app still works; the
// project name is only used for per-project lyrics + a UI label). Tab-separated proj<TAB>ver.
const OSA_SCRIPT = [
  'tell application "System Events"',
  '  if not (exists process "Live") then return ""',
  '  set projName to ""',
  '  set appPath to ""',
  '  try',
  '    set projName to name of front window of process "Live"',
  '  end try',
  '  try',
  '    set appPath to POSIX path of (file of process "Live" as alias)',
  '  end try',
  '  return projName & "\t" & appPath',
  'end tell',
].join("\n");

function readAbletonMac(): Promise<AbletonInfo | null> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", OSA_SCRIPT], { timeout: 12000 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) { resolve(null); return; }
      const [rawProj = "", appPath = ""] = stdout.trim().split("\t");
      // App bundle name e.g. "Ableton Live 12 Suite.app" -> "Ableton Live 12 Suite".
      const m = appPath.match(/\/([^/]+?)\.app\/?$/);
      const version = (m?.[1] || "Ableton Live").trim();
      const proj = rawProj.replace(/\s*[—–-]\s*Ableton.*$/i, "").replace(/\*+$/, "").trim();
      resolve({ project: /ableton/i.test(proj) ? "" : proj, version });
    });
  });
}

/** The open Live Set + Ableton version, or null when Ableton isn't running / unsupported OS. */
export function readAbleton(): Promise<AbletonInfo | null> {
  const p = os.platform();
  if (p === "win32") return readAbletonWin();
  if (p === "darwin") return readAbletonMac();
  return Promise.resolve(null);
}
