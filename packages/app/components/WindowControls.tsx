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

  return (
    <div style={{ display: "flex", alignItems: "stretch", flexShrink: 0 }}>
      <button
        onClick={handleMinimize}
        style={{
          background: "none",
          border: "none",
          color: colors.foregroundSecondary,
          cursor: "pointer",
          padding: "0 14px",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.surface; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        aria-label="Minimize"
      >
        &#x2014;
      </button>
      <button
        onClick={handleMaximize}
        style={{
          background: "none",
          border: "none",
          color: colors.foregroundSecondary,
          cursor: "pointer",
          padding: "0 14px",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.surface; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        aria-label="Maximize"
      >
        &#x25A1;
      </button>
      <button
        onClick={handleClose}
        style={{
          background: "none",
          border: "none",
          color: colors.foregroundSecondary,
          cursor: "pointer",
          padding: "0 14px",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.danger;
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
          e.currentTarget.style.color = colors.foregroundSecondary;
        }}
        aria-label="Close"
      >
        &#x2715;
      </button>
    </div>
  );
}
