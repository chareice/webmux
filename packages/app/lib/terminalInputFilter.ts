const DEVICE_ATTRIBUTES_RESPONSE_RE = /\x1b\[[?>][0-9;]*c/g;

export function filterBrowserGeneratedTerminalInput(data: string): string {
  return data.replace(DEVICE_ATTRIBUTES_RESPONSE_RE, "");
}
