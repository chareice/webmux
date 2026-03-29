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
import { TopBar } from "../../components/TopBar";
import { getKeyboardAvoidingBehavior } from "../../lib/mobile-layout";

export default function MainLayout() {
  const { isLoading, isLoggedIn } = useAuth();
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color="#7aa2f7" size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/login" />;
  }

  if (isWideScreen) {
    return (
      <View className="flex-1 bg-background">
        <TopBar />
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
