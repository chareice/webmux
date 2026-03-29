import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../../../lib/auth";
import { useTheme } from "../../../../lib/theme";
import { checkForUpdate, getCurrentVersionInfo } from "../../../../lib/update";
import type { ThemePreference } from "../../../../lib/theme-utils";

interface SettingsRow {
  label: string;
  description: string;
  href: string;
}

const SETTINGS_ROWS: SettingsRow[] = [
  {
    label: "Nodes",
    description: "Manage registered machines",
    href: "/(main)/settings/nodes",
  },
  {
    label: "Instructions",
    description: "Edit global instructions for Claude Code and Codex",
    href: "/(main)/settings/instructions",
  },
];

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  {
    value: "system",
    label: "Follow system",
    description: "Switch automatically with your device appearance.",
  },
  {
    value: "light",
    label: "Light",
    description: "Keep the current paper-style light look.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Use the warm dark theme across the app.",
  },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { serverUrl, logout } = useAuth();
  const { colors, themePreference, setThemePreference } = useTheme();
  const versionInfo = getCurrentVersionInfo();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const versionLabel = versionInfo.buildNumber
    ? `${versionInfo.version} (${versionInfo.buildNumber})`
    : versionInfo.version;

  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-8">
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

        <View className="bg-surface rounded-xl p-4 border border-border mb-6">
          <Text className="text-foreground text-base font-semibold mb-1">
            Appearance
          </Text>
          <Text className="text-foreground-secondary text-sm mb-3">
            Choose how webmux should look.
          </Text>
          <View className="gap-2">
            {THEME_OPTIONS.map((option) => {
              const isSelected = themePreference === option.value;

              return (
                <Pressable
                  key={option.value}
                  className={`rounded-lg border px-4 py-3 ${
                    isSelected
                      ? "border-accent bg-accent/10"
                      : "border-border bg-surface-light"
                  }`}
                  onPress={() => void setThemePreference(option.value)}
                >
                  <View className="flex-row items-center gap-3">
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-semibold ${
                          isSelected ? "text-accent" : "text-foreground"
                        }`}
                      >
                        {option.label}
                      </Text>
                      <Text className="text-foreground-secondary text-xs mt-0.5">
                        {option.description}
                      </Text>
                    </View>
                    <Text
                      className={`text-xs font-semibold ${
                        isSelected
                          ? "text-accent"
                          : "text-foreground-secondary"
                      }`}
                    >
                      {isSelected ? "Selected" : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

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

        {Platform.OS !== "web" ? (
          <View className="bg-surface rounded-xl p-4 border border-border mb-6">
            <Text className="text-foreground-secondary text-sm mb-1">
              App Version
            </Text>
            <Text className="text-foreground text-sm mb-3">{versionLabel}</Text>
            <Pressable
              className={`bg-surface-light rounded-lg py-3 items-center ${isCheckingUpdate ? "opacity-70" : ""}`}
              disabled={isCheckingUpdate}
              onPress={() => {
                setIsCheckingUpdate(true);
                void checkForUpdate().finally(() => {
                  setIsCheckingUpdate(false);
                });
              }}
            >
              {isCheckingUpdate ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text className="text-accent font-semibold text-sm">
                  Check for updates
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}

        <Pressable
          className="bg-red/10 border border-red rounded-xl py-3 items-center"
          onPress={() => void logout()}
        >
          <Text className="text-red font-semibold text-sm">Logout</Text>
        </Pressable>

        <Text className="text-foreground-secondary text-xs text-center mt-6">
          webmux v{versionLabel}
        </Text>
      </ScrollView>
    </View>
  );
}
