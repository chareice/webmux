import { readPanelOpen } from "./panelOpenStorage";
export function createInitialMainLayout() {
    return {
        selectedWorkpathId: "all",
        zoomedTerminalId: null,
        panelOpen: readPanelOpen(true),
    };
}
export function mainLayoutReducer(state, action) {
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
        case "TOGGLE_PANEL":
            return { ...state, panelOpen: !state.panelOpen };
        default: {
            // Exhaustiveness check: TS errors here if a new MainLayoutAction
            // variant is added without a matching case above. At runtime we
            // return state unchanged rather than yielding `undefined`.
            const _exhaustive = action;
            void _exhaustive;
            return state;
        }
    }
}
