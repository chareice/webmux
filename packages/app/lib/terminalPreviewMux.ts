const PREVIEW_FRAME_MAGIC = 0x02;

export interface TerminalPreviewFrame {
  terminalId: string;
  payload: Uint8Array;
}

export interface TerminalPreviewSubscription {
  machineId: string;
  terminalId: string;
  cols: number;
  rows: number;
}

export type TerminalPreviewChunkHandler = (chunk: Uint8Array) => void;

export type TerminalPreviewClientMessage =
  | {
      type: "subscribe";
      machine_id: string;
      terminal_id: string;
      cols: number;
      rows: number;
    }
  | {
      type: "unsubscribe";
      terminal_id: string;
    };

interface SubscriptionRecord {
  subscription: TerminalPreviewSubscription;
  handlers: Set<TerminalPreviewChunkHandler>;
}

function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  if (source instanceof Uint8Array) {
    return source;
  }
  return new Uint8Array(source);
}

export function decodeTerminalPreviewFrame(
  source: ArrayBuffer | Uint8Array,
): TerminalPreviewFrame {
  const bytes = toBytes(source);
  if (bytes.length === 0) {
    throw new Error("Preview frame is empty");
  }
  if (bytes[0] !== PREVIEW_FRAME_MAGIC) {
    throw new Error(
      `Preview frame magic is 0x${bytes[0].toString(16)}, expected 0x${PREVIEW_FRAME_MAGIC.toString(16)}`,
    );
  }
  if (bytes.length < 3) {
    throw new Error("Preview frame is missing terminal id length");
  }

  const terminalIdLength = (bytes[1] << 8) | bytes[2];
  const terminalIdStart = 3;
  const terminalIdEnd = terminalIdStart + terminalIdLength;
  if (bytes.length < terminalIdEnd) {
    throw new Error("Preview frame is truncated");
  }

  const terminalId = new TextDecoder().decode(
    bytes.subarray(terminalIdStart, terminalIdEnd),
  );
  return {
    terminalId,
    payload: bytes.slice(terminalIdEnd),
  };
}

export function encodeTerminalPreviewFrameForTest(
  terminalId: string,
  payload: Uint8Array,
): Uint8Array {
  const terminalIdBytes = new TextEncoder().encode(terminalId);
  if (terminalIdBytes.length > 0xffff) {
    throw new Error("terminalId is too long");
  }
  const frame = new Uint8Array(1 + 2 + terminalIdBytes.length + payload.length);
  frame[0] = PREVIEW_FRAME_MAGIC;
  frame[1] = (terminalIdBytes.length >> 8) & 0xff;
  frame[2] = terminalIdBytes.length & 0xff;
  frame.set(terminalIdBytes, 3);
  frame.set(payload, 3 + terminalIdBytes.length);
  return frame;
}

export function createTerminalPreviewSubscriptionRegistry(
  sendMessage: (message: TerminalPreviewClientMessage) => void,
) {
  const records = new Map<string, SubscriptionRecord>();

  return {
    subscribe(
      subscription: TerminalPreviewSubscription,
      handler: TerminalPreviewChunkHandler,
    ): () => void {
      let record = records.get(subscription.terminalId);
      if (!record) {
        record = {
          subscription,
          handlers: new Set(),
        };
        records.set(subscription.terminalId, record);
        sendMessage({
          type: "subscribe",
          machine_id: subscription.machineId,
          terminal_id: subscription.terminalId,
          cols: subscription.cols,
          rows: subscription.rows,
        });
      }

      record.handlers.add(handler);

      return () => {
        const current = records.get(subscription.terminalId);
        if (!current) return;
        current.handlers.delete(handler);
        if (current.handlers.size > 0) return;
        records.delete(subscription.terminalId);
        sendMessage({
          type: "unsubscribe",
          terminal_id: subscription.terminalId,
        });
      };
    },

    dispatchFrame(frame: TerminalPreviewFrame) {
      const record = records.get(frame.terminalId);
      if (!record) return;
      for (const handler of record.handlers) {
        handler(frame.payload);
      }
    },

    replaySubscriptions() {
      for (const record of records.values()) {
        sendMessage({
          type: "subscribe",
          machine_id: record.subscription.machineId,
          terminal_id: record.subscription.terminalId,
          cols: record.subscription.cols,
          rows: record.subscription.rows,
        });
      }
    },

    subscriptionCount() {
      return records.size;
    },
  };
}
