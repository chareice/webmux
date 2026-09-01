import { isTauri } from "./platform";

const SERVER_URL_KEY = "offdesk:server_url";
const DEFAULT_SERVER_URL = "https://offdesk.nas.chareice.site";

export interface ResolveServerUrlOptions {
  platformOs: string;
  isTauriRuntime: boolean;
  storedUrl: string | null;
  configuredDefaultUrl?: string | null;
}

export function resolveServerUrl({
  platformOs,
  isTauriRuntime,
  storedUrl,
  configuredDefaultUrl,
}: ResolveServerUrlOptions): string {
  if (platformOs === "web" && !isTauriRuntime) {
    return "";
  }
  return (
    storedUrl?.replace(/\/+$/, "") ||
    configuredDefaultUrl?.replace(/\/+$/, "") ||
    DEFAULT_SERVER_URL
  );
}

function getRuntimePlatformOs(): string {
  if (
    typeof navigator !== "undefined" &&
    (navigator as { product?: string }).product === "ReactNative"
  ) {
    return "native";
  }
  return "web";
}

function getConfiguredDefaultServerUrl(): string | null {
  return (
    process.env.EXPO_PUBLIC_OFFDESK_DEFAULT_SERVER_URL ||
    process.env.OFFDESK_DEFAULT_SERVER_URL ||
    null
  );
}

export function getServerUrl(platformOs = getRuntimePlatformOs()): string {
  const storedUrl =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(SERVER_URL_KEY)
      : null;

  return resolveServerUrl({
    platformOs,
    isTauriRuntime: isTauri(),
    storedUrl,
    configuredDefaultUrl: getConfiguredDefaultServerUrl(),
  });
}

export function getDefaultServerUrl(): string {
  return getConfiguredDefaultServerUrl()?.replace(/\/+$/, "") || DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(SERVER_URL_KEY, url.replace(/\/+$/, ""));
  }
}

export function hasServerUrl(): boolean {
  return getServerUrl() !== "";
}
