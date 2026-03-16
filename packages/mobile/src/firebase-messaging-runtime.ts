export type RemoteMessage = {
  data?: Record<string, string | undefined>;
  notification?: {
    title?: string | null;
    body?: string | null;
  };
};

export type FirebaseMessagingInstance = {
  onNotificationOpenedApp(
    listener: (message: RemoteMessage | null) => void,
  ): () => void;
  onMessage(listener: (message: RemoteMessage) => void): () => void;
  onTokenRefresh(listener: (token: string) => void): () => void;
  registerDeviceForRemoteMessages(): Promise<void>;
  getToken(): Promise<string>;
  getInitialNotification(): Promise<RemoteMessage | null>;
  setBackgroundMessageHandler?(
    handler: (message: RemoteMessage) => Promise<void>,
  ): void;
};

type FirebaseMessagingModule =
  | (() => FirebaseMessagingInstance)
  | {
      default?: () => FirebaseMessagingInstance;
    };

type ResolveFirebaseMessagingOptions = {
  platformOS: string;
  nativeModules: Record<string, unknown>;
  loadMessagingModule: () => FirebaseMessagingModule;
  onUnavailable?: (error: unknown) => void;
};

export function resolveFirebaseMessagingInstance(
  options: ResolveFirebaseMessagingOptions,
): FirebaseMessagingInstance | null {
  const {
    platformOS,
    nativeModules,
    loadMessagingModule,
    onUnavailable,
  } = options;

  if (platformOS !== 'android') {
    return null;
  }

  if (!nativeModules.RNFBAppModule || !nativeModules.RNFBMessagingModule) {
    onUnavailable?.(new Error('Firebase native modules are unavailable.'));
    return null;
  }

  try {
    const loaded = loadMessagingModule();
    const factory =
      typeof loaded === 'function'
        ? loaded
        : typeof loaded.default === 'function'
          ? loaded.default
          : null;

    if (!factory) {
      throw new Error('Firebase messaging module is invalid.');
    }

    return factory();
  } catch (error) {
    onUnavailable?.(error);
    return null;
  }
}
