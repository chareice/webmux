import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import type { TerminalViewRef, TerminalViewProps } from "./TerminalView.types";

const TERM_COLS = 120;
const TERM_ROWS = 36;

export type { TerminalViewRef, TerminalViewProps };

export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  function TerminalView({ machineId, terminalId, wsUrl, onTitleChange, style }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

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
      term.open(container);

      // WebGL renderer for better block character rendering
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available, fall back to default canvas renderer
      }

      termRef.current = term;
      fitRef.current = fit;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            term.write(msg.data);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: TERM_COLS,
            rows: TERM_ROWS,
          }),
        );
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
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

      return () => {
        container.removeEventListener("paste", handlePaste);
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
          if (dims && ws?.readyState === WebSocket.OPEN) {
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
