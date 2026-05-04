import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

import type { TerminalViewRef, TerminalViewProps } from "./TerminalView.types";
import { buildResizeMessage } from "@/lib/terminalResize";
import {
  buildImagePasteMessage,
  MAX_IMAGE_PASTE_BYTES,
  readFileAsBase64,
  safeFilename,
} from "@/lib/terminalImagePaste";
import { ANDROID_TERMINAL_HTML } from "@/lib/nativeTerminalHtml";

export type { TerminalViewRef, TerminalViewProps };

/**
 * Android terminal view using WebView + xterm.js.
 *
 * Architecture:
 *   React Native manages the WebSocket connection to the hub.
 *   xterm.js in WebView handles VT100 rendering and keyboard input.
 *   postMessage bridges data between the two layers.
 */
export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  function TerminalView({
    machineId,
    terminalId,
    wsUrl,
    cols,
    rows,
    isController,
    canResizeTerminal,
    onTitleChange,
    style,
  }, ref) {
    const webViewRef = useRef<WebView>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const readyRef = useRef(false);
    const isControllerRef = useRef(isController ?? true);
    const canResizeTerminalRef = useRef(canResizeTerminal ?? false);
    const decoderRef = useRef(new TextDecoder());
    // Queue output data that arrives before WebView is ready
    const pendingQueue = useRef<string[]>([]);

    // Send a message to the WebView
    const postToWebView = useCallback((msg: object) => {
      webViewRef.current?.postMessage(JSON.stringify(msg));
    }, []);

    const sendResizeToHub = useCallback((dims: { cols: number; rows: number }) => {
      const ws = wsRef.current;
      const resizeMessage = buildResizeMessage(dims);
      if (isControllerRef.current && ws?.readyState === WebSocket.OPEN && resizeMessage) {
        ws.send(JSON.stringify(resizeMessage));
      }
    }, []);

    useEffect(() => {
      isControllerRef.current = isController ?? true;
    }, [isController]);

    useEffect(() => {
      canResizeTerminalRef.current = canResizeTerminal ?? false;
    }, [canResizeTerminal]);

    const writeToTerminal = useCallback(
      (data: string) => {
        if (!data) return;

        if (readyRef.current) {
          postToWebView({ type: "write", data });
        } else {
          pendingQueue.current.push(data);
        }
      },
      [postToWebView],
    );

    // Expose imperative API
    useImperativeHandle(
      ref,
      () => ({
        sendInput(data: string) {
          const ws = wsRef.current;
          if (isControllerRef.current && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        },
        sendCommandInput(data: string) {
          const ws = wsRef.current;
          if (isControllerRef.current && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "command_input", data }));
          }
        },
        fitToContainer() {
          if (!readyRef.current || !isControllerRef.current || !canResizeTerminalRef.current) {
            return;
          }
          postToWebView({ type: "fit" });
        },
        focus() {
          postToWebView({ type: "focus" });
        },
        blur() {
          // Native WebView keyboard dismissal is handled by the host platform.
        },
        async sendImageFile(file: Blob & { name?: string }): Promise<void> {
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
        setMouseTrackingEnabled() {
          // Native APK uses platform-level text selection — the web
          // select-mode toggle does not apply here.
        },
        getSelection() {
          return "";
        },
        getSelectionSnapshot() {
          return null;
        },
      }),
      [postToWebView],
    );

    // Manage WebSocket connection
    useEffect(() => {
      if (!wsUrl) return;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        // Send initial resize after WebView reports dimensions
      };

      ws.onmessage = (event: any) => {
        void Promise.resolve(event.data)
          .then(async (payload) => {
            if (typeof payload === "string") {
              try {
                const msg = JSON.parse(payload);
                if (msg.type === "error") {
                  return;
                }
              } catch {
                /* ignore */
              }
              return;
            }

            if (payload instanceof ArrayBuffer) {
              writeToTerminal(
                decoderRef.current.decode(new Uint8Array(payload), {
                  stream: true,
                }),
              );
              return;
            }

            if (payload && typeof payload.arrayBuffer === "function") {
              const buffer = await payload.arrayBuffer();
              writeToTerminal(
                decoderRef.current.decode(new Uint8Array(buffer), {
                  stream: true,
                }),
              );
            }
          })
          .catch(() => {
            /* ignore */
          });
      };

      ws.onerror = () => {
        /* handled by onclose */
      };

      ws.onclose = () => {
        wsRef.current = null;
      };

      return () => {
        decoderRef.current = new TextDecoder();
        ws.close();
        wsRef.current = null;
      };
    }, [wsUrl, writeToTerminal]);

    // Handle messages from WebView
    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);

          switch (msg.type) {
            case "ready": {
              readyRef.current = true;

              // Flush queued output data
              for (const data of pendingQueue.current) {
                postToWebView({ type: "write", data });
              }
              pendingQueue.current = [];
              postToWebView({ type: "resize", cols, rows });
              break;
            }

            case "input": {
              // User typed something in xterm — forward to WebSocket
              const ws = wsRef.current;
              if (isControllerRef.current && ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "input", data: msg.data }));
              }
              break;
            }

            case "resize": {
              // Terminal dimensions changed — inform the hub
              if (typeof msg.cols === "number" && typeof msg.rows === "number") {
                sendResizeToHub({ cols: msg.cols, rows: msg.rows });
              }
              break;
            }
          }
        } catch {
          /* ignore malformed messages */
        }
      },
      [postToWebView, sendResizeToHub],
    );

    useEffect(() => {
      if (!readyRef.current) return;
      postToWebView({ type: "resize", cols, rows });
    }, [cols, rows, postToWebView]);

    return (
      <View style={[styles.container, style as any]}>
        <WebView
          ref={webViewRef}
          source={{ html: ANDROID_TERMINAL_HTML }}
          style={styles.webview}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          // Prevent zoom gestures from interfering
          scalesPageToFit={false}
          // Disable bouncing/overscroll
          overScrollMode="never"
          // Allow mixed content for CDN resources
          mixedContentMode="compatibility"
          // Transparent background while loading
          androidLayerType="hardware"
          // Don't show scroll indicators
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          // Allow inline media playback
          allowsInlineMediaPlayback
          // Disable text selection gestures that conflict with terminal
          textInteractionEnabled={false}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060a",
  },
  webview: {
    flex: 1,
    backgroundColor: "#05060a",
  },
});
