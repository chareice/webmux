import { Alert, NativeModules } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { getServerUrl, getToken } from './api';
import { buildApiHeaders } from './api-request';

const { ApkInstaller } = NativeModules as {
  ApkInstaller: {
    downloadAndInstall: (url: string, fileName: string) => Promise<boolean>;
  };
};

interface VersionInfo {
  latestVersion: string | null;
  downloadUrl: string | null;
  minVersion: string | null;
}

/**
 * Compare two semantic version strings.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b.
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }

  return 0;
}

async function fetchVersionInfo(): Promise<VersionInfo | null> {
  const serverUrl = getServerUrl();
  if (!serverUrl) return null;

  try {
    const response = await fetch(`${serverUrl}/api/mobile/version`, {
      headers: buildApiHeaders(undefined, getToken()),
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function startDownloadAndInstall(downloadUrl: string, version: string): void {
  const fileName = `webmux-v${version}.apk`;

  Alert.alert('开始下载', '正在后台下载，完成后将自动弹出安装界面。');

  ApkInstaller.downloadAndInstall(downloadUrl, fileName).catch(
    (error: Error) => {
      Alert.alert('下载失败', error.message || '请稍后重试。');
    },
  );
}

/**
 * Manually check for app updates.
 * Shows an alert with the result (new version available, already up-to-date, or error).
 */
export async function checkForUpdate(): Promise<void> {
  const info = await fetchVersionInfo();

  if (!info?.latestVersion) {
    Alert.alert('检查更新', '无法获取版本信息，请稍后重试。');
    return;
  }

  const currentVersion = DeviceInfo.getVersion();
  const comparison = compareVersions(currentVersion, info.latestVersion);

  if (comparison >= 0) {
    Alert.alert('检查更新', `当前版本 ${currentVersion} 已是最新。`);
    return;
  }

  const buttons: Array<{ text: string; style?: string; onPress?: () => void }> = [
    { text: '稍后', style: 'cancel' },
  ];

  if (info.downloadUrl) {
    buttons.push({
      text: '下载更新',
      onPress: () => startDownloadAndInstall(info.downloadUrl!, info.latestVersion!),
    });
  }

  Alert.alert(
    '发现新版本',
    `新版本 ${info.latestVersion} 已可用（当前 ${currentVersion}）。`,
    buttons as Parameters<typeof Alert.alert>[2],
  );
}
