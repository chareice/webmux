# Shipping the iOS app

What the Apple account has to produce, once, so that an `ios-v*` tag turns
into a TestFlight build. Everything below is done in a browser or Keychain
Access by whoever owns the account; nothing is scripted, because every step
asks for that person's Apple sign-in.

The bundle identifier is `dev.offdesk.desktop` (from
`packages/desktop/src-tauri/tauri.conf.json`). Use it verbatim wherever a
form asks for one; a mismatch is the single most common reason a signed
build fails.

## 1. Team ID

[developer.apple.com/account](https://developer.apple.com/account) →
**Membership details** → **Team ID**, ten characters like `A1B2C3D4E5`.

→ secret `APPLE_DEVELOPMENT_TEAM`

## 2. App ID

developer.apple.com/account → **Certificates, Identifiers & Profiles** →
**Identifiers** → **+** → *App IDs* → *App* → Description `offdesk`,
Bundle ID **Explicit** `dev.offdesk.desktop`. No capabilities are needed.
Register.

## 3. Apple Distribution certificate

On the Mac:

1. **Keychain Access** → menu *Keychain Access* → *Certificate Assistant* →
   *Request a Certificate From a Certificate Authority…* Enter your email,
   a common name (`offdesk distribution`), leave CA email empty, choose
   **Saved to disk**. Keep the `.certSigningRequest`.
2. developer.apple.com → **Certificates** → **+** → **Apple Distribution**
   → upload the request → download the `.cer`.
3. Double-click the `.cer` so it lands in your login keychain next to the
   private key the request created.
4. In Keychain Access, *My Certificates*, find *Apple Distribution: …*,
   expand it so the private key shows, select **both**, right-click →
   *Export 2 items…* → `.p12`, with a password.

```bash
base64 -i distribution.p12 | pbcopy      # → secret IOS_CERTIFICATE
```

→ secrets `IOS_CERTIFICATE` (the base64) and `IOS_CERTIFICATE_PASSWORD`

## 4. Provisioning profile

developer.apple.com → **Profiles** → **+** → under *Distribution* choose
**App Store Connect** → App ID `dev.offdesk.desktop` → the certificate from
step 3 → name `offdesk App Store` → Generate → download the
`.mobileprovision`.

```bash
base64 -i offdesk_App_Store.mobileprovision | pbcopy   # → secret IOS_MOBILE_PROVISION
```

Profiles expire after a year; regenerate and replace the secret then.

## 5. The app record

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** →
**+** → *New App* → Platform iOS, Name `offdesk`, Primary language, Bundle ID
`dev.offdesk.desktop` (from the list; it appears once step 2 is done), SKU
`offdesk-ios`, User access Full. Create.

Nothing else needs filling in for TestFlight. The listing (screenshots,
description, privacy) is for the App Store submission later.

## 6. App Store Connect API key

App Store Connect → **Users and Access** → **Integrations** → **App Store
Connect API** → *Team Keys* → **+** (Generate API Key) → Name `github-ci`,
Access **App Manager**. Download the `.p8` — **it can only be downloaded
once**; keep it somewhere safe. The page shows the **Key ID** for that key
and the **Issuer ID** for the team.

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy   # → secret APP_STORE_CONNECT_API_KEY
```

→ secrets `APP_STORE_CONNECT_API_KEY`, `APP_STORE_CONNECT_KEY_ID`,
`APP_STORE_CONNECT_ISSUER_ID`

## 7. Set the secrets

GitHub → repository → **Settings** → **Secrets and variables** → **Actions**,
or from a terminal with the values in files:

```bash
gh secret set APPLE_DEVELOPMENT_TEAM --body "A1B2C3D4E5"
gh secret set IOS_CERTIFICATE < distribution.p12.b64
gh secret set IOS_CERTIFICATE_PASSWORD --body "…"
gh secret set IOS_MOBILE_PROVISION < profile.b64
gh secret set APP_STORE_CONNECT_KEY_ID --body "XXXXXXXXXX"
gh secret set APP_STORE_CONNECT_ISSUER_ID --body "xxxxxxxx-xxxx-…"
gh secret set APP_STORE_CONNECT_API_KEY < AuthKey.p8.b64
```

## 8. Tag

```bash
git tag -a ios-v0.4.5 -m "offdesk iOS 0.4.5" && git push origin ios-v0.4.5
```

`.github/workflows/mobile-ios.yml` builds, signs and uploads. Ten to thirty
minutes after the upload the build shows under **TestFlight** in App Store
Connect. Add yourself as an internal tester and it is on your phone; for a
link anyone can use, create an *external* group, enable **Public Link**, and
submit the first build for Beta App Review (a day or two, once).

`Info.ios.plist` declares `ITSAppUsesNonExemptEncryption = false`, so App
Store Connect does not stop every build to ask about export compliance —
the app uses only the platform's TLS.
