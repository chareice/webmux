import "../global.css";
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "../lib/auth";
import { ThemeProvider } from "../lib/theme";
import LoginScreen from "./login";
function AuthGate() {
    const { isLoading, isAuthenticated } = useAuth();
    if (isLoading) {
        return (<View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#fb9d59"/>
      </View>);
    }
    if (!isAuthenticated) {
        return <LoginScreen />;
    }
    return <Slot />;
}
export default function RootLayout() {
    return (<SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>);
}
