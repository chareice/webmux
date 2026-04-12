interface MachineBookmarkLoadState {
  expanded: boolean;
  loaded: boolean;
}

export function shouldLoadMachineBookmarks({
  expanded,
  loaded,
}: MachineBookmarkLoadState): boolean {
  return expanded && !loaded;
}
