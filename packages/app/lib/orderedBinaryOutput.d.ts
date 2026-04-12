export interface BinaryChunkLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface OrderedBinaryOutputQueue {
  push(source: ArrayBuffer | BinaryChunkLike): void;
  flush(): Promise<void>;
}

export function createOrderedBinaryOutputQueue(
  onChunk: (chunk: Uint8Array) => void,
): OrderedBinaryOutputQueue;
