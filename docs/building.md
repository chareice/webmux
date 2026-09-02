# Building from source

For changing offdesk, not for using it — the installer covers that.

## The hub, the agent and the CLI

```bash
cargo build --release --bin offdesk-hub --bin offdesk-node --bin offdesk
```

The hub serves its web UI from `packages/app/dist` when run from the repo; the
release binary carries the bundle inside it (`--features embed-ui`, after
`pnpm --filter @offdesk/app build`).

## The Android app

You need a JDK 17, the Android SDK with the NDK, and the Rust Android targets:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
cargo install tauri-cli --version "^2.0" --locked
export ANDROID_HOME=$HOME/Library/Android/sdk          # ~/Android/Sdk on Linux
export NDK_HOME=$ANDROID_HOME/ndk/27.1.12297006
```

```bash
pnpm install
pnpm --filter @offdesk/shared build && pnpm --filter @offdesk/app build
cd packages/desktop && cargo tauri android build --debug --apk
```

A `--debug` APK is signed with the Android debug key, so `adb install` takes it
as is; a release APK needs your own keystore, which is what the `Build Android
APK (Tauri)` workflow uses its `ANDROID_KEYSTORE_*` secrets for. Either way the
CLI prints the path when it finishes, under
`packages/desktop/src-tauri/gen/android/app/build/outputs/apk/`.

Set `OFFDESK_MOBILE_HUB_URL` at build time to skip the first-launch question in
your own builds:

```bash
OFFDESK_MOBILE_HUB_URL=https://your-hub.example.com cargo tauri android build --debug --apk
```

It is only a preset — whatever the user enters still wins, and the app grants
notifications, the clipboard, and link opening to that hub's origin alone. On
an emulator, a hub on your own machine is `http://10.0.2.2:4317`.


## The iOS app

The same Tauri app as Android, from the same `packages/desktop/src-tauri`.
Needs Xcode with the iOS platform installed (Xcode → Settings → Components,
or `xcodebuild -downloadPlatform iOS`), CocoaPods (`brew install cocoapods`)
and the Rust targets:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

The Xcode project is committed under `src-tauri/gen/apple` (regenerate with
`tauri ios init` if the Tauri CLI moves); `Info.ios.plist` carries the camera
and local-network usage strings and the ATS exceptions a LAN hub needs, and
`tauri.ios.conf.json` the iOS-only config, both merged in by the CLI.

```bash
pnpm --filter @offdesk/shared build && pnpm --filter @offdesk/app build
cd packages/desktop
pnpm tauri ios dev                          # simulator, or a plugged-in phone
pnpm tauri ios build --export-method debugging   # an .ipa signed for your team
```

Building for a device needs `APPLE_DEVELOPMENT_TEAM` in the environment (the
Team ID from Membership details) and a matching signing identity in your
keychain; Xcode's automatic signing takes care of that once you have opened the
project (`pnpm tauri ios build --open`) and picked the team.

Releases go through TestFlight from `.github/workflows/mobile-ios.yml` on an
`ios-v*` tag; the secrets it needs are listed at the top of that file.
