export function createOrderedBinaryOutputQueue(onChunk) {
  let chain = Promise.resolve();

  return {
    push(source) {
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
        });
    },
    flush() {
      return chain;
    },
  };
}
