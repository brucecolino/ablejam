import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { type AppState, type ClientCommand, type HelloMessage, type ServerMessage, PORTS } from "@ablejam/shared";

/** Per-connection identity, kept SERVER-SIDE. `deviceId` is the client's persistent id (raw —
 * never broadcast, so a viewer can't copy a master's id); `opaqueId` is what the UI sees. */
export interface ClientMeta {
  opaqueId: string;
  deviceId: string;
  name: string;
  isLocal: boolean;
}

function isLoopback(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

const here = path.dirname(fileURLToPath(import.meta.url));
// Built web UI directory. In dev it's the sibling packages/web/dist; when packaged the
// Electron main process ships web/dist as an extraResource and points us at it via
// ABLEJAM_WEB_DIST (process.resourcesPath/web), since the sibling no longer exists.
const webDist = process.env.ABLEJAM_WEB_DIST ?? path.resolve(here, "../../web/dist");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** HTTP (serves the built web UI in production) + WebSocket broadcast, with per-client identity
 * so the host can gate commands (master vs view-only devices). */
export class Server {
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;
  private readonly meta = new Map<WebSocket, ClientMeta>();
  private opaqueSeq = 0;
  onCommand: (c: ClientCommand, client: ClientMeta) => void = () => {};
  /** Fired after a client introduces itself (hello) or disconnects — the host re-broadcasts. */
  onClientsChanged: () => void = () => {};
  /** State transform applied for NON-local clients (redacts license secrets + master ids). */
  redactForRemote: (state: AppState) => AppState = (s) => s;

  constructor(private readonly getState: () => AppState) {
    this.http = http.createServer((req, res) => this.serveStatic(req, res));
    this.wss = new WebSocketServer({ server: this.http });
    // ws forwards the underlying HTTP server's 'error' (e.g. EADDRINUSE on :3700) to the
    // WebSocketServer. Without a listener here that becomes an unhandled 'error' that
    // hard-crashes the process; handle it so a port conflict is logged and `ready` simply
    // never resolves (the Electron wrapper's readiness timeout then shows a clear message).
    this.wss.on("error", (err) => {
      console.error(`[host] server error on :${PORTS.http}:`, (err as Error)?.message ?? err);
    });
    this.wss.on("connection", (ws, req) => {
      const isLocal = isLoopback(req.socket.remoteAddress ?? undefined);
      const m: ClientMeta = { opaqueId: `c${++this.opaqueSeq}`, deviceId: "", name: isLocal ? "PC host" : (req.socket.remoteAddress ?? "?"), isLocal };
      this.meta.set(ws, m);
      ws.send(this.stateFor(m));
      ws.on("close", () => { this.meta.delete(ws); this.onClientsChanged(); });
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ClientCommand | HelloMessage;
          if ((msg as HelloMessage).type === "hello") {
            // Device introduction: record identity server-side, never forwarded as a command.
            const h = msg as HelloMessage;
            m.deviceId = String(h.deviceId ?? "").slice(0, 80);
            if (h.deviceName) m.name = String(h.deviceName).slice(0, 60);
            this.onClientsChanged();
            return;
          }
          this.onCommand(msg as ClientCommand, m);
        } catch {
          // ignore malformed messages
        }
      });
    });
  }

  /** Connected clients (server-side meta, raw device ids included — host use only). */
  clients(): ClientMeta[] {
    return [...this.meta.values()];
  }

  /** Send a message to one client (by its opaque connection id). */
  sendTo(opaqueId: string, msg: ServerMessage): void {
    for (const [ws, m] of this.meta) {
      if (m.opaqueId === opaqueId && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return; }
    }
  }

  listen(onReady?: () => void): void {
    // Port-conflict errors surface on the WebSocketServer (see the constructor) — ws
    // forwards them there — so no http 'error' listener is needed here.
    this.http.listen(PORTS.http, () => {
      console.log(`[host] http + ws listening on :${PORTS.http}`);
      onReady?.();
    });
  }

  /** Release :3700 — close every WS client then the HTTP listener. Used by the Electron
   * wrapper on quit so a relaunch doesn't hit EADDRINUSE. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const c of this.wss.clients) {
        try { c.terminate(); } catch { /* ignore */ }
      }
      // Force-destroy any lingering keep-alive HTTP sockets — otherwise http.close()
      // waits for them to drain and the Electron app appears to hang on quit.
      try { (this.http as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch { /* Node < 18.2 */ }
      this.wss.close(() => this.http.close(() => resolve()));
    });
  }

  broadcast(state: AppState): void {
    // Two serializations: the local desktop gets the full state, LAN clients get the redacted
    // one (license secrets + raw master device ids stripped). Built once each, not per socket.
    const full = JSON.stringify({ type: "state", state } satisfies ServerMessage);
    const redacted = JSON.stringify({ type: "state", state: this.redactForRemote(state) } satisfies ServerMessage);
    for (const [ws, m] of this.meta) {
      if (ws.readyState === WebSocket.OPEN) ws.send(m.isLocal ? full : redacted);
    }
  }

  broadcastMessage(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  private stateFor(m: ClientMeta): string {
    const s = this.getState();
    return JSON.stringify({ type: "state", state: m.isLocal ? s : this.redactForRemote(s) } satisfies ServerMessage);
  }

  private serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!existsSync(webDist)) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("AbleJam host is running.\nIn dev, open the Vite server (pnpm dev:web, http://localhost:5173).");
      return;
    }
    const reqPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const rel = reqPath === "/" ? "/index.html" : reqPath;
    const file = path.join(webDist, rel);
    if (!file.startsWith(webDist) || !existsSync(file)) {
      // SPA fallback
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(readFileSync(path.join(webDist, "index.html")));
      return;
    }
    // no-cache so a rebuilt bundle is always picked up on the next refresh (LAN tool, bandwidth is moot).
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  }
}
