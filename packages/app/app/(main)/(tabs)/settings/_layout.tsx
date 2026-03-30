import { Stack } from "expo-router";
import { useTheme } from "../../../../lib/theme";

export default function SettingsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="nodes" options={{ title: "Nodes" }} />
      <Stack.Screen name="instructions" options={{ title: "Instructions" }} />
      <Stack.Screen name="scan" options={{ title: "Scan to Login", headerShown: false }} />
    </Stack>
  );
}
