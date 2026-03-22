import { Stack } from "expo-router";

export default function ProjectDetailLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#1a1b26" },
      }}
    />
  );
}
