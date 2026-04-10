module.exports = ({ config }) => ({
  ...config,
  name: "webmux",
  slug: "webmux",
  version: "0.1.0",
  scheme: "webmux",
  userInterfaceStyle: "dark",
  platforms: ["web", "android"],
  web: {
    bundler: "metro",
    output: "single",
  },
  plugins: ["expo-router"],
  android: {
    package: "com.webmux.app",
  },
});
