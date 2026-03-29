import type { KeyboardAvoidingViewProps, ScrollViewProps } from "react-native";

export function getKeyboardAvoidingBehavior(
  platformOs: string,
): KeyboardAvoidingViewProps["behavior"] {
  if (platformOs === "ios") {
    return "padding";
  }

  if (platformOs === "android") {
    return undefined;
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

