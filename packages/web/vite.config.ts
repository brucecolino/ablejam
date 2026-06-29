import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The real app version comes from the desktop package (what the installers ship as), so the
// in-app "version" is always accurate instead of a hardcoded string.
const APP_VERSION = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react()],
  // host:true exposes the dev server on the LAN so phones/tablets can connect.
  // Dedicated port (strict) to avoid clashing with other Vite projects.
  server: { host: true, port: 4747, strictPort: true },
});
