export type OAuthProvider = "github" | "google";

export interface OAuthProviderOption {
  description: string;
  label: string;
  value: OAuthProvider;
}

export interface AuthCallbackPayload {
  provider: OAuthProvider | null;
  serverUrl: string;
  token: string;
}

export const LAST_SERVER_URL_KEY = "webmux:last_server_url";

export const OAUTH_PROVIDERS: OAuthProviderOption[] = [
  {
    description: "Use your GitHub account",
    label: "Login with GitHub",
    value: "github",
  },
  {
    description: "Use your Google account",
    label: "Login with Google",
    value: "google",
  },
];

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, "");
}

export function extractAuthCallback(url: string): AuthCallbackPayload | null {
  let parsed: URL;

  try {
    parsed = new URL(url, "https://webmux.local");
  } catch {
    return null;
  }

  const token = parsed.searchParams.get("token")?.trim();
  if (!token) {
    return null;
  }

  const providerValue = parsed.searchParams.get("provider");
  const provider =
    providerValue === "github" || providerValue === "google"
      ? providerValue
      : null;

  return {
    provider,
    serverUrl: normalizeServerUrl(parsed.searchParams.get("server") ?? ""),
    token,
  };
}
