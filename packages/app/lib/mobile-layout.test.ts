import test from "node:test";
import assert from "node:assert/strict";

import {
  getBottomTabBarMetrics,
  getKeyboardAvoidingBehavior,
  getKeyboardAwareScrollProps,
  getMainLayoutEdges,
} from "./mobile-layout.ts";

test("getMainLayoutEdges keeps bottom safe area for stack screens", () => {
  assert.deepEqual(getMainLayoutEdges(false), [
    "top",
    "bottom",
    "left",
    "right",
  ]);
});

test("getMainLayoutEdges skips the bottom inset for tab routes", () => {
  assert.deepEqual(getMainLayoutEdges(true), ["top", "left", "right"]);
});

test("getKeyboardAvoidingBehavior uses padding on ios", () => {
  assert.equal(getKeyboardAvoidingBehavior("ios"), "padding");
});

test("getKeyboardAvoidingBehavior uses height on android", () => {
  assert.equal(getKeyboardAvoidingBehavior("android"), "height");
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

test("getBottomTabBarMetrics keeps a visible bottom inset even on flat screens", () => {
  assert.deepEqual(getBottomTabBarMetrics(0), {
    height: 64,
    paddingBottom: 8,
    paddingTop: 8,
  });
});

test("getBottomTabBarMetrics uses the device inset when it is larger", () => {
  assert.deepEqual(getBottomTabBarMetrics(24), {
    height: 80,
    paddingBottom: 24,
    paddingTop: 8,
  });
});
