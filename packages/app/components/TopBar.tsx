import { View, Text, Pressable } from "react-native";
import { useAuth } from "../lib/auth";

export function TopBar() {
  const { user, logout } = useAuth();

  return (
    <View className="h-12 bg-surface flex-row items-center px-4 border-b border-border">
      <Text className="text-foreground text-lg font-bold flex-1">webmux</Text>
      <View className="flex-row items-center gap-3">
        {user && (
          <Text className="text-foreground-secondary text-sm">{user.displayName}</Text>
        )}
        <Pressable onPress={logout} className="px-3 py-1.5 rounded">
          <Text className="text-foreground-secondary text-sm">Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}
