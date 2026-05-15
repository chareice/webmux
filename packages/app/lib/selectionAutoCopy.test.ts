import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSelectionAutoCopyController } from "./selectionAutoCopy";

describe("createSelectionAutoCopyController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies only the final stable selection after a pointer drag", async () => {
    let selection = "abc";
    const writes: string[] = [];
    const controller = createSelectionAutoCopyController({
      hasSelection: () => selection.length > 0,
      getSelection: () => selection,
      writeText: (text) => {
        writes.push(text);
      },
    });

    controller.pointerSelectionStarted();
    controller.selectionChanged();
    selection = "abcd";
    controller.selectionChanged();
    controller.pointerSelectionFinished();

    await vi.runAllTimersAsync();

    expect(writes).toEqual(["abcd"]);
  });

  it("debounces non-pointer selection changes", async () => {
    let selection = "first";
    const writes: string[] = [];
    const controller = createSelectionAutoCopyController({
      hasSelection: () => selection.length > 0,
      getSelection: () => selection,
      writeText: (text) => {
        writes.push(text);
      },
    });

    controller.selectionChanged();
    selection = "second";
    controller.selectionChanged();

    await vi.runAllTimersAsync();

    expect(writes).toEqual(["second"]);
  });
});
