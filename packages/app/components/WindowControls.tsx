import { useCallback } from "react";
import { isTauri } from "@/lib/platform";
import { colors } from "@/lib/colors";

export function WindowControls() {
  if (!isTauri()) return null;

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

  const buttonBase: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        flexShrink: 0,
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <button
        onClick={handleMinimize}
        style={buttonBase}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.surface;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
        }}
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill={colors.foregroundSecondary} />
        </svg>
      </button>
      <button
        onClick={handleMaximize}
        style={buttonBase}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.surface;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
        }}
        aria-label="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect
            x="0.5"
            y="0.5"
            width="9"
            height="9"
            fill="none"
            stroke={colors.foregroundSecondary}
            strokeWidth="1"
          />
        </svg>
      </button>
      <button
        onClick={handleClose}
        style={buttonBase}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.danger;
          const svg = e.currentTarget.querySelector("svg");
          if (svg) {
            svg.querySelectorAll("line").forEach((l) => l.setAttribute("stroke", "#fff"));
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          const svg = e.currentTarget.querySelector("svg");
          if (svg) {
            svg.querySelectorAll("line").forEach((l) =>
              l.setAttribute("stroke", colors.foregroundSecondary),
            );
          }
        }}
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line
            x1="0"
            y1="0"
            x2="10"
            y2="10"
            stroke={colors.foregroundSecondary}
            strokeWidth="1.2"
          />
          <line
            x1="10"
            y1="0"
            x2="0"
            y2="10"
            stroke={colors.foregroundSecondary}
            strokeWidth="1.2"
          />
        </svg>
      </button>
    </div>
  );
}
