import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthContext, useAuthProvider } from './src/store';
import { colors } from './src/theme';
import type { RootStackParamList } from './src/navigation';
import LoginScreen from './src/screens/LoginScreen';
import RunsScreen from './src/screens/RunsScreen';
import NewRunScreen from './src/screens/NewRunScreen';
import RunDetailScreen from './src/screens/RunDetailScreen';
import TerminalScreen from './src/screens/TerminalScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '600' as const },
  contentStyle: { backgroundColor: colors.background },
  animation: 'slide_from_right' as const,
};

function AppNavigator(): React.JSX.Element {
  const auth = React.useContext(AuthContext);

  if (auth.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {!auth.isLoggedIn ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen
            name="Runs"
            component={RunsScreen}
            options={{ title: 'Runs', headerLargeTitle: true }}
          />
          <Stack.Screen
            name="NewRun"
            component={NewRunScreen}
            options={{ title: 'New Run' }}
          />
          <Stack.Screen
            name="RunDetail"
            component={RunDetailScreen}
            options={{ title: 'Run Detail' }}
          />
          <Stack.Screen
            name="Terminal"
            component={TerminalScreen}
            options={{ title: 'Terminal' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

function App(): React.JSX.Element {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <NavigationContainer
          theme={{
            dark: true,
            colors: {
              primary: colors.accent,
              background: colors.background,
              card: colors.surface,
              text: colors.text,
              border: colors.border,
              notification: colors.accent,
            },
            fonts: {
              regular: { fontFamily: 'System', fontWeight: '400' },
              medium: { fontFamily: 'System', fontWeight: '500' },
              bold: { fontFamily: 'System', fontWeight: '700' },
              heavy: { fontFamily: 'System', fontWeight: '900' },
            },
          }}>
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </AuthContext.Provider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});

export default App;
