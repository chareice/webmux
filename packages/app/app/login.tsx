import { useCallback, useEffect, useRef, useState } from "react";
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
import { getOAuthUrl, configure, createQrSession, connectQrWebSocket } from "../lib/api";
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
import { useTheme } from "../lib/theme";

const QR_EXPIRY_SECONDS = 120;

type QrState = "loading" | "ready" | "expired" | "confirmed";

function QrLoginSection() {
  const { login } = useAuth();
  const [qrState, setQrState] = useState<QrState>("loading");
  const [qrUrl, setQrUrl] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(QR_EXPIRY_SECONDS);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const startSession = useCallback(async () => {
    closeWs();
    clearTimer();
    setQrState("loading");
    setSecondsLeft(QR_EXPIRY_SECONDS);

    try {
      const { sessionId, qrUrl: url } = await createQrSession();
      setQrUrl(url);
      setQrState("ready");

      // Start countdown timer
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            clearTimer();
            closeWs();
            setQrState("expired");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Connect WebSocket
      wsRef.current = connectQrWebSocket(
        sessionId,
        (data) => {
          if (data.type === "confirmed" && data.token) {
            clearTimer();
            setQrState("confirmed");
            void login("", data.token);
          }
        },
        () => {
          // WebSocket closed unexpectedly — if not already confirmed/expired, mark expired
          setQrState((prev) => {
            if (prev === "ready") {
              clearTimer();
              return "expired";
            }
            return prev;
          });
        },
      );
    } catch {
      // If session creation fails, show expired state so user can retry
      setQrState("expired");
    }
  }, [login, closeWs, clearTimer]);

  useEffect(() => {
    void startSession();
    return () => {
      clearTimer();
      closeWs();
    };
  }, [startSession, clearTimer, closeWs]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <View className="items-center mb-6">
      <View className="w-[200px] h-[200px] items-center justify-center bg-white rounded-lg relative">
        {qrState === "loading" && <ActivityIndicator size="large" />}
        {(qrState === "ready" || qrState === "expired") && qrUrl && (
          <QrCodeImage value={qrUrl} expired={qrState === "expired"} />
        )}
        {qrState === "confirmed" && (
          <Text className="text-green text-base font-semibold">✓ Confirmed</Text>
        )}
        {qrState === "expired" && (
          <Pressable
            onPress={() => void startSession()}
            className="absolute inset-0 items-center justify-center bg-black/50 rounded-lg"
          >
            <Text className="text-white text-sm font-semibold text-center">
              Expired, click to refresh
            </Text>
          </Pressable>
        )}
      </View>
      {qrState === "ready" && (
        <>
          <Text className="text-foreground-secondary text-sm mt-3">
            Scan with phone
          </Text>
          <Text className="text-foreground-secondary text-sm mt-1 font-mono">
            {formatTime(secondsLeft)}
          </Text>
        </>
      )}
      {qrState === "loading" && (
        <Text className="text-foreground-secondary text-sm mt-3">
          Generating QR code…
        </Text>
      )}

      {/* Divider */}
      <View className="flex-row items-center mt-6 w-full">
        <View className="flex-1 h-px bg-border" />
        <Text className="text-foreground-secondary text-sm mx-4">or</Text>
        <View className="flex-1 h-px bg-border" />
      </View>
    </View>
  );
}

/**
 * Lazy-loaded QR code renderer (web only, so dynamic import is fine).
 * We use a separate component to keep the conditional import clean.
 */
function QrCodeImage({ value, expired }: { value: string; expired: boolean }) {
  // react-qr-code is only needed on web; import it at the top level since
  // this component is only rendered when Platform.OS === 'web'.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const QRCode = require("react-qr-code").default;
  return (
    <View style={{ opacity: expired ? 0.3 : 1 }}>
      <QRCode value={value} size={184} />
    </View>
  );
}

export default function LoginScreen() {
  const { isLoggedIn } = useAuth();
  const { colors } = useTheme();
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

            {/* QR login (web only) */}
            {Platform.OS === "web" && <QrLoginSection />}

            {/* Server URL input (mobile only) */}
            {Platform.OS !== "web" && (
              <View className="mb-6">
                <Text className="text-foreground-secondary text-sm mb-2">
                  Server URL
                </Text>
                <TextInput
                  className="bg-background text-foreground border border-border rounded-lg px-4 py-3"
                  placeholder="https://your-server.example.com"
                  placeholderTextColor={colors.placeholder}
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
                    className={`py-3 px-4 items-center active:opacity-80 ${
                      isGitHub
                        ? "bg-foreground"
                        : "bg-background border border-border"
                    } ${activeProvider ? "opacity-80" : ""}`}
                    disabled={activeProvider !== null}
                  >
                    {active ? (
                      <ActivityIndicator
                        color={isGitHub ? colors.background : colors.foreground}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
