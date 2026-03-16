import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFirebaseMessagingInstance,
  type FirebaseMessagingInstance,
} from './firebase-messaging-runtime.ts';

function createMessagingStub(): FirebaseMessagingInstance {
  return {
    onNotificationOpenedApp: () => () => {},
    onMessage: () => () => {},
    onTokenRefresh: () => () => {},
    registerDeviceForRemoteMessages: async () => {},
    getToken: async () => 'token',
    getInitialNotification: async () => null,
    setBackgroundMessageHandler: () => {},
  };
}

test('returns null when Firebase native modules are missing', () => {
  const errors: unknown[] = [];
  const messaging = resolveFirebaseMessagingInstance({
    platformOS: 'android',
    nativeModules: {},
    loadMessagingModule: () => {
      throw new Error('should not load');
    },
    onUnavailable: (error) => {
      errors.push(error);
    },
  });

  assert.equal(messaging, null);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /native modules are unavailable/i);
});

test('returns null when Firebase default app is not configured', () => {
  const errors: unknown[] = [];
  const messaging = resolveFirebaseMessagingInstance({
    platformOS: 'android',
    nativeModules: {
      RNFBAppModule: {},
      RNFBMessagingModule: {},
    },
    loadMessagingModule: () => () => {
      throw new Error("No Firebase App '[DEFAULT]' has been created");
    },
    onUnavailable: (error) => {
      errors.push(error);
    },
  });

  assert.equal(messaging, null);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /No Firebase App '\[DEFAULT\]'/);
});

test('returns the messaging instance when Firebase is available', () => {
  const stub = createMessagingStub();
  const messaging = resolveFirebaseMessagingInstance({
    platformOS: 'android',
    nativeModules: {
      RNFBAppModule: {},
      RNFBMessagingModule: {},
    },
    loadMessagingModule: () => () => stub,
  });

  assert.equal(messaging, stub);
});
