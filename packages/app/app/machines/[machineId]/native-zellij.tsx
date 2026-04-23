import { lazy, Suspense } from "react";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Platform, Text, View } from "react-native";

import { useColors } from "@/lib/theme";

const WebNativeZellijPage = lazy(() =>
  import("../../../components/NativeZellijPage.web").then((module) => ({
    default: module.NativeZellijPage,
  })),
);

export default function NativeZellijScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ machineId?: string | string[] }>();
  const machineId = Array.isArray(params.machineId)
    ? params.machineId[0]
    : params.machineId;

  if (Platform.OS === "web" && machineId) {
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
        <WebNativeZellijPage machineId={machineId} />
      </Suspense>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ color: colors.foreground }}>
        Native Zellij is only available on the web app.
      </Text>
    </View>
  );
}
