import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  Linking,
} from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth";
import { getOAuthUrl, configure } from "../lib/api";

export default function LoginScreen() {
  const { isLoggedIn } = useAuth();
  const [serverUrl, setServerUrl] = useState("");

  if (isLoggedIn) {
    return <Redirect href="/" />;
  }

  const handleGitHubLogin = () => {
    if (Platform.OS === "web") {
      // On web: redirect to OAuth flow (same-origin)
      window.location.href = getOAuthUrl("github");
    } else {
      // On native: configure API with serverUrl, then open OAuth in system browser
      const normalizedUrl = serverUrl.replace(/\/+$/, "");
      configure(normalizedUrl, "");
      const oauthUrl = getOAuthUrl("github");
      Linking.openURL(oauthUrl);
    }
  };

  return (
    <View className="flex-1 bg-background items-center justify-center p-6">
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
              placeholderTextColor="#565f89"
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
        )}

        {/* GitHub Login Button */}
        <Pressable
          onPress={handleGitHubLogin}
          className="bg-accent rounded-lg py-3 px-4 items-center active:opacity-80"
        >
          <Text className="text-white font-semibold text-base">
            Login with GitHub
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
