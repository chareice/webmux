import { memo } from "react";
import { colors } from "@/lib/colors";
import { isTauri, detectOS } from "@/lib/platform";
import { WindowControls } from "./WindowControls";
function AppTitleBarComponent({ isMobile }) {
    if (!isTauri())
        return null;
    const isMac = detectOS() === "macos";
    return (<div data-tauri-drag-region style={{
            display: "flex",
            alignItems: "stretch",
            borderBottom: `1px solid ${colors.border}`,
            background: colors.surface,
            flexShrink: 0,
            minHeight: isMobile ? 40 : 36,
            userSelect: "none",
            WebkitAppRegion: "drag",
        }}>
      {isMac && <WindowControls position="left"/>}
      <div data-tauri-drag-region style={{ flex: 1 }}/>
      <WindowControls position="right"/>
    </div>);
}
export const AppTitleBar = memo(AppTitleBarComponent);
