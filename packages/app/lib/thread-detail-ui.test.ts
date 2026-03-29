import test from "node:test";
import assert from "node:assert/strict";

import {
  copyMessageContent,
  getComposerCardClassName,
  getComposerIconButtonClassName,
  getComposerToolbarClassName,
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

test("getComposerCardClassName renders a bordered card", () => {
  const className = getComposerCardClassName();

  assert.match(className, /bg-background/);
  assert.match(className, /border-border/);
});

test("getComposerSubmitButtonClassName uses a muted style when disabled", () => {
  assert.match(
    getComposerSubmitButtonClassName({ disabled: true }),
    /bg-foreground\/25/,
  );
  assert.match(
    getComposerSubmitTextClassName({ disabled: true }),
    /text-background\/50/,
  );
});

test("getComposerSubmitButtonClassName uses the foreground style when enabled", () => {
  assert.match(
    getComposerSubmitButtonClassName({ disabled: false }),
    /bg-foreground/,
  );
  assert.match(
    getComposerSubmitTextClassName({ disabled: false }),
    /text-background/,
  );
});

test("getComposerIconButtonClassName renders a compact icon button", () => {
  const className = getComposerIconButtonClassName({ disabled: false });

  assert.match(className, /w-8/);
  assert.match(className, /h-8/);
  assert.match(className, /rounded-lg/);
});

test("getComposerToolbarClassName renders a toolbar row with separator", () => {
  const className = getComposerToolbarClassName();

  assert.match(className, /flex-row/);
  assert.match(className, /border-t/);
});
