import { useState, useCallback, useEffect } from "react";
import { colors } from "@/lib/colors";
import { isTauri } from "@/lib/platform";
import { getServerUrl, setServerUrl } from "@/lib/serverUrl";
import { getSettings, updateSettings } from "@/lib/api";
import { ArrowLeft } from "lucide-react";
// Common UI (proportional) fonts
const UI_FONTS = [
    "System Default",
    "Inter",
    "Roboto",
    "Segoe UI",
    "Helvetica Neue",
    "Arial",
    "SF Pro",
    "Noto Sans",
    "Open Sans",
    "Lato",
    "Source Sans Pro",
];
// Common monospace / terminal fonts
const TERMINAL_FONTS = [
    "Auto Detect",
    "JetBrains Mono",
    "Fira Code",
    "Cascadia Code",
    "Source Code Pro",
    "Inconsolata",
    "IBM Plex Mono",
    "Hack",
    "Ubuntu Mono",
    "Menlo",
    "Consolas",
    "Monaco",
    "Courier New",
];
// Reusable select with custom input fallback
function FontSelect({ value, options, emptyLabel, onChange, }) {
    const [custom, setCustom] = useState(false);
    const isCustom = custom || (value !== "" && !options.includes(value));
    if (isCustom) {
        return (<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Enter font name..." style={{
                flex: 1,
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                color: colors.foreground,
                padding: "8px 12px",
                fontSize: 13,
                outline: "none",
            }}/>
        <button onClick={() => {
                setCustom(false);
                onChange("");
            }} style={{
                background: "none",
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                color: colors.foregroundSecondary,
                cursor: "pointer",
                padding: "8px 10px",
                fontSize: 12,
            }}>
          List
        </button>
      </div>);
    }
    return (<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select value={value || options[0]} onChange={(e) => {
            const v = e.target.value;
            onChange(v === options[0] ? "" : v);
        }} style={{
            flex: 1,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.foreground,
            padding: "8px 12px",
            fontSize: 13,
            outline: "none",
            cursor: "pointer",
            appearance: "auto",
        }}>
        {options.map((opt) => (<option key={opt} value={opt}>
            {opt === options[0] ? emptyLabel : opt}
          </option>))}
      </select>
      <button onClick={() => setCustom(true)} title="Enter custom font name" style={{
            background: "none",
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            color: colors.foregroundSecondary,
            cursor: "pointer",
            padding: "8px 10px",
            fontSize: 12,
        }}>
        Custom
      </button>
    </div>);
}
function SectionTitle({ children }) {
    return (<h3 style={{
            fontSize: 11,
            fontWeight: 600,
            color: colors.foregroundMuted,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 16,
            marginTop: 0,
        }}>
      {children}
    </h3>);
}
function SettingRow({ label, description, children, }) {
    return (<div style={{ marginBottom: 20 }}>
      <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.foreground,
            marginBottom: description ? 2 : 8,
        }}>
        {label}
      </div>
      {description && (<div style={{
                fontSize: 11,
                color: colors.foregroundMuted,
                marginBottom: 8,
            }}>
          {description}
        </div>)}
      {children}
    </div>);
}
export function SettingsPage({ onClose }) {
    // Status bar visibility (hidden by default — see TerminalCanvas.web).
    const [showStatusBar, setShowStatusBar] = useState(() => localStorage.getItem("webmux:show-status-bar") === "1");
    const toggleStatusBar = useCallback(() => {
        setShowStatusBar((prev) => {
            const next = !prev;
            localStorage.setItem("webmux:show-status-bar", next ? "1" : "0");
            // Notify the orchestrator (listens for the same key via StorageEvent,
            // which only fires cross-tab — dispatch one locally so this tab updates
            // immediately).
            window.dispatchEvent(new StorageEvent("storage", {
                key: "webmux:show-status-bar",
                newValue: next ? "1" : "0",
            }));
            return next;
        });
    }, []);
    // Terminal font settings
    const [terminalFont, setTerminalFont] = useState(() => localStorage.getItem("webmux:terminal-font-family") || "");
    const [terminalFontSize, setTerminalFontSize] = useState(() => localStorage.getItem("webmux:terminal-font-size") || "");
    // UI font settings
    const [uiFont, setUiFont] = useState(() => localStorage.getItem("webmux:ui-font-family") || "");
    const [uiFontSize, setUiFontSize] = useState(() => localStorage.getItem("webmux:ui-font-size") || "");
    // Renderer
    const [renderer, setRenderer] = useState(() => localStorage.getItem("webmux:renderer") || "xterm");
    // Quick commands
    const [quickCommands, setQuickCommands] = useState([]);
    const [quickCommandsLoaded, setQuickCommandsLoaded] = useState(false);
    // Server URL (desktop only)
    const [serverUrl, setServerUrlState] = useState(() => getServerUrl());
    // Load quick commands
    useEffect(() => {
        getSettings()
            .then((res) => {
            try {
                const cmds = JSON.parse(res.settings.quick_commands || "[]");
                setQuickCommands(cmds);
            }
            catch {
                /* ignore */
            }
            setQuickCommandsLoaded(true);
        })
            .catch(() => setQuickCommandsLoaded(true));
    }, []);
    // Apply UI font to document
    useEffect(() => {
        if (uiFont) {
            document.documentElement.style.fontFamily = `'${uiFont}', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        }
        else {
            document.documentElement.style.fontFamily = "";
        }
    }, [uiFont]);
    // Save terminal font
    const handleTerminalFontChange = useCallback((value) => {
        setTerminalFont(value);
        if (value) {
            localStorage.setItem("webmux:terminal-font-family", value);
        }
        else {
            localStorage.removeItem("webmux:terminal-font-family");
        }
    }, []);
    const handleTerminalFontSizeChange = useCallback((e) => {
        const v = e.target.value;
        setTerminalFontSize(v);
        const size = parseInt(v, 10);
        if (size >= 10 && size <= 24) {
            localStorage.setItem("webmux:terminal-font-size", String(size));
        }
        else if (!v) {
            localStorage.removeItem("webmux:terminal-font-size");
        }
    }, []);
    // Save UI font
    const handleUiFontChange = useCallback((value) => {
        setUiFont(value);
        if (value) {
            localStorage.setItem("webmux:ui-font-family", value);
        }
        else {
            localStorage.removeItem("webmux:ui-font-family");
        }
    }, []);
    const handleUiFontSizeChange = useCallback((e) => {
        const v = e.target.value;
        setUiFontSize(v);
        const size = parseInt(v, 10);
        if (size >= 10 && size <= 20) {
            localStorage.setItem("webmux:ui-font-size", String(size));
            document.documentElement.style.fontSize = `${size}px`;
        }
        else if (!v) {
            localStorage.removeItem("webmux:ui-font-size");
            document.documentElement.style.fontSize = "";
        }
    }, []);
    // Renderer
    const handleRendererChange = useCallback((e) => {
        const v = e.target.value;
        setRenderer(v);
        localStorage.setItem("webmux:renderer", v);
    }, []);
    // Quick commands
    const saveQuickCommands = useCallback((cmds) => {
        setQuickCommands(cmds);
        updateSettings({ quick_commands: JSON.stringify(cmds) });
    }, []);
    const handleAddCommand = useCallback(() => {
        saveQuickCommands([...quickCommands, { label: "", command: "" }]);
    }, [quickCommands, saveQuickCommands]);
    const handleRemoveCommand = useCallback((index) => {
        saveQuickCommands(quickCommands.filter((_, i) => i !== index));
    }, [quickCommands, saveQuickCommands]);
    const handleUpdateCommand = useCallback((index, field, value) => {
        const updated = quickCommands.map((cmd, i) => i === index ? { ...cmd, [field]: value } : cmd);
        setQuickCommands(updated);
    }, [quickCommands]);
    const handleBlurSaveCommands = useCallback(() => {
        saveQuickCommands(quickCommands);
    }, [quickCommands, saveQuickCommands]);
    // Server URL
    const handleServerUrlSave = useCallback(() => {
        setServerUrl(serverUrl);
        window.location.reload();
    }, [serverUrl]);
    const inputStyle = {
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        color: colors.foreground,
        padding: "8px 12px",
        fontSize: 13,
        outline: "none",
        width: 80,
    };
    const selectStyle = {
        ...inputStyle,
        width: "auto",
        cursor: "pointer",
        appearance: "auto",
    };
    const needsReload = terminalFont !== (localStorage.getItem("webmux:terminal-font-family") || "") ||
        renderer !== (localStorage.getItem("webmux:renderer") || "xterm");
    return (<div style={{
            flex: 1,
            overflow: "auto",
            background: colors.background,
            display: "flex",
            flexDirection: "column",
        }}>
      {/* Header */}
      <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 24px",
            borderBottom: `1px solid ${colors.border}`,
            flexShrink: 0,
        }}>
        <button onClick={onClose} style={{
            background: "none",
            border: "none",
            color: colors.foregroundSecondary,
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
        }} title="Back">
          <ArrowLeft size={18}/>
        </button>
        <h2 style={{
            fontSize: 16,
            fontWeight: 600,
            color: colors.foreground,
            margin: 0,
        }}>
          Settings
        </h2>
      </div>

      {/* Content */}
      <div style={{
            flex: 1,
            overflow: "auto",
            padding: "24px 24px 48px",
            maxWidth: 560,
        }}>
        {/* Appearance Section */}
        <section style={{ marginBottom: 32 }}>
          <SectionTitle>Appearance</SectionTitle>

          <SettingRow label="Show status bar" description="Adds a 24px monospace bar with CPU/MEM/DISK at the bottom.">
            <button data-testid="toggle-status-bar" onClick={toggleStatusBar} role="switch" aria-checked={showStatusBar} style={{
            width: 40,
            height: 22,
            borderRadius: 999,
            border: `1px solid ${colors.border}`,
            background: showStatusBar ? colors.accent : colors.surface,
            position: "relative",
            cursor: "pointer",
            padding: 0,
            transition: "background 120ms",
        }}>
              <span style={{
            position: "absolute",
            top: 2,
            left: showStatusBar ? 20 : 2,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: showStatusBar ? "#120904" : colors.foregroundMuted,
            transition: "left 120ms",
        }}/>
            </button>
          </SettingRow>

          <SettingRow label="UI Font" description="Font used for the interface (sidebar, tabs, status bar)">
            <FontSelect value={uiFont} options={UI_FONTS} emptyLabel="System Default" onChange={handleUiFontChange}/>
          </SettingRow>

          <SettingRow label="UI Font Size">
            <input type="number" value={uiFontSize} onChange={handleUiFontSizeChange} placeholder="14" min={10} max={20} style={inputStyle}/>
          </SettingRow>
        </section>

        {/* Terminal Section */}
        <section style={{ marginBottom: 32 }}>
          <SectionTitle>Terminal</SectionTitle>

          <SettingRow label="Terminal Font" description="Monospace font used inside terminal windows">
            <FontSelect value={terminalFont} options={TERMINAL_FONTS} emptyLabel="Auto Detect" onChange={handleTerminalFontChange}/>
          </SettingRow>

          <SettingRow label="Terminal Font Size">
            <input type="number" value={terminalFontSize} onChange={handleTerminalFontSizeChange} placeholder="14" min={10} max={24} style={inputStyle}/>
          </SettingRow>

          <SettingRow label="Renderer" description="Terminal rendering engine (changing requires reload)">
            <select value={renderer} onChange={handleRendererChange} style={selectStyle}>
              <option value="xterm">xterm</option>
              <option value="wterm">wterm</option>
            </select>
          </SettingRow>
        </section>

        {/* Quick Commands Section */}
        <section style={{ marginBottom: 32 }}>
          <SectionTitle>Quick Commands</SectionTitle>
          <div style={{
            fontSize: 11,
            color: colors.foregroundMuted,
            marginBottom: 12,
        }}>
            Shortcuts shown under each bookmark for quick terminal launch
          </div>

          {quickCommandsLoaded &&
            quickCommands.map((cmd, i) => (<div key={i} style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 8,
                    alignItems: "center",
                }}>
                <input type="text" value={cmd.label} onChange={(e) => handleUpdateCommand(i, "label", e.target.value)} onBlur={handleBlurSaveCommands} placeholder="Label" style={{ ...inputStyle, width: 80 }}/>
                <input type="text" value={cmd.command} onChange={(e) => handleUpdateCommand(i, "command", e.target.value)} onBlur={handleBlurSaveCommands} placeholder="Command" style={{ ...inputStyle, flex: 1, width: "auto" }}/>
                <button onClick={() => handleRemoveCommand(i)} style={{
                    background: "none",
                    border: "none",
                    color: colors.foregroundMuted,
                    cursor: "pointer",
                    padding: "4px 6px",
                    fontSize: 14,
                }}>
                  &times;
                </button>
              </div>))}
          <button onClick={handleAddCommand} style={{
            background: "none",
            border: `1px dashed ${colors.border}`,
            borderRadius: 6,
            color: colors.foregroundMuted,
            cursor: "pointer",
            padding: "8px 16px",
            fontSize: 12,
            width: "100%",
        }}>
            + Add command
          </button>
        </section>

        {/* Connection Section — desktop only */}
        {isTauri() && (<section style={{ marginBottom: 32 }}>
            <SectionTitle>Connection</SectionTitle>

            <SettingRow label="Server URL" description="WebSocket server address for terminal connections">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="text" value={serverUrl} onChange={(e) => setServerUrlState(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter")
                    handleServerUrlSave();
            }} placeholder="https://your-server:4317" style={{ ...inputStyle, flex: 1, width: "auto" }}/>
                <button onClick={handleServerUrlSave} style={{
                background: colors.accent,
                border: "none",
                borderRadius: 6,
                color: "#fff",
                cursor: "pointer",
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
            }}>
                  Save
                </button>
              </div>
            </SettingRow>
          </section>)}

        {/* Reload notice */}
        <div style={{
            fontSize: 11,
            color: colors.foregroundMuted,
            marginTop: 8,
        }}>
          Some settings (terminal font, renderer) take effect after
          creating a new terminal or reloading the page.
        </div>
      </div>
    </div>);
}
