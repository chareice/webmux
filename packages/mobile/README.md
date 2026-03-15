# Webmux Mobile

React Native client for Webmux run management.

## App Identity

- Android application id: `site.chareice.webmux`
- iOS bundle id: `site.chareice.webmux`
- Display name: `Webmux`
- Deep link callback: `webmux://auth`
- Supported mobile sign-in buttons: GitHub and Google

## Local Development

Install dependencies from the mobile package:

```sh
mise install
pnpm install --frozen-lockfile --ignore-workspace
```

Run Metro:

```sh
pnpm start
```

Run on Android:

```sh
pnpm android
```

Run on iOS:

```sh
bundle install
bundle exec pod install
pnpm ios
```

## Android Release Artifacts

Android release builds expect Java 17. The repository includes a root
`.mise.toml` so `mise install` can provision the matching JDK locally.

GitHub Releases trigger `.github/workflows/mobile-release.yml`.

The workflow builds both:

- `webmux-<tag>.apk` for direct sideload installs
- `webmux-<tag>.aab` for Google Play upload

Release tags must use `vX.Y.Z` or `X.Y.Z`. The workflow derives:

- `versionName` from the tag, for example `1.2.3`
- `versionCode` from `major * 1000000 + minor * 1000 + patch`

Manual workflow runs still work, but they produce internal-test versions like
`0.0.<run_number>`.

## Authentication

The mobile app opens the server-side OAuth flow in the system browser and
returns through `webmux://auth`.

The server currently exposes both:

- `/api/auth/github`
- `/api/auth/google`

## Android Signing

Without signing secrets, release builds fall back to the checked-in debug
keystore. That is only suitable for internal testing.

Configure these repository secrets before publishing a real production release:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## Production Release Checklist

Before shipping to users, make sure all of these are in place:

1. Create a real Android release keystore and store the four signing secrets in GitHub.
2. Publish a GitHub Release with a semantic version tag such as `v1.0.0`.
3. Download the generated APK for direct installs, or upload the generated AAB to Google Play.
4. Replace the default app icons and screenshots with production assets.
5. Fill in any store metadata, privacy disclosures, and support URLs before submitting to app stores.

## iOS Production Status

iOS already uses the production bundle id, but archive/TestFlight publishing is
not automated yet. To ship iOS, you still need:

- an Apple Developer team
- signing certificates and provisioning profiles
- an App Store Connect app
- an archive/export workflow or Xcode-based release process
