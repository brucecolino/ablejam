// Bundle the AbleJam host into one ESM file that the Electron main loads via dynamic import().
// - format MUST be ESM: persist.ts / server.ts / midiout.ts use import.meta.url; CJS would break them.
// - @ablejam/shared is INLINED (raw TS, no build of its own).
// - The native module + the CJS doc parsers stay EXTERNAL: @julusian/midi (native .node, asarUnpacked),
//   ws, mammoth, and pdf-parse (imported via its inner path 'pdf-parse/lib/pdf-parse.js').
import { build, context } from "esbuild";

const opts = {
  entryPoints: ["src/forked.ts"],
  outfile: "dist/host/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
  external: ["@julusian/midi", "ws", "mammoth", "pdf-parse", "pdf-parse/*"],
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("[build-host] watching…");
} else {
  await build(opts);
  console.log("[build-host] dist/host/index.mjs written");
}
