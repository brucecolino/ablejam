// In-app updates from the public GitHub Releases of brucecolino/ablejam.
// The app is UNSIGNED, so we don't use electron-updater's silent install (Squirrel.Mac
// needs a signature). Instead: read the latest release over the public API, compare
// versions, then download the right installer and hand it to the OS — Windows runs the
// NSIS installer (the app quits so it can replace files), macOS opens the .dmg.
import { app, shell } from "electron";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import https from "node:https";

const REPO = "brucecolino/ablejam";
const UA = "AbleJam-Updater";

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  assetName: string | null;
  platform: NodeJS.Platform;
  /** No matching installer asset for this OS/arch (info only). */
  noAsset: boolean;
}

/** Compare dotted numeric versions: returns >0 if a>b, <0 if a<b, 0 if equal. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function getJson(url: string, redirects = 0): Promise<any> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error("too many redirects")); return; }
    https.get(url, { headers: { "User-Agent": UA, Accept: "application/vnd.github+json" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(getJson(res.headers.location, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e as Error); } });
    }).on("error", reject);
  });
}

interface Asset { name: string; browser_download_url: string }

/** Pick the installer asset for this OS + arch. */
function pickAsset(assets: Asset[]): Asset | null {
  if (process.platform === "win32") return assets.find((a) => /^AbleJam-Setup-.*\.exe$/i.test(a.name)) ?? null;
  if (process.platform === "darwin") {
    const dmgs = assets.filter((a) => /\.dmg$/i.test(a.name));
    const arm = process.arch === "arm64";
    return dmgs.find((a) => (arm ? /-arm64\.dmg$/i.test(a.name) : !/-arm64\.dmg$/i.test(a.name))) ?? dmgs[0] ?? null;
  }
  return null;
}

let cachedAsset: Asset | null = null;

export async function checkForUpdate(): Promise<UpdateInfo> {
  const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const latest = String(rel.tag_name || "").replace(/^v/, "");
  const current = app.getVersion();
  cachedAsset = pickAsset(Array.isArray(rel.assets) ? rel.assets : []);
  return {
    current,
    latest,
    available: !!latest && cmpVersion(latest, current) > 0,
    notes: String(rel.body || "").slice(0, 4000),
    assetName: cachedAsset?.name ?? null,
    platform: process.platform,
    noAsset: !cachedAsset,
  };
}

function download(url: string, dest: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error("too many redirects")); return; }
    https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(download(res.headers.location, dest, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    }).on("error", reject);
  });
}

/** Download the installer for this OS and hand it to the user.
 * Windows: launch the NSIS installer, then quit so it can replace files.
 * macOS: open the .dmg (the user drags AbleJam to Applications). */
export async function downloadAndInstall(): Promise<{ ok: boolean; error?: string }> {
  const info = await checkForUpdate();
  if (!info.available) return { ok: false, error: "up-to-date" };
  if (!cachedAsset) return { ok: false, error: "no-asset" };
  const dir = path.join(app.getPath("temp"), "ablejam-update");
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  const dest = path.join(dir, cachedAsset.name);
  try {
    await download(cachedAsset.browser_download_url, dest);
  } catch (e) {
    return { ok: false, error: `download failed: ${(e as Error).message}` };
  }
  await shell.openPath(dest);
  if (process.platform === "win32") setTimeout(() => app.quit(), 2000);
  return { ok: true };
}
