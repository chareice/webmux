import { useWindowDimensions, Platform, View, ActivityIndicator } from "react-native";
import { Slot, Redirect } from "expo-router";
import { useAuth } from "../../lib/auth";
import { TopBar } from "../../components/TopBar";

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

  return <Slot />;
}
