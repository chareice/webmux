import { Platform } from 'react-native'
import { registerPushDevice, unregisterPushDevice } from './api'

let _installationId: string | null = null

export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web') return

  const Notifications = require('expo-notifications')
  const Device = require('expo-device')

  if (!Device.isDevice) return

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') return

  // Get FCM token
  const tokenData = await Notifications.getDevicePushTokenAsync()
  const fcmToken = tokenData.data

  // Generate installation ID
  const installationId = `android-${Date.now()}`
  _installationId = installationId

  await registerPushDevice({
    installationId,
    platform: 'android',
    provider: 'fcm',
    pushToken: fcmToken,
  })
}

export async function unregisterPush(): Promise<void> {
  if (!_installationId) return
  try {
    await unregisterPushDevice(_installationId)
  } catch {
    // ignore errors during unregister
  }
  _installationId = null
}
