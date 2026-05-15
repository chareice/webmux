import type { IClipboardProvider } from "@xterm/addon-clipboard";

interface ClipboardBridge {
  readText: () => string | Promise<string>;
  writeText: (text: string) => void | Promise<void>;
}

const SYSTEM_CLIPBOARD = "c";

export function createTerminalClipboardProvider(
  clipboard: ClipboardBridge,
): IClipboardProvider {
  return {
    async readText(selection) {
      if (selection !== SYSTEM_CLIPBOARD) return "";
      return clipboard.readText();
    },

    async writeText(selection, text) {
      if (selection !== SYSTEM_CLIPBOARD) return;
      await clipboard.writeText(text);
    },
  };
}
