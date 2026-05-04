export const ANDROID_TERMINAL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;overflow:hidden;background:#05060a;touch-action:none;}
#terminal{width:100%;height:100%;overflow:hidden;touch-action:none;}
.xterm{padding:4px;}
.xterm-screen{touch-action:pan-y;pointer-events:none;}
.xterm-viewport{overflow-y:scroll!important;overflow-x:hidden!important;touch-action:pan-y!important;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
.xterm-viewport::-webkit-scrollbar{display:none;}
</style>
</head>
<body>
<div id="terminal"></div>
<script>
(function(){
  var terminalEl = document.getElementById('terminal');
  var term = new Terminal({
    fontSize: 14,
    fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
    theme: {
      background: '#05060a',
      foreground: '#f7f8fb',
      cursor: '#fb9d59',
      selectionBackground: 'rgba(251,157,89,0.3)',
      black: '#0b0c0f', red: '#fa6863', green: '#63d18f',
      yellow: '#eabf3a', blue: '#69c1fc', magenta: '#bb9af4',
      cyan: '#5ccab3', white: '#ccced1',
      brightBlack: '#27292d', brightRed: '#fa6863',
      brightGreen: '#63d18f', brightYellow: '#fb9d59',
      brightBlue: '#69c1fc', brightMagenta: '#bb9af4',
      brightCyan: '#7ad8c6', brightWhite: '#f7f8fb',
    },
    cursorBlink: true,
    scrollback: 5000,
    allowTransparency: false,
  });

  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalEl);

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

  function getLineHeight() {
    var row = document.querySelector('.xterm-rows > div');
    var height = row && row.getBoundingClientRect().height;
    return height || 18;
  }

  var touchStartY = null;
  var pendingLines = 0;
  var TOUCH_SCROLL_WHEEL_SCALE = 0.22;

  function resetTouchScroll() {
    touchStartY = null;
    pendingLines = 0;
  }

  function scrollTerminalByPixels(pixelDelta) {
    var lineHeight = Math.max(8, getLineHeight());
    pendingLines += pixelDelta / lineHeight;
    var lines = pendingLines < 0 ? Math.ceil(pendingLines) : Math.floor(pendingLines);
    if (lines === 0) return;
    scrollTerminalLines(-lines);
    pendingLines -= lines;
  }

  function scrollTerminalLines(lines) {
    if (!lines) return;

    var wheelTarget = document.querySelector('.xterm-screen') ||
      document.querySelector('.xterm') ||
      terminalEl;
    if (wheelTarget && typeof WheelEvent === 'function') {
      wheelTarget.dispatchEvent(new WheelEvent('wheel', {
        deltaY: lines * getLineHeight() * TOUCH_SCROLL_WHEEL_SCALE,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        view: window,
      }));
      return;
    }

    try {
      if (typeof term.scrollLines === 'function') {
        term.scrollLines(lines);
      }
    } catch(e) {
      // Ignore scroll failures from older xterm builds.
    }
  }

  function isTerminalTouch(e) {
    var target = e.target;
    return target === terminalEl ||
      !!(target && target.closest && target.closest('#terminal'));
  }

  function handleTouchStart(e) {
    if (!isTerminalTouch(e)) return;
    if (e.touches.length !== 1) {
      resetTouchScroll();
      return;
    }
    touchStartY = e.touches[0].clientY;
    pendingLines = 0;
  }

  function handleTouchMove(e) {
    if (!isTerminalTouch(e)) return;
    if (touchStartY === null || e.touches.length !== 1) return;
    var nextY = e.touches[0].clientY;
    var pixelDelta = nextY - touchStartY;
    touchStartY = nextY;
    scrollTerminalByPixels(pixelDelta);
    e.preventDefault();
    e.stopPropagation();
  }

  function bindTouchScroll(target) {
    target.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    target.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    target.addEventListener('touchend', resetTouchScroll, { capture: true, passive: true });
    target.addEventListener('touchcancel', resetTouchScroll, { capture: true, passive: true });
  }

  bindTouchScroll(document);
  bindTouchScroll(terminalEl);

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
        case 'scroll':
          if (typeof msg.lines === 'number') {
            scrollTerminalLines(msg.lines);
          }
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
