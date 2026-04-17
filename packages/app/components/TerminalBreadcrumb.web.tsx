import { memo } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { colors } from "@/lib/colors";

interface TerminalBreadcrumbProps {
  scopeLabel: string;
  zoomedTerminalId: string;
  siblings: TerminalInfo[];
  onBack: () => void;
  onSwitchSibling: (terminalId: string) => void;
  onOpenMenu?: (e: React.MouseEvent) => void;
}

function TerminalBreadcrumbComponent({
  scopeLabel,
  zoomedTerminalId,
  siblings,
  onBack,
  onSwitchSibling,
  onOpenMenu,
}: TerminalBreadcrumbProps) {
  return (
    <div
      data-testid="terminal-breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}
    >
      <button
        data-testid="breadcrumb-back"
        onClick={onBack}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: colors.foregroundSecondary,
          cursor: "pointer",
          fontSize: 12,
          padding: "4px 8px",
        }}
        title="Back to Overview (Esc)"
      >
        <ChevronLeft size={14} />
        {scopeLabel} / Overview
      </button>

      <div style={{ flex: 1, display: "flex", gap: 4, overflowX: "auto" }}>
        {siblings
          .filter((t) => t.id !== zoomedTerminalId)
          .map((t) => (
            <button
              key={t.id}
              data-testid={`breadcrumb-sibling-${t.id}`}
              onClick={() => onSwitchSibling(t.id)}
              title={t.title || t.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: 999,
                color: colors.foregroundSecondary,
                cursor: "pointer",
                fontSize: 11,
                padding: "2px 8px",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: colors.accent,
                }}
              />
              {(t.title || t.id.slice(0, 8)).slice(0, 16)}
            </button>
          ))}
      </div>

      {onOpenMenu && (
        <button
          data-testid="breadcrumb-menu"
          onClick={onOpenMenu}
          style={{
            background: "none",
            border: "none",
            color: colors.foregroundMuted,
            cursor: "pointer",
            padding: 4,
          }}
          title="Terminal actions"
        >
          <MoreHorizontal size={14} />
        </button>
      )}
    </div>
  );
}

export const TerminalBreadcrumb = memo(TerminalBreadcrumbComponent);
