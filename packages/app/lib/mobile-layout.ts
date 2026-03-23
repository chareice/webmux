import type { KeyboardAvoidingViewProps, ScrollViewProps } from "react-native";
import type { Edge } from "react-native-safe-area-context";

export function getMainLayoutEdges(isTabsRoute: boolean): Edge[] {
  if (isTabsRoute) {
    return ["top", "left", "right"];
  }

  return ["top", "bottom", "left", "right"];
}

export function getKeyboardAvoidingBehavior(
  platformOs: string,
): KeyboardAvoidingViewProps["behavior"] {
  if (platformOs === "ios") {
    return "padding";
  }

  if (platformOs === "android") {
    return "height";
  }

  return undefined;
}

export function getKeyboardAwareScrollProps(
  platformOs: string,
): Pick<
  ScrollViewProps,
  "automaticallyAdjustKeyboardInsets" | "keyboardDismissMode"
> {
  if (platformOs === "ios") {
    return {
      automaticallyAdjustKeyboardInsets: true,
      keyboardDismissMode: "interactive",
    };
  }

  return {
    keyboardDismissMode: "on-drag",
  };
}

export function getBottomTabBarMetrics(bottomInset: number): {
  height: number;
  paddingBottom: number;
  paddingTop: number;
} {
  const safeBottomInset = Math.max(bottomInset, 8);

  return {
    height: 56 + safeBottomInset,
    paddingBottom: safeBottomInset,
    paddingTop: 8,
  };
}
