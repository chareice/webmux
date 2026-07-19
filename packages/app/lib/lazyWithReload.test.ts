import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHUNK_RELOAD_KEY, lazyWithReload } from "./lazyWithReload";

describe("lazyWithReload", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = { [CHUNK_RELOAD_KEY]: "1" };
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
    vi.stubGlobal("location", { reload: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the reload flag after a chunk loads successfully", async () => {
    const module = { default: "loaded" };

    await expect(lazyWithReload(() => Promise.resolve(module))).resolves.toBe(
      module,
    );
    expect(store[CHUNK_RELOAD_KEY]).toBeUndefined();
  });

  it("reloads once and leaves the first failed load pending", async () => {
    delete store[CHUNK_RELOAD_KEY];
    const error = new Error("chunk missing");

    const result = lazyWithReload(() => Promise.reject(error));
    const outcome = await Promise.race([
      result.then(
        () => "settled",
        () => "settled",
      ),
      new Promise<string>((resolve) => {
        queueMicrotask(() => resolve("pending"));
      }),
    ]);

    expect(outcome).toBe("pending");
    expect(store[CHUNK_RELOAD_KEY]).toBe("1");
    expect(location.reload).toHaveBeenCalledOnce();
  });

  it("rethrows the original error when a reload was already attempted", async () => {
    const error = new Error("chunk still missing");

    await expect(
      lazyWithReload(() => Promise.reject(error)),
    ).rejects.toBe(error);
    expect(location.reload).not.toHaveBeenCalled();
  });
});
