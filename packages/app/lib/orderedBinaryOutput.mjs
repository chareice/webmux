export function createOrderedBinaryOutputQueue(onChunk) {
  let chain = Promise.resolve();
  // Number of chunks still queued on the promise chain. While it is zero an
  // ArrayBuffer can be delivered synchronously (the common case — binary WS
  // frames with binaryType "arraybuffer") without paying a Promise + microtask
  // per message. Blobs, and anything arriving behind a pending Blob, keep the
  // ordered chain.
  let pending = 0;

  return {
    push(source) {
      if (pending === 0 && source instanceof ArrayBuffer) {
        onChunk(new Uint8Array(source));
        return;
      }
      pending += 1;
      chain = chain
        .then(async () => {
          const buffer =
            source instanceof ArrayBuffer
              ? source
              : await source.arrayBuffer();
          onChunk(new Uint8Array(buffer));
        })
        .catch(() => {
          /* ignore */
        })
        .finally(() => {
          pending -= 1;
        });
    },
    flush() {
      return chain;
    },
  };
}
