import { lazy, Suspense } from "react";
import { ActivityIndicator, View } from "react-native";
import { useColors } from "@/lib/theme";

const WebTerminalCanvas = lazy(() =>
  import("../components/TerminalCanvas.web").then((module) => ({
    default: module.TerminalCanvas,
  })),
);

export default function HomeScreen() {
  const colors = useColors();
  return (
    <Suspense
      fallback={
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.background,
          }}
        >
          <ActivityIndicator color={colors.accent} />
        </View>
      }
    >
      <WebTerminalCanvas />
    </Suspense>
  );
}
