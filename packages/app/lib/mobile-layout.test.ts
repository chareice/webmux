import test from "node:test";
import assert from "node:assert/strict";

import {
  getKeyboardAvoidingBehavior,
  getKeyboardAwareScrollProps,
} from "./mobile-layout.ts";

test("getKeyboardAvoidingBehavior uses padding on ios", () => {
  assert.equal(getKeyboardAvoidingBehavior("ios"), "padding");
});

test("getKeyboardAvoidingBehavior leaves android to the native default", () => {
  assert.equal(getKeyboardAvoidingBehavior("android"), undefined);
});

test("getKeyboardAwareScrollProps enables automatic keyboard insets on ios", () => {
  assert.deepEqual(getKeyboardAwareScrollProps("ios"), {
    automaticallyAdjustKeyboardInsets: true,
    keyboardDismissMode: "interactive",
  });
});

test("getKeyboardAwareScrollProps keeps android scroll dismissal simple", () => {
  assert.deepEqual(getKeyboardAwareScrollProps("android"), {
    keyboardDismissMode: "on-drag",
  });
});
