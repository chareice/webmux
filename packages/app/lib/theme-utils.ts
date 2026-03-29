import type { RunStatus } from "@webmux/shared";

export const THEME_PREFERENCE_KEY = "webmux:theme_preference";

export type ThemePreference = "system" | "light" | "dark";
export type AppColorScheme = "light" | "dark";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceLight: string;
  foreground: string;
  foregroundSecondary: string;
  accent: string;
  green: string;
  red: string;
  orange: string;
  yellow: string;
  border: string;
  placeholder: string;
  white: string;
}

const LIGHT_THEME_COLORS: ThemeColors = {
  background: "#f8f5ed",
  surface: "#efe9de",
  surfaceLight: "#e6e0d4",
  foreground: "#1a1a1a",
  foregroundSecondary: "#6b6b6b",
  accent: "#1a1a1a",
  green: "#1a1a1a",
  red: "#b44444",
  orange: "#b44444",
  yellow: "#6b6b6b",
  border: "#d5cfc4",
  placeholder: "#9a9a9a",
  white: "#ffffff",
} as const;

const DARK_THEME_COLORS: ThemeColors = {
  background: "#1a1612",
  surface: "#231d18",
  surfaceLight: "#2c241e",
  foreground: "#f5eee4",
  foregroundSecondary: "#b3a99c",
  accent: "#f5eee4",
  green: "#f5eee4",
  red: "#e08a8a",
  orange: "#e0ab7a",
  yellow: "#c1aa83",
  border: "#463a30",
  placeholder: "#7f766b",
  white: "#ffffff",
} as const;

export function normalizeThemePreference(
  value: string | null | undefined,
): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }

  return "system";
}

export function resolveAppColorScheme(
  preference: ThemePreference,
  systemColorScheme: string | null | undefined,
): AppColorScheme {
  if (preference === "system") {
    return systemColorScheme === "dark" ? "dark" : "light";
  }

  return preference;
}

export function getThemeColors(colorScheme: AppColorScheme): ThemeColors {
  return colorScheme === "dark" ? DARK_THEME_COLORS : LIGHT_THEME_COLORS;
}

export function getRunStatusThemeColor(
  status: RunStatus,
  colors: ThemeColors,
): string {
  switch (status) {
    case "queued":
      return colors.placeholder;
    case "starting":
      return colors.foregroundSecondary;
    case "running":
      return colors.accent;
    case "success":
      return colors.green;
    case "failed":
      return colors.red;
    case "interrupted":
      return colors.placeholder;
  }
}
