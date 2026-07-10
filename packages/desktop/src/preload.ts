// Minimal contextIsolation-safe preload. The renderer is the existing AbleJam web UI loaded
// over http://127.0.0.1:3700, talking to the host purely over WebSocket — so no privileged
// IPC is required today. We expose a tiny read-only namespace so the security model
// (contextIsolation:true, sandbox:true, nodeIntegration:false) never has to be reworked when
// a future in-UI "Install bridge" button is added.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ablejam", {
  platform: process.platform, // so the web can pad the macOS traffic-light title bar
  version: (): Promise<string> => ipcRenderer.invoke("ablejam:version"),
  installBridge: (): Promise<void> => ipcRenderer.invoke("ablejam:install-bridge"),
  // Tell the main process whether closing the window should keep AbleJam running in the background.
  setCloseToTray: (v: boolean): Promise<void> => ipcRenderer.invoke("ablejam:set-close-to-tray", v),
  // NATIVE window fullscreen (Electron). The DOM Fullscreen API leaves the window painted black on
  // exit under Electron/Windows, so the renderer drives the real BrowserWindow instead.
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke("ablejam:toggle-fullscreen"),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke("ablejam:is-fullscreen"),
  onFullscreenChange: (cb: (v: boolean) => void): (() => void) => {
    const listener = (_e: unknown, v: boolean): void => cb(!!v);
    ipcRenderer.on("ablejam:fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("ablejam:fullscreen-changed", listener);
  },
  checkUpdate: (): Promise<unknown> => ipcRenderer.invoke("ablejam:update-check"),
  installUpdate: (): Promise<unknown> => ipcRenderer.invoke("ablejam:update-install"),
  onUpdateProgress: (cb: (p: unknown) => void): (() => void) => {
    const listener = (_e: unknown, p: unknown): void => cb(p);
    ipcRenderer.on("ablejam:update-progress", listener);
    return () => ipcRenderer.removeListener("ablejam:update-progress", listener);
  },
  // Main forwards a license key parsed from an ablejam://activate?key=… deep link (one-click
  // activation from the customer area). The web UI applies it via the normal setSetting path.
  onActivateKey: (cb: (key: string) => void): (() => void) => {
    const listener = (_e: unknown, key: string): void => cb(key);
    ipcRenderer.on("ablejam:activate-key", listener);
    return () => ipcRenderer.removeListener("ablejam:activate-key", listener);
  },
});
