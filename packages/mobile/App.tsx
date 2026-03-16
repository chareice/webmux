import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AuthContext, useAuthProvider } from './src/store';
import { flushPendingThreadDetail, navigationRef } from './src/navigation-ref';
import { usePushNotifications } from './src/push-notifications';
import { colors } from './src/theme';
import type { MainTabParamList, RootStackParamList } from './src/navigation';
import LoginScreen from './src/screens/LoginScreen';
import ThreadsScreen from './src/screens/RunsScreen';
import AgentsScreen from './src/screens/AgentsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import NewThreadScreen from './src/screens/NewRunScreen';
import ThreadDetailScreen from './src/screens/RunDetailScreen';
import ThreadContentScreen from './src/screens/ThreadContentScreen';
import TerminalScreen from './src/screens/TerminalScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '600' as const },
  contentStyle: { backgroundColor: colors.background },
  animation: 'slide_from_right' as const,
};

// Pure View-based tab icons (no native icon library needed)
function ThreadsIcon({ color }: { color: string }) {
  // Robot face: rounded square head + two eyes + antenna
  return (
    <View style={{ width: 22, height: 22 }}>
      {/* Antenna */}
      <View style={{ position: 'absolute', left: 9.5, top: 0, width: 2, height: 5, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', left: 7, top: 0, width: 7, height: 2, backgroundColor: color, borderRadius: 1 }} />
      {/* Head */}
      <View style={{ position: 'absolute', top: 6, left: 2, width: 18, height: 14, borderRadius: 4, borderWidth: 2, borderColor: color }} />
      {/* Eyes */}
      <View style={{ position: 'absolute', top: 11, left: 6, width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />
      <View style={{ position: 'absolute', top: 11, left: 13, width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />
      {/* Mouth */}
      <View style={{ position: 'absolute', top: 16, left: 8, width: 6, height: 1.5, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

function AgentsIcon({ color }: { color: string }) {
  // Monitor/computer: screen + stand
  return (
    <View style={{ width: 22, height: 20 }}>
      {/* Screen */}
      <View style={{ position: 'absolute', top: 0, left: 0, width: 22, height: 14, borderRadius: 2, borderWidth: 2, borderColor: color }} />
      {/* Stand neck */}
      <View style={{ position: 'absolute', top: 14, left: 9, width: 4, height: 3, backgroundColor: color }} />
      {/* Stand base */}
      <View style={{ position: 'absolute', top: 17, left: 5, width: 12, height: 2, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

function SettingsIcon({ color }: { color: string }) {
  // Gear: outer ring with teeth + inner circle
  return (
    <View style={{ width: 22, height: 22 }}>
      {/* Outer circle */}
      <View style={{ position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: color }} />
      {/* Inner circle */}
      <View style={{ position: 'absolute', top: 7, left: 7, width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: color }} />
      {/* Teeth */}
      <View style={{ position: 'absolute', top: 0, left: 9, width: 4, height: 4, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', bottom: 0, left: 9, width: 4, height: 4, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', top: 9, left: 0, width: 4, height: 4, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: 'absolute', top: 9, right: 0, width: 4, height: 4, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

function MainTabs(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}>
      <Tab.Screen
        name="Threads"
        component={ThreadsScreen}
        options={{
          tabBarIcon: ({ color }) => <ThreadsIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Agents"
        component={AgentsScreen}
        options={{
          tabBarIcon: ({ color }) => <AgentsIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color }) => <SettingsIcon color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

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
    <Stack.Navigator screenOptions={stackScreenOptions}>
      {!auth.isLoggedIn ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="NewThread"
            component={NewThreadScreen}
            options={{ title: 'New Thread' }}
          />
          <Stack.Screen
            name="ThreadDetail"
            component={ThreadDetailScreen}
            options={{ title: 'Thread Detail' }}
          />
          <Stack.Screen
            name="ThreadContent"
            component={ThreadContentScreen}
            options={({ route }) => ({ title: route.params.title })}
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
  usePushNotifications(auth.isLoggedIn);

  React.useEffect(() => {
    flushPendingThreadDetail(auth.isLoggedIn);
  }, [auth.isLoggedIn]);

  return (
    <AuthContext.Provider value={auth}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <NavigationContainer
          ref={navigationRef}
          onReady={() => {
            flushPendingThreadDetail(auth.isLoggedIn);
          }}
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
