import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Platform, useColorScheme as useSystemColorScheme } from "react-native";
import { useColorScheme as useNativewindColorScheme } from "nativewind";
import * as SystemUI from "expo-system-ui";

import { storage } from "./storage";
import {
  THEME_PREFERENCE_KEY,
  getThemeColors,
  normalizeThemePreference,
  resolveAppColorScheme,
  type ThemeColors,
  type ThemePreference,
  type AppColorScheme,
} from "./theme-utils";

interface ThemeContextValue {
  colors: ThemeColors;
  colorScheme: AppColorScheme;
  isReady: boolean;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialThemePreference(): ThemePreference {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "system";
  }

  return normalizeThemePreference(
    window.localStorage.getItem(THEME_PREFERENCE_KEY),
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useSystemColorScheme();
  const { setColorScheme } = useNativewindColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    () => getInitialThemePreference(),
  );
  const [isReady, setIsReady] = useState(Platform.OS === "web");

  const colorScheme = resolveAppColorScheme(themePreference, systemColorScheme);
  const colors = getThemeColors(colorScheme);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }

    let cancelled = false;

    void storage
      .get(THEME_PREFERENCE_KEY)
      .then((value) => {
        if (!cancelled) {
          setThemePreferenceState(normalizeThemePreference(value));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setColorScheme(colorScheme);

    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.documentElement.style.colorScheme = colorScheme;
    }
  }, [colorScheme, setColorScheme]);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }

    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {
      // Ignore platform-specific background update failures.
    });
  }, [colors.background]);

  const setThemePreference = async (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    await storage.set(THEME_PREFERENCE_KEY, preference);
  };

  return (
    <ThemeContext.Provider
      value={{
        colors,
        colorScheme,
        isReady,
        themePreference,
        setThemePreference,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
