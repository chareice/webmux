import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform, Appearance } from "react-native";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "theme";

function getStoredTheme(): Theme {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  }
  return "system";
}

function getSystemTheme(): ResolvedTheme {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  }
  // Native: use React Native Appearance API
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  // DOM manipulation is web-only
  if (Platform.OS !== "web") return;
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (resolved === "dark") {
    el.classList.add("dark");
  } else {
    el.classList.remove("dark");
  }
  el.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemTheme : theme;

  // Listen for system theme changes
  useEffect(() => {
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || !window.matchMedia) return;
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        setSystemTheme(e.matches ? "dark" : "light");
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }

    // Native: listen via Appearance API
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemTheme(colorScheme === "dark" ? "dark" : "light");
    });
    return () => subscription.remove();
  }, []);

  // Apply theme to DOM whenever resolved theme changes
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

// Concrete color values for use in React Native component inline styles.
// CSS variable strings (from colors.web.ts) are silently dropped by RNW,
// so components using <Text>/<View> must use these concrete values instead.

const lightColors = {
  background: "#f5f4ed",
  backgroundSecondary: "#faf9f5",
  surface: "#faf9f5",
  surfaceHover: "#f0eee6",
  foreground: "#141413",
  foregroundSecondary: "#5e5d59",
  foregroundMuted: "#87867f",
  accent: "#c96442",
  accentDim: "#d97757",
  danger: "#b53333",
  warning: "#c96442",
  success: "#30d158",
  border: "#f0eee6",
  borderActive: "#c96442",
} as const;

const darkColors = {
  background: "#141413",
  backgroundSecondary: "#30302e",
  surface: "#30302e",
  surfaceHover: "#3d3d3a",
  foreground: "#faf9f5",
  foregroundSecondary: "#c8c6be",
  foregroundMuted: "#a09e96",
  accent: "#d97757",
  accentDim: "#c96442",
  danger: "#b53333",
  warning: "#d97757",
  success: "#30d158",
  border: "#3d3d3a",
  borderActive: "#d97757",
} as const;

const lightAlpha = {
  accentSubtle: "rgba(201, 100, 66, 0.08)",
  accentLight: "rgba(201, 100, 66, 0.1)",
  accentLight12: "rgba(201, 100, 66, 0.12)",
  accentMedium15: "rgba(201, 100, 66, 0.15)",
  accentMedium: "rgba(201, 100, 66, 0.2)",
  accentBorder: "rgba(201, 100, 66, 0.25)",
  backgroundDim: "rgba(245, 244, 237, 0.15)",
  backgroundOverlay: "rgba(245, 244, 237, 0.2)",
  backgroundShadow: "rgba(245, 244, 237, 0.4)",
  backgroundOpaque96: "rgba(245, 244, 237, 0.96)",
  backgroundOpaque98: "rgba(245, 244, 237, 0.98)",
  backgroundSecondaryOpaque96: "rgba(250, 249, 245, 0.96)",
  surfaceOpaque94: "rgba(250, 249, 245, 0.94)",
  foregroundOverlay: "rgba(20, 20, 19, 0.15)",
  foregroundSubtle: "rgba(20, 20, 19, 0.35)",
  warningSubtle: "rgba(201, 100, 66, 0.08)",
  warningLight12: "rgba(201, 100, 66, 0.12)",
  warningBorder: "rgba(201, 100, 66, 0.2)",
  warningBorder22: "rgba(201, 100, 66, 0.22)",
  mutedLight: "rgba(135, 134, 127, 0.15)",
  mutedMedium: "rgba(135, 134, 127, 0.3)",
} as const;

const darkAlpha = {
  accentSubtle: "rgba(217, 119, 87, 0.08)",
  accentLight: "rgba(217, 119, 87, 0.1)",
  accentLight12: "rgba(217, 119, 87, 0.12)",
  accentMedium15: "rgba(217, 119, 87, 0.15)",
  accentMedium: "rgba(217, 119, 87, 0.2)",
  accentBorder: "rgba(217, 119, 87, 0.25)",
  backgroundDim: "rgba(20, 20, 19, 0.15)",
  backgroundOverlay: "rgba(20, 20, 19, 0.2)",
  backgroundShadow: "rgba(20, 20, 19, 0.4)",
  backgroundOpaque96: "rgba(20, 20, 19, 0.96)",
  backgroundOpaque98: "rgba(20, 20, 19, 0.98)",
  backgroundSecondaryOpaque96: "rgba(48, 48, 46, 0.96)",
  surfaceOpaque94: "rgba(48, 48, 46, 0.94)",
  foregroundOverlay: "rgba(250, 249, 245, 0.15)",
  foregroundSubtle: "rgba(250, 249, 245, 0.35)",
  warningSubtle: "rgba(217, 119, 87, 0.08)",
  warningLight12: "rgba(217, 119, 87, 0.12)",
  warningBorder: "rgba(217, 119, 87, 0.2)",
  warningBorder22: "rgba(217, 119, 87, 0.22)",
  mutedLight: "rgba(160, 158, 150, 0.15)",
  mutedMedium: "rgba(160, 158, 150, 0.3)",
} as const;

export function useColors() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? darkColors : lightColors;
}

export function useColorAlpha() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? darkAlpha : lightAlpha;
}
