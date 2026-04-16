// Learn more https://docs.expo.io/guides/customizing-metro
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Exclude Tauri's Rust build output from Metro's file watcher.
// During `tauri dev`, Rust compilation creates/deletes temporary directories
// inside src-tauri/target/ which crashes Metro's FallbackWatcher.
const tauriTarget = path.resolve(__dirname, "../desktop/src-tauri/target");
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  new RegExp(tauriTarget.replace(/[/\\]/g, "[/\\\\]")),
];

module.exports = withNativeWind(config, { input: "./global.css" });
