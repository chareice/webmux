import React, { createContext, useContext, useEffect, } from "react";
import { Platform } from "react-native";
// Dark-only after the design refresh. The context stays in place so existing
// callers (SettingsPage, xterm theme hooks) keep compiling — but setTheme is
// a no-op and resolvedTheme is always "dark".
const FORCED = {
    theme: "dark",
    resolvedTheme: "dark",
    setTheme: () => { },
};
const ThemeContext = createContext(FORCED);
function applyDark() {
    if (Platform.OS !== "web")
        return;
    if (typeof document === "undefined")
        return;
    const el = document.documentElement;
    el.classList.add("dark");
    el.style.colorScheme = "dark";
}
export function ThemeProvider({ children }) {
    useEffect(() => {
        applyDark();
    }, []);
    return <ThemeContext.Provider value={FORCED}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
    return useContext(ThemeContext);
}
// Concrete color values for RN inline styles. RNW silently drops CSS-var
// strings in <Text>/<View>, so native-side components need literals.
const darkColors = {
    // New design tokens.
    bg0: "#0b0c0f",
    bg1: "#111316",
    bg2: "#171a1d",
    bg3: "#1f2226",
    line: "#27292d",
    lineSoft: "#1b1d20",
    fg0: "#f7f8fb",
    fg1: "#ccced1",
    fg2: "#909297",
    fg3: "#5b5e62",
    ok: "#63d18f",
    warn: "#eabf3a",
    err: "#fa6863",
    info: "#69c1fc",
    violet: "#bb9af4",
    termBg: "#05060a",
    // Legacy keys.
    background: "#0b0c0f",
    backgroundSecondary: "#111316",
    surface: "#171a1d",
    surfaceHover: "#1f2226",
    foreground: "#f7f8fb",
    foregroundSecondary: "#ccced1",
    foregroundMuted: "#909297",
    accent: "#fb9d59",
    accentDim: "#fb9d59",
    danger: "#fa6863",
    warning: "#eabf3a",
    success: "#63d18f",
    border: "#27292d",
    borderActive: "#fb9d59",
};
const darkAlpha = {
    accentSoft: "rgba(251, 157, 89, 0.14)",
    accentLine: "rgba(251, 157, 89, 0.35)",
    dangerSoft: "rgba(250, 104, 99, 0.25)",
    dangerLine: "rgba(250, 104, 99, 0.5)",
    overlay: "rgba(0, 0, 0, 0.58)",
    accentSubtle: "rgba(251, 157, 89, 0.08)",
    accentLight: "rgba(251, 157, 89, 0.1)",
    accentLight12: "rgba(251, 157, 89, 0.12)",
    accentMedium15: "rgba(251, 157, 89, 0.15)",
    accentMedium: "rgba(251, 157, 89, 0.2)",
    accentBorder: "rgba(251, 157, 89, 0.25)",
    backgroundDim: "rgba(11, 12, 15, 0.15)",
    backgroundOverlay: "rgba(11, 12, 15, 0.2)",
    backgroundShadow: "rgba(0, 0, 0, 0.4)",
    backgroundOpaque96: "rgba(11, 12, 15, 0.96)",
    backgroundOpaque98: "rgba(11, 12, 15, 0.98)",
    backgroundSecondaryOpaque96: "rgba(17, 19, 22, 0.96)",
    surfaceOpaque94: "rgba(23, 26, 29, 0.94)",
    foregroundOverlay: "rgba(247, 248, 251, 0.15)",
    foregroundSubtle: "rgba(247, 248, 251, 0.35)",
    warningSubtle: "rgba(234, 191, 58, 0.08)",
    warningLight12: "rgba(234, 191, 58, 0.12)",
    warningBorder: "rgba(234, 191, 58, 0.2)",
    warningBorder22: "rgba(234, 191, 58, 0.22)",
    mutedLight: "rgba(144, 146, 151, 0.15)",
    mutedMedium: "rgba(144, 146, 151, 0.3)",
};
export function useColors() {
    return darkColors;
}
export function useColorAlpha() {
    return darkAlpha;
}
