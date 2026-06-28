// Bundle the Electron main + preload to CJS (dist/main.cjs, dist/preload.cjs).
// 'electron' is external (provided by the runtime). The host bundle is NOT bundled here —
// main loads dist/host/index.mjs at runtime via dynamic import().
import { build, context } from "esbuild";

const opts = {
  entryPoints: ["src/main.ts", "src/preload.ts"],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
  external: ["electron"],
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("[build-main] watching…");
} else {
  await build(opts);
  console.log("[build-main] dist/main.cjs + dist/preload.cjs written");
}
