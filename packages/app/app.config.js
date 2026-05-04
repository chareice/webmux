const { withAndroidManifest } = require("@expo/config-plugins");

const withCleartextTraffic = (config) =>
  withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$["android:usesCleartextTraffic"] = "true";
    }
    return config;
  });

const plugins = ["expo-router"];
if (process.env.WEBMUX_ALLOW_CLEARTEXT === "1") {
  plugins.push(withCleartextTraffic);
}

module.exports = ({ config }) => ({
  ...config,
  name: "webmux",
  slug: "webmux",
  version: process.env.WEBMUX_APP_VERSION || "0.1.0",
  scheme: "webmux",
  userInterfaceStyle: "dark",
  platforms: ["web", "android"],
  web: {
    bundler: "metro",
    output: "single",
    headTags: [
      {
        tag: "script",
        innerHTML: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark');document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})();`,
      },
    ],
  },
  plugins,
  android: {
    package: "com.webmux.app",
    permissions: ["REQUEST_INSTALL_PACKAGES"],
  },
  extra: {
    defaultServerUrl:
      process.env.EXPO_PUBLIC_WEBMUX_DEFAULT_SERVER_URL ||
      process.env.WEBMUX_DEFAULT_SERVER_URL ||
      null,
  },
});
