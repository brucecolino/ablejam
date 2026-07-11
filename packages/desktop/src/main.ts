// AbleJam desktop window (Electron main). Boots the AbleJam host IN this process, then
// points an AbleJam-styled window at the host's local UI (http://127.0.0.1:3700).
//
// Ordering is load-bearing:
//   1. single-instance lock   (guards the fixed ports 39061/39062/3700)
//   2. crash guards           (a host throw must not silently kill the app)
//   3. resolve paths + env    (set BEFORE importing the host — persist/server read env at module-eval)
//   4. whenReady -> splash -> startHost -> wait for :3700 -> show main window
//   5. graceful teardown on quit (release timers, watchers, MIDI, UDP, http+ws)
import { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, ipcMain } from "electron";
import path from "node:path";
import net from "node:net";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installBridge, openDataFolder, lanUrl, autoUpdateBridge } from "./install";
import { checkForUpdate, downloadAndInstall } from "./update";

const HOST_PORT = 3700;

// ---- 1. single-instance lock --------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  // eslint-disable-next-line no-process-exit
  process.exit(0);
}

// Windows taskbar identity: bind the running process to the installed app's AppUserModelID
// (matches electron-builder's appId). Without this Windows treats the Electron host as a
// generic app and shows its default icon in the taskbar instead of AbleJam's.
if (process.platform === "win32") app.setAppUserModelId("com.ablejam.app");

let mainWin: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;
let hostHandle: { ready: Promise<void>; close: () => Promise<void> } | null = null;
let quitting = false;
let closeToTray = false; // when true, closing the window hides it (app keeps running) instead of quitting

/** Bring the (possibly hidden/minimized) main window back to the foreground. */
function showWindow(): void {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

/** A small tray icon so a background-running AbleJam can be reopened or quit (no window otherwise). */
function ensureTray(): void {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip("AbleJam");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Mostra AbleJam", click: showWindow },
      { type: "separator" },
      { label: "Esci", click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on("click", showWindow);
    tray.on("double-click", showWindow);
  } catch { /* tray is optional */ }
}
let pendingActivateKey: string | null = null;

// ---- one-click license activation: ablejam://activate?key=… (from the customer area) --------
// Register the custom scheme so the OS routes ablejam:// links here. A bogus link is harmless:
// the host verifies the Ed25519 signature before activating, so an invalid key is just ignored.
if (process.defaultApp) {
  const devArg = process.argv[1];
  if (devArg) app.setAsDefaultProtocolClient("ablejam", process.execPath, [path.resolve(devArg)]);
} else {
  app.setAsDefaultProtocolClient("ablejam");
}

function activateKeyFromArg(arg: string): string | null {
  if (typeof arg !== "string" || !arg.startsWith("ablejam://")) return null;
  try {
    const u = new URL(arg);
    if (u.hostname === "activate" || u.pathname.replace(/\//g, "") === "activate") return u.searchParams.get("key");
  } catch { /* not a URL */ }
  return null;
}

function flushActivateKey(): void {
  if (pendingActivateKey && mainWin && !mainWin.webContents.isLoading()) {
    mainWin.webContents.send("ablejam:activate-key", pendingActivateKey);
    pendingActivateKey = null;
  }
}

function deliverActivateKey(key: string): void {
  pendingActivateKey = key;
  if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  flushActivateKey();
}

// Cold start carrying the link (Windows passes it as an argv).
{
  const coldKey = process.argv.map(activateKeyFromArg).find(Boolean);
  if (coldKey) pendingActivateKey = coldKey;
}

app.on("second-instance", (_e, argv) => {
  const key = argv.map(activateKeyFromArg).find(Boolean);
  if (key) { deliverActivateKey(key); return; }
  showWindow(); // relaunching AbleJam brings a background/hidden window back to the front
});

// macOS: clicking the dock icon reopens the (hidden-to-background) window.
app.on("activate", showWindow);

// macOS delivers the link via open-url (can fire before the window exists).
app.on("open-url", (_e, url) => {
  const key = activateKeyFromArg(url);
  if (key) deliverActivateKey(key);
});

// ---- 2. crash guards ----------------------------------------------------------------
function fatal(context: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
  console.error(`[ablejam] ${context}:`, msg);
  try { dialog.showErrorBox("AbleJam", `${context}\n\n${msg}`); } catch { /* before ready */ }
}
process.on("uncaughtException", (e) => fatal("Errore imprevisto (host)", e));
process.on("unhandledRejection", (e) => fatal("Promessa non gestita (host)", e));

// ---- 3. paths + env -----------------------------------------------------------------
const isDev = !app.isPackaged;
// In dev __dirname is packages/desktop/dist; the repo root is three levels up.
const resourcesRoot = isDev ? path.resolve(__dirname, "..", "..", "..") : process.resourcesPath;

/** True if a data dir already holds the user's data (its session.json carries the settings +
 * LICENSE, or it has saved setlists). */
function hasUserData(dataDir: string): boolean {
  try {
    if (existsSync(path.join(dataDir, "session.json"))) return true;
    return readdirSync(path.join(dataDir, "setlists")).some((f) => f.endsWith(".json"));
  } catch { return false; }
}

/** Resolve the data dir to wherever the user's data ACTUALLY is, without moving anything.
 *
 * The historical default is <app.getPath("userData")>/ablejam-data, but userData depends on
 * app.getName(), which has been both "@ablejam/desktop" (package name, slash → nested folder) and
 * "AbleJam" (electron-builder productName) across builds. If the default is empty but a known
 * alternate location still holds the data (setlists + the licence in session.json), USE that folder
 * in place — never copy/relocate (a bad copy once left the app pointed at an empty, unlicensed
 * folder → locked to the demo). This keeps every existing install on its real data. */
function resolveDataDir(): string {
  const primary = path.join(app.getPath("userData"), "ablejam-data");
  if (hasUserData(primary)) return primary; // the normal case — this is where installs already write
  for (const alt of [
    path.join(app.getPath("appData"), "@ablejam", "desktop", "ablejam-data"),
    path.join(app.getPath("appData"), "AbleJam", "ablejam-data"),
  ]) {
    if (path.resolve(alt) !== path.resolve(primary) && hasUserData(alt)) return alt;
  }
  return primary; // fresh install — nothing anywhere yet
}

function configureHostEnv(): void {
  if (isDev) {
    // Dev parity with `pnpm start`: reuse the repo's existing .ablejam-data + packages/web/dist
    // by leaving the overrides UNSET (the host falls back to its repo-relative paths).
    return;
  }
  process.env.ABLEJAM_DATA_DIR = resolveDataDir();
  process.env.ABLEJAM_WEB_DIST = path.join(process.resourcesPath, "web");
  process.env.ABLEJAM_SPEECH_DIR = path.join(process.resourcesPath, "speech"); // default guide audio
}

// net.connect poll: resolves once something accepts on 127.0.0.1:HOST_PORT (fallback to the
// in-process ready Promise). 127.0.0.1 (not "localhost") dodges IPv6 ::1 resolution stalls.
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = (): void => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not up within ${timeoutMs}ms`));
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

function createSplash(): void {
  splash = new BrowserWindow({
    width: 420, height: 280, frame: false, resizable: false, center: true,
    backgroundColor: "#0b0b0c", show: false, skipTaskbar: false, title: "AbleJam",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Show only once the splash HTML has painted. On Windows a frameless window shown BEFORE its
  // first paint renders transparent (you see the desktop through it) — that was the bug.
  splash.once("ready-to-show", () => splash?.show());
  void splash.loadFile(path.join(__dirname, "splash.html"));
  splash.on("closed", () => { splash = null; });
}

function createMainWindow(): void {
  const iconPng = path.join(__dirname, "icon.png");
  mainWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: "#0b0b0c", // kills the white flash before first paint
    title: "AbleJam",
    show: false,
    autoHideMenuBar: true,
    icon: process.platform === "win32" && existsSync(iconPng) ? iconPng : undefined,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep WS + timers alive when the window is backgrounded on stage
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // External links open in the real browser, never a new Electron window.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Right-click Cut/Copy/Paste on inputs. macOS shows NO context menu by default, so the license
  // key field couldn't be pasted into via right-click (nor could any text field). Give editable
  // targets the standard actions, and offer Copy when there's a selection.
  mainWin.webContents.on("context-menu", (_e, params) => {
    const hasSel = params.selectionText.trim().length > 0;
    if (!params.isEditable && !hasSel) return;
    const items: Electron.MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: "cut", enabled: hasSel },
          { role: "copy", enabled: hasSel },
          { role: "paste" },
          { type: "separator" },
          { role: "selectAll" },
        ]
      : [{ role: "copy" }];
    Menu.buildFromTemplate(items).popup();
  });

  // Cover the open-port-but-route-still-racing window with a few retries.
  let retries = 0;
  mainWin.webContents.on("did-fail-load", () => {
    if (retries++ < 5 && mainWin) setTimeout(() => mainWin?.loadURL(`http://127.0.0.1:${HOST_PORT}`), 300);
  });
  // Deliver any deep-link key captured before the UI finished loading (cold start / mac open-url).
  mainWin.webContents.on("did-finish-load", flushActivateKey);
  mainWin.once("ready-to-show", () => {
    mainWin?.show();
    splash?.destroy();
    splash = null;
  });
  // "Close to background": hide the window (host keeps running) instead of quitting, so connected
  // devices/Ableton stay linked. Reopen from the tray or by relaunching AbleJam. Real quits (menu
  // Esci / tray Esci / before-quit) set `quitting` first, so they close normally.
  mainWin.on("close", (e) => {
    if (closeToTray && !quitting) { e.preventDefault(); mainWin?.hide(); ensureTray(); }
  });
  mainWin.on("closed", () => { mainWin = null; });

  // Keep the renderer's fullscreen button in sync with the REAL window state (F11, native events).
  mainWin.on("enter-full-screen", () => mainWin?.webContents.send("ablejam:fullscreen-changed", true));
  mainWin.on("leave-full-screen", () => mainWin?.webContents.send("ablejam:fullscreen-changed", false));
  // F11 toggles fullscreen natively (Escape never traps the user — the on-screen button + tray remain).
  // `!isAutoRepeat` so HOLDING F11 doesn't rapid-fire the toggle (flicker / transient black frames);
  // preventDefault so F11 is reserved for fullscreen and never also fires a bound transport shortcut.
  mainWin.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && !input.isAutoRepeat && input.key === "F11" && mainWin) {
      e.preventDefault();
      mainWin.setFullScreen(!mainWin.isFullScreen());
    }
  });

  void mainWin.loadURL(`http://127.0.0.1:${HOST_PORT}`);
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    // Edit menu — REQUIRED on macOS for the ⌘X/⌘C/⌘V/⌘A shortcuts to work in text fields (they are
    // routed through this menu; a custom app menu without it silently disables paste). Harmless on Windows.
    {
      label: "Modifica",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "AbleJam",
      submenu: [
        { label: "Installa bridge Ableton + loopMIDI…", click: () => installBridge(resourcesRoot) },
        { label: "Apri cartella dati", click: () => openDataFolder() },
        { label: "Apri nel browser (LAN)", click: () => void shell.openExternal(lanUrl(HOST_PORT)) },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function boot(): Promise<void> {
  configureHostEnv();
  // Plug-and-play: silently (re)install the Ableton control surface whenever this app build ships a
  // newer bridge than what's installed — the user never clicks "Install bridge", they just restart
  // Ableton when the app tells them to. The bundled version is passed to the host so it can detect a
  // still-running old bridge and prompt for the restart.
  try {
    const b = autoUpdateBridge(resourcesRoot);
    process.env.ABLEJAM_BRIDGE_VERSION = String(b.bundled);
  } catch { /* non-fatal */ }
  createSplash();
  buildMenu();

  // macOS dock icon: the packaged .app uses the .icns for Finder, but set it at runtime too
  // so the dock always shows the AbleJam logo (and so it's branded in dev, where the bundled
  // electron has its own icon).
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = path.join(__dirname, "icon.png");
    if (existsSync(dockIcon)) app.dock.setIcon(dockIcon);
  }

  // ipc seams (reserved for a future in-UI "Install bridge" button).
  ipcMain.handle("ablejam:version", () => app.getVersion());
  ipcMain.handle("ablejam:install-bridge", () => { installBridge(resourcesRoot); });
  ipcMain.handle("ablejam:update-check", () => checkForUpdate());
  ipcMain.handle("ablejam:update-install", (event) => downloadAndInstall((p) => event.sender.send("ablejam:update-progress", p)));
  ipcMain.handle("ablejam:set-close-to-tray", (_e, v: boolean) => { closeToTray = !!v; }); // web mirrors the setting here
  ipcMain.handle("ablejam:toggle-fullscreen", () => {
    if (!mainWin) return false;
    const next = !mainWin.isFullScreen();
    mainWin.setFullScreen(next);
    return next;
  });
  ipcMain.handle("ablejam:is-fullscreen", () => !!mainWin?.isFullScreen());
  // WYSIWYG print preview: render the CURRENT page with the PRINT stylesheet to a real PDF and open
  // it in the OS PDF viewer. Reliable, unlike the Windows "Microsoft Print to PDF" dialog, whose
  // preview pane often shows "Anteprima non disponibile". The print modal's @media print rules
  // isolate the setlist page, so the PDF is exactly what "Stampa" would produce.
  ipcMain.handle("ablejam:print-preview", async () => {
    if (!mainWin) return { ok: false };
    try {
      const data = await mainWin.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      const p = path.join(app.getPath("temp"), "AbleJam-setlist-preview.pdf");
      writeFileSync(p, data);
      const err = await shell.openPath(p); // "" on success
      return { ok: !err, error: err || undefined };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // Dynamic import of the ESM host bundle from this CJS main (computed specifier keeps it a
  // native import(), so Node loads the .mjs correctly).
  const hostUrl = pathToFileURL(path.join(__dirname, "host", "index.mjs")).href;
  const host = (await import(hostUrl)) as { startHost: () => { ready: Promise<void>; close: () => Promise<void> } };
  hostHandle = host.startHost();

  try {
    await Promise.race([hostHandle.ready, waitForPort(HOST_PORT, 12000)]);
  } catch {
    dialog.showErrorBox(
      "AbleJam",
      `L'host non si è avviato sulla porta ${HOST_PORT}. Forse un'altra istanza di AbleJam o un \`pnpm dev:host\` sta occupando la porta.`,
    );
    app.quit();
    return;
  }
  createMainWindow();
}

app.whenReady().then(boot).catch((e) => fatal("Avvio fallito", e));

// ---- 5. lifecycle / teardown --------------------------------------------------------
app.on("window-all-closed", () => app.quit()); // the app IS the server — quit everywhere, incl. macOS

app.on("before-quit", (e) => {
  if (quitting || !hostHandle) return;
  e.preventDefault();
  quitting = true;
  // Tear the host down, but never block quit on it: a hung close() (e.g. a socket that
  // won't drain) must not leave the app un-quittable. Race it against a 2s deadline.
  Promise.race([
    hostHandle.close().catch(() => {}),
    new Promise<void>((r) => setTimeout(r, 2000)),
  ]).finally(() => app.quit());
});
