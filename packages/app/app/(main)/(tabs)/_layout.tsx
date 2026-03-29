import { Platform, useWindowDimensions, Pressable, Text } from "react-native";
import { Tabs, Slot, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "../../../lib/theme";

function NewThreadButton() {
  const router = useRouter();
  return (
    <Pressable
      className="bg-accent rounded-md px-3 py-1.5 mr-4"
      onPress={() => router.push("/(main)/threads/new" as never)}
    >
      <Text className="text-background text-xs font-semibold">+ New</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isWideScreen = Platform.OS === "web" && width >= 768;
  const { colors } = useTheme();

  if (isWideScreen) {
    return <Slot />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.foregroundSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "webmux",
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
          headerRight: () => <NewThreadButton />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cog-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
