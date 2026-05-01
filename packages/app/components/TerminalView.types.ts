export interface TerminalViewRef {
  sendInput: (data: string) => void;
  sendCommandInput: (data: string) => void;
  fitToContainer: () => void;
  focus: () => void;
  blur: () => void;
  // Forward an image / file picked from a system picker into the terminal
  // session via the existing `image_paste` WS protocol. Returns once the
  // frame has been queued (or rejects with the reason it was skipped).
  sendImageFile: (file: Blob & { name?: string }) => Promise<void>;
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
  onTitleChange?: (title: string) => void;
  /** Platform-specific style object (CSSProperties on web, ViewStyle on native) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
}
