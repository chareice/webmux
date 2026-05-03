import { describe, expect, it } from "vitest";

import {
  compareAppVersions,
  findAndroidApkAsset,
  findLatestNewerAndroidRelease,
  getNewerAndroidRelease,
} from "./nativeUpdate";

const release = {
  tag_name: "app-v0.1.4",
  html_url: "https://github.com/chareice/webmux/releases/tag/app-v0.1.4",
  assets: [
    {
      name: "webmux-0.1.4-armeabi-v7a.apk",
      browser_download_url:
        "https://github.com/chareice/webmux/releases/download/app-v0.1.4/webmux-0.1.4-armeabi-v7a.apk",
    },
    {
      name: "webmux-0.1.4-arm64-v8a.apk",
      browser_download_url:
        "https://github.com/chareice/webmux/releases/download/app-v0.1.4/webmux-0.1.4-arm64-v8a.apk",
    },
    {
      name: "webmux-0.1.4-universal.apk",
      browser_download_url:
        "https://github.com/chareice/webmux/releases/download/app-v0.1.4/webmux-0.1.4-universal.apk",
    },
  ],
};

describe("nativeUpdate", () => {
  it("compares app-v semver tags", () => {
    expect(compareAppVersions("app-v0.1.4", "0.1.3")).toBeGreaterThan(0);
    expect(compareAppVersions("app-v0.1.3", "0.1.3")).toBe(0);
    expect(compareAppVersions("app-v0.1.2", "0.1.3")).toBeLessThan(0);
  });

  it("prefers the universal APK asset for reliable in-app updates", () => {
    expect(findAndroidApkAsset(release)?.name).toBe("webmux-0.1.4-universal.apk");
  });

  it("returns a release only when it is newer and has an APK", () => {
    expect(getNewerAndroidRelease(release, "0.1.3")).toEqual({
      version: "0.1.4",
      tagName: "app-v0.1.4",
      releaseUrl: release.html_url,
      apkName: "webmux-0.1.4-universal.apk",
      apkUrl:
        "https://github.com/chareice/webmux/releases/download/app-v0.1.4/webmux-0.1.4-universal.apk",
    });

    expect(getNewerAndroidRelease(release, "0.1.4")).toBeNull();
  });

  it("skips non-Android releases when choosing the latest newer APK", () => {
    expect(
      findLatestNewerAndroidRelease(
        [
          {
            tag_name: "desktop-v0.3.1",
            html_url:
              "https://github.com/chareice/webmux/releases/tag/desktop-v0.3.1",
            assets: [],
          },
          release,
        ],
        "0.1.3",
      )?.tagName,
    ).toBe("app-v0.1.4");
  });
});
