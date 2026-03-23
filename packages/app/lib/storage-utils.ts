const SECURE_STORE_SAFE_KEY = /^[A-Za-z0-9._-]+$/;

export function getStorageKeyForPlatform(
  key: string,
  platformOs: string,
): string {
  if (platformOs === "web" || SECURE_STORE_SAFE_KEY.test(key)) {
    return key;
  }

  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}
