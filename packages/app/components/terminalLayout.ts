export const MOBILE_STATUS_BAR_HEIGHT = 24;

export function getMaximizedTerminalFrame(isMobile: boolean) {
  if (isMobile) {
    return {
      top: 0,
      left: 0,
      width: "100vw",
      height: `calc(100dvh - ${MOBILE_STATUS_BAR_HEIGHT}px)`,
    };
  }

  return {
    top: "5vh",
    left: "5vw",
    width: "90vw",
    height: "90vh",
  };
}

export function getMaximizedBackdropStyle(isMobile: boolean) {
  return {
    top: 0,
    left: 0,
    right: 0,
    bottom: isMobile ? MOBILE_STATUS_BAR_HEIGHT : 0,
  };
}
