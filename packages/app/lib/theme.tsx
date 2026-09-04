import React, {
  createContext,
  useContext,
  useEffect,
} from "react";
import { Platform } from "react-native";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

// One look, the site's: warm chrome, dark terminal. The context stays in
// place so existing callers (SettingsPage, xterm theme hooks) keep compiling —
// but setTheme is a no-op and resolvedTheme is always "light".
const FORCED: ThemeContextValue = {
  theme: "light",
  resolvedTheme: "light",
  setTheme: () => { /* one look */ },
};

const ThemeContext = createContext<ThemeContextValue>(FORCED);

function applyLight() {
  if (Platform.OS !== "web") return;
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.remove("dark");
  el.style.colorScheme = "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyLight();
  }, []);
  return <ThemeContext.Provider value={FORCED}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

// Concrete color values for RN inline styles. RNW silently drops CSS-var
// strings in <Text>/<View>, so native-side components need literals.
const lightColors = {
  // New design tokens — the same values as global.css.
  bg0: "#fff4e3",
  bg1: "#fffbf4",
  bg2: "#fffbf4",
  bg3: "#ffe9cc",
  line: "#e6cfae",
  lineSoft: "#f1dec6",
  fg0: "#2b2340",
  fg1: "#4a4160",
  fg2: "#6e6486",
  fg3: "#9d95b3",
  ok: "#1f9e8c",
  warn: "#d29a12",
  err: "#e8543f",
  info: "#1f8fc2",
  violet: "#7c5cbf",
  termBg: "#1e1b2e",
  onAccent: "#fffbf4",

  // Legacy keys.
  background: "#fff4e3",
  backgroundSecondary: "#fffbf4",
  surface: "#fffbf4",
  surfaceHover: "#ffe9cc",
  foreground: "#2b2340",
  foregroundSecondary: "#4a4160",
  foregroundMuted: "#6e6486",
  accent: "#ff6b57",
  accentDim: "#ff6b57",
  danger: "#e8543f",
  warning: "#d29a12",
  success: "#1f9e8c",
  border: "#e6cfae",
  borderActive: "#ff6b57",
} as const;

const lightAlpha = {
  accentSoft: "rgba(255, 107, 87, 0.14)",
  accentLine: "rgba(255, 107, 87, 0.35)",
  dangerSoft: "rgba(232, 84, 63, 0.18)",
  dangerLine: "rgba(232, 84, 63, 0.5)",
  overlay: "rgba(43, 35, 64, 0.45)",

  accentSubtle: "rgba(255, 107, 87, 0.08)",
  accentLight: "rgba(255, 107, 87, 0.1)",
  accentLight12: "rgba(255, 107, 87, 0.12)",
  accentMedium15: "rgba(255, 107, 87, 0.15)",
  accentMedium: "rgba(255, 107, 87, 0.2)",
  accentBorder: "rgba(255, 107, 87, 0.25)",
  backgroundDim: "rgba(255, 244, 227, 0.15)",
  backgroundOverlay: "rgba(255, 244, 227, 0.2)",
  backgroundShadow: "rgba(43, 35, 64, 0.25)",
  backgroundOpaque96: "rgba(255, 244, 227, 0.96)",
  backgroundOpaque98: "rgba(255, 244, 227, 0.98)",
  backgroundSecondaryOpaque96: "rgba(255, 251, 244, 0.96)",
  surfaceOpaque94: "rgba(255, 251, 244, 0.94)",
  foregroundOverlay: "rgba(43, 35, 64, 0.15)",
  foregroundSubtle: "rgba(43, 35, 64, 0.35)",
  warningSubtle: "rgba(210, 154, 18, 0.08)",
  warningLight12: "rgba(210, 154, 18, 0.12)",
  warningBorder: "rgba(210, 154, 18, 0.2)",
  warningBorder22: "rgba(210, 154, 18, 0.22)",
  mutedLight: "rgba(110, 100, 134, 0.15)",
  mutedMedium: "rgba(110, 100, 134, 0.3)",
} as const;

export function useColors() {
  return lightColors;
}

export function useColorAlpha() {
  return lightAlpha;
}
