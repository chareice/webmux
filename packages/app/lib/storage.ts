import { Platform } from "react-native";

import { getStorageKeyForPlatform } from "./storage-utils";

const PREFIX = "webmux:";

export const storage = {
  async get(key: string): Promise<string | null> {
    const prefixed = PREFIX + key;
    if (Platform.OS === "web") {
      return localStorage.getItem(prefixed);
    }
    const SecureStore = require("expo-secure-store");
    return SecureStore.getItemAsync(
      getStorageKeyForPlatform(prefixed, Platform.OS),
    );
  },
  async set(key: string, value: string): Promise<void> {
    const prefixed = PREFIX + key;
    if (Platform.OS === "web") {
      localStorage.setItem(prefixed, value);
      return;
    }
    const SecureStore = require("expo-secure-store");
    await SecureStore.setItemAsync(
      getStorageKeyForPlatform(prefixed, Platform.OS),
      value,
    );
  },
  async remove(key: string): Promise<void> {
    const prefixed = PREFIX + key;
    if (Platform.OS === "web") {
      localStorage.removeItem(prefixed);
      return;
    }
    const SecureStore = require("expo-secure-store");
    await SecureStore.deleteItemAsync(
      getStorageKeyForPlatform(prefixed, Platform.OS),
    );
  },
};
