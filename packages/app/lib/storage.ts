import { Platform } from 'react-native'

import { getStorageKeyForPlatform } from './storage-utils'

export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key)
    }
    const SecureStore = require('expo-secure-store')
    return SecureStore.getItemAsync(getStorageKeyForPlatform(key, Platform.OS))
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value)
      return
    }
    const SecureStore = require('expo-secure-store')
    await SecureStore.setItemAsync(
      getStorageKeyForPlatform(key, Platform.OS),
      value,
    )
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key)
      return
    }
    const SecureStore = require('expo-secure-store')
    await SecureStore.deleteItemAsync(
      getStorageKeyForPlatform(key, Platform.OS),
    )
  },
}
