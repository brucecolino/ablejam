// Mirror of packages/host/src/pdf-parse.d.ts — needed because typechecking the desktop
// package pulls in the host source (via @ablejam/host), which imports pdf-parse's inner
// module, and the host's own .d.ts isn't part of this package's compilation.
declare module "pdf-parse/lib/pdf-parse.js";
