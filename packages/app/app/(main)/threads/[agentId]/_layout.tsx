import { Stack } from "expo-router";

export default function AgentThreadLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#f8f5ed" },
      }}
    />
  );
}
