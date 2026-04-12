import { Platform } from "react-native";

const DEVICE_ID_KEY = "tc-device-id";
let cachedDeviceIdPromise: Promise<string> | null = null;

function getWebDeviceId(): string {
  let id = sessionStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function generateNativeDeviceId(): string {
  return `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getNativeDeviceId(): Promise<string> {
  const SecureStore = await import("expo-secure-store");

  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = generateNativeDeviceId();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }

  return id;
}

export function getPersistentDeviceId(): Promise<string> {
  if (!cachedDeviceIdPromise) {
    cachedDeviceIdPromise =
      Platform.OS === "web"
        ? Promise.resolve(getWebDeviceId())
        : getNativeDeviceId();
  }

  return cachedDeviceIdPromise;
}
