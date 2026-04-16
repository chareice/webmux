import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import type { TerminalViewRef, TerminalViewProps } from "./TerminalView.types";
import { createOrderedBinaryOutputQueue } from "@/lib/orderedBinaryOutput.mjs";
import { createTerminalReconnectController } from "@/lib/terminalReconnect";
import { buildResizeMessage } from "@/lib/terminalResize";
import {
  getTerminalFitDimensions,
  getTerminalViewportLayout,
} from "@/lib/terminalViewModel";
import { terminalTheme } from "@/lib/colors";
import { isTauri } from "@/lib/platform";
import { isAppShortcut } from "@/lib/shortcuts";

const TERM_COLS = 120;
const TERM_ROWS = 36;

// Preferred monospace fonts in priority order.
// Includes Nerd Font variants common on Linux.
const PREFERRED_FONTS = [
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono NF",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMono NFM",
  "Fira Code",
  "FiraCode Nerd Font",
  "FiraCode NF",
  "Cascadia Code",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaCove NF",
  "Source Code Pro",
  "SauceCodePro Nerd Font",
  "Hack",
  "Hack Nerd Font",
  "Ubuntu Mono",
  "UbuntuMono Nerd Font",
  "Consolas",
  "Menlo",
  "Monaco",
  "DejaVu Sans Mono",
];

// Detect which monospace font is actually available on the client
// by comparing canvas text measurements against the generic fallback.
function detectAvailableFont(): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "monospace";

  const testStr = "mmmmmmmmmmlli";
  ctx.font = "72px monospace";
  const baseWidth = ctx.measureText(testStr).width;

  for (const font of PREFERRED_FONTS) {
    ctx.font = `72px '${font}', monospace`;
    if (ctx.measureText(testStr).width !== baseWidth) {
      return `'${font}', monospace`;
    }
  }

  return "monospace";
}

function measureTerminalSurface(
  container: HTMLDivElement | null,
): { width: number; height: number } {
  if (!container) {
    return { width: 0, height: 0 };
  }

  const screen = container.querySelector(".xterm-screen") as HTMLElement | null;
  const width = Math.max(
    screen?.scrollWidth ?? 0,
    screen?.clientWidth ?? 0,
    container.scrollWidth,
    container.clientWidth,
  );
  const height = Math.max(
    screen?.scrollHeight ?? 0,
    screen?.clientHeight ?? 0,
    container.scrollHeight,
    container.clientHeight,
  );

  return { width, height };
}

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
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
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

    const clipboardWrite = useCallback(async (text: string) => {
      if (isTauri()) {
        const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
        await writeText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
    }, []);

    const clipboardRead = useCallback(async (): Promise<string> => {
      if (isTauri()) {
        const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
        return await readText();
      }
      return await navigator.clipboard.readText();
    }, []);

    // Expose imperative API
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
        sendImagePaste(base64: string, mime: string) {
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
        },
        fitToContainer() {
          const fit = fitRef.current;
          const liveWs = wsRef.current;
          if (
            liveWs?.readyState !== WebSocket.OPEN ||
            !isControllerRef.current ||
            !canResizeTerminalRef.current
          ) {
            return;
          }

          try {
            const nextDims =
              displayMode === "immersive"
                ? getTerminalFitDimensions({
                    viewportWidth: viewportSizeRef.current.width,
                    viewportHeight: viewportSizeRef.current.height,
                    contentWidth: surfaceSizeRef.current.width,
                    contentHeight: surfaceSizeRef.current.height,
                    cols,
                    rows,
                  })
                : (() => {
                    if (!fit) return null;
                    fit.fit();
                    return fit.proposeDimensions();
                  })();

            const resizeMessage = buildResizeMessage(nextDims);
            if (!resizeMessage) return;
            liveWs.send(JSON.stringify(resizeMessage));
          } catch {
            /* ignore */
          }
        },
        focus() {
          termRef.current?.focus();
        },
      }),
      [cols, displayMode, rows],
    );

    // Create terminal once on mount — never recreated during reconnections
    // so that terminal modes (mouse tracking, alternate screen) are preserved.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const userFont = localStorage.getItem("webmux:terminal-font-family");
      const userFontSize = localStorage.getItem("webmux:terminal-font-size");
      const fontFamily = userFont ? `'${userFont}', monospace` : detectAvailableFont();
      const fontSize = userFontSize ? Math.max(10, Math.min(24, parseInt(userFontSize, 10) || 14)) : 14;

      const term = new Terminal({
        cols,
        rows,
        fontSize,
        lineHeight: 1,
        letterSpacing: 0,
        fontFamily,
        allowTransparency: false,
        rescaleOverlappingGlyphs: true,
        theme: terminalTheme,
        cursorBlink: true,
        scrollback: 0,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new ClipboardAddon());
      term.loadAddon(new WebLinksAddon());
      term.open(container);
      scheduleMeasure();

      termRef.current = term;
      fitRef.current = fit;

      // Wait two frames so the browser fully resolves the detected font
      // before WebGL builds its glyph texture atlas (avoids black-box glyphs).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!container.isConnected || termRef.current !== term) return;

          let webgl: WebglAddon | null = null;
          try {
            webgl = new WebglAddon();
            webgl.onContextLoss(() => {
              webgl?.dispose();
            });
            term.loadAddon(webgl);
            scheduleMeasure();
          } catch {
            webgl?.dispose();
          }
        });
      });

      // Forward terminal input to the current WebSocket
      term.onData((data) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN && isControllerRef.current) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Helper: send image data over the current WebSocket
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

      // Ctrl+C / Cmd+C copies selection to clipboard instead of sending SIGINT
      // Ctrl+V / Cmd+V checks clipboard for images before letting xterm paste text
      term.attachCustomKeyEventHandler((event) => {
        // Let app-level shortcuts bubble up to the window handler
        if (isAppShortcut(event)) {
          return false;
        }

        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === "c" &&
          event.type === "keydown"
        ) {
          if (term.hasSelection()) {
            event.preventDefault();
            void clipboardWrite(term.getSelection()).then(() => {
              term.clearSelection();
            }).catch(() => {
              /* clipboard write failed — ignore */
            });
            return false;
          }
        }

        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === "v" &&
          event.type === "keydown"
        ) {
          event.preventDefault();
          void (async () => {
            try {
              if (isTauri()) {
                // On Tauri, use native clipboard (text only — no image read API)
                const text = await clipboardRead();
                if (text) term.paste(text);
              } else {
                // On web, read full clipboard including images
                const items = await navigator.clipboard.read();
                for (const item of items) {
                  const imageType = item.types.find((t) =>
                    t.startsWith("image/"),
                  );
                  if (imageType) {
                    const blob = await item.getType(imageType);
                    const reader = new FileReader();
                    reader.onload = () => {
                      const base64 = (reader.result as string).split(",")[1];
                      sendImageToWs(base64, imageType);
                    };
                    reader.readAsDataURL(blob);
                    return;
                  }
                }
                const text = await navigator.clipboard.readText();
                if (text) term.paste(text);
              }
            } catch {
              try {
                const text = await clipboardRead();
                if (text) term.paste(text);
              } catch {
                /* clipboard read failed — ignore */
              }
            }
          })();
          return false;
        }

        return true;
      });

      // Intercept paste events for image detection
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

      // Touch scroll handling for mobile
      const lineHeight = (term.options.fontSize ?? 14) * (term.options.lineHeight ?? 1);
      let lastTouchY = 0;
      let accumulatedDelta = 0;

      const onTouchStart = (e: TouchEvent) => {
        e.stopPropagation();
        if (e.touches[0]) {
          lastTouchY = e.touches[0].clientY;
          accumulatedDelta = 0;
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.touches[0]) {
          const currentY = e.touches[0].clientY;
          accumulatedDelta += lastTouchY - currentY;
          lastTouchY = currentY;
          const lines = Math.trunc(accumulatedDelta / lineHeight);
          if (lines !== 0) {
            const vp = container.querySelector(".xterm-viewport");
            if (vp) {
              for (let i = 0; i < Math.abs(lines); i++) {
                vp.dispatchEvent(
                  new WheelEvent("wheel", {
                    deltaY: lines > 0 ? lineHeight : -lineHeight,
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              }
            }
            accumulatedDelta -= lines * lineHeight;
          }
        }
      };
      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });

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
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        term.dispose();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Terminal created once on mount
    }, []);

    // Manage WebSocket connection — reconnects without recreating Terminal.
    // This preserves terminal modes (mouse tracking, alternate screen) across reconnections.
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
      const MAX_PENDING = 128 * 1024;

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
      const term = termRef.current;
      if (!term) return;
      if (term.cols === cols && term.rows === rows) return;
      try {
        term.resize(cols, rows);
        scheduleMeasure();
      } catch {
        /* ignore */
      }
    }, [cols, rows, scheduleMeasure]);

    useEffect(() => {
      scheduleMeasure();
    }, [displayMode, scheduleMeasure]);

    // Auto-fit terminal when first created at default size (80x24).
    // Only triggers once — switching tabs on an already-sized terminal won't re-fit.
    useEffect(() => {
      if (displayMode !== "immersive" || !canResizeTerminal) return;
      // Only auto-fit if terminal is at the server default size (newly created).
      // Already-sized terminals keep their size when switching tabs.
      if (cols !== 80 || rows !== 24) return;

      const timerId = window.setTimeout(() => {
        const fit = fitRef.current;
        const liveWs = wsRef.current;
        const viewport = viewportRef.current;
        if (
          !fit ||
          !liveWs ||
          liveWs.readyState !== WebSocket.OPEN ||
          !isControllerRef.current ||
          !canResizeTerminalRef.current ||
          // Skip auto-fit if the viewport is hidden (e.g. inactive tab kept alive)
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
          const resizeMessage = buildResizeMessage(nextDims);
          if (!resizeMessage) return;
          liveWs.send(JSON.stringify(resizeMessage));
        } catch {
          /* ignore */
        }
      }, 200);

      return () => window.clearTimeout(timerId);
    }, [displayMode, canResizeTerminal, cols, rows]);

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
              }}
            />
          </div>
        </div>
      </div>
    );
  },
);
