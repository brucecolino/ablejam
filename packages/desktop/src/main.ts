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

let mainWin: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let hostHandle: { ready: Promise<void>; close: () => Promise<void> } | null = null;
let quitting = false;

app.on("second-instance", () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
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
    backgroundColor: "#0b0b0c", show: true, skipTaskbar: false, title: "AbleJam",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
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

  // Cover the open-port-but-route-still-racing window with a few retries.
  let retries = 0;
  mainWin.webContents.on("did-fail-load", () => {
    if (retries++ < 5 && mainWin) setTimeout(() => mainWin?.loadURL(`http://127.0.0.1:${HOST_PORT}`), 300);
  });
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

  // ipc seams (reserved for a future in-UI "Install bridge" button).
  ipcMain.handle("ablejam:version", () => app.getVersion());
  ipcMain.handle("ablejam:install-bridge", () => { installBridge(resourcesRoot); });
  ipcMain.handle("ablejam:update-check", () => checkForUpdate());
  ipcMain.handle("ablejam:update-install", () => downloadAndInstall());

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
