import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host:true exposes the dev server on the LAN so phones/tablets can connect.
  // Dedicated port (strict) to avoid clashing with other Vite projects.
  server: { host: true, port: 4747, strictPort: true },
});
