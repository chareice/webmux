import { View, Text, Pressable, ScrollView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../../lib/auth";

interface SettingsRow {
  label: string;
  description: string;
  href: string;
}

const SETTINGS_ROWS: SettingsRow[] = [
  {
    label: "LLM Configuration",
    description: "Manage API endpoints, keys, and models",
    href: "/(main)/settings/llm",
  },
  {
    label: "Instructions",
    description: "Edit global instructions for Claude Code and Codex",
    href: "/(main)/settings/instructions",
  },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { serverUrl, logout } = useAuth();

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-8">
        {/* Header */}
        <Text className="text-foreground text-2xl font-bold mb-4">
          Settings
        </Text>

        {/* Setting rows */}
        <View className="gap-2 mb-6">
          {SETTINGS_ROWS.map((row) => (
            <Pressable
              key={row.href}
              className="bg-surface rounded-xl p-4 border border-border flex-row items-center"
              onPress={() => router.push(row.href as never)}
            >
              <View className="flex-1">
                <Text className="text-foreground text-base font-semibold">
                  {row.label}
                </Text>
                <Text className="text-foreground-secondary text-sm mt-0.5">
                  {row.description}
                </Text>
              </View>
              <Text className="text-foreground-secondary text-lg ml-2">
                {">"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Server URL (mobile only) */}
        {Platform.OS !== "web" && serverUrl ? (
          <View className="bg-surface rounded-xl p-4 border border-border mb-6">
            <Text className="text-foreground-secondary text-sm mb-1">
              Server URL
            </Text>
            <Text className="text-foreground text-sm" selectable>
              {serverUrl}
            </Text>
          </View>
        ) : null}

        {/* Logout */}
        <Pressable
          className="bg-red/10 border border-red rounded-xl py-3 items-center"
          onPress={() => void logout()}
        >
          <Text className="text-red font-semibold text-sm">Logout</Text>
        </Pressable>

        {/* Version */}
        <Text className="text-foreground-secondary text-xs text-center mt-6">
          webmux v1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}
