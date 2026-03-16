/**
 * @format
 */

import { AppRegistry, NativeModules, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { resolveFirebaseMessagingInstance } from './src/firebase-messaging-runtime';

const messaging = resolveFirebaseMessagingInstance({
  platformOS: Platform.OS,
  nativeModules: NativeModules,
  loadMessagingModule: () => require('@react-native-firebase/messaging'),
});

messaging?.setBackgroundMessageHandler?.(async () => {});

AppRegistry.registerComponent(appName, () => App);
