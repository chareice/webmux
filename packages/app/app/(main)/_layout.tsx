import {
  useWindowDimensions,
  Platform,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { Slot, Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { Sidebar } from "../../components/Sidebar";
import { WorkpathProvider, useWorkpaths } from "../../lib/workpath-context";
import { getKeyboardAvoidingBehavior } from "../../lib/mobile-layout";
import { useTheme } from "../../lib/theme";

function MainContent() {
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;
  const { workpaths, selectedPath, setSelectedPath, isLoading } =
    useWorkpaths();

  if (isWideScreen) {
    return (
      <View className="flex-1 flex-row bg-background">
        <Sidebar
          workpaths={workpaths}
          selectedPath={selectedPath}
          onSelectWorkpath={setSelectedPath}
          isLoading={isLoading}
        />
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
