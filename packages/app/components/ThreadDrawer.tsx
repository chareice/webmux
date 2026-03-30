import { View, Pressable, useWindowDimensions } from "react-native";
import type { ReactNode } from "react";

interface ThreadDrawerProps {
  children: ReactNode;
  onClose: () => void;
  /** CSS z-index for stacking multiple drawers */
  zIndex?: number;
  /** Override drawer width ratio (0-1). Default 0.65 */
  widthRatio?: number;
  /** Override min width. Default 500 */
  minWidth?: number;
  /** Override max width. Default none */
  maxWidth?: number;
}

export function ThreadDrawer({
  children,
  onClose,
  zIndex = 50,
  widthRatio = 0.65,
  minWidth = 500,
  maxWidth,
}: ThreadDrawerProps) {
  const { width } = useWindowDimensions();
  let drawerWidth = Math.max(minWidth, width * widthRatio);
  if (maxWidth) drawerWidth = Math.min(maxWidth, drawerWidth);

  return (
    <View
      className="absolute top-0 bottom-0 left-0 right-0"
      style={{ zIndex }}
    >
      {/* Backdrop */}
      <Pressable
        className="absolute top-0 bottom-0 left-0 right-0"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.3)" }}
        onPress={onClose}
      />
      {/* Drawer panel */}
      <View
        className="absolute top-0 bottom-0 right-0 bg-background border-l border-border"
        style={{ width: drawerWidth }}
      >
        {children}
      </View>
    </View>
  );
}
