import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TerminalInfo } from "@webmux/shared";
import {
  ChevronDown,
  Columns2,
  Expand,
  Maximize2,
  Minimize2,
  PanelBottom,
  Plus,
  X,
} from "lucide-react";
import { TerminalCard, type TerminalCardRef } from "./TerminalCard.web";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";
import {
  type WorkspaceGroup,
  type WorkspacePaneNode,
  type WorkspaceSplitIntent,
  closeWorkspacePane,
  createTerminalWorkspace,
  getActiveWorkspaceGroup,
  reconcileTerminalWorkspace,
  selectWorkspaceGroup,
  splitWorkspacePane,
} from "@/lib/terminalWorkspaceLayout";

interface TerminalWorkspaceProps {
  terminal: TerminalInfo;
  siblings: TerminalInfo[];
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onSplit: (
    terminal: TerminalInfo,
    direction: WorkspaceSplitIntent,
  ) => Promise<TerminalInfo | null>;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

function TerminalWorkspaceComponent({
  terminal,
  siblings,
  isController,
  deviceId,
  isMobile,
  onClose,
  onPick,
  onDestroy,
  onSplit,
  onRequestControl,
  onReleaseControl,
}: TerminalWorkspaceProps) {
  const [workspace, setWorkspace] = useState(() =>
    createTerminalWorkspace(siblings, terminal.id),
  );
  const activeCardRef = useRef<TerminalCardRef | null>(null);
  const [maximizedTerminalId, setMaximizedTerminalId] = useState<string | null>(
    null,
  );
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const terminalsById = useMemo(() => {
    const map = new Map<string, TerminalInfo>();
    for (const sibling of siblings) map.set(sibling.id, sibling);
    return map;
  }, [siblings]);

  useEffect(() => {
    setWorkspace((prev) =>
      reconcileTerminalWorkspace(prev, siblings, terminal.id),
    );
  }, [siblings, terminal.id]);

  const activeGroup = getActiveWorkspaceGroup(workspace);
  const activeTerminal =
    terminalsById.get(workspace.activeTerminalId ?? "") ?? terminal;

  const fitActivePaneAfterLayout = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        activeCardRef.current?.fitToContainer({ skipIfUnchanged: true });
      });
    });
  }, []);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      const changedTerminal = terminalId !== workspace.activeTerminalId;
      if (changedTerminal) setMaximizedTerminalId(null);
      setWorkspace((prev) => {
        const group =
          prev.groups.find((candidate) =>
            containsTerminal(candidate.root, terminalId),
          ) ?? null;
        return {
          ...prev,
          activeGroupId: group?.id ?? prev.activeGroupId,
          activeTerminalId: terminalId,
        };
      });
      onPick(terminalId);
      if (!isMobile && isController && changedTerminal) {
        fitActivePaneAfterLayout();
      }
    },
    [
      fitActivePaneAfterLayout,
      isController,
      isMobile,
      onPick,
      workspace.activeTerminalId,
    ],
  );

  const activateGroup = useCallback(
    (groupId: string) => {
      setMaximizedTerminalId(null);
      setWorkspace((prev) => {
        const next = selectWorkspaceGroup(prev, groupId);
        if (next.activeTerminalId) onPick(next.activeTerminalId);
        return next;
      });
      if (!isMobile && isController) fitActivePaneAfterLayout();
    },
    [fitActivePaneAfterLayout, isController, isMobile, onPick],
  );

  const handleSplit = useCallback(
    async (direction: WorkspaceSplitIntent) => {
      if (!isController) return;
      const created = await onSplit(activeTerminal, direction);
      if (!created) return;
      setMaximizedTerminalId(null);
      setWorkspace((prev) =>
        splitWorkspacePane(prev, {
          activeTerminalId: activeTerminal.id,
          newTerminalId: created.id,
          direction,
        }),
      );
      onPick(created.id);
      fitActivePaneAfterLayout();
    },
    [activeTerminal, fitActivePaneAfterLayout, isController, onPick, onSplit],
  );

  const handleFit = useCallback(() => {
    activeCardRef.current?.fitToContainer();
  }, []);

  const handleDestroy = useCallback(
    (target: TerminalInfo) => {
      if (!isController) return;
      const nextWorkspace = closeWorkspacePane(workspace, target.id);
      if (
        workspace.activeTerminalId === target.id &&
        nextWorkspace.activeTerminalId &&
        nextWorkspace.activeTerminalId !== target.id
      ) {
        onPick(nextWorkspace.activeTerminalId);
      }
      if (maximizedTerminalId === target.id) setMaximizedTerminalId(null);
      onDestroy(target);
    },
    [isController, maximizedTerminalId, onDestroy, onPick, workspace],
  );

  if (isMobile) {
    return (
      <div
        data-testid="expanded-terminal"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: terminalTheme.background,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <WorkspaceTopBar
          groups={workspace.groups}
          activeGroupId={workspace.activeGroupId}
          activeTerminal={activeTerminal}
          isController={isController}
          isMobile
          onGroupSelect={activateGroup}
          onOpenDrawer={() => setMobileDrawerOpen(true)}
          onSplitRight={() => void handleSplit("right")}
          onSplitDown={() => void handleSplit("down")}
          onFit={handleFit}
          onToggleMaximize={() => {}}
          maximized={false}
          onClose={onClose}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <WorkspacePaneLeaf
            terminal={activeTerminal}
            isActive
            isController={isController}
            deviceId={deviceId}
            isMobile
            onActiveRef={(ref) => {
              activeCardRef.current = ref;
            }}
            onFocus={activateTerminal}
            onDestroy={handleDestroy}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        </div>
        <MobilePaneTabs
          group={activeGroup}
          terminalsById={terminalsById}
          activeTerminalId={activeTerminal.id}
          isController={isController}
          onPick={activateTerminal}
          onNew={() => void handleSplit("right")}
        />
        {mobileDrawerOpen && (
          <MobilePaneDrawer
            groups={workspace.groups}
            activeGroupId={workspace.activeGroupId}
            activeTerminalId={activeTerminal.id}
            terminalsById={terminalsById}
            isController={isController}
            onClose={() => setMobileDrawerOpen(false)}
            onGroupPick={activateGroup}
            onPick={(id) => {
              activateTerminal(id);
              setMobileDrawerOpen(false);
            }}
            onDestroy={handleDestroy}
            onNew={() => void handleSplit("right")}
          />
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="expanded-terminal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: terminalTheme.background,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "webmuxFadeIn 140ms ease-out",
      }}
    >
      <WorkspaceTopBar
        groups={workspace.groups}
        activeGroupId={workspace.activeGroupId}
        activeTerminal={activeTerminal}
        isController={isController}
        isMobile={false}
        onGroupSelect={activateGroup}
        onOpenDrawer={() => {}}
        onSplitRight={() => void handleSplit("right")}
        onSplitDown={() => void handleSplit("down")}
        onFit={handleFit}
        onToggleMaximize={() =>
          setMaximizedTerminalId((value) =>
            value === activeTerminal.id ? null : activeTerminal.id,
          )
        }
        maximized={Boolean(maximizedTerminalId)}
        onClose={onClose}
        onRequestControl={onRequestControl}
        onReleaseControl={onReleaseControl}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 8,
          background: terminalTheme.background,
        }}
      >
        {maximizedTerminalId ? (
          <WorkspacePaneLeaf
            terminal={terminalsById.get(maximizedTerminalId) ?? activeTerminal}
            isActive
            isController={isController}
            deviceId={deviceId}
            isMobile={false}
            onActiveRef={(ref) => {
              activeCardRef.current = ref;
            }}
            onFocus={activateTerminal}
            onDestroy={handleDestroy}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        ) : activeGroup?.root ? (
          <WorkspacePaneTree
            node={activeGroup.root}
            terminalsById={terminalsById}
            activeTerminalId={activeTerminal.id}
            isController={isController}
            deviceId={deviceId}
            onActiveRef={(ref) => {
              activeCardRef.current = ref;
            }}
            onFocus={activateTerminal}
            onDestroy={handleDestroy}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        ) : null}
      </div>
    </div>
  );
}

export const TerminalWorkspace = memo(TerminalWorkspaceComponent);

function WorkspaceTopBar({
  groups,
  activeGroupId,
  activeTerminal,
  isController,
  isMobile,
  maximized,
  onGroupSelect,
  onOpenDrawer,
  onSplitRight,
  onSplitDown,
  onFit,
  onToggleMaximize,
  onClose,
  onRequestControl,
  onReleaseControl,
}: {
  groups: WorkspaceGroup[];
  activeGroupId: string | null;
  activeTerminal: TerminalInfo;
  isController: boolean;
  isMobile: boolean;
  maximized: boolean;
  onGroupSelect: (id: string) => void;
  onOpenDrawer: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onFit: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  return (
    <div
      style={{
        height: isMobile ? 44 : 42,
        borderBottom: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: isMobile ? "0 8px" : "0 10px",
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {isMobile ? (
        <button
          type="button"
          onClick={onOpenDrawer}
          style={mobileGroupButton}
          data-testid="workspace-mobile-groups"
        >
          <span style={truncateStyle}>
            {groups.find((group) => group.id === activeGroupId)?.label ??
              "workspace"}
          </span>
          <ChevronDown size={14} />
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 4,
            overflowX: "auto",
            maxWidth: "42vw",
            minWidth: 0,
          }}
        >
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => onGroupSelect(group.id)}
              data-testid={`workspace-group-${group.id}`}
              style={{
                ...groupTabStyle,
                color: group.id === activeGroupId ? colors.fg0 : colors.fg2,
                background:
                  group.id === activeGroupId ? colors.bg2 : "transparent",
                borderColor:
                  group.id === activeGroupId
                    ? colorAlpha.accentLine
                    : colors.lineSoft,
              }}
            >
              <span style={truncateStyle}>{group.label}</span>
              <span style={{ color: colors.fg3 }}>{group.paneCount}</span>
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          flex: 1,
          color: colors.fg2,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
      >
        <span style={{ color: colors.fg1, ...truncateStyle }}>
          {activeTerminal.title || activeTerminal.id.slice(0, 8)}
        </span>
        {!isMobile && (
          <span style={truncateStyle}>{shortenHome(activeTerminal.cwd)}</span>
        )}
      </div>

      {isController ? (
        <button
          type="button"
          data-testid="terminal-mode-toggle"
          onClick={() => onReleaseControl?.(activeTerminal.machine_id)}
          style={controlPillStyle}
          title="Release control"
        >
          ctrl
        </button>
      ) : (
        <button
          type="button"
          data-testid="terminal-mode-toggle"
          onClick={() => onRequestControl?.(activeTerminal.machine_id)}
          style={{
            ...controlPillStyle,
            background: colors.accent,
            color: "#120904",
          }}
          title="Take control"
        >
          control
        </button>
      )}

      {!isMobile && (
        <>
          <IconButton
            disabled={!isController}
            title="Split right"
            onClick={onSplitRight}
          >
            <Columns2 size={14} />
          </IconButton>
          <IconButton
            disabled={!isController}
            title="Split down"
            onClick={onSplitDown}
          >
            <PanelBottom size={14} />
          </IconButton>
          <IconButton title="Fit" testId="terminal-fit-button" onClick={onFit}>
            <Expand size={14} />
          </IconButton>
          <IconButton
            title={maximized ? "Restore panes" : "Maximize pane"}
            onClick={onToggleMaximize}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
        </>
      )}
      {isMobile && (
        <>
          {isController && (
            <IconButton
              title="Fit"
              testId="terminal-fit-button"
              onClick={onFit}
            >
              <Expand size={15} />
            </IconButton>
          )}
          <IconButton
            disabled={!isController}
            title="New pane"
            onClick={onSplitRight}
          >
            <Plus size={15} />
          </IconButton>
        </>
      )}
      <IconButton
        title="Exit workspace"
        testId="expanded-close"
        onClick={onClose}
      >
        <X size={15} />
      </IconButton>
    </div>
  );
}

function WorkspacePaneTree({
  node,
  terminalsById,
  activeTerminalId,
  isController,
  deviceId,
  onActiveRef,
  onFocus,
  onDestroy,
  onRequestControl,
  onReleaseControl,
}: {
  node: WorkspacePaneNode;
  terminalsById: Map<string, TerminalInfo>;
  activeTerminalId: string;
  isController: boolean;
  deviceId: string;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  if (node.type === "leaf") {
    const terminal = terminalsById.get(node.terminalId);
    if (!terminal) return null;
    return (
      <WorkspacePaneLeaf
        terminal={terminal}
        isActive={terminal.id === activeTerminalId}
        isController={isController}
        deviceId={deviceId}
        isMobile={false}
        onActiveRef={onActiveRef}
        onFocus={onFocus}
        onDestroy={onDestroy}
        onRequestControl={onRequestControl}
        onReleaseControl={onReleaseControl}
      />
    );
  }
  const row = node.direction === "horizontal";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: row ? "row" : "column",
        width: "100%",
        height: "100%",
        gap: 6,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div style={{ flex: node.ratio, minWidth: 0, minHeight: 0 }}>
        <WorkspacePaneTree
          node={node.first}
          terminalsById={terminalsById}
          activeTerminalId={activeTerminalId}
          isController={isController}
          deviceId={deviceId}
          onActiveRef={onActiveRef}
          onFocus={onFocus}
          onDestroy={onDestroy}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
      </div>
      <div style={{ flex: 1 - node.ratio, minWidth: 0, minHeight: 0 }}>
        <WorkspacePaneTree
          node={node.second}
          terminalsById={terminalsById}
          activeTerminalId={activeTerminalId}
          isController={isController}
          deviceId={deviceId}
          onActiveRef={onActiveRef}
          onFocus={onFocus}
          onDestroy={onDestroy}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
      </div>
    </div>
  );
}

function WorkspacePaneLeaf({
  terminal,
  isActive,
  isController,
  deviceId,
  isMobile,
  onActiveRef,
  onFocus,
  onDestroy,
  onRequestControl,
  onReleaseControl,
}: {
  terminal: TerminalInfo;
  isActive: boolean;
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  const cardRef = useRef<TerminalCardRef>(null);

  useEffect(() => {
    if (!isActive) return;
    const frame = requestAnimationFrame(() => {
      if (isMobile && isController) {
        cardRef.current?.fitToContainer({ skipIfUnchanged: true });
      } else {
        cardRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive, isController, isMobile, terminal.id]);

  useEffect(() => {
    if (!isActive) return;
    onActiveRef(cardRef.current);
    return () => onActiveRef(null);
  }, [isActive, onActiveRef]);

  return (
    <div
      data-testid={`workspace-pane-${terminal.id}`}
      onMouseDown={() => onFocus(terminal.id)}
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
        border: `1px solid ${isActive ? colors.accent : colors.lineSoft}`,
        boxShadow: isActive ? `0 0 0 1px ${colorAlpha.accentLine}` : "none",
        overflow: "hidden",
      }}
    >
      {!isMobile && (
        <div
          data-testid={`expanded-thumb-${terminal.id}`}
          style={{
            height: 28,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "0 8px",
            background: isActive ? colors.bg2 : colors.bg1,
            borderBottom: `1px solid ${colors.lineSoft}`,
            color: colors.fg2,
            fontSize: 11,
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: terminal.reachable ? colors.ok : colors.warn,
              flexShrink: 0,
            }}
          />
          <span
            style={{ color: colors.fg1, fontWeight: 600, ...truncateStyle }}
          >
            {terminal.title || terminal.id.slice(0, 8)}
          </span>
          <span
            style={{
              color: colors.fg3,
              fontFamily: "var(--font-mono)",
              ...truncateStyle,
            }}
          >
            {shortenHome(terminal.cwd)}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            data-testid={`expanded-thumb-close-${terminal.id}`}
            disabled={!isController}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDestroy(terminal);
            }}
            title={isController ? "Close pane" : "View only"}
            style={{
              ...smallIconButtonStyle,
              color: isController ? colors.fg2 : colors.fg3,
              cursor: isController ? "pointer" : "not-allowed",
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <TerminalCard
        ref={cardRef}
        terminal={terminal}
        displayMode="tab"
        isMobile={isMobile}
        isController={isController}
        deviceId={deviceId}
        onSelectTab={() => {}}
        onDestroy={onDestroy}
        onRequestControl={onRequestControl}
        onReleaseControl={onReleaseControl}
      />
    </div>
  );
}

function MobilePaneTabs({
  group,
  terminalsById,
  activeTerminalId,
  isController,
  onPick,
  onNew,
}: {
  group: WorkspaceGroup | null;
  terminalsById: Map<string, TerminalInfo>;
  activeTerminalId: string;
  isController: boolean;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const ids = group ? collectIds(group.root) : [];
  return (
    <div
      style={{
        minHeight: 48,
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: "7px 8px",
        borderTop: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {ids.map((id) => {
        const terminal = terminalsById.get(id);
        if (!terminal) return null;
        const active = id === activeTerminalId;
        return (
          <button
            key={id}
            type="button"
            data-testid={`expanded-thumb-${id}`}
            onClick={() => onPick(id)}
            style={{
              ...mobilePaneTabStyle,
              color: active ? colors.fg0 : colors.fg2,
              background: active ? colors.bg2 : "transparent",
              borderColor: active ? colors.accent : colors.lineSoft,
            }}
          >
            {terminal.id.slice(0, 4)}
          </button>
        );
      })}
      <button
        type="button"
        disabled={!isController}
        onClick={onNew}
        style={mobilePaneTabStyle}
        title="New pane"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function MobilePaneDrawer({
  groups,
  activeGroupId,
  activeTerminalId,
  terminalsById,
  isController,
  onClose,
  onGroupPick,
  onPick,
  onDestroy,
  onNew,
}: {
  groups: WorkspaceGroup[];
  activeGroupId: string | null;
  activeTerminalId: string;
  terminalsById: Map<string, TerminalInfo>;
  isController: boolean;
  onClose: () => void;
  onGroupPick: (groupId: string) => void;
  onPick: (terminalId: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onNew: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.52)",
        display: "flex",
        alignItems: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxHeight: "78dvh",
          background: colors.bg1,
          borderTop: `1px solid ${colors.line}`,
          padding: "10px 10px 14px",
          overflow: "auto",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: 10 }}
        >
          <strong style={{ color: colors.fg0, fontSize: 14 }}>Panes</strong>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={drawerDoneButtonStyle}>
            Done
          </button>
        </div>
        {groups.map((group) => (
          <div key={group.id} style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => onGroupPick(group.id)}
              style={{
                ...drawerGroupButtonStyle,
                color: group.id === activeGroupId ? colors.fg0 : colors.fg2,
              }}
            >
              {group.label}
              <span style={{ color: colors.fg3 }}>{group.paneCount}</span>
            </button>
            {collectIds(group.root).map((id) => {
              const terminal = terminalsById.get(id);
              if (!terminal) return null;
              return (
                <div key={id} style={drawerPaneRowStyle}>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      color:
                        id === activeTerminalId ? colors.accent : colors.fg1,
                      padding: 0,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {terminal.title || terminal.id.slice(0, 8)}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: colors.fg3,
                        ...truncateStyle,
                      }}
                    >
                      {shortenHome(terminal.cwd)}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={!isController}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDestroy(terminal);
                    }}
                    style={smallIconButtonStyle}
                    title="Close pane"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        <button
          type="button"
          disabled={!isController}
          onClick={onNew}
          style={drawerNewButtonStyle}
        >
          <Plus size={14} />
          New pane
        </button>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  disabled = false,
  testId,
  onClick,
}: {
  children: ReactNode;
  title: string;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...iconButtonStyle,
        color: disabled ? colors.fg3 : colors.fg2,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

const iconButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
};

const smallIconButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  border: "none",
  background: "transparent",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  color: colors.fg2,
};

const groupTabStyle: CSSProperties = {
  height: 28,
  maxWidth: 150,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  padding: "0 9px",
  fontSize: 12,
  flexShrink: 0,
  cursor: "pointer",
};

const controlPillStyle: CSSProperties = {
  height: 24,
  borderRadius: 5,
  border: `1px solid ${colorAlpha.accentLine}`,
  background: colorAlpha.accentSoft,
  color: colors.accent,
  padding: "0 8px",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  flexShrink: 0,
  cursor: "pointer",
};

const mobileGroupButton: CSSProperties = {
  height: 30,
  maxWidth: "42vw",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg0,
  padding: "0 9px",
  fontSize: 12,
  fontWeight: 700,
  minWidth: 0,
};

const mobilePaneTabStyle: CSSProperties = {
  height: 32,
  minWidth: 44,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: "transparent",
  color: colors.fg2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
};

const drawerDoneButtonStyle: CSSProperties = {
  height: 30,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg1,
  padding: "0 10px",
  fontSize: 12,
};

const drawerGroupButtonStyle: CSSProperties = {
  width: "100%",
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 12,
  fontWeight: 700,
};

const drawerPaneRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 48,
  borderTop: `1px solid ${colors.lineSoft}`,
  padding: "7px 0",
};

const drawerNewButtonStyle: CSSProperties = {
  width: "100%",
  height: 38,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  borderRadius: 7,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg1,
  fontSize: 13,
  fontWeight: 700,
};

const truncateStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

function collectIds(root: WorkspacePaneNode | null): string[] {
  if (!root) return [];
  if (root.type === "leaf") return [root.terminalId];
  return [...collectIds(root.first), ...collectIds(root.second)];
}

function containsTerminal(root: WorkspacePaneNode | null, terminalId: string) {
  return collectIds(root).includes(terminalId);
}

function shortenHome(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
}
