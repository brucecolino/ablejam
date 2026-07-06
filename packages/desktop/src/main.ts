// AbleJam desktop window (Electron main). Boots the AbleJam host IN this process, then
// points an AbleJam-styled window at the host's local UI (http://127.0.0.1:3700).
//
// Ordering is load-bearing:
//   1. single-instance lock   (guards the fixed ports 39061/39062/3700)
//   2. crash guards           (a host throw must not silently kill the app)
//   3. resolve paths + env    (set BEFORE importing the host — persist/server read env at module-eval)
//   4. whenReady -> splash -> startHost -> wait for :3700 -> show main window
//   5. graceful teardown on quit (release timers, watchers, MIDI, UDP, http+ws)
import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from "electron";
import path from "node:path";
import net from "node:net";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installBridge, openDataFolder, lanUrl } from "./install";
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
let hostHandle: { ready: Promise<void>; close: () => Promise<void> } | null = null;
let quitting = false;
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
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

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

function configureHostEnv(): void {
  if (isDev) {
    // Dev parity with `pnpm start`: reuse the repo's existing .ablejam-data + packages/web/dist
    // by leaving the overrides UNSET (the host falls back to its repo-relative paths).
    return;
  }
  process.env.ABLEJAM_DATA_DIR = path.join(app.getPath("userData"), "ablejam-data");
  process.env.ABLEJAM_WEB_DIST = path.join(process.resourcesPath, "web");
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
  mainWin.on("closed", () => { mainWin = null; });

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
