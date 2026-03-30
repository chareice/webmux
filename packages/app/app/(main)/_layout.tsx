import {
  useWindowDimensions,
  Platform,
  View,
  ActivityIndicator,
} from "react-native";
import { Stack, Slot, Redirect } from "expo-router";
import { useAuth } from "../../lib/auth";
import { WorkpathProvider } from "../../lib/workpath-context";
import { useTheme } from "../../lib/theme";

function MainContent() {
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;
  const { colors } = useTheme();

  if (isWideScreen) {
    return (
      <View className="flex-1 bg-background">
        <Slot />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="workpath"
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      <Stack.Screen name="threads" />
    </Stack>
  );
}

export default function MainLayout() {
  const { isLoading, isLoggedIn } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/login" />;
  }

  return (
    <WorkpathProvider>
      <MainContent />
    </WorkpathProvider>
  );
}
