// Single esbuild bundling root for the host. Re-exporting startHost here pulls in the
// whole host graph (and inlines @ablejam/shared) into one ESM file that main.cjs loads via
// dynamic import(). Named "forked" because it's also the seam where a parentPort handshake
// would live if the host is ever moved to a utilityProcess — no host changes needed for that.
export { startHost } from "@ablejam/host";
