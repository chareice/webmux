// Reverse proxy: /api/* and /ws/* → production, everything else → local Expo dev server
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PRODUCTION = "https://webmux.nas.chareice.site";
const LOCAL_DEV = "http://localhost:8081";
const PORT = 3000;

function proxyRequest(req, res, target) {
  const url = new URL(target + req.url);
  const isHttps = url.protocol === "https:";
  const mod = isHttps ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: url.hostname,
    },
  };

  const proxyReq = mod.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`Proxy error to ${target}: ${err.message}`);
    res.writeHead(502);
    res.end("Bad Gateway");
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/") || req.url.startsWith("/ws/")) {
    proxyRequest(req, res, PRODUCTION);
  } else {
    proxyRequest(req, res, LOCAL_DEV);
  }
});

// Handle WebSocket upgrades
server.on("upgrade", (req, socket, head) => {
  const url = new URL(PRODUCTION + req.url);
  const wsReq = https.request({
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: "GET",
    headers: {
      ...req.headers,
      host: url.hostname,
    },
  });

  wsReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(proxyRes.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") +
      "\r\n\r\n"
    );
    if (proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  wsReq.on("error", (err) => {
    console.error(`WS proxy error: ${err.message}`);
    socket.destroy();
  });

  wsReq.end();
});

server.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
  console.log(`  /api/*, /ws/* → ${PRODUCTION}`);
  console.log(`  everything else → ${LOCAL_DEV}`);
});
