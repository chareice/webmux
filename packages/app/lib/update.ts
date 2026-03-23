import { Alert, Linking, Platform } from "react-native";
import * as Application from "expo-application";

import { getBaseUrl, getToken } from "./api";
import { getUpdateState } from "./update-utils";

interface VersionInfo {
  downloadUrl: string | null;
  latestVersion: string | null;
  minVersion: string | null;
}

export function getCurrentVersionInfo(): {
  buildNumber: string | null;
  version: string;
} {
  return {
    buildNumber: Application.nativeBuildVersion ?? null,
    version: Application.nativeApplicationVersion ?? "0.0.0",
  };
}

export async function checkForUpdate(): Promise<void> {
  if (Platform.OS === "web") {
    return;
  }

  const current = getCurrentVersionInfo();
  const info = await fetchVersionInfo();
  const state = getUpdateState(current.version, info?.latestVersion ?? null);

  if (state.status === "unavailable") {
    Alert.alert("Check for updates", "Version information is unavailable right now.");
    return;
  }

  if (state.status === "current") {
    Alert.alert(
      "Check for updates",
      `Version ${current.version} is already up to date.`,
    );
    return;
  }

  const buttons: Array<{
    onPress?: () => void;
    style?: "cancel";
    text: string;
  }> = [{ style: "cancel", text: "Later" }];

  if (info?.downloadUrl) {
    buttons.push({
      onPress: () => {
        void Linking.openURL(info.downloadUrl!);
      },
      text: "Open download",
    });
  }

  Alert.alert(
    "Update available",
    `Version ${state.latestVersion} is available (current ${current.version}).`,
    buttons,
  );
}

async function fetchVersionInfo(): Promise<VersionInfo | null> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/api/mobile/version`, {
      headers: buildHeaders(),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as VersionInfo;
  } catch {
    return null;
  }
}

function buildHeaders(): Record<string, string> {
  const token = getToken();

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}
