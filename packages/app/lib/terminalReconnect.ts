export interface TerminalReconnectController {
  cancelReconnect: () => void;
  handleSocketOpen: () => void;
  handleVisibilityChange: (visibilityState: string, readyState: number) => void;
  hasPendingReconnect: () => boolean;
  scheduleReconnect: () => void;
}

interface TerminalReconnectControllerOptions<TimerHandle> {
  delayMs: number;
  openReadyState: number;
  onReconnect: () => void;
  schedule: (callback: () => void, delayMs: number) => TimerHandle;
  cancel: (timerHandle: TimerHandle) => void;
}

export function createTerminalReconnectController<TimerHandle>({
  delayMs,
  openReadyState,
  onReconnect,
  schedule,
  cancel,
}: TerminalReconnectControllerOptions<TimerHandle>): TerminalReconnectController {
  let reconnectTimer: TimerHandle | null = null;

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
