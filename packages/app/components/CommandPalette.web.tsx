// Command palette (⌃B k) — Phase 2 D1 shell. Centered overlay with a fuzzy
// filter, arrow-key + Enter navigation, and mouse support. Rows are supplied
// by TerminalCanvas; `switchHost` / `sessionSwitcher` prefix actions open it
// pre-filtered to the hosts / tabs sections.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { colors } from "@/lib/colors";

export type PaletteSection = "actions" | "tabs" | "hosts";
export type PaletteFilter = "all" | "tabs" | "hosts";

export interface PaletteRow {
  id: string;
  section: PaletteSection;
  label: string;
  // Right-aligned binding hint (formatPrefixBinding output), when any.
  hint?: string;
  // Extra text the fuzzy filter matches on (e.g. machine name, cwd).
  keywords?: string;
  disabled?: boolean;
  action: () => void;
}

interface CommandPaletteProps {
  rows: PaletteRow[];
  filter?: PaletteFilter;
  onClose: () => void;
}

// Case-insensitive subsequence match ("nt" matches "New terminal").
function fuzzyMatch(query: string, text: string): boolean {
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

export function CommandPalette({
  rows,
  filter = "all",
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const visibleRows = useMemo(() => {
    const sectioned =
      filter === "all" ? rows : rows.filter((row) => row.section === filter);
    const trimmed = query.trim();
    if (!trimmed) return sectioned;
    return sectioned.filter((row) =>
      fuzzyMatch(trimmed, `${row.label} ${row.keywords ?? ""}`),
    );
  }, [rows, filter, query]);

  // Keep the highlight on the first row whenever the result set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [visibleRows.length, query, filter]);

  const runRow = (row: PaletteRow | undefined) => {
    if (!row || row.disabled) return;
    onClose();
    row.action();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (visibleRows.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next =
        (selectedIndex + delta + visibleRows.length) % visibleRows.length;
      setSelectedIndex(next);
      listRef.current
        ?.querySelector(`[data-palette-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      runRow(visibleRows[selectedIndex]);
    }
  };

  return (
    <div
      data-testid="command-palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
      }}
    >
      <div
        style={{
          width: "calc(100% - 48px)",
          maxWidth: 480,
          background: colors.bg1,
          border: `1px solid ${colors.line}`,
          borderRadius: 10,
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          data-testid="command-palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command or search…"
          spellCheck={false}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "transparent",
            border: "none",
            borderBottom: `1px solid ${colors.lineSoft}`,
            outline: "none",
            color: colors.fg0,
            fontSize: 14,
            padding: "12px 14px",
          }}
        />
        <div
          ref={listRef}
          style={{
            maxHeight: "50vh",
            overflowY: "auto",
            padding: "6px 0",
          }}
        >
          {visibleRows.length === 0 && (
            <div
              style={{
                padding: "14px",
                color: colors.fg3,
                fontSize: 12,
                textAlign: "center",
              }}
            >
              No matching commands
            </div>
          )}
          {visibleRows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              data-testid={`command-palette-row-${row.id}`}
              data-palette-index={index}
              disabled={row.disabled}
              onClick={() => runRow(row)}
              onMouseEnter={() => setSelectedIndex(index)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
                border: "none",
                background:
                  index === selectedIndex ? colors.bg2 : "transparent",
                color: row.disabled ? colors.fg3 : colors.fg1,
                fontSize: 13,
                textAlign: "left",
                padding: "8px 14px",
                cursor: row.disabled ? "default" : "pointer",
              }}
            >
              <span style={truncateStyle}>{row.label}</span>
              {row.hint && (
                <span
                  style={{
                    color: colors.fg3,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {row.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const truncateStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};
