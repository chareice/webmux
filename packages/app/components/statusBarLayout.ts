export interface StatusBarLayout {
  showStats: boolean;
  visibleStats: Array<"cpu" | "memory" | "disk">;
  showModeLabel: boolean;
  actionButtonPadding: string;
  machineButtonPadding: string;
  statPadding: string;
  separatorMargin: string;
  sectionGap: number;
}

export function getStatusBarLayout(isMobile: boolean): StatusBarLayout {
  if (isMobile) {
    return {
      showStats: true,
      visibleStats: ["cpu", "memory"],
      showModeLabel: false,
      actionButtonPadding: "1px 5px",
      machineButtonPadding: "0 4px",
      statPadding: "0 3px",
      separatorMargin: "0 4px",
      sectionGap: 4,
    };
  }

  return {
    showStats: true,
    visibleStats: ["cpu", "memory", "disk"],
    showModeLabel: true,
    actionButtonPadding: "1px 6px",
    machineButtonPadding: "0 6px",
    statPadding: "0 4px",
    separatorMargin: "0 6px",
    sectionGap: 6,
  };
}
