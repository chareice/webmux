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
import "@xterm/xterm/css/xterm.css";

import type { TerminalViewRef, TerminalViewProps } from "./TerminalView.types";
import { measureTerminalSurface } from "./terminalXtermMetrics";
import { useTerminalFitController } from "./useTerminalFitController";
import { useTerminalLiveSocket } from "./useTerminalLiveSocket";
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
  waitForWsOpen,
} from "@/lib/terminalImagePaste";
import {
  mergeWrappedRows,
  trimTrailingBlankLines,
  type RawRow,
} from "@/lib/terminalSelection";
import { createSelectionAutoCopyController } from "@/lib/selectionAutoCopy";
import { createTerminalClipboardProvider } from "@/lib/terminalClipboard";
import { isTauri } from "@/lib/platform";
import { createExternalUrlOpener } from "@/lib/terminalLinks";
import { useDisplayMode } from "@/lib/hooks";
import { usePrefixKey } from "@/lib/prefixKeyContext";
import { filterBrowserGeneratedTerminalInput } from "@/lib/terminalInputFilter";
import { createWheelDirectionGate } from "@/lib/terminalWheelGate";
import { resolveTerminalFontFamily } from "@/lib/terminalFonts";

const TERM_COLS = 120;
const TERM_ROWS = 36;
const TERMINAL_SCROLL_SENSITIVITY = 6;

const openExternalUrl = createExternalUrlOpener({
  isTauri,
  tauriOpenUrl: (url) =>
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)),
  tauriShellOpen: (url) =>
    import("@tauri-apps/plugin-shell").then(({ open }) => open(url)),
  windowOpen: (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
});

interface XtermMouseService {
  getCoords: (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined;
  getMouseReportCoords: (
    event: MouseEvent,
    element: HTMLElement,
  ) => { col: number; row: number; x: number; y: number } | undefined;
}

type TerminalWithMouseService = Terminal & {
  _core?: {
    _mouseService?: XtermMouseService;
  };
};

function getLayoutMouseEvent<T extends { clientX: number; clientY: number }>(
  event: T,
  element: HTMLElement,
): T | { clientX: number; clientY: number } {
  const rect = element.getBoundingClientRect();
  const layoutWidth = element.clientWidth || element.offsetWidth;
  const layoutHeight = element.clientHeight || element.offsetHeight;
  const scaleX = layoutWidth > 0 ? rect.width / layoutWidth : 1;
  const scaleY = layoutHeight > 0 ? rect.height / layoutHeight : 1;
  const hasScaledX = Number.isFinite(scaleX) && Math.abs(scaleX - 1) > 0.001;
  const hasScaledY = Number.isFinite(scaleY) && Math.abs(scaleY - 1) > 0.001;

  if (!hasScaledX && !hasScaledY) return event;

  return {
    clientX: hasScaledX
      ? rect.left + (event.clientX - rect.left) / scaleX
      : event.clientX,
    clientY: hasScaledY
      ? rect.top + (event.clientY - rect.top) / scaleY
      : event.clientY,
  };
}

function patchScaledMouseCoordinates(term: Terminal): () => void {
  // xterm calculates mouse cells from untransformed renderer metrics. Adjust
  // pointer coordinates when an ancestor visually scales the terminal.
  const mouseService = (term as TerminalWithMouseService)._core?._mouseService;
  if (!mouseService) return () => {};

  const originalGetCoords = mouseService.getCoords.bind(mouseService);
  const originalGetMouseReportCoords =
    mouseService.getMouseReportCoords.bind(mouseService);

  mouseService.getCoords = (
    event,
    element,
    colCount,
    rowCount,
    isSelection,
  ) =>
    originalGetCoords(
      getLayoutMouseEvent(event, element),
      element,
      colCount,
      rowCount,
      isSelection,
    );

  mouseService.getMouseReportCoords = (event, element) =>
    originalGetMouseReportCoords(
      getLayoutMouseEvent(event, element) as MouseEvent,
      element,
    );

  return () => {
    mouseService.getCoords = originalGetCoords;
    mouseService.getMouseReportCoords = originalGetMouseReportCoords;
  };
}

function formatErr(err: unknown): string {
  if (err == null) return "unknown";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.toString();
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Surface a clipboard failure as a floating toast for users who can't open
// devtools (production Tauri builds). Auto-removes after 8 seconds.
function showCopyDiagnostic(message: string): void {
  if (typeof document === "undefined") return;
  const id = "webmux-copy-diagnostic";
  const existing = document.getElementById(id);
  existing?.remove();
  const div = document.createElement("div");
  div.id = id;
  div.style.cssText =
    "position:fixed;top:8px;right:8px;background:rgba(220,40,40,0.95);" +
    "color:#fff;padding:8px 12px;z-index:99999;font:12px/1.4 monospace;" +
    "border-radius:6px;max-width:60vw;word-break:break-word;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.4);pointer-events:auto;cursor:pointer;";
  div.textContent = `copy failed — ${message}`;
  div.addEventListener("click", () => div.remove());
  document.body.appendChild(div);
  window.setTimeout(() => div.remove(), 8000);
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
    canType,
    canResizeTerminal,
    onTitleChange,
    onReconnectingChange,
    inputTransformRef,
    style,
  }, ref) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const isControllerRef = useRef(isController ?? true);
    const canTypeRef = useRef(canType ?? isController ?? true);
    const canResizeTerminalRef = useRef(canResizeTerminal ?? false);
    const measureRafRef = useRef<number | null>(null);
    const recentClipboardImagePasteRef =
      useRef<ImagePasteDedupeRecord | null>(null);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
    const [sessionGeneration, setSessionGeneration] = useState(0);
    const viewportSizeRef = useRef(viewportSize);

    // Prefix engine access for the xterm key handler below. The handler is
    // attached once at mount, so the latest values go through a ref.
    const prefixKey = usePrefixKey();
    const { isCompact } = useDisplayMode();
    const prefixKeyRef = useRef({ prefixKey, isCompact });
    useEffect(() => {
      prefixKeyRef.current = { prefixKey, isCompact };
    }, [prefixKey, isCompact]);

    useEffect(() => {
      isControllerRef.current = isController ?? true;
    }, [isController]);

    useEffect(() => {
      canTypeRef.current = canType ?? isController ?? true;
    }, [canType, isController]);

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
      let tauriError: unknown = null;
      if (isTauri()) {
        // Use __TAURI_INTERNALS__.invoke directly instead of dynamic-importing
        // the plugin module. Metro compiles `await import("@tauri-apps/...")`
        // into a chunk-loaded async require; that path has been observed to
        // succeed for some plugins (updater, shell) but fail silently for
        // clipboard-manager on macOS WKWebView, leaving the OS clipboard
        // untouched. The internals global is injected by Tauri at
        // window-create time and is always present, so this avoids the
        // chunk-loading variable entirely.
        const internals = (window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: <T = unknown>(
              cmd: string,
              args?: Record<string, unknown>,
            ) => Promise<T>;
          };
        }).__TAURI_INTERNALS__;
        if (internals?.invoke) {
          try {
            await internals.invoke("plugin:clipboard-manager|write_text", {
              text,
            });
            return;
          } catch (err) {
            tauriError = err;
            // eslint-disable-next-line no-console
            console.warn("[webmux] tauri clipboard invoke failed", err);
          }
        } else {
          showCopyDiagnostic("__TAURI_INTERNALS__ not available");
        }
      }
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        const prefix = tauriError
          ? `Tauri clipboard failed: ${formatErr(tauriError)}; browser clipboard failed`
          : "Browser clipboard failed";
        showCopyDiagnostic(`${prefix}: ${formatErr(err)}`);
        // eslint-disable-next-line no-console
        console.warn("[webmux] navigator.clipboard.writeText failed", err);
        throw err;
      }
    }, []);

    const clipboardRead = useCallback(async (): Promise<string> => {
      if (isTauri()) {
        const internals = (window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: <T = unknown>(
              cmd: string,
              args?: Record<string, unknown>,
            ) => Promise<T>;
          };
        }).__TAURI_INTERNALS__;
        if (internals?.invoke) {
          try {
            const text = await internals.invoke<string>(
              "plugin:clipboard-manager|read_text",
            );
            return typeof text === "string" ? text : "";
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[webmux] tauri clipboard read failed", err);
          }
        }
      }
      return navigator.clipboard.readText();
    }, []);

    // Forward a picked file (mobile attach button, drag-drop, etc.) over
    // the live WS using the same `image_paste` protocol that clipboard
    // pastes use. Throws on failure so the caller can surface a message —
    // mobile users can't see console.warn.
    const sendImageFile = useCallback(
      async (file: Blob & { name?: string }): Promise<void> => {
        if (!canTypeRef.current) {
          throw new Error("Unlock view only to attach an image.");
        }
        if (file.size > MAX_IMAGE_PASTE_BYTES) {
          const mb = Math.round(MAX_IMAGE_PASTE_BYTES / (1024 * 1024));
          throw new Error(`Image too large (max ${mb} MB).`);
        }
        // Mobile browsers commonly close the WebSocket while a file picker
        // sits in the foreground. Wait for the reconnect to land before
        // giving up so the user doesn't think the upload silently failed.
        const ws = await waitForWsOpen(() => wsRef.current, 5000);
        if (!ws) {
          throw new Error("Connection unavailable. Try again.");
        }
        const { base64, mime } = await readFileAsBase64(file);
        const ext = mime.includes("/") ? `.${mime.split("/")[1]}` : "";
        const filename = safeFilename(file.name ?? "", ext);
        ws.send(JSON.stringify(buildImagePasteMessage(base64, mime, filename)));
      },
      [],
    );

    // Toggle DEC mouse-tracking modes locally so touch users can drag-select
    // text while in "select mode". We only flip the locally-written modes;
    // a TUI program can still re-enable on its own output, but for shells
    // and Claude Code / Codex sessions this is sufficient in practice.
    const setMouseTrackingEnabled = useCallback((enabled: boolean) => {
      const term = termRef.current;
      if (!term) return;
      term.write(enabled ? "\x1b[?1003h\x1b[?1006h" : "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");
    }, []);

    const getSelection = useCallback((): string => {
      return termRef.current?.getSelection() ?? "";
    }, []);

    const getSelectionSnapshot = useCallback(() => {
      const term = termRef.current;
      if (!term) return null;
      const buf = term.buffer.active;
      const start = buf.viewportY;
      const rawRows: RawRow[] = [];
      for (let i = 0; i < term.rows; i++) {
        const line = buf.getLine(start + i);
        if (!line) {
          rawRows.push({ text: "", isWrapped: false });
          continue;
        }
        rawRows.push({
          text: line.translateToString(true),
          isWrapped: line.isWrapped,
        });
      }
      const lines = trimTrailingBlankLines(mergeWrappedRows(rawRows));
      return {
        lines,
        fontFamily: term.options.fontFamily ?? "monospace",
        fontSize: term.options.fontSize ?? 14,
      };
    }, []);

    const { fitToContainer, resizeLocalTerminal } = useTerminalFitController({
      termRef,
      wsRef,
      fitRef,
      viewportSizeRef,
      displayMode,
      isControllerRef,
      canResizeTerminalRef,
      scheduleMeasure,
    });

    // Expose imperative API
    useImperativeHandle(
      ref,
      () => ({
        sendInput(data: string) {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN && canTypeRef.current) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        },
        sendCommandInput(data: string) {
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN && canTypeRef.current) {
            ws.send(JSON.stringify({ type: "command_input", data }));
          }
        },
        fitToContainer(opts) {
          fitToContainer(opts);
        },
        scrollToBottom() {
          termRef.current?.scrollToBottom();
        },
        focus() {
          termRef.current?.focus();
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
        getSelectionSnapshot,
      }),
      [fitToContainer, sendImageFile, setMouseTrackingEnabled, getSelection, getSelectionSnapshot],
    );

    // Create terminal once on mount — never recreated during reconnections
    // so that terminal modes (mouse tracking, alternate screen) are preserved.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const userFont = localStorage.getItem("webmux:terminal-font-family");
      const userFontSize = localStorage.getItem("webmux:terminal-font-size");
      const fontFamily = resolveTerminalFontFamily(userFont);
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
        macOptionClickForcesSelection: true,
        // xterm dampens likely trackpad wheel deltas before emitting mouse
        // wheel reports. Keep small terminal scroll gestures responsive.
        scrollSensitivity: TERMINAL_SCROLL_SENSITIVITY,
        // OSC 8 hyperlinks have no default click action in xterm.js;
        // WebLinksAddon only covers plain-text URLs.
        linkHandler: {
          activate: (_event, url) => openExternalUrl(url),
        },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(
        new ClipboardAddon(
          undefined,
          createTerminalClipboardProvider({
            readText: clipboardRead,
            writeText: clipboardWrite,
          }),
        ),
      );
      term.loadAddon(
        new WebLinksAddon((_event, url) => {
          openExternalUrl(url);
        }),
      );
      term.open(container);
      const restoreMouseCoordinates = patchScaledMouseCoordinates(term);
      scheduleMeasure();

      // Wheel reports drive tmux copy-mode (wheel-up enters, scrolling to the
      // bottom exits). Swallow the tiny direction reversals trackpads emit at
      // the end of a gesture — amplified by scrollSensitivity they'd re-enter
      // copy-mode right after the user scrolled back down, leaving the
      // terminal stuck showing the scroll position badge.
      const wheelGate = createWheelDirectionGate();
      term.attachCustomWheelEventHandler((ev) =>
        wheelGate(ev.deltaY, ev.deltaMode),
      );

      // Put xterm into mouse-tracking mode locally instead of relying on the
      // hub to emit the escape sequences. Hub-generated bytes wouldn't be
      // counted in the terminal's output_seq, which used to drift the client's
      // lastSeenSeq ahead of the hub and force AttachMode::Reset on every
      // reconnect. Writing locally keeps the WS byte stream pure PTY history.
      // SGR extended mode (1006) + all-motion tracking (1003).
      term.write("\x1b[?1003h\x1b[?1006h");

      termRef.current = term;
      fitRef.current = fit;

      // Expose the Terminal instance for Playwright E2E tests. Renderer DOM
      // shape is not stable across xterm versions, so tests read content via
      // `term.buffer.active.getLine(i).translateToString` through this map.
      // Gated behind localStorage("webmux:e2e")==="1" so production builds
      // never expose live xterm internals on window.
      if (
        typeof window !== "undefined" &&
        typeof localStorage !== "undefined" &&
        localStorage.getItem("webmux:e2e") === "1"
      ) {
        const winAny = window as unknown as {
          __webmuxTerminals?: Map<string, Terminal>;
        };
        if (!winAny.__webmuxTerminals) {
          winAny.__webmuxTerminals = new Map();
        }
        winAny.__webmuxTerminals.set(terminalId, term);
      }

      // Forward terminal input to the current WebSocket. Per-keystroke,
      // unbuffered: xterm's hidden textarea (and its IME composition
      // handling) delivers data to onData as it is committed, and each
      // event is sent immediately. The optional transform hook is the
      // mobile Ctrl latch — it rewrites the armed key to its control byte.
      term.onData((data) => {
        const userInput = filterBrowserGeneratedTerminalInput(data);
        if (!userInput) return;
        const transformed =
          inputTransformRef?.current?.(userInput) ?? userInput;
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN && canTypeRef.current) {
          ws.send(JSON.stringify({ type: "input", data: transformed }));
        }
      });

      // 25 MB cap per file — WS frames larger than this regularly choke the
      // browser and the hub forwarder. Drag-drop a bigger file: we skip it
      // and surface a console.warn so the user knows why it didn't land.
      const MAX_DROP_BYTES = MAX_IMAGE_PASTE_BYTES;

      // Send file bytes over the current WS using the shared `image_paste`
      // protocol. The machine handler writes to /tmp/<filename> and
      // bracketed-pastes the path, which both Claude Code and Codex accept.
      const sendFileToWs = (
        base64: string,
        mime: string,
        filename: string,
        options: { dedupeClipboardImage?: boolean } = {},
      ) => {
        if (!canTypeRef.current) return;
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
          ws.send(JSON.stringify(buildImagePasteMessage(base64, mime, filename)));
        }
      };

      // Ctrl+C / Cmd+C copies selection to clipboard instead of sending SIGINT
      // Ctrl+V / Cmd+V checks clipboard for images before letting xterm paste text
      term.attachCustomKeyEventHandler((event) => {
        // Keep app-level prefix keys out of xterm: the Ctrl+B trigger, and
        // every key while the engine is armed. Returning false covers
        // keydown, keypress and keyup so no stray input reaches the pty;
        // the window keydown listener does the actual dispatch. Compact
        // (phone) chrome has no prefix engine; the unfolded Fold screen
        // keeps it for hardware keyboards.
        const { prefixKey: pk, isCompact: compact } = prefixKeyRef.current;
        if (!compact && pk.isPrefixKeyEvent(event)) {
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
            }).catch((err) => {
              // eslint-disable-next-line no-console
              console.warn("[webmux] Cmd/Ctrl+C clipboard write failed", err);
            });
            return false;
          }
        }

        // Cmd/Ctrl+V is handled by the native paste event below. Reading the
        // clipboard via navigator.clipboard.* trips macOS Sequoia's clipboard
        // privacy prompt (the "Paste" tooltip) — the paste event's
        // clipboardData already exposes both text and image items without
        // triggering it.

        return true;
      });

      // Intercept paste events for image detection
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
          const ext = imageItem.type.split("/")[1] || "png";
          sendFileToWs(
            base64,
            imageItem.type,
            safeFilename(blob.name, `.${ext}`),
            { dedupeClipboardImage: true },
          );
        };
        reader.readAsDataURL(blob);
      };
      container.addEventListener("paste", handlePaste, { capture: true });

      // Drag-and-drop file upload. Dropped files go through the same
      // image-paste pipeline on the machine side (save to /tmp, inject
      // the path as a bracketed paste into the PTY), which works for any
      // file type: Claude Code and Codex both accept a pasted path and
      // figure out whether it's an image / PDF / text themselves.
      const handleDragOver = (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
      };
      const handleDrop = (e: DragEvent) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        for (const file of Array.from(files)) {
          if (file.size > MAX_DROP_BYTES) {
            // eslint-disable-next-line no-console
            console.warn(
              `[webmux] skipping ${file.name}: ${file.size} bytes exceeds ${MAX_DROP_BYTES}`,
            );
            continue;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            sendFileToWs(
              base64,
              file.type || "application/octet-stream",
              safeFilename(file.name),
            );
          };
          reader.readAsDataURL(file);
        }
      };
      container.addEventListener("dragover", handleDragOver);
      container.addEventListener("drop", handleDrop);

      // Suppress the browser default context menu on the terminal — the custom
      // context menu is rendered by TerminalWorkspace.web.tsx via an
      // onContextMenu handler on the wrapping pane div.
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
      };
      container.addEventListener("contextmenu", handleContextMenu);

      // Copy-on-select: when the user finishes a drag/double-click/triple-click
      // selection, push the highlighted text to the clipboard so ⌘V elsewhere
      // works without having to press ⌘C first.
      //
      // Mirror xterm's own SelectionService pattern: on mousedown inside the
      // terminal, attach a one-shot mouseup listener to `document`. This way
      // the copy fires even when the user releases the mouse outside the
      // terminal viewport (e.g. dragging down past the workspace toolbar),
      // and unrelated clicks elsewhere on the page never trigger a re-write.
      //
      // Also listen to xterm's selection-change event. That fires after xterm
      // finalizes its internal selection state, which avoids platform-specific
      // mouseup ordering differences in WebViews.
      const selectionAutoCopy = createSelectionAutoCopyController({
        hasSelection: () => term.hasSelection(),
        getSelection: () => term.getSelection(),
        writeText: clipboardWrite,
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn("[webmux] copy-on-select clipboard write failed", err);
        },
      });
      const selectionChangeDisposable = term.onSelectionChange(() => {
        selectionAutoCopy.selectionChanged();
      });
      const handleSelectMouseUp = () => {
        selectionAutoCopy.pointerSelectionFinished();
      };
      const handleSelectMouseDown = () => {
        selectionAutoCopy.pointerSelectionStarted();
        document.addEventListener("mouseup", handleSelectMouseUp, { once: true });
      };
      container.addEventListener("mousedown", handleSelectMouseDown);

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
        const touch = e.touches[0];
        if (touch) {
          const currentY = touch.clientY;
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
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    screenX: touch.screenX,
                    screenY: touch.screenY,
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
        container.removeEventListener("paste", handlePaste, { capture: true });
        container.removeEventListener("dragover", handleDragOver);
        container.removeEventListener("drop", handleDrop);
        container.removeEventListener("contextmenu", handleContextMenu);
        container.removeEventListener("mousedown", handleSelectMouseDown);
        document.removeEventListener("mouseup", handleSelectMouseUp);
        selectionAutoCopy.dispose();
        selectionChangeDisposable.dispose();
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        if (typeof window !== "undefined") {
          const winAny = window as unknown as {
            __webmuxTerminals?: Map<string, Terminal>;
          };
          // Map only exists when the test-hook flag was set; delete is a no-op
          // otherwise because the map itself was never created.
          winAny.__webmuxTerminals?.delete(terminalId);
        }
        restoreMouseCoordinates();
        term.dispose();
        if (termRef.current === term) {
          termRef.current = null;
        }
        if (fitRef.current === fit) {
          fitRef.current = null;
        }
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Terminal created once on mount
    }, []);

    useTerminalLiveSocket({
      termRef,
      wsRef,
      wsUrl,
      scheduleMeasure,
      sessionGeneration,
      setSessionGeneration,
      onReconnectingChange,
    });

    useEffect(() => {
      const term = termRef.current;
      if (!term) return;
      if (term.cols === cols && term.rows === rows) return;
      resizeLocalTerminal(cols, rows);
    }, [cols, resizeLocalTerminal, rows]);

    useEffect(() => {
      scheduleMeasure();
    }, [displayMode, scheduleMeasure]);

    const liveJustifyContent =
      displayMode === "immersive" &&
      surfaceSize.width > 0 &&
      viewportSize.width >= surfaceSize.width
        ? "center"
        : "flex-start";
    const frameWidth =
      displayMode === "immersive" && surfaceSize.width > 0
        ? `${surfaceSize.width}px`
        : "100%";
    const frameHeight =
      displayMode === "immersive" && surfaceSize.height > 0
        ? `${surfaceSize.height}px`
        : "100%";

    return (
      <div
        ref={viewportRef}
        data-terminal-display-mode={displayMode}
        data-terminal-view-scale="1.0000"
        data-terminal-view-justify={liveJustifyContent}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          justifyContent:
            displayMode === "immersive" ? liveJustifyContent : "flex-start",
          alignItems: "flex-start",
          overflow: "hidden",
          ...style,
        }}
      >
        <div
          style={{
            width: frameWidth,
            height: frameHeight,
            flex: "0 0 auto",
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
    );
  },
);
