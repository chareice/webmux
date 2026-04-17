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

export type { TerminalViewRef, TerminalViewProps };

const TERMINAL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;overflow:hidden;background:#141413;}
#terminal{width:100%;height:100%;}
.xterm{padding:4px;}
</style>
</head>
<body>
<div id="terminal"></div>
<script>
(function(){
  var term = new Terminal({
    fontSize: 14,
    fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
    theme: {
      background: '#141413',
      foreground: '#faf9f5',
      cursor: '#d97757',
      selectionBackground: 'rgba(217,119,87,0.3)',
      black: '#141413', red: '#b53333', green: '#30d158',
      yellow: '#d97757', blue: '#3898ec', magenta: '#cc5de8',
      cyan: '#22b8cf', white: '#faf9f5',
    },
    cursorBlink: true,
    scrollback: 5000,
    allowTransparency: false,
  });

  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));

  function doFit() {
    try {
      fitAddon.fit();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows,
      }));
    } catch(e) {}
  }

  // Forward user input to RN
  term.onData(function(data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'input',
      data: data,
    }));
  });

  // Forward binary input (e.g. from paste)
  term.onBinary(function(data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'input',
      data: data,
    }));
  });

  // Handle messages from RN
  function handleMessage(e) {
    try {
      var msg = JSON.parse(e.data);
      switch(msg.type) {
        case 'write':
          term.write(msg.data);
          break;
        case 'resize':
          if (msg.cols && msg.rows) {
            term.resize(msg.cols, msg.rows);
          }
          break;
        case 'clear':
          term.clear();
          break;
        case 'focus':
          term.focus();
          break;
        case 'fit':
          doFit();
          break;
      }
    } catch(ex) {}
  }

  // Android WebView uses document 'message' event
  document.addEventListener('message', handleMessage);
  // Also listen on window for compatibility
  window.addEventListener('message', handleMessage);

  // Signal ready
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: 'ready',
    cols: term.cols,
    rows: term.rows,
  }));
})();
</script>
</body>
</html>`;

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
          source={{ html: TERMINAL_HTML }}
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
    backgroundColor: "#141413",
  },
  webview: {
    flex: 1,
    backgroundColor: "#141413",
  },
});
