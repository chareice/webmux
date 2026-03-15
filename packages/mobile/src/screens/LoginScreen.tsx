import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../store';
import { getOAuthUrl, OAuthProvider, setServerUrl } from '../api';
import { normalizeServerUrl } from '../server-url';
import { colors, commonStyles } from '../theme';

const STORAGE_KEY_LAST_SERVER = '@webmux/last_server_url';

export default function LoginScreen(): React.JSX.Element {
  const { login } = useAuth();
  const [serverUrl, setServerUrlInput] = useState('');
  const [activeProvider, setActiveProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState('');

  // Restore last used server URL
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_LAST_SERVER).then(url => {
      if (url) {
        setServerUrlInput(normalizeServerUrl(url));
      }
    });
  }, []);

  // Handle deep link callback with token
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const parsed = new URL(event.url);
      const token = parsed.searchParams.get('token');
      if (token) {
        const redirectedServerUrl = parsed.searchParams.get('server');
        const provider = parsed.searchParams.get('provider');
        void handleTokenReceived(
          token,
          redirectedServerUrl ?? serverUrl,
          provider === 'google' ? 'google' : 'github',
        );
      }
    };

    // Check if app was opened via deep link
    Linking.getInitialURL().then(url => {
      if (url) {
        handleUrl({ url });
      }
    });

    const subscription = Linking.addEventListener('url', handleUrl);
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  const handleTokenReceived = async (
    token: string,
    incomingServerUrl: string,
    provider: OAuthProvider,
  ) => {
    setActiveProvider(provider);
    setError('');
    try {
      const cleanUrl = normalizeServerUrl(incomingServerUrl);
      await AsyncStorage.setItem(STORAGE_KEY_LAST_SERVER, cleanUrl);
      await login(cleanUrl, token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      setError(msg);
    } finally {
      setActiveProvider(null);
    }
  };

  const handleLogin = async (provider: OAuthProvider) => {
    Keyboard.dismiss();
    setError('');

    const cleanUrl = normalizeServerUrl(serverUrl);
    if (!cleanUrl) {
      setError('Please enter a server URL');
      return;
    }

    try {
      const parsedUrl = new URL(cleanUrl);
      if (!/^https?:$/.test(parsedUrl.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      setError('Please enter a valid server URL');
      return;
    }

    setActiveProvider(provider);
    try {
      setServerUrlInput(cleanUrl);
      setServerUrl(cleanUrl);
      await AsyncStorage.setItem(STORAGE_KEY_LAST_SERVER, cleanUrl);

      const oauthUrl = getOAuthUrl(provider);
      await Linking.openURL(oauthUrl);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to open login page';
      setError(msg);
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>webmux</Text>
        <Text style={styles.subtitle}>AI Coding Run Manager</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={commonStyles.input}
            placeholder="https://webmux.example.com"
            placeholderTextColor={colors.textSecondary}
            value={serverUrl}
            onChangeText={setServerUrlInput}
            onBlur={() => {
              const cleanUrl = normalizeServerUrl(serverUrl);
              if (cleanUrl) {
                setServerUrlInput(cleanUrl);
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void handleLogin('github')}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[commonStyles.button, styles.loginButton]}
            onPress={() => void handleLogin('github')}
            disabled={activeProvider !== null}
            activeOpacity={0.7}>
            {activeProvider === 'github' ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={commonStyles.buttonText}>Login with GitHub</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[commonStyles.button, styles.googleButton]}
            onPress={() => void handleLogin('google')}
            disabled={activeProvider !== null}
            activeOpacity={0.7}>
            {activeProvider === 'google' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.googleButtonText}>Login with Google</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 32,
  },
  title: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 48,
  },
  form: {
    gap: 16,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: -8,
  },
  loginButton: {
    marginTop: 8,
  },
  googleButton: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
  },
});
