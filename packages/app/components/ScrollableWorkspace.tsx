import { useEffect, useRef } from "react";
import type {
  TerminalInfo,
  WorkspaceColumnWidth,
  WorkspaceScrollableColumn,
} from "@webmux/shared";
import type { TerminalCardRef } from "./TerminalCard.web";
import type { WorkspaceFitRequest } from "./TerminalWorkspace.web";
import { WorkspacePaneLeaf } from "./TerminalWorkspace.web";

function widthToFlexBasis(width: WorkspaceColumnWidth, isMobile: boolean): string {
  if (isMobile) return "100%";
  if (width.kind === "preset") {
    switch (width.value) {
      case "half":
        return "50%";
      case "two_thirds":
        return "66.6667%";
      case "full":
        return "100%";
    }
  }
  // fraction
  return `${Math.max(5, Math.min(100, width.value * 100))}%`;
}

function widthToFraction(width: WorkspaceColumnWidth): number {
  if (width.kind === "fraction") return width.value;
  switch (width.value) {
    case "half":
      return 0.5;
    case "two_thirds":
      return 0.6667;
    case "full":
      return 1;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface ScrollableWorkspaceProps {
  columns: WorkspaceScrollableColumn[];
  terminalsById: Map<string, TerminalInfo>;
  activeTerminalId: string | null;
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  fitRequest: WorkspaceFitRequest | null;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number, terminalId: string) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onResizeColumn: (terminalId: string, width: WorkspaceColumnWidth) => void;
  onReorderColumns: (sourceTerminalId: string, targetTerminalId: string) => void;
  onPaneContextMenu?: (
    terminalId: string,
    event: React.MouseEvent<HTMLElement>,
  ) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

export function ScrollableWorkspace(props: ScrollableWorkspaceProps) {
  const {
    columns,
    terminalsById,
    activeTerminalId,
    isMobile,
  } = props;

  const focusedRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Scroll the focused column into view whenever the active terminal changes.
  useEffect(() => {
    const node = focusedRef.current;
    if (!node) return;
    node.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTerminalId, columns.length, isMobile]);

  // Translate wheel events into horizontal scroll. xterm.js consumes wheel
  // events on its canvas for scrollback, so without intercepting at the
  // strip container the user has no way to pan the viewport with a regular
  // mouse wheel. Conventions:
  //   - Shift + vertical wheel  → pan strip horizontally (override scrollback)
  //   - Trackpad horizontal swipe (deltaX-dominant) → pan strip
  //   - Plain vertical wheel    → unchanged (xterm scrollback wins)
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handler = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      const horizontalIntent =
        event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontalIntent) return;
      const delta = event.shiftKey ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      event.preventDefault();
      event.stopPropagation();
      node.scrollLeft += delta;
    };
    node.addEventListener("wheel", handler, { capture: true, passive: false });
    return () => {
      node.removeEventListener("wheel", handler, {
        capture: true,
      } as EventListenerOptions);
    };
  }, []);

  // Drag state for column resize handles.
  const dragRef = useRef<{
    startClientX: number;
    startFraction: number;
    leftTerminalId: string;
    containerWidth: number;
  } | null>(null);

  function startDrag(leftIdx: number) {
    return (e: React.MouseEvent<HTMLDivElement>) => {
      if (isMobile) return;
      const column = columns[leftIdx];
      if (!column) return;
      const container = containerRef.current;
      if (!container) return;

      dragRef.current = {
        startClientX: e.clientX,
        startFraction: widthToFraction(column.width),
        leftTerminalId: column.terminalId,
        containerWidth: container.getBoundingClientRect().width,
      };

      const onMouseMove = (mv: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = (mv.clientX - drag.startClientX) / drag.containerWidth;
        const newFraction = clamp(drag.startFraction + delta, 0.1, 1);
        props.onResizeColumn(drag.leftTerminalId, { kind: "fraction", value: newFraction });
      };

      const onMouseUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflowX: "auto",
        overflowY: "hidden",
        scrollSnapType: "x proximity",
        display: "flex",
        gap: 6,
      }}
    >
      {columns.map((column, idx) => {
        const terminal = terminalsById.get(column.terminalId);
        const isActive = column.terminalId === activeTerminalId;

        return [
          // Resize handle before this column (between prev and current).
          idx > 0 && !isMobile ? (
            <div
              key={`resize-${column.terminalId}`}
              data-testid="column-resize-handle"
              style={{
                width: 6,
                cursor: "col-resize",
                background: "rgba(255,255,255,0.06)",
                borderRadius: 3,
                alignSelf: "stretch",
                flexShrink: 0,
              }}
              onMouseDown={startDrag(idx - 1)}
            />
          ) : null,
          // Column wrapper.
          <div
            key={column.terminalId}
            data-testid="scrollable-column"
            ref={isActive ? focusedRef : null}
            style={{
              flex: `0 0 ${widthToFlexBasis(column.width, isMobile)}`,
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              alignSelf: "stretch",
              scrollSnapAlign: "start",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {terminal ? (
              <WorkspacePaneLeaf
                terminal={terminal}
                isActive={isActive}
                isController={props.isController}
                deviceId={props.deviceId}
                isMobile={isMobile}
                focusRing={columns.length > 1}
                fitRequestNonce={
                  props.fitRequest?.terminalIds.includes(terminal.id)
                    ? props.fitRequest.nonce
                    : null
                }
                fitRequestShouldFocus={
                  props.fitRequest?.focusTerminalId === terminal.id
                }
                onActiveRef={props.onActiveRef}
                onFitRequestHandled={props.onFitRequestHandled}
                onFocus={props.onFocus}
                onDestroy={props.onDestroy}
                onPaneContextMenu={props.onPaneContextMenu}
                onRequestControl={props.onRequestControl}
                onReleaseControl={props.onReleaseControl}
              />
            ) : null}
          </div>,
        ];
      })}
    </div>
  );
}
