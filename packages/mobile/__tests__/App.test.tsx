/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('react-native', () => {
  const React = require('react');

  return {
    ActivityIndicator: () => React.createElement('ActivityIndicator'),
    StatusBar: () => null,
    Platform: {
      OS: 'android',
      Version: 34,
      constants: {},
      select: <T,>(options: { android?: T; ios?: T; default?: T }) =>
        options.android ?? options.default,
    },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) => React.createElement('Text', null, children),
    View: ({ children }: { children?: React.ReactNode }) => React.createElement('View', null, children),
  };
});

jest.mock('../src/store', () => {
  const React = require('react');

  return {
    AuthContext: React.createContext({
      serverUrl: 'https://example.com',
      token: 'token',
      isLoading: false,
      isLoggedIn: true,
      login: async () => {},
      logout: async () => {},
      restoreSession: async () => {},
    }),
    useAuthProvider: () => ({
      serverUrl: 'https://example.com',
      token: 'token',
      isLoading: false,
      isLoggedIn: true,
      login: async () => {},
      logout: async () => {},
      restoreSession: async () => {},
    }),
  };
});

jest.mock('../src/push-notifications', () => ({
  usePushNotifications: () => {},
}));

jest.mock('../src/navigation-ref', () => ({
  flushPendingThreadDetail: () => {},
  navigationRef: { current: null },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: ({ component: Component }: { component: React.ComponentType }) => <Component />,
  }),
}));

function mockCreateScreen(label: string) {
  return () => {
    const { Text } = require('react-native');
    return <Text>{label}</Text>;
  };
}

jest.mock('../src/screens/LoginScreen', () => mockCreateScreen('LoginScreen'));
jest.mock('../src/screens/RunsScreen', () => mockCreateScreen('ThreadsScreen'));
jest.mock('../src/screens/AgentsScreen', () => mockCreateScreen('AgentsScreen'));
jest.mock('../src/screens/NewRunScreen', () => mockCreateScreen('NewThreadScreen'));
jest.mock('../src/screens/RunDetailScreen', () => mockCreateScreen('ThreadDetailScreen'));
jest.mock('../src/screens/ThreadContentScreen', () => mockCreateScreen('ThreadContentScreen'));
jest.mock('../src/screens/TerminalScreen', () => mockCreateScreen('TerminalScreen'));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
