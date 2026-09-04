import { ActivityIndicator, View } from "react-native";

export function LazyLoadingFallback() {
  return (
    <View className="flex-1 min-h-16 w-full bg-background items-center justify-center">
      <ActivityIndicator size="large" color="#ff6b57" />
    </View>
  );
}
