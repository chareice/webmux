import { isTauri } from "./platform";
const SERVER_URL_KEY = "webmux:server_url";
const DEFAULT_SERVER_URL = "https://webmux.nas.chareice.site";
export function getServerUrl() {
    if (!isTauri()) {
        return "";
    }
    if (typeof localStorage !== "undefined") {
        return localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL;
    }
    return DEFAULT_SERVER_URL;
}
export function getDefaultServerUrl() {
    return DEFAULT_SERVER_URL;
}
export function setServerUrl(url) {
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(SERVER_URL_KEY, url.replace(/\/+$/, ""));
    }
}
export function hasServerUrl() {
    return getServerUrl() !== "";
}
