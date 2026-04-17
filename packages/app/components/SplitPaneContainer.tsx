import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { TerminalInfo } from "@webmux/shared";
import type { PaneNode, PaneSplit } from "@/lib/paneLayout";
import { TerminalCard } from "./TerminalCard.web";
import type { TerminalCardRef } from "./TerminalCard.web";
import { colors } from "@/lib/colors";

interface SplitPaneContainerProps {
  node: PaneNode;
  terminals: TerminalInfo[];
  activePaneId: string | null;
  isMobile: boolean;
  isMachineController: (machineId: string) => boolean;
  deviceId: string;
  terminalCardRefs: React.MutableRefObject<Record<string, TerminalCardRef | null>>;
  onSelectTab: (id: string | null) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onClosePane: (terminalId: string) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
  onActivatePane: (terminalId: string) => void;
  onUpdateRatio: (splitNode: PaneSplit, newRatio: number) => void;
  // True when this node lives inside a split — controls the per-pane close affordance
  inSplit?: boolean;
}

function PaneCloseButton({ onClose }: { onClose: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Close pane (Ctrl+Shift+W)"
      aria-label="Close pane"
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        width: 20,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hovered ? colors.danger : "rgba(0,0,0,0.35)",
        color: hovered ? "#fff" : colors.foregroundSecondary,
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        opacity: hovered ? 1 : 0.6,
        transition: "opacity 0.15s, background 0.15s, color 0.15s",
        zIndex: 2,
      }}
    >
      <X size={12} />
    </button>
  );
}

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  splitNode: PaneSplit;
  onDrag: (splitNode: PaneSplit, newRatio: number) => void;
}

function ResizeHandle({ direction, splitNode, onDrag }: ResizeHandleProps) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{
    startPos: number;
    startRatio: number;
    parentSize: number;
  } | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  // Always track the latest splitNode so mousemove uses the current reference
  const splitNodeRef = useRef(splitNode);
  splitNodeRef.current = splitNode;
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  const isVerticalSplit = direction === "vertical";

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const pos = isVerticalSplit ? e.clientX : e.clientY;
      const delta = pos - state.startPos;
      const ratioDelta = delta / state.parentSize;
      const newRatio = state.startRatio + ratioDelta;
      onDragRef.current(splitNodeRef.current, newRatio);
    };

    const handleMouseUp = () => {
      setDragging(false);
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, isVerticalSplit]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const parent = handleRef.current?.parentElement;
      if (!parent) return;

      const parentRect = parent.getBoundingClientRect();
      const parentSize = isVerticalSplit ? parentRect.width : parentRect.height;
      const startPos = isVerticalSplit ? e.clientX : e.clientY;

      dragStateRef.current = {
        startPos,
        startRatio: splitNode.ratio,
        parentSize,
      };

      setDragging(true);
      document.body.style.cursor = isVerticalSplit ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [splitNode, isVerticalSplit],
  );

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: "0 0 4px",
        background: hovered || dragging ? colors.accent : colors.border,
        cursor: isVerticalSplit ? "col-resize" : "row-resize",
        transition: "background 0.15s ease",
        zIndex: 1,
      }}
    />
  );
}

export function SplitPaneContainer({
  node,
  terminals,
  activePaneId,
  isMobile,
  isMachineController,
  deviceId,
  terminalCardRefs,
  onSelectTab,
  onDestroy,
  onClosePane,
  onRequestControl,
  onReleaseControl,
  onActivatePane,
  onUpdateRatio,
  inSplit,
}: SplitPaneContainerProps) {
  if (node.type === "leaf") {
    const terminal = terminals.find((t) => t.id === node.terminalId);
    if (!terminal) return null;

    const isActive = activePaneId === node.terminalId;
    const isController = isMachineController(terminal.machine_id);
    const showPaneClose = !!inSplit && isController;

    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: isActive ? `1px solid ${colors.accent}` : "1px solid transparent",
          borderRadius: 2,
          transition: "border-color 0.15s ease",
          position: "relative",
        }}
        onMouseDown={() => onActivatePane(node.terminalId)}
      >
        <TerminalCard
          // Key by terminal.id so switching tabs remounts with a fresh xterm +
          // WS. Without this, React reuses the component instance and the new
          // tab's replay is written on top of the previous tab's content. See
          // docs/superpowers/specs/2026-04-17-terminal-resume-protocol-design.md.
          key={terminal.id}
          ref={(el) => {
            terminalCardRefs.current[terminal.id] = el;
          }}
          terminal={terminal}
          displayMode="tab"
          isMobile={isMobile}
          isController={isController}
          deviceId={deviceId}
          onSelectTab={onSelectTab}
          onDestroy={onDestroy}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
        {showPaneClose && (
          <PaneCloseButton onClose={() => onClosePane(terminal.id)} />
        )}
      </div>
    );
  }

  // Split node
  const { direction, children, ratio } = node;
  // vertical split = panes side by side (row), horizontal split = panes stacked (column)
  const isVerticalSplit = direction === "vertical";
  const firstPercent = ratio * 100;
  const secondPercent = (1 - ratio) * 100;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: isVerticalSplit ? "row" : "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: `0 0 calc(${firstPercent}% - 2px)`,
          display: "flex",
          overflow: "hidden",
        }}
      >
        <SplitPaneContainer
          node={children[0]}
          terminals={terminals}
          activePaneId={activePaneId}
          isMobile={isMobile}
          isMachineController={isMachineController}
          deviceId={deviceId}
          terminalCardRefs={terminalCardRefs}
          onSelectTab={onSelectTab}
          onDestroy={onDestroy}
          onClosePane={onClosePane}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
          onActivatePane={onActivatePane}
          onUpdateRatio={onUpdateRatio}
          inSplit
        />
      </div>
      <ResizeHandle
        direction={direction}
        splitNode={node}
        onDrag={onUpdateRatio}
      />
      <div
        style={{
          flex: `0 0 calc(${secondPercent}% - 2px)`,
          display: "flex",
          overflow: "hidden",
        }}
      >
        <SplitPaneContainer
          node={children[1]}
          terminals={terminals}
          activePaneId={activePaneId}
          isMobile={isMobile}
          isMachineController={isMachineController}
          deviceId={deviceId}
          terminalCardRefs={terminalCardRefs}
          onSelectTab={onSelectTab}
          onDestroy={onDestroy}
          onClosePane={onClosePane}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
          onActivatePane={onActivatePane}
          onUpdateRatio={onUpdateRatio}
          inSplit
        />
      </div>
    </div>
  );
}
