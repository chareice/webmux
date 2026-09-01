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
if (process.env.OFFDESK_ALLOW_CLEARTEXT === "1") {
  plugins.push(withCleartextTraffic);
}

module.exports = ({ config }) => ({
  ...config,
  name: "offdesk",
  slug: "offdesk",
  version: process.env.OFFDESK_APP_VERSION || "0.1.0",
  scheme: "offdesk",
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
    package: "dev.offdesk.app",
    permissions: ["REQUEST_INSTALL_PACKAGES"],
  },
  extra: {
    defaultServerUrl:
      process.env.EXPO_PUBLIC_OFFDESK_DEFAULT_SERVER_URL ||
      process.env.OFFDESK_DEFAULT_SERVER_URL ||
      null,
  },
});
