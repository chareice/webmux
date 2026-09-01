const PREFIX = "offdesk:";

// All shipping clients (mobile-web, desktop-Tauri, Android-Tauri) run in a
// WebView or browser context, so localStorage is universally available.
// The earlier Expo Android shell used expo-secure-store; it was retired
// with the .android.tsx tree.
export const storage = {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(PREFIX + key);
  },
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(PREFIX + key, value);
  },
  async remove(key: string): Promise<void> {
    localStorage.removeItem(PREFIX + key);
  },
};
