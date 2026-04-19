import { useCallback, useState } from "react";
import { isTauri, detectOS } from "@/lib/platform";
import { colors } from "@/lib/colors";
function MacControls() {
    const [hovered, setHovered] = useState(false);
    const handleClose = useCallback(async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
    }, []);
    const handleMinimize = useCallback(async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
    }, []);
    const handleMaximize = useCallback(async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().toggleMaximize();
    }, []);
    const dotStyle = (color) => ({
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: color,
        border: "none",
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    });
    return (<div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            flexShrink: 0,
            WebkitAppRegion: "no-drag",
        }}>
      <button onClick={handleClose} style={dotStyle("#ff5f57")} aria-label="Close">
        {hovered && (<svg width="6" height="6" viewBox="0 0 6 6">
            <line x1="0.5" y1="0.5" x2="5.5" y2="5.5" stroke="#4d0000" strokeWidth="1.2"/>
            <line x1="5.5" y1="0.5" x2="0.5" y2="5.5" stroke="#4d0000" strokeWidth="1.2"/>
          </svg>)}
      </button>
      <button onClick={handleMinimize} style={dotStyle("#febc2e")} aria-label="Minimize">
        {hovered && (<svg width="6" height="2" viewBox="0 0 6 2">
            <line x1="0.5" y1="1" x2="5.5" y2="1" stroke="#995700" strokeWidth="1.2"/>
          </svg>)}
      </button>
      <button onClick={handleMaximize} style={dotStyle("#28c840")} aria-label="Maximize">
        {hovered && (<svg width="6" height="6" viewBox="0 0 6 6">
            <polyline points="1,4 1,1 4,1" fill="none" stroke="#006500" strokeWidth="1.2"/>
            <polyline points="5,2 5,5 2,5" fill="none" stroke="#006500" strokeWidth="1.2"/>
          </svg>)}
      </button>
    </div>);
}
function WinLinuxControls() {
    const handleMinimize = useCallback(async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
    }, []);
    const handleMaximize = useCallback(async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().toggleMaximize();
    }, []);
    const handleClose = useCallback(async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
    }, []);
    const buttonBase = {
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
    };
    return (<div style={{
            display: "flex",
            alignItems: "stretch",
            flexShrink: 0,
            WebkitAppRegion: "no-drag",
        }}>
      <button onClick={handleMinimize} style={buttonBase} onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.surface;
        }} onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
        }} aria-label="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill={colors.foregroundSecondary}/>
        </svg>
      </button>
      <button onClick={handleMaximize} style={buttonBase} onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.surface;
        }} onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
        }} aria-label="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke={colors.foregroundSecondary} strokeWidth="1"/>
        </svg>
      </button>
      <button onClick={handleClose} style={buttonBase} onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.danger;
            const svg = e.currentTarget.querySelector("svg");
            if (svg) {
                svg.querySelectorAll("line").forEach((l) => l.setAttribute("stroke", "#fff"));
            }
        }} onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            const svg = e.currentTarget.querySelector("svg");
            if (svg) {
                svg.querySelectorAll("line").forEach((l) => l.setAttribute("stroke", colors.foregroundSecondary));
            }
        }} aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke={colors.foregroundSecondary} strokeWidth="1.2"/>
          <line x1="10" y1="0" x2="0" y2="10" stroke={colors.foregroundSecondary} strokeWidth="1.2"/>
        </svg>
      </button>
    </div>);
}
export function WindowControls({ position }) {
    if (!isTauri())
        return null;
    const os = detectOS();
    if (os === "macos" && position !== "right")
        return <MacControls />;
    if (os === "macos" && position === "right")
        return null;
    if (position === "left")
        return null;
    return <WinLinuxControls />;
}
