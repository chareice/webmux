import { isBundledOrigin, isTauri } from "./platform";

const SERVER_URL_KEY = "offdesk:server_url";
// No built-in hub. A hub is someone's own machine; guessing one here is how
// the mobile app ended up talking to its author's NAS. Builds that want a
// preset set OFFDESK_DEFAULT_SERVER_URL.
const DEFAULT_SERVER_URL = "";

export interface ResolveServerUrlOptions {
  platformOs: string;
  isTauriRuntime: boolean;
  storedUrl: string | null;
  configuredDefaultUrl?: string | null;
  /**
   * Whether this page came from the app's bundled assets. Pages a hub served
   * belong to that hub, whether they are in a browser tab or inside the
   * mobile app's WebView.
   */
  isBundledOrigin?: boolean;
}

export function resolveServerUrl({
  platformOs,
  isTauriRuntime,
  storedUrl,
  configuredDefaultUrl,
  isBundledOrigin = true,
}: ResolveServerUrlOptions): string {
  if (platformOs === "web" && (!isTauriRuntime || !isBundledOrigin)) {
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
    isBundledOrigin: isBundledOrigin(),
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
