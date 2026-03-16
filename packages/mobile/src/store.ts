import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setServerUrl, setToken } from './api';
import { unregisterCurrentPushDevice } from './push-notifications';
import { normalizeServerUrl } from './server-url';

const STORAGE_KEY_SERVER_URL = '@webmux/server_url';
const STORAGE_KEY_TOKEN = '@webmux/token';

export interface AuthState {
  serverUrl: string;
  token: string;
  isLoading: boolean;
  isLoggedIn: boolean;
}

export interface AuthActions {
  login: (serverUrl: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export type AuthContextType = AuthState & AuthActions;

export const AuthContext = createContext<AuthContextType>({
  serverUrl: '',
  token: '',
  isLoading: true,
  isLoggedIn: false,
  login: async () => {},
  logout: async () => {},
  restoreSession: async () => {},
});

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthContextType {
  const [serverUrl, setServerUrlState] = useState('');
  const [token, setTokenState] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const isLoggedIn = !!token && !!serverUrl;

  const login = useCallback(async (url: string, jwt: string) => {
    const cleanUrl = normalizeServerUrl(url);
    setServerUrlState(cleanUrl);
    setTokenState(jwt);
    setServerUrl(cleanUrl);
    setToken(jwt);

    await AsyncStorage.multiSet([
      [STORAGE_KEY_SERVER_URL, cleanUrl],
      [STORAGE_KEY_TOKEN, jwt],
    ]);
  }, []);

  const logout = useCallback(async () => {
    await unregisterCurrentPushDevice();
    setServerUrlState('');
    setTokenState('');
    setServerUrl('');
    setToken('');

    await AsyncStorage.multiRemove([STORAGE_KEY_SERVER_URL, STORAGE_KEY_TOKEN]);
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const values = await AsyncStorage.multiGet([
        STORAGE_KEY_SERVER_URL,
        STORAGE_KEY_TOKEN,
      ]);

      const storedUrl = values[0][1];
      const storedToken = values[1][1];

      if (storedUrl && storedToken) {
        const cleanUrl = normalizeServerUrl(storedUrl);
        setServerUrlState(cleanUrl);
        setTokenState(storedToken);
        setServerUrl(cleanUrl);
        setToken(storedToken);

        if (cleanUrl !== storedUrl) {
          await AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, cleanUrl);
        }
      }
    } catch {
      // Ignore storage errors on restore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  return {
    serverUrl,
    token,
    isLoading,
    isLoggedIn,
    login,
    logout,
    restoreSession,
  };
}
