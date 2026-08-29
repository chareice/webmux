// Coalesce terminal input written in the same tick into one WS message.
//
// Scroll gestures are the heavy case: xterm emits one onData per SGR wheel
// report, so a single trackpad frame can produce a burst of tiny
// `{type:"input"}` messages that each pay WS framing + hub forwarding
// overhead. Joining a synchronous burst into one message is semantically
// identical for the PTY (same byte stream, same order) and flushes in a
// microtask, so no added latency is observable — the bytes leave before the
// browser yields to the event loop.

export interface InputBatcher {
  push(data: string): void;
  /** Send anything pending now. Call before sending a non-input message so
   *  cross-type ordering is preserved. */
  flush(): void;
}

export function createInputBatcher(
  send: (data: string) => void,
  schedule: (cb: () => void) => void = (cb) => queueMicrotask(cb),
): InputBatcher {
  let pending: string[] = [];
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (pending.length === 0) return;
    const data = pending.length === 1 ? pending[0] : pending.join("");
    pending = [];
    send(data);
  };

  return {
    push(data: string) {
      pending.push(data);
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },
    flush,
  };
}
