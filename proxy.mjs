// Dev proxy for local development.
// Proxies /api/* and /ws/* to the Rust hub server, everything else to Expo dev server.
// Usage: WEBMUX_PROXY_TARGET=http://127.0.0.1:4317 node proxy.mjs

import http from 'node:http'
import { URL } from 'node:url'

const EXPO_PORT = 8081
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '4000', 10)
const BACKEND = process.env.WEBMUX_PROXY_TARGET || 'http://127.0.0.1:4317'
const backendUrl = new URL(BACKEND)

function proxyRequest(req, res, target) {
  const url = new URL(target)
  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: url.host,
    },
  }

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })

  proxyReq.on('error', (err) => {
    console.error(`Proxy error to ${target}: ${err.message}`)
    if (!res.headersSent) {
      res.writeHead(502)
      res.end('Bad Gateway')
    }
  })

  req.pipe(proxyReq)
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/api?')) {
    proxyRequest(req, res, BACKEND)
  } else if (req.url.startsWith('/ws/') || req.url.startsWith('/ws?')) {
    proxyRequest(req, res, BACKEND)
  } else {
    proxyRequest(req, res, `http://127.0.0.1:${EXPO_PORT}`)
  }
})

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const isBackend =
    req.url.startsWith('/ws/') || req.url.startsWith('/ws?') ||
    req.url.startsWith('/api/') || req.url.startsWith('/api?')

  const target = isBackend ? backendUrl : new URL(`http://127.0.0.1:${EXPO_PORT}`)

  const options = {
    hostname: target.hostname,
    port: target.port || 80,
    path: req.url,
    method: 'GET',
    headers: {
      ...req.headers,
      host: target.host,
    },
  }

  const proxyReq = http.request(options)

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(proxyRes.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n') +
      '\r\n\r\n'
    )
    if (proxyHead.length > 0) socket.write(proxyHead)
    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
  })

  proxyReq.on('error', (err) => {
    console.error(`WebSocket proxy error: ${err.message}`)
    socket.destroy()
  })

  proxyReq.end()
})

server.listen(PROXY_PORT, () => {
  console.log(`Dev proxy listening on http://localhost:${PROXY_PORT}`)
  console.log(`  /api/* /ws/* → ${BACKEND}`)
  console.log(`  everything else → http://localhost:${EXPO_PORT}`)
})
