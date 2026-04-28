export interface TerminalViewRef {
  sendInput: (data: string) => void;
  sendCommandInput: (data: string) => void;
  fitToContainer: () => void;
  focus: () => void;
}

export interface TerminalOutputSource {
  subscribe: (onChunk: (chunk: Uint8Array) => void) => () => void;
}

export interface TerminalViewProps {
  machineId: string;
  terminalId: string;
  wsUrl?: string;
  outputSource?: TerminalOutputSource | null;
  cols: number;
  rows: number;
  displayMode?: "card" | "immersive";
  isController?: boolean;
  canResizeTerminal?: boolean;
  suppressAutoFitUntil?: number;
  onTitleChange?: (title: string) => void;
  /** Platform-specific style object (CSSProperties on web, ViewStyle on native) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
}
