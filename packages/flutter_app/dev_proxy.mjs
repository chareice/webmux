// Simple dev proxy: serves Flutter web build + proxies /api and /ws to NAS
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, 'build', 'web');
const TARGET = 'https://webmux.nas.chareice.site';
const PORT = 8080;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

function proxyRequest(req, res) {
  const url = new URL(TARGET + req.url);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: req.method,
    headers: { ...req.headers, host: url.hostname },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    res.writeHead(502);
    res.end('Proxy error: ' + e.message);
  });
  req.pipe(proxyReq);
}

function proxyWebSocket(req, socket, head) {
  const url = new URL(TARGET + req.url);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: 'GET',
    headers: { ...req.headers, host: url.hostname },
  };

  const proxyReq = https.request(options);
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n'
    );
    if (proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on('error', () => socket.destroy());
  proxyReq.end();
}

const server = http.createServer((req, res) => {
  // Proxy API requests
  if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
    return proxyRequest(req, res);
  }

  // Serve static files
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(STATIC_DIR, 'index.html'); // SPA fallback
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/')) {
    proxyWebSocket(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Dev proxy running at http://localhost:${PORT}`);
  console.log(`API/WS proxied to ${TARGET}`);
});
