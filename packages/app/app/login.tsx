import { useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  Pressable,
  TextInput,
} from "react-native";
import { useAuth } from "../lib/auth";
import { isTauri } from "../lib/platform";
import { getServerUrl, setServerUrl } from "../lib/serverUrl";

type OAuthProvider = "github" | "google";

const PROVIDERS: { value: OAuthProvider; label: string }[] = [
  { value: "github", label: "Sign in with GitHub" },
  { value: "google", label: "Sign in with Google" },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const [activeProvider, setActiveProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [serverUrlInput, setServerUrlInput] = useState(getServerUrl());
  const isDesktop = isTauri();

  const handleLogin = (provider: OAuthProvider) => {
    if (isDesktop) {
      setServerUrl(serverUrlInput);
    }
    setActiveProvider(provider);
    login(provider);
  };

  return (
    <View className="flex-1 bg-background items-center justify-center p-6">
      <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
        {/* Title */}
        <Text className="text-foreground text-3xl font-bold text-center mb-2">
          Terminal Canvas
        </Text>
        <Text className="text-foreground text-center mb-8 opacity-80">
          Sign in to continue
        </Text>

        {/* Server URL input for desktop */}
        {isDesktop && (
          <View className="mb-6">
            <Text className="text-foreground text-sm mb-2 opacity-60">
              Server URL
            </Text>
            <TextInput
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              placeholder="https://your-server:4317"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              className="bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm"
            />
          </View>
        )}

        {/* OAuth buttons */}
        <View className="gap-3">
          {PROVIDERS.map((provider) => {
            const active = activeProvider === provider.value;
            const isGitHub = provider.value === "github";
            const disabled =
              activeProvider !== null ||
              (isDesktop && !serverUrlInput.trim());

            return (
              <Pressable
                key={provider.value}
                onPress={() => handleLogin(provider.value)}
                className={`py-3 px-4 rounded-lg items-center active:opacity-80 ${
                  isGitHub
                    ? "bg-foreground"
                    : "bg-background border border-border"
                } ${disabled ? "opacity-50" : ""}`}
                disabled={disabled}
              >
                {active ? (
                  <ActivityIndicator
                    color={isGitHub ? "#141413" : "#faf9f5"}
                  />
                ) : (
                  <Text
                    className={`font-semibold text-base ${
                      isGitHub ? "text-background" : "text-foreground"
                    }`}
                  >
                    {provider.label}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
