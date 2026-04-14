import { isTauri } from "./platform";

const SERVER_URL_KEY = "webmux:server_url";

export function getServerUrl(): string {
  if (!isTauri()) {
    return "";
  }
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(SERVER_URL_KEY) || "";
  }
  return "";
}

export function setServerUrl(url: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(SERVER_URL_KEY, url.replace(/\/+$/, ""));
  }
}

export function hasServerUrl(): boolean {
  return getServerUrl() !== "";
}
