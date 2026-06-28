import { useCallback, useEffect, useRef, useState } from "react";
import { type AppState, type ClientCommand, type ImportResult, type ServerMessage, initialState, PORTS } from "@ablejam/shared";

export interface Toast {
  id: number;
  level: "info" | "error";
  message: string;
}

export interface Beat { inBar: number; n: number } // 0-based beat-in-bar + a monotonic counter (retrigger)

export function useAbleJam() {
  const [state, setState] = useState<AppState>(initialState);
  const [connected, setConnected] = useState(false);
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
      socket.onopen = () => setConnected(true);
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
        } else if (msg.type === "importResult") {
          setImportResult(msg.result);
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

  return { state, connected, toasts, importResult, clearImportResult: () => setImportResult(null), send, beat };
}
