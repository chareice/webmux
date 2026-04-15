module.exports = ({ config }) => ({
  ...config,
  name: "webmux",
  slug: "webmux",
  version: "0.1.0",
  scheme: "webmux",
  userInterfaceStyle: "automatic",
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
  plugins: ["expo-router"],
  android: {
    package: "com.webmux.app",
  },
});
