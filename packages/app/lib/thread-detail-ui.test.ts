import test from "node:test";
import assert from "node:assert/strict";

import {
  copyMessageContent,
  getComposerCardClassName,
  getComposerSubmitButtonClassName,
  getComposerSubmitTextClassName,
} from "./thread-detail-ui.ts";

test("copyMessageContent writes trimmed message text", async () => {
  let copied = "";

  const result = await copyMessageContent("  hello world  ", async (value) => {
    copied = value;
  });

  assert.equal(result, true);
  assert.equal(copied, "hello world");
});

test("copyMessageContent skips empty messages", async () => {
  let called = false;

  const result = await copyMessageContent("   ", async () => {
    called = true;
  });

  assert.equal(result, false);
  assert.equal(called, false);
});

test("getComposerCardClassName keeps the input row inside a bordered card", () => {
  const className = getComposerCardClassName();

  assert.match(className, /bg-background/);
  assert.match(className, /border-border/);
  assert.match(className, /rounded-\[18px\]/);
});

test("getComposerSubmitButtonClassName uses a muted style when disabled", () => {
  assert.match(
    getComposerSubmitButtonClassName({ disabled: true }),
    /bg-surface-light/,
  );
  assert.match(
    getComposerSubmitTextClassName({ disabled: true }),
    /text-foreground-secondary/,
  );
});

test("getComposerSubmitButtonClassName uses the accent style when enabled", () => {
  assert.match(
    getComposerSubmitButtonClassName({ disabled: false }),
    /bg-accent/,
  );
  assert.match(
    getComposerSubmitTextClassName({ disabled: false }),
    /text-white/,
  );
});
