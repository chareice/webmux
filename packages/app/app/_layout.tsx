import "../global.css";

import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../lib/auth";
import { ThemeProvider, useTheme } from "../lib/theme";

function RootLayoutContent() {
  const { colorScheme } = useTheme();

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        <Slot />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
}
