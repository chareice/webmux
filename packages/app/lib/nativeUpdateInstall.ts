import type { AndroidUpdate } from "./nativeUpdate";

const APK_MIME_TYPE = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export interface InstalledApkIntent {
  fileUri: string;
  contentUri: string;
}

export async function downloadAndOpenAndroidApk(
  update: AndroidUpdate,
): Promise<InstalledApkIntent> {
  const FileSystem = await import("expo-file-system/legacy");
  const IntentLauncher = await import("expo-intent-launcher");

  if (!FileSystem.cacheDirectory) {
    throw new Error("No cache directory is available for APK download");
  }

  const targetUri = `${FileSystem.cacheDirectory}${update.apkName}`;
  const downloaded = await FileSystem.downloadAsync(update.apkUrl, targetUri);
  const contentUri = await FileSystem.getContentUriAsync(downloaded.uri);

  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: APK_MIME_TYPE,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });

  return {
    fileUri: downloaded.uri,
    contentUri,
  };
}
