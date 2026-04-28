import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { TerminalOutputSource } from "@/components/TerminalView.types";
import { terminalPreviewsWsUrl } from "@/lib/api";
import {
  createTerminalPreviewSubscriptionRegistry,
  decodeTerminalPreviewFrame,
  type TerminalPreviewChunkHandler,
  type TerminalPreviewClientMessage,
} from "@/lib/terminalPreviewMux";

interface TerminalPreviewMuxProviderProps {
  deviceId: string | null;
  children: ReactNode;
}

interface TerminalPreviewMuxContextValue {
  subscribe(
    machineId: string,
    terminalId: string,
    cols: number,
    rows: number,
    handler: TerminalPreviewChunkHandler,
  ): () => void;
}

interface UseTerminalPreviewOutputSourceOptions {
  enabled: boolean;
  machineId: string;
  terminalId: string;
  cols: number;
  rows: number;
}

const TerminalPreviewMuxContext =
  createContext<TerminalPreviewMuxContextValue | null>(null);

export function TerminalPreviewMuxProvider({
  deviceId,
  children,
}: TerminalPreviewMuxProviderProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const [generation, setGeneration] = useState(0);
  const [activeSubscriptionCount, setActiveSubscriptionCount] = useState(0);
  const hasPreviewSubscriptions = activeSubscriptionCount > 0;

  const sendMessage = useCallback((message: TerminalPreviewClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const registryRef = useRef(
    createTerminalPreviewSubscriptionRegistry(sendMessage),
  );

  useEffect(() => {
    if (!deviceId || !hasPreviewSubscriptions) return;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const ws = new WebSocket(terminalPreviewsWsUrl(deviceId));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const dispatchBytes = (source: ArrayBuffer | Uint8Array) => {
      try {
        registryRef.current.dispatchFrame(decodeTerminalPreviewFrame(source));
      } catch {
        /* ignore malformed preview frames */
      }
    };

    ws.onopen = () => {
      registryRef.current.replaySubscriptions();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        dispatchBytes(event.data);
        return;
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then(dispatchBytes).catch(() => {
          /* ignore */
        });
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (disposed) return;
      reconnectTimer = setTimeout(() => {
        setGeneration((value) => value + 1);
      }, 1000);
    };

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      ws.onclose = null;
      ws.close();
    };
  }, [deviceId, generation, hasPreviewSubscriptions]);

  const value = useMemo<TerminalPreviewMuxContextValue>(
    () => ({
      subscribe(machineId, terminalId, cols, rows, handler) {
        let active = true;
        const unsubscribe = registryRef.current.subscribe(
          { machineId, terminalId, cols, rows },
          handler,
        );
        setActiveSubscriptionCount(registryRef.current.subscriptionCount());

        return () => {
          if (!active) return;
          active = false;
          unsubscribe();
          setActiveSubscriptionCount(registryRef.current.subscriptionCount());
        };
      },
    }),
    [],
  );

  return (
    <TerminalPreviewMuxContext.Provider value={value}>
      {children}
    </TerminalPreviewMuxContext.Provider>
  );
}

export function useTerminalPreviewOutputSource({
  enabled,
  machineId,
  terminalId,
  cols,
  rows,
}: UseTerminalPreviewOutputSourceOptions): TerminalOutputSource | null {
  const mux = useContext(TerminalPreviewMuxContext);

  return useMemo(() => {
    if (!enabled || !mux) return null;
    return {
      subscribe(handler) {
        return mux.subscribe(machineId, terminalId, cols, rows, handler);
      },
    };
  }, [cols, enabled, machineId, mux, rows, terminalId]);
}
