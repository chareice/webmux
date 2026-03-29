import {
  useWindowDimensions,
  Platform,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { Slot, Redirect, usePathname } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { LeftPanel } from "../../components/LeftPanel";
import { WorkpathProvider } from "../../lib/workpath-context";
import { getKeyboardAvoidingBehavior } from "../../lib/mobile-layout";
import { useTheme } from "../../lib/theme";

function MainContent() {
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;
  const pathname = usePathname();

  // Extract active thread ID from the current route
  const threadMatch = pathname.match(/\/threads\/([^/]+)\/([^/]+)$/);
  const activeThreadId = threadMatch ? threadMatch[2] : null;

  if (isWideScreen) {
    return (
      <View className="flex-1 flex-row bg-background">
        <LeftPanel activeThreadId={activeThreadId} />
        <View className="flex-1">
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={getKeyboardAvoidingBehavior(Platform.OS)}
        enabled={Platform.OS !== "web"}
      >
        <Slot />
      </KeyboardAvoidingView>
    </SafeAreaView>
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
