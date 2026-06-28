// Copy static assets the packaged main loads by path (loadFile/icon) into dist/, so the
// same __dirname-relative paths work in dev and inside app.asar.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(here, "dist"), { recursive: true });

const assets = ["splash.html"];
for (const a of assets) {
  const src = path.join(here, a);
  if (existsSync(src)) {
    copyFileSync(src, path.join(here, "dist", a));
    console.log(`[copy-assets] ${a} -> dist/${a}`);
  }
}

// Optional branded window icon — copied only if present (otherwise Electron's default is used).
const icon = path.join(here, "build", "icon.png");
if (existsSync(icon)) {
  copyFileSync(icon, path.join(here, "dist", "icon.png"));
  console.log("[copy-assets] build/icon.png -> dist/icon.png");
}
