import { useState } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { confirmQrSession, getOAuthUrl } from "../../lib/api";

type ConfirmState = "idle" | "confirming" | "success" | "error";

export default function QrConfirmScreen() {
  const { s: sessionId } = useLocalSearchParams<{ s: string }>();
  const { isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [confirmState, setConfirmState] = useState<ConfirmState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Loading auth state
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-full max-w-sm bg-surface rounded-2xl p-8 items-center">
            <ActivityIndicator size="large" />
            <Text className="text-foreground-secondary text-sm mt-4">
              Loading...
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // No session_id in URL
  if (!sessionId) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-full max-w-sm bg-surface rounded-2xl p-8 items-center">
            <Text className="text-red text-base font-semibold text-center">
              Invalid QR code link
            </Text>
            <Text className="text-foreground-secondary text-sm text-center mt-2">
              The link is missing a session identifier.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const handleConfirm = async () => {
    setConfirmState("confirming");
    setErrorMessage("");
    try {
      await confirmQrSession(sessionId);
      setConfirmState("success");
    } catch (err) {
      setConfirmState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to authorize login",
      );
    }
  };

  const handleCancel = () => {
    router.replace("/");
  };

  const handleLoginRedirect = () => {
    // Build an OAuth URL that redirects back to this page after login
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const redirectTo = `${origin}/auth/qr?s=${encodeURIComponent(sessionId)}`;
    const oauthBase = getOAuthUrl("github");
    // Replace the default redirectTo with our custom one
    const url = new URL(oauthBase, origin);
    url.searchParams.set("redirectTo", redirectTo);
    window.location.href = url.toString();
  };

  // Not logged in
  if (!isLoggedIn) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
            <Text className="text-foreground text-xl font-bold text-center mb-2">
              Authorization Required
            </Text>
            <Text className="text-foreground-secondary text-center mb-8">
              You need to log in first to authorize this request.
            </Text>
            <Pressable
              onPress={handleLoginRedirect}
              className="bg-foreground py-3 px-4 items-center active:opacity-80"
            >
              <Text className="text-background font-semibold text-base">
                Log in
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Logged in — show confirm/cancel UI
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center p-6">
        <View className="w-full max-w-sm bg-surface rounded-2xl p-8">
          {confirmState === "success" ? (
            <View className="items-center">
              <Text className="text-green text-xl font-bold text-center mb-2">
                Login authorized!
              </Text>
              <Text className="text-foreground-secondary text-center">
                You can close this page now.
              </Text>
            </View>
          ) : (
            <>
              <Text className="text-foreground text-xl font-bold text-center mb-2">
                Authorize Login
              </Text>
              <Text className="text-foreground-secondary text-center mb-8">
                Authorize login on another device?
              </Text>

              {confirmState === "error" && errorMessage ? (
                <Text className="text-red text-sm mb-4 text-center">
                  {errorMessage}
                </Text>
              ) : null}

              <View className="gap-3">
                <Pressable
                  onPress={() => void handleConfirm()}
                  disabled={confirmState === "confirming"}
                  className={`bg-foreground py-3 px-4 items-center active:opacity-80 ${
                    confirmState === "confirming" ? "opacity-80" : ""
                  }`}
                >
                  {confirmState === "confirming" ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-background font-semibold text-base">
                      Confirm
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={handleCancel}
                  disabled={confirmState === "confirming"}
                  className="bg-background border border-border py-3 px-4 items-center active:opacity-80"
                >
                  <Text className="text-foreground font-semibold text-base">
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
