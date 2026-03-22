import { Stack } from "expo-router";

export default function TasksLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#1a1b26" },
      }}
    />
  );
}
