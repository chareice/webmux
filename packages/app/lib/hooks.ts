import { useState, useEffect } from "react";
import { Dimensions, Platform } from "react-native";

/**
 * Returns true when the viewport is narrower than the given breakpoint.
 * On web uses matchMedia for real-time responsiveness.
 * On native uses Dimensions API.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return window.innerWidth <= breakpoint;
    }
    return Dimensions.get("window").width <= breakpoint;
  });

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
      const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
      mql.addEventListener("change", handler);
      setIsMobile(mql.matches);
      return () => mql.removeEventListener("change", handler);
    }

    // Native: listen to dimension changes
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setIsMobile(window.width <= breakpoint);
    });
    return () => sub.remove();
  }, [breakpoint]);

  return isMobile;
}

/**
 * Web-only. Tracks `window.visualViewport.height` so layouts can shrink when
 * the mobile soft keyboard opens (dvh/vh units don't react to it). Returns
 * `null` if `visualViewport` is unavailable — callers should fall back to
 * `100dvh` or similar in that case.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !window.visualViewport
    ) {
      return null;
    }
    return window.visualViewport.height;
  });

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !window.visualViewport
    ) {
      return;
    }
    const vv = window.visualViewport;
    const update = () => setHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    // iOS Safari fires `scroll` — not `resize` — when the keyboard shifts.
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return height;
}
