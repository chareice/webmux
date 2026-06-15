import { useEffect, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";

import { createOrderedBinaryOutputQueue } from "@/lib/orderedBinaryOutput.mjs";
import { createTerminalReconnectController } from "@/lib/terminalReconnect";

interface UseTerminalLiveSocketOptions {
  termRef: RefObject<Terminal | null>;
  wsRef: RefObject<WebSocket | null>;
  wsUrl?: string;
  scheduleMeasure: () => void;
  sessionGeneration: number;
  setSessionGeneration: (next: (value: number) => number) => void;
}

const MAX_PENDING_OUTPUT_BYTES = 128 * 1024;

export function useTerminalLiveSocket({
  termRef,
  wsRef,
  wsUrl,
  scheduleMeasure,
  sessionGeneration,
  setSessionGeneration,
}: UseTerminalLiveSocketOptions) {
  useEffect(() => {
    const term = termRef.current;
    if (!term || !wsUrl) return;
    let disposed = false;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const reconnectController = createTerminalReconnectController<number>({
      delayMs: 1000,
      openReadyState: WebSocket.OPEN,
      onReconnect: () => {
        if (!disposed) {
          setSessionGeneration((value) => value + 1);
        }
      },
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timerId) => window.clearTimeout(timerId),
    });

    let pendingChunks: Uint8Array[] = [];
    let pendingBytes = 0;
    let rafId = 0;

    const flushPending = () => {
      if (pendingBytes > 0) {
        const merged = new Uint8Array(pendingBytes);
        let offset = 0;
        for (const chunk of pendingChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        term.write(merged);
        pendingChunks = [];
        pendingBytes = 0;
      }
      rafId = 0;
    };

    const enqueueOutput = (chunk: Uint8Array) => {
      pendingChunks.push(chunk);
      pendingBytes += chunk.length;

      if (pendingBytes >= MAX_PENDING_OUTPUT_BYTES) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        flushPending();
      } else if (!rafId) {
        rafId = requestAnimationFrame(flushPending);
      }
    };

    const orderedOutput = createOrderedBinaryOutputQueue(enqueueOutput);

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        orderedOutput.push(event.data);
        return;
      }

      if (event.data instanceof Blob) {
        orderedOutput.push(event.data);
      }
    };

    const refreshTerminalSurface = () => {
      term.refresh(0, Math.max(term.rows - 1, 0));
      scheduleMeasure();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshTerminalSurface();
      }
      reconnectController.handleVisibilityChange(
        document.visibilityState,
        ws.readyState,
      );
    };

    const handlePageShow = () => {
      refreshTerminalSurface();
      reconnectController.handleVisibilityChange("visible", ws.readyState);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    ws.onopen = () => {
      reconnectController.handleSocketOpen();
      refreshTerminalSurface();
    };

    ws.onclose = () => {
      if (disposed) return;
      reconnectController.scheduleReconnect();
    };

    return () => {
      disposed = true;
      reconnectController.cancelReconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      if (rafId) cancelAnimationFrame(rafId);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      ws.onclose = null;
      ws.close();
    };
  }, [
    scheduleMeasure,
    sessionGeneration,
    setSessionGeneration,
    termRef,
    wsRef,
    wsUrl,
  ]);
}
