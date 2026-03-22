interface SocketLike {
  onclose: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onmessage: ((event: any) => void) | null
  close: (code?: number, reason?: string) => void
}

interface ReconnectableSocketOptions<TSocket extends SocketLike> {
  connect: () => TSocket
  onMessage: (event: any) => void
  onError?: () => void
  getDelayMs?: (attempt: number) => number
}

export function createReconnectableSocket<TSocket extends SocketLike>(
  options: ReconnectableSocketOptions<TSocket>,
) {
  let socket: TSocket | null = null
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const disposeSocket = () => {
    if (!socket) {
      return
    }

    const current = socket
    socket = null
    current.onclose = null
    current.onerror = null
    current.onmessage = null
    current.close()
  }

  const connect = () => {
    if (disposed) {
      return
    }

    disposeSocket()

    const current = options.connect()
    socket = current
    current.onmessage = options.onMessage
    current.onerror = () => {
      options.onError?.()
    }
    current.onclose = () => {
      if (disposed) {
        return
      }

      reconnectAttempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, options.getDelayMs?.(reconnectAttempt) ?? 3000)
    }
  }

  connect()

  return {
    dispose() {
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      disposeSocket()
    },
  }
}
