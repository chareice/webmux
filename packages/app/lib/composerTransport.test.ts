import { afterEach, describe, expect, it, vi } from "vitest";
import { createComposerTransport, newComposerId } from "./composerTransport";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("composer delivery", () => {
  it("does not mistake a socket send for delivery and ignores another send's receipt", async () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", { OPEN: 1 });
    const send = vi.fn();
    const transport = createComposerTransport(() => ({ readyState: 1, send }) as unknown as WebSocket);
    const message = { id: newComposerId(), text: "hello", attachments: [] };
    const result = transport.send(message);
    let done = false; void result.then(() => { done = true; });
    expect(send).toHaveBeenCalledOnce();
    transport.receive(JSON.stringify({ type: "composer_receipt", receipt: { id: "other", status: "delivered", detail: "ok" } }));
    await Promise.resolve(); expect(done).toBe(false);
    await expect(transport.send(message)).rejects.toThrow("already");
    transport.close();
    expect((await result).status).toBe("unknown");
    expect(send).toHaveBeenCalledOnce();
  });

  it("times out as unconfirmed without automatically resending", async () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", { OPEN: 1 });
    const send = vi.fn();
    const transport = createComposerTransport(() => ({ readyState: 1, send }) as unknown as WebSocket);
    const result = transport.send({ id: newComposerId(), text: "hello", attachments: [] });
    await vi.advanceTimersByTimeAsync(35_000);
    expect((await result).status).toBe("unknown");
    expect(send).toHaveBeenCalledOnce();
  });
});
