import { useWindowDimensions, Platform, Text } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getBottomTabBarMetrics } from "../../../lib/mobile-layout";

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hideTabBar = Platform.OS === "web" && width >= 768;
  const tabBarMetrics = getBottomTabBarMetrics(insets.bottom);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          display: hideTabBar ? "none" : "flex",
          backgroundColor: "#1f2335",
          borderTopColor: "#343a52",
          height: tabBarMetrics.height,
          paddingBottom: tabBarMetrics.paddingBottom,
          paddingTop: tabBarMetrics.paddingTop,
        },
        tabBarActiveTintColor: "#7aa2f7",
        tabBarInactiveTintColor: "#565f89",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Agents",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>{"🤖"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="threads"
        options={{
          title: "Threads",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>{"💬"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>{"📁"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 18 }}>{"⚙️"}</Text>
          ),
        }}
      />
    </Tabs>
  );
}
