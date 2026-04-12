import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import type { TerminalViewRef, TerminalViewProps } from "./TerminalView.types";
import { createOrderedBinaryOutputQueue } from "@/lib/orderedBinaryOutput.mjs";
import { buildResizeMessage, didGainControl } from "@/lib/terminalResize";

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

export type { TerminalViewRef, TerminalViewProps };

export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  function TerminalView({ machineId, terminalId, wsUrl, isController, onTitleChange, style }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const isControllerRef = useRef(isController ?? true);
    const syncResizeRef = useRef<() => void>(() => {});
    const previousControllerRef = useRef(isController ?? true);

    useEffect(() => {
      const nextIsController = isController ?? true;
      const previousIsController = previousControllerRef.current;
      isControllerRef.current = nextIsController;

      if (didGainControl(previousIsController, nextIsController)) {
        requestAnimationFrame(() => {
          syncResizeRef.current();
        });
      }

      previousControllerRef.current = nextIsController;
    }, [isController]);

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
        focus() {
          termRef.current?.focus();
        },
      }),
      [],
    );

    // Create terminal and WebSocket once on mount
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const fontFamily = detectAvailableFont();

      const term = new Terminal({
        cols: TERM_COLS,
        rows: TERM_ROWS,
        fontSize: 14,
        lineHeight: 1,
        letterSpacing: 0,
        fontFamily,
        allowTransparency: false,
        rescaleOverlappingGlyphs: true,
        theme: {
          background: "#112a45",
          foreground: "#e0e8f0",
          cursor: "#00d4aa",
          selectionBackground: "rgba(0, 212, 170, 0.3)",
          black: "#0a1929",
          red: "#ff6b6b",
          green: "#00d4aa",
          yellow: "#ffd93d",
          blue: "#4dabf7",
          magenta: "#cc5de8",
          cyan: "#22b8cf",
          white: "#e0e8f0",
        },
        cursorBlink: true,
        scrollback: 0,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new ClipboardAddon());
      term.loadAddon(new WebLinksAddon());
      term.open(container);

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
          } catch {
            webgl?.dispose();
          }
        });
      });

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      const syncTerminalResize = () => {
        const fit = fitRef.current;
        const liveWs = wsRef.current;
        if (!fit || liveWs?.readyState !== WebSocket.OPEN || !isControllerRef.current) {
          return;
        }

        try {
          fit.fit();
          const resizeMessage = buildResizeMessage(fit.proposeDimensions());
          if (!resizeMessage) return;
          liveWs.send(JSON.stringify(resizeMessage));
        } catch {
          /* ignore */
        }
      };

      syncResizeRef.current = syncTerminalResize;

      let pendingChunks: Uint8Array[] = [];
      let pendingBytes = 0;
      let rafId = 0;
      const MAX_PENDING = 128 * 1024; // flush immediately if buffer exceeds 128KB (e.g. background tab)

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

      ws.onopen = () => {
        const initialResize = buildResizeMessage({
          cols: TERM_COLS,
          rows: TERM_ROWS,
        });
        if (isControllerRef.current && initialResize) {
          ws.send(JSON.stringify(initialResize));
        }
        syncTerminalResize();
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN && isControllerRef.current) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Helper: send image data over WebSocket
      const sendImageToWs = (base64: string, mime: string) => {
        if (ws.readyState === WebSocket.OPEN) {
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
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === "c" &&
          event.type === "keydown"
        ) {
          const writeText = navigator.clipboard?.writeText?.bind(
            navigator.clipboard,
          );
          if (writeText && term.hasSelection()) {
            event.preventDefault();
            void writeText(term.getSelection()).then(() => {
              term.clearSelection();
            }).catch(() => {
              /* clipboard write failed — ignore */
            });
            return false;
          }
        }

        // Intercept paste (Cmd+V / Ctrl+V) to check for images.
        // ClipboardAddon only reads text via navigator.clipboard.readText(),
        // so the native paste event with image data never reaches our container
        // listener on macOS. We handle it here with the full Clipboard API.
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === "v" &&
          event.type === "keydown"
        ) {
          event.preventDefault();
          void (async () => {
            try {
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
              // No image — paste text normally
              const text = await navigator.clipboard.readText();
              if (text) term.paste(text);
            } catch {
              // Clipboard API denied or unavailable — fall back to text paste
              try {
                const text = await navigator.clipboard.readText();
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

      // Intercept paste events for image detection (fallback for right-click paste, etc.)
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

      // Fix: xterm.js v6 registers a document-level touchstart/touchmove handler
      // with {passive:false} that calls preventDefault(), blocking native scroll.
      // We stop propagation on the container so the document handler never fires,
      // then dispatch synthetic WheelEvents on the viewport so xterm.js handles
      // them normally — when tmux mouse mode is on, xterm converts wheel to mouse
      // escape sequences; otherwise it scrolls its own scrollback.
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
            const viewport = container.querySelector(".xterm-viewport");
            if (viewport) {
              for (let i = 0; i < Math.abs(lines); i++) {
                viewport.dispatchEvent(
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

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        syncResizeRef.current = () => {};
        container.removeEventListener("paste", handlePaste);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        ws.close();
        term.dispose();
      };
    }, [wsUrl]);

    // Fit terminal when container size changes
    useEffect(() => {
      const container = containerRef.current;
      const fit = fitRef.current;
      if (!container || !fit) return;

      const doFit = () => {
        syncResizeRef.current();
      };

      const timer = setTimeout(doFit, 50);
      const observer = new ResizeObserver(doFit);
      observer.observe(container);

      return () => {
        clearTimeout(timer);
        observer.disconnect();
      };
    }, []);

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          ...style,
        }}
      />
    );
  },
);
