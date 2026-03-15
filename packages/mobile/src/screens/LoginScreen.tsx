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
import { getOAuthUrl, setServerUrl } from '../api';
import { colors, commonStyles } from '../theme';

const STORAGE_KEY_LAST_SERVER = '@webmux/last_server_url';

export default function LoginScreen(): React.JSX.Element {
  const { login } = useAuth();
  const [serverUrl, setServerUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Restore last used server URL
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_LAST_SERVER).then(url => {
      if (url) {
        setServerUrlInput(url);
      }
    });
  }, []);

  // Handle deep link callback with token
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const { url } = event;
      // Expected format: webmux://auth?token=xxx
      const match = url.match(/[?&]token=([^&]+)/);
      if (match) {
        const token = decodeURIComponent(match[1]);
        handleTokenReceived(token);
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

  const handleTokenReceived = async (token: string) => {
    setIsLoading(true);
    setError('');
    try {
      const cleanUrl = serverUrl.replace(/\/+$/, '');
      await AsyncStorage.setItem(STORAGE_KEY_LAST_SERVER, cleanUrl);
      await login(cleanUrl, token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    Keyboard.dismiss();
    setError('');

    const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
    if (!cleanUrl) {
      setError('Please enter a server URL');
      return;
    }

    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      setError('URL must start with http:// or https://');
      return;
    }

    setIsLoading(true);
    try {
      setServerUrl(cleanUrl);
      await AsyncStorage.setItem(STORAGE_KEY_LAST_SERVER, cleanUrl);

      const oauthUrl = getOAuthUrl();
      await Linking.openURL(oauthUrl);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to open login page';
      setError(msg);
    } finally {
      setIsLoading(false);
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
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[commonStyles.button, styles.loginButton]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.7}>
            {isLoading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={commonStyles.buttonText}>Login with GitHub</Text>
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
  error: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
  },
});
