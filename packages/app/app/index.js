import { lazy, Suspense } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { useColors } from "@/lib/theme";
const WebTerminalCanvas = lazy(() => import("../components/TerminalCanvas.web").then((module) => ({
    default: module.TerminalCanvas,
})));
export default function HomeScreen() {
    const colors = useColors();
    if (Platform.OS === "web") {
        return (<Suspense fallback={<View style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.background,
                }}>
            <ActivityIndicator color={colors.accent}/>
          </View>}>
        <WebTerminalCanvas />
      </Suspense>);
    }
    // Android
    const { TerminalCanvas } = require("../components/TerminalCanvas.android");
    return <TerminalCanvas />;
}
