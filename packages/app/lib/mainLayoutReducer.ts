export type WorkpathSelection = "all" | string;

export interface MainLayoutState {
  selectedWorkpathId: WorkpathSelection;
  zoomedTerminalId: string | null;
  columnForceExpanded: boolean;
}

export type MainLayoutAction =
  | { type: "SELECT_WORKPATH"; workpathId: WorkpathSelection }
  | { type: "ZOOM_TERMINAL"; terminalId: string }
  | { type: "UNZOOM" }
  | { type: "TERMINAL_CREATED"; terminalId: string; workpathId: WorkpathSelection }
  | { type: "TERMINAL_DESTROYED"; terminalId: string }
  | { type: "WORKPATH_DELETED"; workpathId: string }
  | { type: "TOGGLE_NAV_FORCE_EXPANDED" };

export function createInitialMainLayout(): MainLayoutState {
  return {
    selectedWorkpathId: "all",
    zoomedTerminalId: null,
    columnForceExpanded: false,
  };
}

export function mainLayoutReducer(
  state: MainLayoutState,
  action: MainLayoutAction,
): MainLayoutState {
  switch (action.type) {
    case "SELECT_WORKPATH":
      return {
        ...state,
        selectedWorkpathId: action.workpathId,
        zoomedTerminalId: null,
      };
    case "ZOOM_TERMINAL":
      return { ...state, zoomedTerminalId: action.terminalId };
    case "UNZOOM":
      return { ...state, zoomedTerminalId: null };
    case "TERMINAL_CREATED":
      return {
        ...state,
        selectedWorkpathId: action.workpathId,
        zoomedTerminalId: action.terminalId,
      };
    case "TERMINAL_DESTROYED":
      if (state.zoomedTerminalId === action.terminalId) {
        return { ...state, zoomedTerminalId: null };
      }
      return state;
    case "WORKPATH_DELETED":
      if (state.selectedWorkpathId === action.workpathId) {
        return { ...state, selectedWorkpathId: "all", zoomedTerminalId: null };
      }
      return state;
    case "TOGGLE_NAV_FORCE_EXPANDED":
      return { ...state, columnForceExpanded: !state.columnForceExpanded };
    default: {
      // Exhaustiveness check: TS errors here if a new MainLayoutAction
      // variant is added without a matching case above. At runtime we
      // return state unchanged rather than yielding `undefined`.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
