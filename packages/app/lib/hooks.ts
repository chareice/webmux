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
