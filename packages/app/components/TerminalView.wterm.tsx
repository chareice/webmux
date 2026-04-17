import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";
import { WTerm } from "@wterm/dom";
import "@wterm/dom/css";

import type { TerminalViewRef, TerminalViewProps } from "./TerminalView.types";
import { createOrderedBinaryOutputQueue } from "@/lib/orderedBinaryOutput.mjs";
import { createTerminalReconnectController } from "@/lib/terminalReconnect";
import { buildResizeMessage } from "@/lib/terminalResize";
import {
  getTerminalFitDimensions,
  getTerminalViewportLayout,
} from "@/lib/terminalViewModel";
import { terminalTheme } from "@/lib/colors";

function measureTerminalSurface(
  container: HTMLDivElement | null,
): { width: number; height: number } {
  if (!container) {
    return { width: 0, height: 0 };
  }

  const grid = container.querySelector(".term-grid") as HTMLElement | null;
  const width = Math.max(
    grid?.scrollWidth ?? 0,
    grid?.clientWidth ?? 0,
    container.scrollWidth,
    container.clientWidth,
  );
  const height = Math.max(
    grid?.scrollHeight ?? 0,
    grid?.clientHeight ?? 0,
    container.scrollHeight,
    container.clientHeight,
  );

  return { width, height };
}

const WTERM_THEME_STYLE: React.CSSProperties & Record<`--${string}`, string> = {
  "--term-bg": terminalTheme.background,
  "--term-fg": terminalTheme.foreground,
  "--term-cursor": terminalTheme.cursor,
  "--term-color-0": terminalTheme.black,
  "--term-color-1": terminalTheme.red,
  "--term-color-2": terminalTheme.green,
  "--term-color-3": terminalTheme.yellow,
  "--term-color-4": terminalTheme.blue,
  "--term-color-5": terminalTheme.magenta,
  "--term-color-6": terminalTheme.cyan,
  "--term-color-7": terminalTheme.white,
  "--term-color-8": terminalTheme.brightBlack,
  "--term-color-9": terminalTheme.brightRed,
  "--term-color-10": terminalTheme.brightGreen,
  "--term-color-11": terminalTheme.brightYellow,
  "--term-color-12": terminalTheme.brightBlue,
  "--term-color-13": terminalTheme.brightMagenta,
  "--term-color-14": terminalTheme.brightCyan,
  "--term-color-15": terminalTheme.brightWhite,
};

export type { TerminalViewRef, TerminalViewProps };

export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  function TerminalView({
    machineId,
    terminalId,
    wsUrl,
    cols,
    rows,
    displayMode = "immersive",
    isController,
    canResizeTerminal,
    onTitleChange,
    style,
  }, ref) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const wtermRef = useRef<WTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const isControllerRef = useRef(isController ?? true);
    const canResizeTerminalRef = useRef(canResizeTerminal ?? false);
    const measureRafRef = useRef<number | null>(null);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
    const [sessionGeneration, setSessionGeneration] = useState(0);
    const viewportSizeRef = useRef(viewportSize);
    const surfaceSizeRef = useRef(surfaceSize);

    useEffect(() => {
      isControllerRef.current = isController ?? true;
    }, [isController]);

    useEffect(() => {
      canResizeTerminalRef.current = canResizeTerminal ?? false;
    }, [canResizeTerminal]);

    const measureLayout = useCallback(() => {
      const viewport = viewportRef.current;
      const container = containerRef.current;
      if (!viewport || !container) return;

      const nextViewportSize = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      };
      const nextSurfaceSize = measureTerminalSurface(container);

      setViewportSize((current) =>
        current.width === nextViewportSize.width &&
        current.height === nextViewportSize.height
          ? current
          : nextViewportSize,
      );
      setSurfaceSize((current) =>
        current.width === nextSurfaceSize.width &&
        current.height === nextSurfaceSize.height
          ? current
          : nextSurfaceSize,
      );
      viewportSizeRef.current = nextViewportSize;
      surfaceSizeRef.current = nextSurfaceSize;
    }, []);

    const scheduleMeasure = useCallback(() => {
      if (measureRafRef.current) {
        cancelAnimationFrame(measureRafRef.current);
      }
      measureRafRef.current = requestAnimationFrame(() => {
        measureRafRef.current = null;
        measureLayout();
      });
    }, [measureLayout]);

    useImperativeHandle(
      ref,
      () => ({
        sendInput(data: string) {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        },
        sendCommandInput(data: string) {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "command_input", data }));
          }
        },
        fitToContainer() {
          const liveWs = wsRef.current;
          if (
            liveWs?.readyState !== WebSocket.OPEN ||
            !isControllerRef.current ||
            !canResizeTerminalRef.current
          ) {
            return;
          }

          try {
            const nextDims = getTerminalFitDimensions({
              viewportWidth: viewportSizeRef.current.width,
              viewportHeight: viewportSizeRef.current.height,
              contentWidth: surfaceSizeRef.current.width,
              contentHeight: surfaceSizeRef.current.height,
              cols,
              rows,
            });

            const resizeMessage = buildResizeMessage(nextDims);
            if (!resizeMessage) return;
            liveWs.send(JSON.stringify(resizeMessage));
          } catch {
            /* ignore */
          }
        },
        focus() {
          wtermRef.current?.focus();
        },
      }),
      [cols, rows],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const wt = new WTerm(container, {
        cols,
        rows,
        autoResize: false,
        cursorBlink: true,
        onData: (data) => {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN && isControllerRef.current) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        },
        onTitle: (title) => {
          onTitleChange?.(title);
        },
      });

      wtermRef.current = wt;

      wt.init()
        .then(() => {
          scheduleMeasure();
        })
        .catch((err) => {
          console.error("wterm init failed:", err);
        });

      const sendImageToWs = (base64: string, mime: string) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "image_paste",
              data: base64,
              mime,
              filename: `tc-paste-${Date.now()}.png`,
            }),
          );
        }
      };

      const handlePaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            e.preventDefault();
            e.stopPropagation();
            const blob = item.getAsFile();
            if (!blob) continue;
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = (reader.result as string).split(",")[1];
              sendImageToWs(base64, item.type);
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      };
      container.addEventListener("paste", handlePaste);

      const viewport = viewportRef.current;
      const resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });
      if (viewport) {
        resizeObserver.observe(viewport);
      }

      return () => {
        resizeObserver.disconnect();
        if (measureRafRef.current) {
          cancelAnimationFrame(measureRafRef.current);
          measureRafRef.current = null;
        }
        container.removeEventListener("paste", handlePaste);
        wt.destroy();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Terminal created once on mount
    }, []);

    useEffect(() => {
      const wt = wtermRef.current;
      if (!wt || !wsUrl) return;
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
      const MAX_PENDING = 128 * 1024;

      const flushPending = () => {
        if (pendingBytes > 0) {
          const merged = new Uint8Array(pendingBytes);
          let offset = 0;
          for (const chunk of pendingChunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          wt.write(merged);
          pendingChunks = [];
          pendingBytes = 0;
        }
        rafId = 0;
      };

      const enqueueOutput = (chunk: Uint8Array) => {
        pendingChunks.push(chunk);
        pendingBytes += chunk.length;

        if (pendingBytes >= MAX_PENDING) {
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
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "error") {
              return;
            }
          } catch {
            /* ignore */
          }
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

      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          scheduleMeasure();
        }
        reconnectController.handleVisibilityChange(
          document.visibilityState,
          ws.readyState,
        );
      };

      const handlePageShow = () => {
        scheduleMeasure();
        reconnectController.handleVisibilityChange("visible", ws.readyState);
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("pageshow", handlePageShow);

      ws.onopen = () => {
        reconnectController.handleSocketOpen();
        scheduleMeasure();
      };

      ws.onclose = () => {
        if (disposed) {
          return;
        }
        reconnectController.scheduleReconnect();
      };

      return () => {
        disposed = true;
        reconnectController.cancelReconnect();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("pageshow", handlePageShow);
        if (rafId) cancelAnimationFrame(rafId);
        ws.onclose = null;
        ws.close();
      };
    }, [scheduleMeasure, sessionGeneration, wsUrl]);

    useEffect(() => {
      const wt = wtermRef.current;
      if (!wt || !wt.bridge) return;
      if (wt.cols === cols && wt.rows === rows) return;
      try {
        wt.resize(cols, rows);
        scheduleMeasure();
      } catch {
        /* ignore */
      }
    }, [cols, rows, scheduleMeasure]);

    useEffect(() => {
      scheduleMeasure();
    }, [displayMode, scheduleMeasure]);

    // Auto-fit on every viewport change while the user is the controller —
    // see the matching effect in TerminalView.xterm.tsx for context.
    useEffect(() => {
      if (displayMode !== "immersive" || !canResizeTerminal) return;

      const timerId = window.setTimeout(() => {
        const liveWs = wsRef.current;
        const viewport = viewportRef.current;
        if (
          !liveWs ||
          liveWs.readyState !== WebSocket.OPEN ||
          !isControllerRef.current ||
          !canResizeTerminalRef.current ||
          !viewport ||
          viewport.offsetParent === null
        ) {
          return;
        }
        try {
          const nextDims = getTerminalFitDimensions({
            viewportWidth: viewportSizeRef.current.width,
            viewportHeight: viewportSizeRef.current.height,
            contentWidth: surfaceSizeRef.current.width,
            contentHeight: surfaceSizeRef.current.height,
            cols,
            rows,
          });
          if (!nextDims) return;
          if (nextDims.cols === cols && nextDims.rows === rows) return;
          const resizeMessage = buildResizeMessage(nextDims);
          if (!resizeMessage) return;
          liveWs.send(JSON.stringify(resizeMessage));
        } catch {
          /* ignore */
        }
      }, 200);

      return () => window.clearTimeout(timerId);
    }, [
      displayMode,
      canResizeTerminal,
      cols,
      rows,
      viewportSize.width,
      viewportSize.height,
    ]);

    const viewportLayout = getTerminalViewportLayout({
      displayMode,
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      contentWidth: surfaceSize.width,
      contentHeight: surfaceSize.height,
    });

    return (
      <div
        ref={viewportRef}
        data-terminal-display-mode={displayMode}
        data-terminal-view-scale={viewportLayout.scale.toFixed(4)}
        data-terminal-view-justify={viewportLayout.justifyContent}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          justifyContent:
            displayMode === "immersive"
              ? viewportLayout.justifyContent
              : "flex-start",
          alignItems: "flex-start",
          overflow: "hidden",
          ...style,
        }}
      >
        <div
          style={{
            width:
              displayMode === "immersive" && viewportLayout.frameWidth > 0
                ? `${viewportLayout.frameWidth}px`
                : "100%",
            height:
              displayMode === "immersive" && viewportLayout.frameHeight > 0
                ? `${viewportLayout.frameHeight}px`
                : "100%",
            flex: "0 0 auto",
          }}
        >
          <div
            style={{
              width:
                displayMode === "immersive" && surfaceSize.width > 0
                  ? `${surfaceSize.width}px`
                  : "100%",
              height:
                displayMode === "immersive" && surfaceSize.height > 0
                  ? `${surfaceSize.height}px`
                  : "100%",
              transform:
                displayMode === "immersive"
                  ? `scale(${viewportLayout.scale})`
                  : "none",
              transformOrigin: "top left",
            }}
          >
            <div
              ref={containerRef}
              style={{
                width: displayMode === "immersive" ? undefined : "100%",
                height: displayMode === "immersive" ? undefined : "100%",
                display: displayMode === "immersive" ? "inline-block" : "block",
                ...WTERM_THEME_STYLE,
              }}
            />
          </div>
        </div>
      </div>
    );
  },
);
