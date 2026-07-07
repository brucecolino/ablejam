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

/** Pick the installer asset for this OS + arch from the API's asset list. */
function pickAsset(assets: Asset[]): Asset | null {
  if (process.platform === "win32") return assets.find((a) => /^AbleJam-Setup-.*\.exe$/i.test(a.name)) ?? null;
  if (process.platform === "darwin") {
    const dmgs = assets.filter((a) => /\.dmg$/i.test(a.name));
    const arm = process.arch === "arm64";
    return dmgs.find((a) => (arm ? /-arm64\.dmg$/i.test(a.name) : !/-arm64\.dmg$/i.test(a.name))) ?? dmgs[0] ?? null;
  }
  return null;
}

/** The installer asset name for this OS/arch at a given version, from the fixed electron-builder
 * naming — lets us build a download URL WITHOUT the API (used by the rate-limit fallback). */
function assetNameForVersion(v: string): string | null {
  if (process.platform === "win32") return `AbleJam-Setup-${v}.exe`;
  if (process.platform === "darwin") return process.arch === "arm64" ? `AbleJam-${v}-arm64.dmg` : `AbleJam-${v}.dmg`;
  return null;
}

/** Read the Location header of a single request WITHOUT following it. Used to read the latest tag
 * from github.com/<repo>/releases/latest, which 302-redirects to /releases/tag/vX.Y.Z. This host
 * is NOT the API, so it is not subject to the 60-req/hour unauthenticated rate limit. */
function redirectLocation(url: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      res.resume();
      const sc = res.statusCode ?? 0;
      if (sc >= 300 && sc < 400 && res.headers.location) resolve(res.headers.location);
      else resolve(null);
    }).on("error", reject);
  });
}

/** Latest published tag via the github.com redirect (rate-limit-free fallback for checkForUpdate). */
async function latestTagViaRedirect(): Promise<string | null> {
  let url = `https://github.com/${REPO}/releases/latest`;
  for (let i = 0; i < 6; i++) {
    const loc = await redirectLocation(url);
    if (!loc) return null;
    const tag = loc.match(/\/releases\/tag\/([^/?#]+)/)?.[1];
    if (tag) return decodeURIComponent(tag);
    url = loc.startsWith("http") ? loc : new URL(loc, url).toString();
  }
  return null;
}

let cachedAsset: Asset | null = null;

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  // Prefer the API (exact asset list + release notes). Fall back to the github.com redirect when
  // the API is unavailable — the UNauthenticated API is capped at 60 requests/hour per IP, which a
  // few manual "check for updates" plus app restarts can exhaust, returning HTTP 403.
  try {
    const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    cachedAsset = pickAsset(Array.isArray(rel.assets) ? rel.assets : []);
    return {
      current, latest,
      available: !!latest && cmpVersion(latest, current) > 0,
      notes: String(rel.body || "").slice(0, 4000),
      assetName: cachedAsset?.name ?? null,
      platform: process.platform,
      noAsset: !cachedAsset,
    };
  } catch (apiErr) {
    const tag = await latestTagViaRedirect();
    if (!tag) throw apiErr; // genuinely offline (or both paths failed) — surface the original error
    const latest = tag.replace(/^v/, "");
    const name = assetNameForVersion(latest);
    cachedAsset = name ? { name, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}` } : null;
    return {
      current, latest,
      available: !!latest && cmpVersion(latest, current) > 0,
      notes: "", // notes come from the API only; the in-app "what's new" modal covers them anyway
      assetName: cachedAsset?.name ?? null,
      platform: process.platform,
      noAsset: !cachedAsset,
    };
  }
}

export interface DownloadProgress { pct: number; mb: number; total: number }

function download(url: string, dest: string, onProgress?: (p: DownloadProgress) => void, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error("too many redirects")); return; }
    https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(download(res.headers.location, dest, onProgress, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const total = parseInt(String(res.headers["content-length"] || "0"), 10);
      let got = 0;
      let lastPct = -1;
      res.on("data", (chunk: Buffer) => {
        got += chunk.length;
        if (onProgress && total > 0) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct) { lastPct = pct; onProgress({ pct, mb: Math.round(got / 1e6), total: Math.round(total / 1e6) }); }
        }
      });
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    }).on("error", reject);
  });
}

/** Download the installer for this OS and hand it to the user (reporting progress).
 * Windows: launch the NSIS installer, then quit so it can replace files.
 * macOS: open the .dmg (the user drags AbleJam to Applications). */
export async function downloadAndInstall(onProgress?: (p: DownloadProgress) => void): Promise<{ ok: boolean; error?: string }> {
  const info = await checkForUpdate();
  if (!info.available) return { ok: false, error: "up-to-date" };
  if (!cachedAsset) return { ok: false, error: "no-asset" };
  const dir = path.join(app.getPath("temp"), "ablejam-update");
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  const dest = path.join(dir, cachedAsset.name);
  try {
    await download(cachedAsset.browser_download_url, dest, onProgress);
  } catch (e) {
    return { ok: false, error: `download failed: ${(e as Error).message}` };
  }
  await shell.openPath(dest);
  if (process.platform === "win32") setTimeout(() => app.quit(), 2000);
  return { ok: true };
}
