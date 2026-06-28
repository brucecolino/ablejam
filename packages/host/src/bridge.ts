import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { PORTS } from "@ablejam/shared";
import { encode, decode } from "@ablejam/shared/osc";

/**
 * Talks to the Python control surface running inside Ableton Live.
 * Receives state on PORTS.hostRecv, sends commands to PORTS.bridgeRecv.
 */
export class BridgeLink extends EventEmitter {
  private readonly sock = dgram.createSocket("udp4");
  private readonly bridgeAddr = "127.0.0.1";
  private lastSeen = 0;

  constructor() {
    super();
    this.sock.on("message", (msg) => {
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
    this.sock.send(encode(address, args), PORTS.bridgeRecv, this.bridgeAddr);
  }

  isConnected(timeoutMs = 4000): boolean {
    return this.lastSeen > 0 && Date.now() - this.lastSeen < timeoutMs;
  }

  /** Close the bound UDP socket (39062). Used by the Electron wrapper on quit so a
   * relaunch doesn't leave the port held. */
  close(): void {
    try { this.sock.close(); } catch { /* already closed */ }
  }
}
