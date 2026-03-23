const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_VERSION = "1.0.0";
const DEFAULT_VERSION_CODE = 1;

function resolveAndroidBuildConfig(env) {
  const version = env.WEBMUX_MOBILE_VERSION_NAME?.trim() || DEFAULT_VERSION;
  const versionCode = parsePositiveInteger(env.WEBMUX_MOBILE_VERSION_CODE);

  return {
    version,
    versionCode: versionCode ?? DEFAULT_VERSION_CODE,
  };
}

function resolveGoogleServicesFile(appRoot, env) {
  const explicitPath = env.WEBMUX_ANDROID_GOOGLE_SERVICES_PATH?.trim();
  if (explicitPath) {
    return path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(appRoot, explicitPath);
  }

  const bundledPath = path.resolve(appRoot, "google-services.json");
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  return undefined;
}

function parsePositiveInteger(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

module.exports = {
  resolveAndroidBuildConfig,
  resolveGoogleServicesFile,
};
