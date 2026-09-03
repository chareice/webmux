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

  // The link the hub printed, pasted here. Same origin as this page means
  // this hub: loading it is the sign-in — the app reads `?token=`, stores it
  // and strips it. A link for another hub cannot be followed from a page the
  // first hub served; the mobile app can let go of this hub and take the
  // whole link on its own setup screen instead.
  const inMobileApp = isTauriMobile() && !isBundledOrigin();
  const [pastedLink, setPastedLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const handleOpenLink = () => openLink(pastedLink.trim());
  const openLink = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      setLinkError("That is not a link. Paste the whole thing, starting with http.");
      return;
    }
    if (!url.searchParams.has("token") && !url.searchParams.has("code")) {
      setLinkError("That link has no ?token= or ?code= in it. Copy the whole line the hub printed.");
      return;
    }
    if (url.origin === window.location.origin) {
      window.location.assign(url.toString());
      return;
    }
    setLinkError(
      inMobileApp
        ? `That link is for ${url.origin}, not this hub. Switch hub, then paste it there.`
        : `That link is for ${url.origin}, not this hub. Open it in the browser instead.`,
    );
  };
  // iOS keeps the local-network switch in the app's Settings page; the
  // scanner plugin already knows how to open it, and the app's own origin
  // is allowed to ask.
  const openSettings = async () => {
    try {
      const { openAppSettings } = await import("@tauri-apps/plugin-barcode-scanner");
      await openAppSettings();
    } catch {
      // Nothing to do: the message already says where the switch is.
    }
  };
  const handleSwitchHub = () => {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("clear_mobile_hub_url"),
    );
  };

  // The phone's camera, in the app: reads the code the hub's page shows —
  // the sign-in link, with the token on it — so nothing is typed. Only the
  // app has a camera to offer; a browser tab uses the system camera app,
  // which opens the link by itself.
  const [scanError, setScanError] = useState<string | null>(null);
  // Errors from the plugin arrive as objects, not Error instances; String()
  // on those is "[object Object]", which tells nobody anything.
  const describe = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      return String((error as { message: unknown }).message);
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "unknown error";
    }
  };
  const scanCode = async (): Promise<string | null> => {
    setScanError(null);
    try {
      const { scan, Format, checkPermissions, requestPermissions, openAppSettings } =
        await import("@tauri-apps/plugin-barcode-scanner");
      // The camera has to be asked for before it is used; scan() alone does
      // not put the system prompt up. Denied once, the prompt is gone for
      // good on Android and only the app's settings page can undo it.
      let permission = await checkPermissions();
      if (permission !== "granted") {
        permission = await requestPermissions();
      }
      if (permission !== "granted") {
        setScanError(
          "The camera is off for this app. Allow it in the app's settings, then try again.",
        );
        void openAppSettings().catch(() => {});
        return null;
      }
      const result = await scan({ windowed: false, formats: [Format.QRCode] });
      return result.content?.trim() || null;
    } catch (error) {
      const text = describe(error);
      setScanError(
        /cancel/i.test(text) ? null : `Could not scan: ${text}`,
      );
      return null;
    }
  };
  const handleScanForHub = async () => {
    const content = await scanCode();
    if (!content) return;
    setServerUrlInput(content);
    setConnecting(true);
    setHubError(null);
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_mobile_hub_url", { url: content }))
      .catch((error: unknown) => {
        setHubError(String(error));
        setConnecting(false);
      });
  };
  const handleScanForLink = async () => {
    const content = await scanCode();
    if (!content) return;
    setPastedLink(content);
    openLink(content);
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
              Hub address, or the whole sign-in link the hub printed
            </Text>
            <TextInput
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              placeholder="http://192.168.1.10:4317/?token=…"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
              className="bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-sm"
            />
          </View>

          {hubError ? (
            <View className="mb-4">
              <Text className="text-foreground text-xs opacity-80">
                {hubError}
              </Text>
              {/Local Network/.test(hubError) ? (
                <Pressable
                  onPress={() => void openSettings()}
                  className="mt-2 self-start py-1.5 px-3 rounded-lg border border-border active:opacity-80"
                >
                  <Text className="text-foreground text-xs font-medium">Open Settings</Text>
                </Pressable>
              ) : null}
            </View>
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

          <Pressable
            onPress={() => void handleScanForHub()}
            disabled={connecting}
            className="py-3 px-4 rounded-lg items-center active:opacity-80 border border-border mt-3"
          >
            <Text className="text-foreground font-medium">Scan the code instead</Text>
          </Pressable>
          {scanError ? (
            <Text className="text-foreground text-xs mt-3 opacity-80">{scanError}</Text>
          ) : null}

          <Text className="text-foreground text-xs text-center mt-4 opacity-40">
            The hub shows a code on its terminal at install, behind the Phone
            button, and from `offdesk-hub link`. Scan it, or type the address
            and sign in on the hub once it loads.
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
          <View className="mb-6">
            <Text className="text-foreground text-sm text-center opacity-80 leading-6 mb-5">
              This hub has no GitHub or Google sign-in, so the address alone
              does not get you in. It printed a link when it was installed —
              also under Settings → Mobile app on the computer that runs it,
              as a code for this phone's camera. Paste that link here:
            </Text>
            <TextInput
              value={pastedLink}
              onChangeText={(text) => {
                setPastedLink(text);
                setLinkError(null);
              }}
              placeholder="http://192.168.1.10:4317/?token=…"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
              onSubmitEditing={handleOpenLink}
              className="bg-background border border-border rounded-lg px-4 py-3 text-foreground mb-3"
            />
            {linkError ? (
              <Text className="text-foreground text-xs mb-3 opacity-80">
                {linkError}
              </Text>
            ) : null}
            <Pressable
              onPress={handleOpenLink}
              disabled={!pastedLink.trim()}
              className={`py-3 px-4 rounded-lg items-center active:opacity-80 bg-foreground ${
                pastedLink.trim() ? "" : "opacity-50"
              }`}
            >
              <Text className="text-background font-medium">Open the link</Text>
            </Pressable>
            {inMobileApp ? (
              <Pressable
                onPress={() => void handleScanForLink()}
                className="py-3 px-4 rounded-lg items-center active:opacity-80 border border-border mt-3"
              >
                <Text className="text-foreground font-medium">Scan the code instead</Text>
              </Pressable>
            ) : null}
            {scanError && inMobileApp ? (
              <Text className="text-foreground text-xs mt-3 opacity-80">{scanError}</Text>
            ) : null}
            {inMobileApp ? (
              <Pressable
                onPress={handleSwitchHub}
                className="py-3 px-4 rounded-lg items-center active:opacity-80 mt-3"
              >
                <Text className="text-foreground opacity-70">
                  Use a different hub
                </Text>
              </Pressable>
            ) : null}
          </View>
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
