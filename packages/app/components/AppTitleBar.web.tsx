import { memo } from "react";
import { colors } from "@/lib/colors";
import { isTauri, isTauriMobile, detectOS } from "@/lib/platform";
import { WindowControls } from "./WindowControls";

function AppTitleBarComponent({ isMobile }: { isMobile: boolean }) {
  // The bar only hosts desktop window chrome (drag region + min/max/close).
  // The Android/iOS shells have no window to manage, so render nothing there.
  if (!isTauri() || isTauriMobile()) return null;
  const isMac = detectOS() === "macos";

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        flexShrink: 0,
        minHeight: isMobile ? 40 : 36,
        userSelect: "none",
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      {isMac && (
        // Native macOS traffic lights overlay this gutter (titleBarStyle: Overlay).
        <div data-tauri-drag-region style={{ width: 78, flexShrink: 0 }} />
      )}
      <div data-tauri-drag-region style={{ flex: 1 }} />
      <WindowControls position="right" />
    </div>
  );
}

export const AppTitleBar = memo(AppTitleBarComponent);
