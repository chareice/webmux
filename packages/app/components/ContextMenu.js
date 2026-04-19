import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { colors } from "@/lib/colors";
function isSeparator(entry) {
    return "type" in entry && entry.type === "separator";
}
export function ContextMenu({ x, y, items, onClose }) {
    const menuRef = useRef(null);
    const adjustedPosition = useCallback(() => {
        const menu = menuRef.current;
        if (!menu)
            return { left: x, top: y };
        const rect = menu.getBoundingClientRect();
        const left = Math.min(x, window.innerWidth - rect.width - 4);
        const top = Math.min(y, window.innerHeight - rect.height - 4);
        return { left: Math.max(0, left), top: Math.max(0, top) };
    }, [x, y]);
    useEffect(() => {
        const menu = menuRef.current;
        if (menu) {
            const pos = adjustedPosition();
            menu.style.left = `${pos.left}px`;
            menu.style.top = `${pos.top}px`;
        }
    }, [adjustedPosition]);
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onClose();
            }
        };
        const handleEscape = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        const handleScroll = () => onClose();
        requestAnimationFrame(() => {
            document.addEventListener("mousedown", handleClickOutside);
        });
        document.addEventListener("keydown", handleEscape);
        window.addEventListener("scroll", handleScroll, true);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
            window.removeEventListener("scroll", handleScroll, true);
        };
    }, [onClose]);
    return createPortal(<div ref={menuRef} style={{
            position: "fixed",
            left: x,
            top: y,
            zIndex: 9999,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: "4px 0",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            minWidth: 180,
        }}>
      {items.map((entry, i) => {
            if (isSeparator(entry)) {
                return (<div key={`sep-${i}`} style={{
                        height: 1,
                        background: colors.border,
                        margin: "4px 0",
                    }}/>);
            }
            return (<button key={`item-${i}`} onClick={() => {
                    if (!entry.disabled) {
                        entry.onClick();
                        onClose();
                    }
                }} disabled={entry.disabled} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "6px 12px",
                    background: "none",
                    border: "none",
                    color: entry.disabled ? colors.foregroundMuted : colors.foreground,
                    cursor: entry.disabled ? "default" : "pointer",
                    fontSize: 13,
                    textAlign: "left",
                }} onMouseEnter={(e) => {
                    if (!entry.disabled) {
                        e.currentTarget.style.background = colors.background;
                    }
                }} onMouseLeave={(e) => {
                    e.currentTarget.style.background = "none";
                }}>
            <span>{entry.label}</span>
            {entry.shortcut && (<span style={{ fontSize: 11, color: colors.foregroundMuted, marginLeft: 16 }}>
                {entry.shortcut}
              </span>)}
          </button>);
        })}
    </div>, document.body);
}
