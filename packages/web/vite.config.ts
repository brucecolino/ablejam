import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The real app version comes from the desktop package (what the installers ship as), so the
// in-app "version" is always accurate instead of a hardcoded string.
const APP_VERSION = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react()],
  // Old iPads used as stage displays run an old WebKit. Vite 5's default target (Safari 14+) ships
  // ES2020+ syntax the bundle actually uses — nullish `??` (Safari 13.4+) and class private `#fields`
  // (Safari 14.1+) — which old Safari can't even PARSE, so the whole script throws and the page is
  // blank/black. Lower the target so esbuild transpiles the syntax down (support floor ~iOS 12).
  // Modern browsers + the Electron desktop are unaffected.
  build: { target: ["es2015", "safari11"] },
  // host:true exposes the dev server on the LAN so phones/tablets can connect.
  // Dedicated port (strict) to avoid clashing with other Vite projects.
  server: { host: true, port: 4747, strictPort: true },
});
