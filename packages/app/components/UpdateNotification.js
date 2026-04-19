import { useState, useEffect, useCallback } from "react";
import { isTauri } from "@/lib/platform";
import { colors } from "@/lib/colors";
export function UpdateNotification() {
    const [updateAvailable, setUpdateAvailable] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
        if (!isTauri())
            return;
        let cancelled = false;
        const checkForUpdate = async () => {
            try {
                const { check } = await import("@tauri-apps/plugin-updater");
                const update = await check();
                if (!cancelled && update) {
                    setUpdateAvailable({
                        version: update.version,
                        body: update.body ?? undefined,
                    });
                }
            }
            catch {
                // Silently ignore update check failures
            }
        };
        const timer = setTimeout(checkForUpdate, 5000);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, []);
    const handleInstall = useCallback(async () => {
        setInstalling(true);
        try {
            const { check } = await import("@tauri-apps/plugin-updater");
            const update = await check();
            if (update) {
                await update.downloadAndInstall();
                const { relaunch } = await import("@tauri-apps/plugin-process");
                await relaunch();
            }
        }
        catch {
            setInstalling(false);
        }
    }, []);
    if (!updateAvailable || dismissed)
        return null;
    return (<div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 8px",
            fontSize: 11,
        }}>
      <span style={{ color: colors.background, opacity: 0.9 }}>
        {installing
            ? "Installing update..."
            : `v${updateAvailable.version} available`}
      </span>
      {!installing && (<>
          <button onClick={handleInstall} style={{
                background: "rgba(255,255,255,0.2)",
                border: "none",
                borderRadius: 3,
                color: colors.background,
                cursor: "pointer",
                fontSize: 10,
                padding: "1px 6px",
                fontWeight: 600,
            }}>
            Install
          </button>
          <button onClick={() => setDismissed(true)} style={{
                background: "none",
                border: "none",
                color: colors.background,
                cursor: "pointer",
                fontSize: 10,
                opacity: 0.7,
                padding: "1px 4px",
            }}>
            &#x2715;
          </button>
        </>)}
    </div>);
}
