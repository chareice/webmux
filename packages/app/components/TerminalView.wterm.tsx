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
import {
  shouldSendClipboardImagePaste,
  type ImagePasteDedupeRecord,
} from "@/lib/imagePasteDedupe";
import {
  buildImagePasteMessage,
  MAX_IMAGE_PASTE_BYTES,
  readFileAsBase64,
  safeFilename,
} from "@/lib/terminalImagePaste";

const FIT_RETRY_LIMIT = 10;
const FIT_RETRY_DELAY_MS = 100;

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

interface CellMetrics {
  width: number;
  height: number;
}

interface WtermFitInputs extends CellMetrics {
  paddingX: number;
  paddingY: number;
}

// Probe one `.term-cell` inside `.term-grid` to read the live per-cell
// pixel size, plus the `.wterm` padding that takes pixels from the viewport
// before rows/cols can fit. Probing on each fit call is cheap (one DOM
// insertion + getBoundingClientRect + removal) and avoids the cached
// surface-measurement race that was driving fit drift.
function readWtermFitInputs(element: HTMLElement | null): WtermFitInputs | null {
  if (!element) return null;
  const grid = element.querySelector(".term-grid") as HTMLElement | null;
  if (!grid) return null;
  const probe = document.createElement("span");
  probe.className = "term-cell";
  probe.textContent = "W";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  grid.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  if (!rect.width || !rect.height) return null;
  const cs = getComputedStyle(element);
  // wterm pins row height via the --term-row-height custom property; rect's
  // height is line-height-padded text and would over-count.
  const rowHeight = parseFloat(cs.getPropertyValue("--term-row-height"));
  const cellHeight = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : rect.height;
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  if (cs.boxSizing === "border-box") {
    // Border counts against the inner content too when box-sizing is
    // border-box, matching wterm's own _lockHeight bookkeeping.
    const borderX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    return {
      width: rect.width,
      height: cellHeight,
      paddingX: padX + borderX,
      paddingY: padY + borderY,
    };
  }
  return {
    width: rect.width,
    height: cellHeight,
    paddingX: padX,
    paddingY: padY,
  };
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
    outputSource,
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
    const fitRetryTimerRef = useRef<number | null>(null);
    const recentClipboardImagePasteRef =
      useRef<ImagePasteDedupeRecord | null>(null);
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

    const schedulePostResizeMeasure = useCallback(() => {
      scheduleMeasure();
      requestAnimationFrame(() => {
        scheduleMeasure();
        requestAnimationFrame(scheduleMeasure);
      });
    }, [scheduleMeasure]);

    const clearFitRetryTimer = useCallback(() => {
      if (fitRetryTimerRef.current !== null) {
        window.clearTimeout(fitRetryTimerRef.current);
        fitRetryTimerRef.current = null;
      }
    }, []);

    const resizeLocalTerminal = useCallback(
      (nextCols: number, nextRows: number) => {
        const wt = wtermRef.current;
        if (!wt || !wt.bridge) return;
        if (wt.cols === nextCols && wt.rows === nextRows) {
          wt.resize(nextCols, nextRows);
          schedulePostResizeMeasure();
          return;
        }
        try {
          wt.resize(nextCols, nextRows);
          schedulePostResizeMeasure();
        } catch {
          /* ignore */
        }
      },
      [schedulePostResizeMeasure],
    );

    const fitToContainer = useCallback(
      (attempt = 0) => {
        const scheduleRetry = () => {
          if (attempt >= FIT_RETRY_LIMIT) return;
          clearFitRetryTimer();
          fitRetryTimerRef.current = window.setTimeout(() => {
            fitRetryTimerRef.current = null;
            fitToContainer(attempt + 1);
          }, FIT_RETRY_DELAY_MS);
        };

        const liveWs = wsRef.current;
        if (!isControllerRef.current || !canResizeTerminalRef.current) return;
        if (liveWs?.readyState !== WebSocket.OPEN) {
          scheduleRetry();
          return;
        }

        try {
          const fitInputs = readWtermFitInputs(containerRef.current);
          if (!fitInputs) {
            scheduleRetry();
            return;
          }
          const nextDims = getTerminalFitDimensions({
            viewportWidth: viewportSizeRef.current.width,
            viewportHeight: viewportSizeRef.current.height,
            cellWidth: fitInputs.width,
            cellHeight: fitInputs.height,
            paddingX: fitInputs.paddingX,
            paddingY: fitInputs.paddingY,
          });

          const resizeMessage = buildResizeMessage(nextDims);
          if (!resizeMessage) {
            scheduleRetry();
            return;
          }
          clearFitRetryTimer();
          liveWs.send(JSON.stringify(resizeMessage));
          resizeLocalTerminal(resizeMessage.cols, resizeMessage.rows);
        } catch {
          scheduleRetry();
        }
      },
      [clearFitRetryTimer, resizeLocalTerminal],
    );

    useEffect(() => clearFitRetryTimer, [clearFitRetryTimer]);

    const sendImageFile = useCallback(
      async (file: Blob & { name?: string }): Promise<void> => {
        if (!isControllerRef.current) return;
        if (file.size > MAX_IMAGE_PASTE_BYTES) {
          // eslint-disable-next-line no-console
          console.warn(
            `[webmux] skipped attachment >${MAX_IMAGE_PASTE_BYTES} bytes`,
          );
          return;
        }
        const ws = wsRef.current;
        if (ws?.readyState !== WebSocket.OPEN) return;
        const { base64, mime } = await readFileAsBase64(file);
        const ext = mime.includes("/") ? `.${mime.split("/")[1]}` : "";
        const filename = safeFilename(file.name ?? "", ext);
        ws.send(JSON.stringify(buildImagePasteMessage(base64, mime, filename)));
      },
      [],
    );

    const setMouseTrackingEnabled = useCallback((enabled: boolean) => {
      const wt = wtermRef.current;
      if (!wt) return;
      wt.write(enabled ? "\x1b[?1003h\x1b[?1006h" : "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");
    }, []);

    const getSelection = useCallback((): string => {
      // WTerm renders to DOM, so the browser's native selection covers it.
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      return sel?.toString() ?? "";
    }, []);

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
          fitToContainer();
        },
        focus() {
          wtermRef.current?.focus();
        },
        blur() {
          const active = document.activeElement;
          if (
            active instanceof HTMLElement &&
            containerRef.current?.contains(active)
          ) {
            active.blur();
          }
        },
        sendImageFile,
        setMouseTrackingEnabled,
        getSelection,
      }),
      [fitToContainer, sendImageFile, setMouseTrackingEnabled, getSelection],
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

      const sendImageToWs = (
        base64: string,
        mime: string,
        options: { dedupeClipboardImage?: boolean } = {},
      ) => {
        if (options.dedupeClipboardImage) {
          const result = shouldSendClipboardImagePaste(
            recentClipboardImagePasteRef.current,
            { data: base64, mime },
          );
          recentClipboardImagePasteRef.current = result.recent;
          if (!result.send) return;
        }

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
        const imageItem = Array.from(items).find((item) =>
          item.type.startsWith("image/"),
        );
        if (!imageItem) return;

        e.preventDefault();
        e.stopPropagation();
        const blob = imageItem.getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          sendImageToWs(base64, imageItem.type, {
            dedupeClipboardImage: true,
          });
        };
        reader.readAsDataURL(blob);
      };
      container.addEventListener("paste", handlePaste, { capture: true });

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
        container.removeEventListener("paste", handlePaste, { capture: true });
        wt.destroy();
        if (wtermRef.current === wt) {
          wtermRef.current = null;
        }
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Terminal created once on mount
    }, []);

    useEffect(() => {
      const wt = wtermRef.current;
      if (!wt || !wsUrl || outputSource) return;
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
    }, [outputSource, scheduleMeasure, sessionGeneration, wsUrl]);

    useEffect(() => {
      const wt = wtermRef.current;
      if (!wt || !outputSource) return;

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

      const unsubscribe = outputSource.subscribe(enqueueOutput);

      return () => {
        unsubscribe();
        if (rafId) cancelAnimationFrame(rafId);
      };
    }, [outputSource]);

    useEffect(() => {
      const wt = wtermRef.current;
      if (!wt || !wt.bridge) return;
      if (wt.cols === cols && wt.rows === rows) return;
      resizeLocalTerminal(cols, rows);
    }, [cols, resizeLocalTerminal, rows]);

    useEffect(() => {
      scheduleMeasure();
    }, [displayMode, scheduleMeasure]);

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
