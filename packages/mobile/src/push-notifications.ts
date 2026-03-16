import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, NativeModules, PermissionsAndroid, Platform } from 'react-native';

import { registerPushDevice, unregisterPushDevice } from './api';
import {
  resolveFirebaseMessagingInstance,
  type FirebaseMessagingInstance,
  type RemoteMessage,
} from './firebase-messaging-runtime';
import { openThreadDetail } from './navigation-ref';
import { parseThreadNotificationTarget } from './notification-route';

const STORAGE_KEY_INSTALLATION_ID = '@webmux/push_installation_id';

export function usePushNotifications(isLoggedIn: boolean): void {
  React.useEffect(() => {
    if (!isLoggedIn || Platform.OS !== 'android') {
      return;
    }

    const messaging = getFirebaseMessaging();
    if (!messaging) {
      return;
    }

    let disposed = false;
    const unsubscribeOpen = messaging.onNotificationOpenedApp((message) => {
      handleThreadNotificationOpen(message);
    });
    const unsubscribeForeground = messaging.onMessage((message) => {
      showForegroundNotification(message);
    });
    const unsubscribeRefresh = messaging.onTokenRefresh((token) => {
      void registerCurrentPushDevice(token);
    });

    void (async () => {
      const permissionGranted = await ensureNotificationPermission();
      if (!permissionGranted || disposed) {
        return;
      }

      try {
        await messaging.registerDeviceForRemoteMessages();
        const token = await messaging.getToken();
        if (disposed || !token) {
          return;
        }

        await registerCurrentPushDevice(token);
      } catch (error) {
        console.warn('Push notifications are unavailable on this build.', error);
      }

      try {
        const initialMessage = await messaging.getInitialNotification();
        if (!disposed) {
          handleThreadNotificationOpen(initialMessage);
        }
      } catch (error) {
        console.warn('Failed to read the initial push notification.', error);
      }
    })();

    return () => {
      disposed = true;
      unsubscribeOpen();
      unsubscribeForeground();
      unsubscribeRefresh();
    };
  }, [isLoggedIn]);
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    const installationId = await getInstallationId();
    await unregisterPushDevice(installationId);
  } catch (error) {
    console.warn('Failed to unregister the Android push device.', error);
  }
}

async function registerCurrentPushDevice(pushToken: string): Promise<void> {
  const installationId = await getInstallationId();
  await registerPushDevice({
    installationId,
    platform: 'android',
    provider: 'fcm',
    pushToken,
    deviceName: buildDeviceName(),
  });
}

function handleThreadNotificationOpen(
  message: RemoteMessage | null,
): void {
  const target = parseThreadNotificationTarget(message?.data);
  if (target) {
    openThreadDetail(target);
  }
}

function showForegroundNotification(
  message: RemoteMessage,
): void {
  const target = parseThreadNotificationTarget(message.data);
  const title = message.notification?.title?.trim() || 'Thread update';
  const body =
    message.notification?.body?.trim() || 'A Webmux thread finished running.';

  Alert.alert(title, body, [
    {
      text: 'Later',
      style: 'cancel',
    },
    {
      text: target ? 'Open' : 'OK',
      onPress: () => {
        if (target) {
          openThreadDetail(target);
        }
      },
    },
  ]);
}

function getFirebaseMessaging(): FirebaseMessagingInstance | null {
  return resolveFirebaseMessagingInstance({
    platformOS: Platform.OS,
    nativeModules: NativeModules as Record<string, unknown>,
    loadMessagingModule: () => require('@react-native-firebase/messaging'),
    onUnavailable: (error) => {
      console.warn('Push notifications are unavailable on this build.', error);
    },
  });
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (Platform.Version < 33) {
    return true;
  }

  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return true;
  }

  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_KEY_INSTALLATION_ID);
  if (existing) {
    return existing;
  }

  const next = `android-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  await AsyncStorage.setItem(STORAGE_KEY_INSTALLATION_ID, next);
  return next;
}

function buildDeviceName(): string {
  const constants = Platform.constants as { Brand?: string; Model?: string };
  const brand = constants.Brand?.trim();
  const model = constants.Model?.trim();

  return [brand, model].filter(Boolean).join(' ') || 'Android device';
}
