const {
  resolveAndroidBuildConfig,
  resolveGoogleServicesFile,
} = require("./lib/app-config-utils.js");

module.exports = ({ config }) => {
  const appRoot = __dirname;
  const { version, versionCode } = resolveAndroidBuildConfig(process.env);
  const googleServicesFile = resolveGoogleServicesFile(appRoot, process.env);

  return {
    ...config,
    name: "webmux",
    slug: "webmux",
    version,
    scheme: "webmux",
    userInterfaceStyle: "automatic",
    platforms: ["ios", "android", "web"],
    web: {
      bundler: "metro",
      output: "single",
    },
    plugins: ["expo-router", "expo-notifications"],
    android: {
      package: "com.webmux.app",
      ...(googleServicesFile ? { googleServicesFile } : {}),
      softwareKeyboardLayoutMode: "pan",
      versionCode,
    },
    ios: {
      buildNumber: version,
      bundleIdentifier: "com.webmux.app",
    },
  };
};
