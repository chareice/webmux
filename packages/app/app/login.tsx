import { useState } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { useAuth } from "../lib/auth";

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

  const handleLogin = (provider: OAuthProvider) => {
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

        {/* OAuth buttons */}
        <View className="gap-3">
          {PROVIDERS.map((provider) => {
            const active = activeProvider === provider.value;
            const isGitHub = provider.value === "github";

            return (
              <Pressable
                key={provider.value}
                onPress={() => handleLogin(provider.value)}
                className={`py-3 px-4 rounded-lg items-center active:opacity-80 ${
                  isGitHub
                    ? "bg-foreground"
                    : "bg-background border border-border"
                } ${activeProvider ? "opacity-80" : ""}`}
                disabled={activeProvider !== null}
              >
                {active ? (
                  <ActivityIndicator
                    color={isGitHub ? "#0a1929" : "#e0e8f0"}
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
