import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  Linking,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { getOAuthUrl, configure } from "../lib/api";
import {
  LAST_SERVER_URL_KEY,
  normalizeServerUrl,
  OAUTH_PROVIDERS,
  type OAuthProvider,
} from "../lib/auth-utils";
import {
  getKeyboardAvoidingBehavior,
  getKeyboardAwareScrollProps,
} from "../lib/mobile-layout";
import { storage } from "../lib/storage";

export default function LoginScreen() {
  const { isLoggedIn } = useAuth();
  const [serverUrl, setServerUrl] = useState("");
  const [activeProvider, setActiveProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState("");

  if (isLoggedIn) {
    return <Redirect href="/" />;
  }

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }

    let cancelled = false;

    void storage.get(LAST_SERVER_URL_KEY).then((value) => {
      if (!cancelled && value) {
        setServerUrl(normalizeServerUrl(value));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (provider: OAuthProvider) => {
    setError("");
    setActiveProvider(provider);

    if (Platform.OS === "web") {
      window.location.href = getOAuthUrl(provider);
      return;
    }

    const normalizedUrl = normalizeServerUrl(serverUrl);
    if (!normalizedUrl) {
      setError("Please enter a server URL");
      setActiveProvider(null);
      return;
    }

    try {
      const parsedUrl = new URL(normalizedUrl);
      if (!/^https?:$/.test(parsedUrl.protocol)) {
        throw new Error("Unsupported protocol");
      }

      configure(normalizedUrl, "");
      await storage.set(LAST_SERVER_URL_KEY, normalizedUrl);
      setServerUrl(normalizedUrl);
      await Linking.openURL(getOAuthUrl(provider));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to open the login page",
      );
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={getKeyboardAvoidingBehavior(Platform.OS)}
        enabled={Platform.OS !== "web"}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow items-center justify-center p-6"
          keyboardShouldPersistTaps="handled"
          {...getKeyboardAwareScrollProps(Platform.OS)}
        >
          <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
            {/* Logo */}
            <Text className="text-foreground text-3xl font-bold text-center mb-2">
              webmux
            </Text>
            <Text className="text-foreground-secondary text-center mb-8">
              Sign in to continue
            </Text>

            {/* Server URL input (mobile only) */}
            {Platform.OS !== "web" && (
              <View className="mb-6">
                <Text className="text-foreground-secondary text-sm mb-2">
                  Server URL
                </Text>
                <TextInput
                  className="bg-background text-foreground border border-border rounded-lg px-4 py-3"
                  placeholder="https://your-server.example.com"
                  placeholderTextColor="#9a9a9a"
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  onBlur={() => {
                    const normalizedUrl = normalizeServerUrl(serverUrl);
                    if (normalizedUrl) {
                      setServerUrl(normalizedUrl);
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
            )}

            {error ? (
              <Text className="text-red text-sm mb-4">{error}</Text>
            ) : null}

            <View className="gap-3">
              {OAUTH_PROVIDERS.map((provider) => {
                const active = activeProvider === provider.value;
                const isGitHub = provider.value === "github";

                return (
                  <Pressable
                    key={provider.value}
                    onPress={() => void handleLogin(provider.value)}
                    className={`rounded-lg py-3 px-4 items-center active:opacity-80 ${
                      isGitHub
                        ? "bg-accent"
                        : "bg-background border border-border"
                    } ${activeProvider ? "opacity-80" : ""}`}
                    disabled={activeProvider !== null}
                  >
                    {active ? (
                      <ActivityIndicator
                        color={isGitHub ? "#ffffff" : "#1a1a1a"}
                      />
                    ) : (
                      <Text
                        className={`font-semibold text-base ${
                          isGitHub ? "text-white" : "text-foreground"
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
