import { Platform } from "react-native";

export default function HomeScreen() {
  if (Platform.OS === "web") {
    const { TerminalCanvas } = require("../components/TerminalCanvas.web");
    return <TerminalCanvas />;
  }

  // Android
  const { TerminalCanvas } = require("../components/TerminalCanvas.android");
  return <TerminalCanvas />;
}
