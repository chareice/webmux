import { generateDeviceId } from "./deviceIdShared";

const DEVICE_ID_KEY = "tc-device-id";
let cachedDeviceIdPromise: Promise<string> | null = null;

// Device IDs are scoped to a browser/WebView session (sessionStorage), so a
// re-launch issues a fresh ID. The hub treats the ID as opaque and keeps the
// terminal session alive across reconnects from the same ID, which is all
// we need for control hand-off.
export function getPersistentDeviceId(): Promise<string> {
  if (!cachedDeviceIdPromise) {
    cachedDeviceIdPromise = Promise.resolve(getDeviceId());
  }
  return cachedDeviceIdPromise;
}

function getDeviceId(): string {
  if (typeof sessionStorage === "undefined") {
    return generateDeviceId();
  }
  let id = sessionStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateDeviceId();
    sessionStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
