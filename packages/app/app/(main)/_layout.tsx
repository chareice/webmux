import { useWindowDimensions, Platform, View } from "react-native";
import { Slot } from "expo-router";
import { TopBar } from "../../components/TopBar";

export default function MainLayout() {
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;

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
