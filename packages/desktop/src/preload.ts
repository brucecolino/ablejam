// Minimal contextIsolation-safe preload. The renderer is the existing AbleJam web UI loaded
// over http://127.0.0.1:3700, talking to the host purely over WebSocket — so no privileged
// IPC is required today. We expose a tiny read-only namespace so the security model
// (contextIsolation:true, sandbox:true, nodeIntegration:false) never has to be reworked when
// a future in-UI "Install bridge" button is added.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ablejam", {
  version: (): Promise<string> => ipcRenderer.invoke("ablejam:version"),
  installBridge: (): Promise<void> => ipcRenderer.invoke("ablejam:install-bridge"),
  checkUpdate: (): Promise<unknown> => ipcRenderer.invoke("ablejam:update-check"),
  installUpdate: (): Promise<unknown> => ipcRenderer.invoke("ablejam:update-install"),
});
