import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getServerUrl, getToken } from '../api';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

export default function TerminalScreen({ route }: Props): React.JSX.Element {
  const { agentId, sessionName } = route.params;
  const serverUrl = getServerUrl();
  const token = getToken();

  // Load the webmux web app's terminal page with auth token
  const params = new URLSearchParams({ token });
  if (sessionName) {
    params.set('session', sessionName);
  }
  const uri = `${serverUrl}/agents/${agentId}?${params.toString()}`;

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        startInLoadingState
        originWhitelist={['*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
