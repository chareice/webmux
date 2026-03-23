// Simple reverse proxy for local development.
// Proxies /api/* and /ws/* to the real backend, everything else to Expo dev server.
// Usage: WEBMUX_PROXY_TARGET=https://webmux.nas.chareice.site node dev-proxy.mjs

import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

const EXPO_PORT = 8099
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '4000', 10)
const BACKEND = process.env.WEBMUX_PROXY_TARGET || 'http://127.0.0.1:4317'
const PUBLIC_SERVER_URL = process.env.WEBMUX_PROXY_PUBLIC_URL || BACKEND
const backendUrl = new URL(BACKEND)
const backendIsHttps = backendUrl.protocol === 'https:'

function proxyRequest(req, res, target) {
  const url = new URL(target)
  const targetIsHttps = url.protocol === 'https:'
  const mod = targetIsHttps ? https : http
  const options = {
    hostname: url.hostname,
    port: url.port || (targetIsHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: url.host,
    },
  }

  const proxyReq = mod.request(options, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers }
    if (req.url.startsWith('/api/')) {
      responseHeaders['x-webmux-server-url'] = PUBLIC_SERVER_URL
    }
    res.writeHead(proxyRes.statusCode, responseHeaders)
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
  } else {
    proxyRequest(req, res, `http://127.0.0.1:${EXPO_PORT}`)
  }
})

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/') || req.url.startsWith('/ws?')) {
    const wsProtocol = backendIsHttps ? 'wss' : 'ws'
    const mod = backendIsHttps ? https : http

    const options = {
      hostname: backendUrl.hostname,
      port: backendUrl.port || (backendIsHttps ? 443 : 80),
      path: req.url,
      method: 'GET',
      headers: {
        ...req.headers,
        host: backendUrl.host,
      },
    }

    const proxyReq = mod.request(options)
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
  } else {
    // Forward non-API WebSocket to Expo (HMR)
    const expoReq = http.request({
      hostname: '127.0.0.1',
      port: EXPO_PORT,
      path: req.url,
      method: 'GET',
      headers: req.headers,
    })
    expoReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
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
    expoReq.on('error', (err) => {
      console.error(`Expo WS proxy error: ${err.message}`)
      socket.destroy()
    })
    expoReq.end()
  }
})

server.listen(PROXY_PORT, () => {
  console.log(`Dev proxy listening on http://localhost:${PROXY_PORT}`)
  console.log(`  /api/* /ws/* → ${BACKEND}`)
  console.log(`  everything else → http://localhost:${EXPO_PORT}`)
})
