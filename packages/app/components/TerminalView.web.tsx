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

const TERM_COLS = 120;
const TERM_ROWS = 36;

export type { TerminalViewRef, TerminalViewProps };

export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  function TerminalView({ machineId, terminalId, wsUrl, isController, onTitleChange, style }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const isControllerRef = useRef(isController ?? true);
    useEffect(() => { isControllerRef.current = isController ?? true; }, [isController]);

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

      const term = new Terminal({
        cols: TERM_COLS,
        rows: TERM_ROWS,
        fontSize: 14,
        lineHeight: 1,
        letterSpacing: 0,
        fontFamily:
          "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
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
        scrollback: 5000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new ClipboardAddon());
      term.loadAddon(new WebLinksAddon());
      term.open(container);

      termRef.current = term;
      fitRef.current = fit;

      // Load WebGL renderer after custom font is ready to avoid black-box glyphs.
      // Guard against component unmount before fonts resolve.
      document.fonts.ready.then(() => {
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

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      let pendingData = "";
      let rafId = 0;
      const MAX_PENDING = 128 * 1024; // flush immediately if buffer exceeds 128KB (e.g. background tab)

      const flushPending = () => {
        if (pendingData) {
          term.write(pendingData);
          pendingData = "";
        }
        rafId = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            pendingData += msg.data;
            if (pendingData.length >= MAX_PENDING) {
              if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
              flushPending();
            } else if (!rafId) {
              rafId = requestAnimationFrame(flushPending);
            }
          }
        } catch {
          /* ignore */
        }
      };

      ws.onopen = () => {
        if (isControllerRef.current) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: TERM_COLS,
              rows: TERM_ROWS,
            }),
          );
        }
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN && isControllerRef.current) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Ctrl+C / Cmd+C copies selection to clipboard instead of sending SIGINT
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
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: "image_paste",
                    data: base64,
                    mime: item.type,
                    filename: `tc-paste-${Date.now()}.png`,
                  }),
                );
              }
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      };
      container.addEventListener("paste", handlePaste);

      // Intercept wheel and touch events before xterm.js processes them so we
      // scroll the local scrollback buffer directly. Without this, xterm.js
      // detects tmux mouse mode and converts wheel events into mouse escape
      // sequences that round-trip through the network, making scroll feel laggy.
      const lineHeight = (term.options.fontSize ?? 14) * (term.options.lineHeight ?? 1);

      // Convert deltaY to line count respecting deltaMode (pixel/line/page)
      const wheelDeltaToLines = (e: WheelEvent): number => {
        switch (e.deltaMode) {
          case WheelEvent.DOM_DELTA_LINE:
            return e.deltaY;
          case WheelEvent.DOM_DELTA_PAGE:
            return e.deltaY * term.rows;
          default: // DOM_DELTA_PIXEL
            return e.deltaY / lineHeight;
        }
      };

      // Wheel handler — capture phase so we act before xterm.js
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        let lines = Math.trunc(wheelDeltaToLines(e));
        if (lines === 0 && e.deltaY !== 0) {
          lines = e.deltaY > 0 ? 1 : -1;
        }
        term.scrollLines(lines);
      };
      container.addEventListener("wheel", onWheel, { passive: false, capture: true });

      // Touch scroll handlers — same direct scrollLines approach
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
          // Convert accumulated pixel delta to line count
          const lines = Math.trunc(accumulatedDelta / lineHeight);
          if (lines !== 0) {
            term.scrollLines(lines);
            accumulatedDelta -= lines * lineHeight;
          }
        }
      };
      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        container.removeEventListener("paste", handlePaste);
        container.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
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
        try {
          fit.fit();
          const dims = fit.proposeDimensions();
          const ws = wsRef.current;
          if (dims && ws?.readyState === WebSocket.OPEN && isControllerRef.current) {
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: dims.cols,
                rows: dims.rows,
              }),
            );
          }
        } catch {
          /* ignore */
        }
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
