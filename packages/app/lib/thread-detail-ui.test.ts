import test from "node:test";
import assert from "node:assert/strict";

import {
  copyMessageContent,
  getComposerCardClassName,
  getComposerIconButtonClassName,
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

test("copyMessageContent accepts clipboard writers that return a success flag", async () => {
  let copied = "";

  const result = await copyMessageContent(" copied ", async (value) => {
    copied = value;
    return true;
  });

  assert.equal(result, true);
  assert.equal(copied, "copied");
});

test("getComposerCardClassName keeps the input row inside a bordered card", () => {
  const className = getComposerCardClassName();

  assert.match(className, /bg-surface/);
  assert.match(className, /border-border/);
  assert.match(className, /rounded-\[22px\]/);
});

test("getComposerSubmitButtonClassName uses a muted style when disabled", () => {
  assert.match(
    getComposerSubmitButtonClassName({ disabled: true }),
    /bg-accent\/35/,
  );
  assert.match(
    getComposerSubmitButtonClassName({ disabled: true }),
    /rounded-\[16px\]/,
  );
  assert.match(
    getComposerSubmitTextClassName({ disabled: true }),
    /text-white\/70/,
  );
});

test("getComposerSubmitButtonClassName uses the accent style when enabled", () => {
  assert.match(
    getComposerSubmitButtonClassName({ disabled: false }),
    /bg-accent/,
  );
  assert.match(
    getComposerSubmitButtonClassName({ disabled: false }),
    /min-w-\[78px\]/,
  );
  assert.match(
    getComposerSubmitTextClassName({ disabled: false }),
    /text-background/,
  );
});

test("getComposerIconButtonClassName keeps the image action compact and square", () => {
  const className = getComposerIconButtonClassName({ disabled: false });

  assert.match(className, /w-12/);
  assert.match(className, /h-12/);
  assert.match(className, /rounded-\[16px\]/);
  assert.match(className, /bg-surface-light/);
});
