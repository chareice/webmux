import { extractAuthCallback } from "./auth-utils.ts";
import { withTimeout } from "./async-utils.ts";

export interface AuthBootstrapState {
  serverUrl: string;
  source: "callback" | "storage" | "dev" | "none";
  token: string | null;
}

export interface ResolveAuthBootstrapStateOptions {
  currentUrl: string | null;
  devLogin: () => Promise<{ token: string } | null>;
  getInitialUrl: () => Promise<string | null>;
  platformOs: string;
  readServerUrl: () => Promise<string | null>;
  readToken: () => Promise<string | null>;
  timeoutMs?: number;
}

const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 5_000;

export async function resolveAuthBootstrapState(
  options: ResolveAuthBootstrapStateOptions,
): Promise<AuthBootstrapState> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;

  try {
    const startupUrl =
      options.platformOs === "web"
        ? options.currentUrl
        : await withTimeout(
            options.getInitialUrl(),
            timeoutMs,
            "Initial URL lookup timed out",
          );

    const callback = startupUrl ? extractAuthCallback(startupUrl) : null;
    if (callback) {
      return {
        serverUrl: callback.serverUrl,
        source: "callback",
        token: callback.token,
      };
    }

    const [storedToken, storedServerUrl] = await withTimeout(
      Promise.all([options.readToken(), options.readServerUrl()]),
      timeoutMs,
      "Session restore timed out",
    );

    if (storedToken) {
      return {
        serverUrl: storedServerUrl ?? "",
        source: "storage",
        token: storedToken,
      };
    }

    if (options.platformOs === "web") {
      const devSession = await withTimeout(
        options.devLogin(),
        timeoutMs,
        "Dev login timed out",
      );
      if (devSession?.token) {
        return {
          serverUrl: "",
          source: "dev",
          token: devSession.token,
        };
      }
    }
  } catch {
    // Ignore startup failures and show the login screen instead of spinning.
  }

  return {
    serverUrl: "",
    source: "none",
    token: null,
  };
}
