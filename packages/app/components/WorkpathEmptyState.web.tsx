import { memo } from "react";
import type { Bookmark } from "@webmux/shared";
import { colors } from "@/lib/colors";
import type { QuickCommand } from "./TabStrip.web";

interface WorkpathEmptyStateProps {
  bookmark: Bookmark;
  canCreateTerminal: boolean;
  quickCommands: QuickCommand[];
  onNewTerminal: () => void;
  onQuickCommand: (command: string) => void;
}

function WorkpathEmptyStateComponent({
  bookmark,
  canCreateTerminal,
  quickCommands,
  onNewTerminal,
  onQuickCommand,
}: WorkpathEmptyStateProps) {
  const visibleChips = quickCommands.filter((c) => c.label && c.command);
  return (
    <div
      data-testid="workpath-empty"
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ color: colors.foreground, fontSize: 14, marginBottom: 4 }}>
          {bookmark.label}
        </div>
        <div
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            marginBottom: 18,
            wordBreak: "break-all",
          }}
        >
          {bookmark.path}
        </div>
        {canCreateTerminal ? (
          <>
            <button
              data-testid="workpath-empty-new-terminal"
              onClick={onNewTerminal}
              style={{
                background: colors.accent,
                color: colors.background,
                border: "none",
                borderRadius: 4,
                padding: "8px 16px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + New terminal here
            </button>
            <div style={{ color: colors.foregroundMuted, fontSize: 10, marginTop: 8 }}>
              Cmd/Ctrl+Shift+T
            </div>
            {visibleChips.length > 0 && (
              <>
                <div
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginTop: 24,
                    marginBottom: 8,
                  }}
                >
                  Quick commands
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {visibleChips.map((cmd) => (
                    <button
                      key={cmd.label}
                      data-testid={`workpath-empty-quick-cmd-${cmd.label}`}
                      onClick={() => onQuickCommand(cmd.command)}
                      style={{
                        background: "rgba(217, 119, 87, 0.12)",
                        color: colors.accent,
                        border: "1px solid rgba(217, 119, 87, 0.3)",
                        borderRadius: 4,
                        fontSize: 10,
                        padding: "4px 10px",
                        cursor: "pointer",
                      }}
                    >
                      {cmd.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            Take control of this machine to start a terminal.
          </div>
        )}
      </div>
    </div>
  );
}

export const WorkpathEmptyState = memo(WorkpathEmptyStateComponent);
