import { lazy, Suspense } from "react";
import { ActivityIndicator, Platform, View } from "react-native";

const WebTerminalCanvas = lazy(() =>
  import("../components/TerminalCanvas.web").then((module) => ({
    default: module.TerminalCanvas,
  })),
);

export default function HomeScreen() {
  if (Platform.OS === "web") {
    return (
      <Suspense
        fallback={
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgb(10, 25, 41)",
            }}
          >
            <ActivityIndicator color="rgb(0, 212, 170)" />
          </View>
        }
      >
        <WebTerminalCanvas />
      </Suspense>
    );
  }

  // Android
  const { TerminalCanvas } = require("../components/TerminalCanvas.android");
  return <TerminalCanvas />;
}
