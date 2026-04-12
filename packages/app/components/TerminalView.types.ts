export interface TerminalViewRef {
  sendInput: (data: string) => void;
  sendCommandInput: (data: string) => void;
  sendImagePaste: (base64: string, mime: string) => void;
  fitToContainer: () => void;
  focus: () => void;
}

export interface TerminalViewProps {
  machineId: string;
  terminalId: string;
  wsUrl: string;
  cols: number;
  rows: number;
  isController?: boolean;
  canResizeTerminal?: boolean;
  onTitleChange?: (title: string) => void;
  /** Platform-specific style object (CSSProperties on web, ViewStyle on native) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
}
