import "../global.css";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AuthProvider, useAuth } from "../lib/auth";
import { ThemeProvider } from "../lib/theme";
import LoginScreen from "./login";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render failed", error, info.componentStack);
  }

  private reload = () => {
    if (typeof location !== "undefined") {
      location.reload();
    }
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <View className="flex-1 min-h-screen bg-zinc-950 items-center justify-center px-6 py-10">
        <View className="w-full max-w-2xl items-center gap-4">
          <Text className="text-2xl font-semibold text-zinc-100">加载失败</Text>
          <Pressable
            accessibilityRole="button"
            className="rounded-md bg-orange-400 px-5 py-3"
            onPress={this.reload}
          >
            <Text className="font-semibold text-zinc-950">重新加载</Text>
          </Pressable>
          <View className="mt-4 w-full rounded-md bg-zinc-900 p-4">
            <Text className="font-mono text-xs text-zinc-400">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </Text>
          </View>
        </View>
      </View>
    );
  }
}

function AuthGate() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#fb9d59" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
