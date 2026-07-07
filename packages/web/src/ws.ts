import { useCallback, useEffect, useRef, useState } from "react";
import { type AppState, type ClientCommand, type HelloMessage, type ImportResult, type ServerMessage, initialState, PORTS } from "@ablejam/shared";

export interface Toast {
  id: number;
  level: "info" | "error";
  message: string;
}

export interface Beat { inBar: number; n: number } // 0-based beat-in-bar + a monotonic counter (retrigger)

/** Persistent per-browser device id (survives reloads) — the host counts THIS as "a device"
 * for the master/viewer roles. Only ever sent to the host, never displayed. */
function deviceId(): string {
  try {
    const k = "ablejam.deviceId";
    let v = localStorage.getItem(k);
    if (!v) {
      v = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "no-storage";
  }
}
/** A friendly label for the device list, derived from the user agent (e.g. "iPad · Safari"). */
function deviceName(): string {
  try {
    const ua = navigator.userAgent;
    const dev = /iPad/i.test(ua) ? "iPad" : /iPhone/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android"
      : /Macintosh/i.test(ua) ? "Mac" : /Windows/i.test(ua) ? "PC Windows" : "Dispositivo";
    const br = /Electron/i.test(ua) ? "AbleJam" : /CriOS|Chrome/i.test(ua) ? "Chrome" : /Firefox|FxiOS/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "";
    return br ? `${dev} · ${br}` : dev;
  } catch {
    return "Dispositivo";
  }
}

export function useAbleJam() {
  const [state, setState] = useState<AppState>(initialState);
  const [connected, setConnected] = useState(false);
  // Master until told otherwise: an OLD host never sends "role", and its clients must stay
  // fully functional. A new host answers the hello with the real role right away.
  const [isMaster, setIsMaster] = useState(true);
  const [selfId, setSelfId] = useState(""); // this connection's opaque id (to mark "this device" in the list)
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [beat, setBeat] = useState<Beat>({ inBar: -1, n: 0 });
  const ref = useRef<WebSocket | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket;
    const connect = () => {
      socket = new WebSocket(`ws://${location.hostname}:${PORTS.http}`);
      ref.current = socket;
      socket.onopen = () => {
        setConnected(true);
        // Introduce this device (before any command — WS preserves per-socket order).
        const hello: HelloMessage = { type: "hello", deviceId: deviceId(), deviceName: deviceName() };
        socket.send(JSON.stringify(hello));
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) setTimeout(connect, 1000);
      };
      socket.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === "state") {
          setState(msg.state);
        } else if (msg.type === "transport") {
          setState((prev) => ({ ...prev, transport: msg.transport, currentEntryIndex: msg.currentEntryIndex, bridgeConnected: msg.bridgeConnected }));
        } else if (msg.type === "beat") {
          setBeat((b) => ({ inBar: msg.beat, n: b.n + 1 }));
        } else if (msg.type === "toast") {
          const id = ++toastId.current;
          setToasts((t) => [...t, { id, level: msg.level, message: msg.message }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
        } else if (msg.type === "role") {
          setIsMaster(msg.isMaster);
          setSelfId(msg.selfId);
        } else if (msg.type === "importResult") {
          setImportResult(msg.result);
        } else if (msg.type === "ttsPreview") {
          // A generated voice sample (data: URL) — play it immediately for the "Ascolta" button.
          try { void new Audio(msg.data).play(); } catch { /* autoplay blocked / no audio */ }
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      ref.current?.close();
    };
  }, []);

  const send = useCallback((cmd: ClientCommand) => {
    const s = ref.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(cmd));
  }, []);

  return { state, connected, isMaster, selfId, toasts, importResult, clearImportResult: () => setImportResult(null), send, beat };
}
