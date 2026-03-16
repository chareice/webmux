const reactNativePreset = require('react-native/jest-preset');

module.exports = {
  ...reactNativePreset,
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|react-native|@react-native|@react-navigation|react-native-safe-area-context|react-native-screens|@react-native-async-storage)/)',
  ],
};
