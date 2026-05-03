export type NativeOAuthProvider = "github" | "google";

export const NATIVE_AUTH_CALLBACK_URL = "webmux://auth";

export function buildNativeOAuthUrl(
  serverUrl: string,
  provider: NativeOAuthProvider,
  callbackUrl = NATIVE_AUTH_CALLBACK_URL,
): string {
  const url = new URL(
    `/api/auth/${provider}`,
    `${serverUrl.replace(/\/+$/, "")}/`,
  );
  url.searchParams.set("mobile_callback", callbackUrl);
  return url.toString();
}

export function getTokenFromNativeAuthUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "webmux:" || url.hostname !== "auth") {
      return null;
    }
    if (url.pathname !== "" && url.pathname !== "/") {
      return null;
    }
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}
