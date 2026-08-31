import type { TerminalInfo } from "@offdesk/shared";

const LEGACY_TERMINAL_TITLE = /^Terminal [0-9a-f]{8}$/;

export function displayTerminalTitle(terminal: TerminalInfo): string {
  const title = terminal.title?.trim();
  return title && !LEGACY_TERMINAL_TITLE.test(title) ? title : "shell";
}
