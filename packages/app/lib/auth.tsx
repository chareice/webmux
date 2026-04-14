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

export type { User };

const TOKEN_KEY = "token";
const GET_ME_TIMEOUT_MS = 10_000;

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

/**
 * Extract ?token=xxx from current URL (OAuth callback redirect).
 * Returns null if not present or not on web.
 */
function extractTokenFromUrl(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

/**
 * Remove the ?token query param from URL without reloading the page.
 */
function cleanTokenFromUrl(): void {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState(
    {},
    "",
    url.pathname + url.search + url.hash,
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  // Restore session on mount: check URL callback, then storage, then dev login
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        // 1. Check URL for OAuth callback token
        const urlToken = extractTokenFromUrl();
        if (urlToken) {
          cleanTokenFromUrl();
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
            // Dev login not available (production mode) — fall through to show login screen
          }
        }
      } catch {
        // Something failed during restore — clear state
        await storage.remove(TOKEN_KEY);
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, []);

  // When token changes, validate it by calling getMe()
  useEffect(() => {
    if (token === null) {
      return;
    }

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
        }
      } catch {
        // Token invalid or expired — clear session
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

    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback((provider: "github" | "google") => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      // Same-origin redirect to backend OAuth endpoint
      window.location.href = `/api/auth/${provider}`;
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
