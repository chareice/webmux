import { router } from 'expo-router'
import { Alert, Platform } from 'react-native'
import { registerPushDevice, unregisterPushDevice } from './api'
import { buildThreadRoute, parseThreadNotificationTarget } from './notification-utils'
import { storage } from './storage'

const INSTALLATION_ID_KEY = 'webmux:push_installation_id'

let _installationId: string | null = null
let _pushCleanup: (() => void) | null = null
let _lastHandledNotificationId: string | null = null

export async function registerForPush(): Promise<() => void> {
  if (Platform.OS === 'web') {
    return () => {}
  }

  if (_pushCleanup) {
    return _pushCleanup
  }

  const Notifications = require('expo-notifications')
  const Device = require('expo-device')

  if (!Device.isDevice) {
    return () => {}
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    }),
  })

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: 'default',
    })
  }

  const installationId = await getOrCreateInstallationId()
  _installationId = installationId

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') {
    return () => {}
  }

  const tokenData = await Notifications.getDevicePushTokenAsync()
  await registerCurrentPushDevice(
    installationId,
    tokenData.data,
    Device.deviceName ?? 'Android device',
  )

  const receivedSubscription = Notifications.addNotificationReceivedListener(
    (notification: { request: { content: { body?: string; data: unknown; title?: string } } }) => {
      const target = parseThreadNotificationTarget(notification.request.content.data)
      if (!target) {
        return
      }

      const title = notification.request.content.title?.trim() || 'Thread update'
      const body =
        notification.request.content.body?.trim() ||
        'A Webmux thread finished running.'

      Alert.alert(title, body, [
        {
          style: 'cancel',
          text: 'Later',
        },
        {
          onPress: () => {
            navigateToThread(target)
          },
          text: 'Open',
        },
      ])
    },
  )

  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response: { notification: { request: { content: { data: unknown }; identifier: string } } }) => {
      const identifier = response.notification.request.identifier
      if (identifier && identifier === _lastHandledNotificationId) {
        return
      }

      _lastHandledNotificationId = identifier
      const target = parseThreadNotificationTarget(response.notification.request.content.data)
      if (!target) {
        return
      }

      navigateToThread(target)
      Notifications.clearLastNotificationResponse()
    },
  )

  const tokenSubscription = Notifications.addPushTokenListener(
    (nextToken: { data: string }) => {
      void registerCurrentPushDevice(
        installationId,
        nextToken.data,
        Device.deviceName ?? 'Android device',
      )
    },
  )

  const lastResponse = await Notifications.getLastNotificationResponseAsync()
  if (lastResponse) {
    const target = parseThreadNotificationTarget(lastResponse.notification.request.content.data)
    if (target) {
      _lastHandledNotificationId = lastResponse.notification.request.identifier
      navigateToThread(target)
      Notifications.clearLastNotificationResponse()
    }
  }

  _pushCleanup = () => {
    receivedSubscription.remove()
    responseSubscription.remove()
    tokenSubscription.remove()
    _pushCleanup = null
  }

  return _pushCleanup
}

export async function unregisterPush(): Promise<void> {
  _pushCleanup?.()

  const installationId = _installationId ?? await storage.get(INSTALLATION_ID_KEY)
  if (!installationId) return
  try {
    await unregisterPushDevice(installationId)
  } catch {
    // ignore errors during unregister
  }
  _installationId = null
}

async function getOrCreateInstallationId(): Promise<string> {
  const existing = await storage.get(INSTALLATION_ID_KEY)
  if (existing) {
    return existing
  }

  const next = `android-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
  await storage.set(INSTALLATION_ID_KEY, next)
  return next
}

async function registerCurrentPushDevice(
  installationId: string,
  pushToken: string,
  deviceName: string,
): Promise<void> {
  await registerPushDevice({
    deviceName,
    installationId,
    platform: 'android',
    provider: 'fcm',
    pushToken,
  })
}

function navigateToThread(target: {
  agentId: string
  threadId: string
}): void {
  router.push(buildThreadRoute(target) as never)
}
