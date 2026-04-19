import { useState } from "react";
import { ActivityIndicator, View, Text, Pressable, TextInput, } from "react-native";
import { useAuth } from "../lib/auth";
import { isTauri } from "../lib/platform";
import { getServerUrl, setServerUrl } from "../lib/serverUrl";
const PROVIDERS = [
    { value: "github", label: "Sign in with GitHub" },
    { value: "google", label: "Sign in with Google" },
];
export default function LoginScreen() {
    const { login } = useAuth();
    const [connecting, setConnecting] = useState(false);
    const [activeProvider, setActiveProvider] = useState(null);
    const [serverUrlInput, setServerUrlInput] = useState(getServerUrl());
    const isDesktop = isTauri();
    const handleDesktopConnect = () => {
        setServerUrl(serverUrlInput.trim());
        setConnecting(true);
        login();
    };
    const handleWebLogin = (provider) => {
        setActiveProvider(provider);
        login(provider);
    };
    if (isDesktop) {
        return (<View className="flex-1 bg-background items-center justify-center p-6">
        <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
          <Text className="text-foreground text-3xl font-bold text-center mb-2">
            Terminal Canvas
          </Text>
          <Text className="text-foreground text-center mb-8 opacity-80">
            Connect to your server
          </Text>

          <View className="mb-6">
            <Text className="text-foreground text-sm mb-2 opacity-60">
              Server URL
            </Text>
            <TextInput value={serverUrlInput} onChangeText={setServerUrlInput} placeholder="https://your-server:4317" placeholderTextColor="#999" autoCapitalize="none" autoCorrect={false} className="bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm"/>
          </View>

          <Pressable onPress={handleDesktopConnect} disabled={connecting || !serverUrlInput.trim()} className={`py-3 px-4 rounded-lg items-center active:opacity-80 bg-foreground ${connecting || !serverUrlInput.trim() ? "opacity-50" : ""}`}>
            {connecting ? (<ActivityIndicator color="#141413"/>) : (<Text className="font-semibold text-base text-background">
                Sign in via Browser
              </Text>)}
          </Pressable>

          <Text className="text-foreground text-xs text-center mt-4 opacity-40">
            Opens your browser to sign in or reuse an existing session
          </Text>
        </View>
      </View>);
    }
    return (<View className="flex-1 bg-background items-center justify-center p-6">
      <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
        <Text className="text-foreground text-3xl font-bold text-center mb-2">
          Terminal Canvas
        </Text>
        <Text className="text-foreground text-center mb-8 opacity-80">
          Sign in to continue
        </Text>

        <View className="gap-3">
          {PROVIDERS.map((provider) => {
            const active = activeProvider === provider.value;
            const isGitHub = provider.value === "github";
            return (<Pressable key={provider.value} onPress={() => handleWebLogin(provider.value)} className={`py-3 px-4 rounded-lg items-center active:opacity-80 ${isGitHub
                    ? "bg-foreground"
                    : "bg-background border border-border"} ${activeProvider ? "opacity-50" : ""}`} disabled={activeProvider !== null}>
                {active ? (<ActivityIndicator color={isGitHub ? "#141413" : "#faf9f5"}/>) : (<Text className={`font-semibold text-base ${isGitHub ? "text-background" : "text-foreground"}`}>
                    {provider.label}
                  </Text>)}
              </Pressable>);
        })}
        </View>
      </View>
    </View>);
}
