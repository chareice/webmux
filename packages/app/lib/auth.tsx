import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";

import { configure, devLogin, getMe } from "./api";
import type { User } from "@webmux/shared";
import { storage } from "./storage";
import { getServerUrl } from "./serverUrl";
import { isTauri } from "./platform";

export type { User };

const TOKEN_KEY = "token";
const GET_ME_TIMEOUT_MS = 10_000;
const DESKTOP_CALLBACK_KEY = "webmux:desktop_callback";

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (provider: "github" | "google") => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}

// ── URL & desktop callback helpers ──

function getUrlParam(name: string): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function removeUrlParams(...names: string[]): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const n of names) url.searchParams.delete(n);
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

/**
 * Get the desktop callback URL — from URL param or sessionStorage
 * (persisted across the OAuth redirect round-trip).
 */
function getDesktopCallback(): string | null {
  const fromUrl = getUrlParam("desktop_callback");
  if (fromUrl) {
    sessionStorage.setItem(DESKTOP_CALLBACK_KEY, fromUrl);
    removeUrlParams("desktop_callback");
    return fromUrl;
  }
  return sessionStorage.getItem(DESKTOP_CALLBACK_KEY);
}

function clearDesktopCallback(): void {
  sessionStorage.removeItem(DESKTOP_CALLBACK_KEY);
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Redirect the token to the desktop app's loopback server.
 * Returns true if redirect was performed.
 */
function redirectTokenToDesktop(jwt: string): boolean {
  const callback = getDesktopCallback();
  if (!callback || !isLoopbackUrl(callback)) {
    clearDesktopCallback();
    return false;
  }
  clearDesktopCallback();
  const url = new URL(callback);
  url.searchParams.set("token", jwt);
  window.location.href = url.toString();
  return true;
}

// ── Tauri desktop login ──

async function tauriDesktopLogin(
  onToken: (token: string) => void,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-shell");
  const { listen } = await import("@tauri-apps/api/event");

  const port: number = await invoke("start_oauth_listener");
  const callback = `http://127.0.0.1:${port}/callback`;
  const serverUrl = getServerUrl();
  const connectUrl = `${serverUrl}?desktop_callback=${encodeURIComponent(callback)}`;

  const unlisten = await listen("oauth-token", (event: { payload: string }) => {
    unlisten();
    onToken(event.payload);
  });

  await open(connectUrl);
}

// ── Provider ──

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  // On mount: persist desktop_callback from URL to sessionStorage so it
  // survives the OAuth redirect round-trip.
  useEffect(() => {
    if (Platform.OS === "web" && !isTauri()) {
      getDesktopCallback();
    }
  }, []);

  // Restore session on mount
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        // 1. Check URL for OAuth callback token (?token=xxx)
        const urlToken = getUrlParam("token");
        if (urlToken) {
          removeUrlParams("token");
          await storage.set(TOKEN_KEY, urlToken);
          if (!cancelled) {
            configure(getServerUrl(), urlToken);
            setToken(urlToken);
          }
          return;
        }

        // 2. Check storage for existing token
        const storedToken = await storage.get(TOKEN_KEY);
        if (storedToken) {
          if (!cancelled) {
            configure(getServerUrl(), storedToken);
            setToken(storedToken);
          }
          return;
        }

        // 3. On web in dev mode, try automatic dev login
        if (Platform.OS === "web") {
          try {
            const result = await devLogin();
            if (result?.token) {
              await storage.set(TOKEN_KEY, result.token);
              if (!cancelled) {
                configure(getServerUrl(), result.token);
                setToken(result.token);
              }
              return;
            }
          } catch {
            // Dev login not available (production mode)
          }
        }
      } catch {
        await storage.remove(TOKEN_KEY);
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    void restore();
    return () => { cancelled = true; };
  }, []);

  // When token changes, validate via getMe(), then handle desktop callback
  useEffect(() => {
    if (token === null) return;

    let cancelled = false;

    const loadUser = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          GET_ME_TIMEOUT_MS,
        );
        const me = await getMe();
        clearTimeout(timeoutId);

        if (!cancelled) {
          setUser(me);

          // If web page was opened with ?desktop_callback=…, send the
          // validated token to the desktop app's loopback server.
          if (!isTauri()) {
            redirectTokenToDesktop(token);
          }
        }
      } catch {
        await storage.remove(TOKEN_KEY);
        if (!cancelled) {
          configure(getServerUrl(), null);
          setToken(null);
          setUser(null);
        }
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    void loadUser();
    return () => { cancelled = true; };
  }, [token]);

  const login = useCallback((provider: "github" | "google") => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    if (isTauri()) {
      void tauriDesktopLogin(async (newToken) => {
        await storage.set(TOKEN_KEY, newToken);
        configure(getServerUrl(), newToken);
        setToken(newToken);
      }).catch((err) => {
        console.error("Desktop login failed:", err);
      });
    } else {
      // desktop_callback is already persisted in sessionStorage by the
      // mount effect, so it survives the OAuth redirect round-trip.
      const base = getServerUrl();
      window.location.href = `${base}/api/auth/${provider}`;
    }
  }, []);

  const logout = useCallback(async () => {
    await storage.remove(TOKEN_KEY);
    configure(getServerUrl(), null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({ user, token, isLoading, isAuthenticated, login, logout }),
    [user, token, isLoading, isAuthenticated, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
