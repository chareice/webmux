export interface StatusBarLayout {
  showStats: boolean;
  showModeLabel: boolean;
  actionButtonPadding: string;
  machineButtonPadding: string;
  sectionGap: number;
}

export function getStatusBarLayout(isMobile: boolean): StatusBarLayout {
  if (isMobile) {
    return {
      showStats: false,
      showModeLabel: false,
      actionButtonPadding: "1px 5px",
      machineButtonPadding: "0 4px",
      sectionGap: 4,
    };
  }

  return {
    showStats: true,
    showModeLabel: true,
    actionButtonPadding: "1px 6px",
    machineButtonPadding: "0 6px",
    sectionGap: 6,
  };
}
