export interface ComposerMessage {
  id: string;
  text: string;
  attachments: { data: string; mime: string; filename?: string }[];
}
export interface ComposerReceipt {
  id: string;
  status: "delivered" | "failed" | "unknown";
  detail: string;
}

/** crypto.randomUUID is unavailable on HTTP LAN origins; getRandomValues isn't. */
export function newComposerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** One outstanding send per terminal. Retrying uses the same durable ID. */
export function createComposerTransport(getSocket: () => WebSocket | null) {
  let pending: { id: string; resolve: (receipt: ComposerReceipt) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const finish = (receipt: ComposerReceipt) => {
    if (!pending || receipt.id !== pending.id) return;
    clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = null;
    resolve(receipt);
  };
  return {
    send(message: ComposerMessage): Promise<ComposerReceipt> {
      if (pending) return Promise.reject(new Error("A message is already being sent."));
      const ws = getSocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Reconnect to the terminal before sending."));
      return new Promise(resolve => {
        pending = { id: message.id, resolve, timer: setTimeout(() => finish({ id: message.id, status: "unknown", detail: "Delivery is unconfirmed. Check status before sending again." }), 35_000) };
        try { ws.send(JSON.stringify({ type: "composer", message })); }
        catch { finish({ id: message.id, status: "unknown", detail: "Connection interrupted. Check delivery status." }); }
      });
    },
    receive(text: string) {
      try {
        const msg = JSON.parse(text);
        if (msg.type === "composer_receipt" && typeof msg.receipt?.id === "string" && ["delivered", "failed", "unknown"].includes(msg.receipt.status) && typeof msg.receipt.detail === "string") finish(msg.receipt);
      } catch { /* Other terminal control frames are handled elsewhere. */ }
    },
    close() {
      if (pending) finish({ id: pending.id, status: "unknown", detail: "Connection interrupted. Check delivery status." });
    },
  };
}
