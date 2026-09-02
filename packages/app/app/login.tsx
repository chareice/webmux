import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  View,
  Text,
  Pressable,
  TextInput,
} from "react-native";
import { getAuthProviders, type AuthProviders } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isBundledOrigin, isTauri, isTauriMobile } from "../lib/platform";
import { getServerUrl, setServerUrl } from "../lib/serverUrl";

type OAuthProvider = "github" | "google";

const PROVIDERS: { value: OAuthProvider; label: string }[] = [
  { value: "github", label: "Sign in with GitHub" },
  { value: "google", label: "Sign in with Google" },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [activeProvider, setActiveProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [serverUrlInput, setServerUrlInput] = useState(
    getServerUrl(Platform.OS),
  );
  const [hubError, setHubError] = useState<string | null>(null);
  // Tauri-on-mobile (Android/iOS WebView) takes the same provider-button
  // path as plain mobile-web; only Tauri desktop uses the loopback flow.
  const isDesktop = isTauri() && !isTauriMobile();
  // The mobile app boots into its own bundled screens and knows no hub until
  // someone names one. Once it has, it navigates to the hub and this screen
  // is never seen again — the sign-in below is served by the hub itself.
  const needsHub = isTauriMobile() && isBundledOrigin();

  // Reaching this screen with a hub already stored means the app tried it on
  // launch and could not get there. Offer it back rather than making someone
  // retype an address on a phone.
  const [savedHub, setSavedHub] = useState<string | null>(null);
  useEffect(() => {
    if (!needsHub) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string | null>("mobile_hub_url"))
      .then((url) => {
        if (!url) return;
        setSavedHub(url);
        setServerUrlInput(url);
      })
      .catch(() => {});
  }, [needsHub]);

  // What this hub can actually sign you in with. Until the answer arrives
  // nothing is drawn: a button that appears and then vanishes is worse than a
  // moment of nothing, and a button that fails when pressed is worse still.
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  useEffect(() => {
    if (isDesktop || needsHub) return;
    let cancelled = false;
    getAuthProviders()
      .then((result) => {
        if (!cancelled) setProviders(result);
      })
      .catch(() => {
        // An old hub without the endpoint: assume both, as before.
        if (!cancelled) setProviders({ github: true, google: true, link: false });
      });
    return () => {
      cancelled = true;
    };
  }, [isDesktop, needsHub]);

  const handleHubConnect = () => {
    setConnecting(true);
    setHubError(null);
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("set_mobile_hub_url", { url: serverUrlInput.trim() }),
      )
      // On success the WebView is already loading the hub, so there is
      // nothing to do here but wait for it.
      .catch((error: unknown) => {
        setHubError(String(error));
        setConnecting(false);
      });
  };

  const handleDesktopConnect = () => {
    setServerUrl(serverUrlInput.trim());
    setConnecting(true);
    void login().catch(() => {
      setConnecting(false);
    });
  };

  const handleWebLogin = (provider: OAuthProvider) => {
    setActiveProvider(provider);
    void login(provider)
      .then(() => {
        if (Platform.OS !== "web") {
          setActiveProvider(null);
        }
      })
      .catch(() => {
        setActiveProvider(null);
      });
  };

  if (needsHub) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-6">
        <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
          <Text className="text-foreground text-3xl font-bold text-center mb-2">
            offdesk
          </Text>
          <Text className="text-foreground text-center mb-8 opacity-80">
            Connect to your hub
          </Text>

          <View className="mb-6">
            <Text className="text-foreground text-sm mb-2 opacity-60">
              Hub address
            </Text>
            <TextInput
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              placeholder="https://your-hub.example.com"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
              className="bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm"
            />
          </View>

          {hubError ? (
            <Text className="text-foreground text-xs mb-4 opacity-80">
              {hubError}
            </Text>
          ) : savedHub ? (
            <Text className="text-foreground text-xs mb-4 opacity-60">
              Could not reach this hub on launch. Check that it is running and
              that you are on the same network, or enter another address.
            </Text>
          ) : null}

          <Pressable
            onPress={handleHubConnect}
            disabled={connecting || !serverUrlInput.trim()}
            className={`py-3 px-4 rounded-lg items-center active:opacity-80 bg-foreground ${
              connecting || !serverUrlInput.trim() ? "opacity-50" : ""
            }`}
          >
            {connecting ? (
              <ActivityIndicator color="#141413" />
            ) : (
              <Text className="font-semibold text-base text-background">
                Connect
              </Text>
            )}
          </Pressable>

          <Text className="text-foreground text-xs text-center mt-4 opacity-40">
            The address you use to open offdesk in a browser. You sign in on the
            hub itself, once it loads.
          </Text>
        </View>
      </View>
    );
  }

  if (isDesktop) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-6">
        <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
          <Text className="text-foreground text-3xl font-bold text-center mb-2">
            offdesk
          </Text>
          <Text className="text-foreground text-center mb-8 opacity-80">
            Connect to your server
          </Text>

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

          <Pressable
            onPress={handleDesktopConnect}
            disabled={connecting || !serverUrlInput.trim()}
            className={`py-3 px-4 rounded-lg items-center active:opacity-80 bg-foreground ${
              connecting || !serverUrlInput.trim() ? "opacity-50" : ""
            }`}
          >
            {connecting ? (
              <ActivityIndicator color="#141413" />
            ) : (
              <Text className="font-semibold text-base text-background">
                Sign in via Browser
              </Text>
            )}
          </Pressable>

          <Text className="text-foreground text-xs text-center mt-4 opacity-40">
            Opens your browser to sign in or reuse an existing session
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background items-center justify-center p-6">
      <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
        <Text className="text-foreground text-3xl font-bold text-center mb-2">
          offdesk
        </Text>
        <Text className="text-foreground text-center mb-8 opacity-80">
          Sign in to continue
        </Text>

        {providers?.link ? (
          <Text className="text-foreground text-sm text-center opacity-80 leading-6">
            This hub has no GitHub or Google sign-in. Open the link it printed
            when it started, or scan the code on its setup page from a device
            that is already signed in.
          </Text>
        ) : null}

        <View className="gap-3">
          {PROVIDERS.filter(
            (provider) => providers === null ? false : providers[provider.value],
          ).map((provider) => {
            const active = activeProvider === provider.value;
            const isGitHub = provider.value === "github";

            return (
              <Pressable
                key={provider.value}
                onPress={() => handleWebLogin(provider.value)}
                className={`py-3 px-4 rounded-lg items-center active:opacity-80 ${
                  isGitHub
                    ? "bg-foreground"
                    : "bg-background border border-border"
                } ${activeProvider ? "opacity-50" : ""}`}
                disabled={activeProvider !== null}
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
