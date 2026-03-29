import { Stack } from "expo-router";
import { useTheme } from "../../../lib/theme";

export default function ThreadsLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="new"
        options={{
          headerShown: true,
          title: "New Thread",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      <Stack.Screen name="[agentId]" />
    </Stack>
  );
}
