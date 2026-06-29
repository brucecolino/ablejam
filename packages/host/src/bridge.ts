import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { ADDR, PORTS } from "@ablejam/shared";
import { encode, decode } from "@ablejam/shared/osc";
import { DEMO_CUES, DEMO_TRACKS, DEMO_TEMPO, DEMO_BRIDGE_VERSION } from "./demo";

/**
 * Talks to the Python control surface running inside Ableton Live.
 * Receives state on PORTS.hostRecv, sends commands to PORTS.bridgeRecv.
 */
export class BridgeLink extends EventEmitter {
  private readonly sock = dgram.createSocket("udp4");
  private readonly bridgeAddr = "127.0.0.1";
  private lastSeen = 0;
  // Demo mode: a self-contained fake bridge (fictional setlist + simulated playhead).
  private demo = false;
  private demoTime = 0;
  private demoPlaying = false;
  private demoTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    super();
    this.sock.on("message", (msg) => {
      // In demo mode the simulated playhead is the only source of truth. Drop real Ableton
      // packets so the demo timer (120 BPM, every 100 ms) and a live bridge can't both push
      // `transport` and fight over it — that flapping is what caused the on-stage flicker
      // (BPM/active-song/countdown jumping). It also keeps an unlicensed app fully isolated
      // from real Ableton, as licensing intends.
      if (this.demo) return;
      this.lastSeen = Date.now();
      try {
        const m = decode(msg);
        this.emit("osc", m.address, m.args);
      } catch {
        // ignore malformed packets
      }
    });
    this.sock.on("error", (err) => this.emit("error", err));
    this.sock.bind(PORTS.hostRecv, "0.0.0.0");
  }

  send(address: string, args: (number | string)[] = []): void {
    if (this.demo) { this.handleDemoCommand(address, args); return; }
    this.sock.send(encode(address, args), PORTS.bridgeRecv, this.bridgeAddr);
  }

  isConnected(timeoutMs = 4000): boolean {
    if (this.demo) return true; // demo bridge is always "connected"
    return this.lastSeen > 0 && Date.now() - this.lastSeen < timeoutMs;
  }

  /** Turn demo mode on/off. On: stream a fictional setlist + a simulated playhead so the app
   * is fully usable (navigate, follow, auto-stop, medley) without Ableton. Off: stop
   * simulating; the real UDP bridge takes over again. */
  setDemo(on: boolean): void {
    if (on === this.demo) return;
    this.demo = on;
    if (on) {
      this.demoTime = 0;
      this.demoPlaying = false;
      // Defer the first burst so we don't re-enter the host's osc handler synchronously
      // from inside the command (setSetting) that toggled demo on.
      setTimeout(() => {
        if (!this.demo) return;
        this.emit("osc", ADDR.hello, ["AbleJam demo", DEMO_BRIDGE_VERSION]);
        this.emit("osc", ADDR.tracks, [JSON.stringify(DEMO_TRACKS)]);
        this.emit("osc", ADDR.setlist, [JSON.stringify(DEMO_CUES)]);
        this.emit("osc", ADDR.transport, [0, this.demoTime, DEMO_TEMPO, 4, 4, 0]);
      }, 0);
      this.demoTimer = setInterval(() => {
        if (this.demoPlaying) this.demoTime += (DEMO_TEMPO / 60) * 0.1; // beats per 100 ms
        this.emit("osc", ADDR.transport, [this.demoPlaying ? 1 : 0, this.demoTime, DEMO_TEMPO, 4, 4, 0]);
      }, 100);
    } else {
      if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = undefined; }
      this.demoPlaying = false;
    }
  }

  /** Apply a transport command to the simulated playhead (demo mode only). */
  private handleDemoCommand(address: string, args: (number | string)[]): void {
    switch (address) {
      case ADDR.cmdPlay: this.demoPlaying = true; break;
      case ADDR.cmdPause:
      case ADDR.cmdStop: this.demoPlaying = false; break;
      case ADDR.cmdJumpToTime: this.demoTime = Number(args[0]) || 0; break;
      case ADDR.cmdStopToStart: this.demoPlaying = false; this.demoTime = Number(args[0]) || 0; break;
      case ADDR.cmdRefresh:
        this.emit("osc", ADDR.tracks, [JSON.stringify(DEMO_TRACKS)]);
        this.emit("osc", ADDR.setlist, [JSON.stringify(DEMO_CUES)]);
        break;
      default: break; // metronome / armStop / sendNote / colorize … — no-op in demo
    }
  }

  /** Close the bound UDP socket (39062). Used by the Electron wrapper on quit so a
   * relaunch doesn't leave the port held. */
  close(): void {
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = undefined; }
    try { this.sock.close(); } catch { /* already closed */ }
  }
}
