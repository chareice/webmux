import { useRef } from "react";
import { View, Text, Pressable, Alert, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { confirmQrSession } from "../../../../lib/api";
import { useTheme } from "../../../../lib/theme";

export default function ScanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scannedRef.current) return;

    try {
      const url = new URL(data);
      const sessionId = url.searchParams.get("s");

      if (!sessionId || !url.pathname.includes("/auth/qr")) {
        return; // Not a webmux QR code, ignore
      }

      scannedRef.current = true;

      Alert.alert("Authorize Login", "Allow login on another device?", [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            scannedRef.current = false;
          },
        },
        {
          text: "Confirm",
          onPress: async () => {
            try {
              await confirmQrSession(sessionId);
              Alert.alert("Success", "Login authorized!", [
                { text: "OK", onPress: () => router.back() },
              ]);
            } catch (err) {
              Alert.alert(
                "Error",
                err instanceof Error ? err.message : "Failed to confirm",
              );
              scannedRef.current = false;
            }
          },
        },
      ]);
    } catch {
      // Invalid URL, ignore
    }
  };

  if (!permission) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-6">
        <Text className="text-foreground text-center mb-4">
          Camera permission is needed to scan QR codes
        </Text>
        <Pressable
          className="bg-foreground py-3 px-6 rounded-lg"
          onPress={requestPermission}
        >
          <Text className="text-background font-semibold">
            Grant Permission
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        className="flex-1"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarCodeScanned}
      />
      {/* Close button overlay */}
      <Pressable
        className="absolute top-14 left-4 bg-black/50 rounded-full w-10 h-10 items-center justify-center"
        onPress={() => router.back()}
      >
        <Text className="text-white text-lg font-bold">✕</Text>
      </Pressable>
    </View>
  );
}
