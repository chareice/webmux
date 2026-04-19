export function createTerminalReconnectController({ delayMs, openReadyState, onReconnect, schedule, cancel, }) {
    let reconnectTimer = null;
    const cancelReconnect = () => {
        if (reconnectTimer === null) {
            return;
        }
        cancel(reconnectTimer);
        reconnectTimer = null;
    };
    const scheduleReconnect = () => {
        if (reconnectTimer !== null) {
            return;
        }
        reconnectTimer = schedule(() => {
            reconnectTimer = null;
            onReconnect();
        }, delayMs);
    };
    return {
        cancelReconnect,
        handleSocketOpen() {
            cancelReconnect();
        },
        handleVisibilityChange(visibilityState, readyState) {
            if (visibilityState !== "visible" || readyState === openReadyState) {
                return;
            }
            scheduleReconnect();
        },
        hasPendingReconnect() {
            return reconnectTimer !== null;
        },
        scheduleReconnect,
    };
}
