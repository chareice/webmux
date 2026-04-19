export function getLiveTerminalIds(terminals, _maximizedId) {
    return terminals.map((terminal) => terminal.id);
}
export function getTerminalSurfaceMode(_terminalId, _maximizedId) {
    return "live";
}
