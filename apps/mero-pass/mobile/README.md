# Mero Pass: native mobile apps

Native iOS and Android clients for Mero Pass, next to the web frontend (`../app`), the contract
(`../logic`, package `com.calimero.mero-pass`) and the vault library (`../../../packages/mero-pass`).
Both apps have the same screens, copy, icons (SF Symbols on iOS, Material Icons on Android) and
flows, and they open the same vaults as the web app: everything is sealed and opened on the phone,
byte-compatible with the web's crypto.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen; logic in the local `PassCore` package | swift-sdk `6c5f116` (head of swift-sdk#85, `feat/calimero-1.0`, Calimero 1.0; moves to its merge commit once it lands) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | kotlin-sdk `ea8ded7` (`main` merge commit of kotlin-sdk#67), composite build |

The SDK pins are the `main` merge commits of those app-session PRs. To bump them, change
`revision:` in `ios/project.yml` and `ios/PassCore/Package.swift` (keep the two identical), and
`android/kotlin-sdk.ref`.

## How the apps reach Calimero

**iOS runs on Calimero 1.0.** The app talks to a node of a Calimero Cloud cluster over the sealed
channel (`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and signs in with
a passkey; it runs no node. `MeroAppSession` builds the SDK's `CloudAppBackend`, and the view
models keep their `MeroAppBackend` calls, each of which maps one to one:

| The app | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| team | namespace | organization (metadata `package = com.calimero.mero-pass`) |
| vault | subgroup (open) | team (`join: everyone`) |
| vault's contract | context | app instance (`/apps/{app}/views`, `/intents`, `/events`) |
| invitation | `OrgInvitation` | org invite token, redeemed at `/invites/{token}/redeem` |

Sign-in (`ios/Sources/App/CloudAccess.swift`, the same file in every ported app):

- **Calimero Cloud:** a node URL of your cluster (from cloud.calimero.network; `MeroNodeURL` in
  `ios/project.yml` prefills it), then *Sign in with passkey* or *Create an account*. The device's
  passkey belongs to the cluster's relying party: add the `webcredentials:<rp-id>` associated
  domain to the app for a real cluster.
- **Development node:** a `merod local` node (`MeroDevNodeURL`, `http://localhost:2501` by
  default), mock attestation allowed (`allowMock`), with a software passkey the SDK keeps for it.
- **Approvals** (Security → Account): node releases and app upgrades waiting for you, per org and
  for your own apps. *Review* opens the node's consent page in the system browser, which returns
  to `mero-pass://consent`. The app's own session cannot approve anything.

**Android still runs on 0.x** (delegated execution through the account's relay, wallet sign-in);
its port follows the kotlin-sdk's.

A vault's app instance is created with `init(name)`, as on the web. Live updates come from
`MeroAppBackend.events(contextId)`, with a 5-second poll when the stream is not available and
while the phone waits for a vault key. Device approvals and key rotation inside a vault are the
vault contract's own calls, not the node's consent page, so they work the same on both platforms.

## Crypto, compatible with web vaults

The web's `packages/mero-pass/src/crypto.ts` (and the app's recovery-code, share-link and TOTP
helpers) are reimplemented natively, with only platform crypto:

| Piece | Algorithm | iOS | Android |
| --- | --- | --- | --- |
| Device key | ECDH P-256 | CryptoKit `P256.KeyAgreement` | `java.security` `KeyPairGenerator`/`KeyAgreement("ECDH")` |
| Vault key id | SHA-256 | CryptoKit | `MessageDigest` |
| Key wrap | ECIES: ephemeral P-256, HKDF-SHA256 (salt = epk ‖ recipient, info `mero-pass/key-wrap/v1`), AES-256-GCM with the key id as AAD | CryptoKit | `KeyAgreement` + HKDF (RFC 5869 over `Mac("HmacSHA256")`) + `Cipher("AES/GCM/NoPadding")` |
| Field seal | AES-256-GCM, `secretId\0field` as AAD, `mp1.<keyId>.<iv>.<ct>` | CryptoKit | `Cipher` |
| Recovery code | Crockford base32 of the P-256 scalar + 3 fingerprint bytes | CryptoKit | `ECPrivateKeySpec` |
| Share link | AES-256-GCM, key in the link or PBKDF2-SHA256 (600,000 rounds) | CommonCrypto `CCKeyDerivationPBKDF` | `SecretKeyFactory("PBKDF2WithHmacSHA256")` |
| Authenticator | TOTP (RFC 6238), SHA-1/256/512 | CryptoKit HMAC | `Mac` |

No third-party crypto library is needed: nothing here uses Argon2 or X25519.

**Shared test vectors.** `test-vectors/generate.mjs` runs the web's own code under Node with every
random input fixed (device keys, ephemeral keys, vault keys, nonces, salts) and writes
`test-vectors/vectors.json`. Both apps assert against that one file, both ways: what they seal
must equal the web's output byte for byte (wraps, field envelopes, recovery codes), and what the
web sealed must open natively (plus the cases that must not open: wrong key id, wrong device,
tampered ciphertext, an envelope moved to another field or secret, an expired or mis-keyed share
link). iOS: `PassCoreTests/CryptoVectorTests`; Android: `core/CryptoVectorTest`.

```sh
node --experimental-transform-types apps/mero-pass/mobile/test-vectors/generate.mjs   # Node 22.15+
```

CI regenerates the file and fails on any diff, so a web change that would break native vaults is
caught on the PR that makes it.

The vault session (`VaultSession`: register, open the wraps addressed to this device, bootstrap a
new vault's key, hand keys to entitled devices, approve/deny devices, rotate, recovery keys,
seal/open every field) is a line-by-line port of `packages/mero-pass/src/vaultSession.ts`, tested
against an in-memory vault that enforces the contract's rules, test for test with the web's suite.

## Keys and secrets on the phone

- **Device key.** iOS: the private scalar in the Keychain (`WhenUnlockedThisDeviceOnly`: never
  synced, never in a backup). Android: sealed with an AES-256-GCM key in the Android Keystore
  (non-exportable), the sealed bytes in app-private storage. Unlocking asks for Face ID / Touch ID
  / the passcode (iOS `LocalAuthentication`) or the fingerprint / face / screen lock (Android
  `BiometricPrompt` with device credential), then holds the key in memory only. The app locks
  again after the chosen time away (1, 5, 15 or 60 minutes, the web's choices), and every vault
  key goes with it.
- **The web's passphrase and passkey locks** seal a browser's key; a phone's key is sealed by the
  platform instead, so there is no passphrase to set and the platform's biometric unlock plays
  the passkey's part. WebAuthn PRF passkeys are not used on the phone.
- **Clipboard.** Copied secrets expire: iOS writes a `localOnly` pasteboard item with a 30-second
  `expirationDate` (never Universal Clipboard); Android marks the clip sensitive
  (`EXTRA_IS_SENSITIVE`) and clears it after 30 seconds.
- **Screens.** The app switcher shows a cover instead of the vault (iOS), and Android sets
  `FLAG_SECURE` (no screenshots, no recents thumbnail).
- **Logs.** Nothing logs a key, a plaintext or a field value; key types print as `…`.

## Screens

1. **Sign in**: what Mero Pass is; on iOS a Calimero Cloud passkey (sign in or create an account) or
   a development node. An invitation that arrived while
   signed out is named here.
2. **Unlock**: Face ID / fingerprint; the first unlock makes this phone's key.
3. **Vaults** (tab): your teams as cards (vault and member counts); New team, Join with a link;
   swipe or long-press a team to invite someone. Pull to refresh.
4. **Team**: its vaults (You are in / Not joined, tap to join); New vault; invite to the team, or
   to one vault (swipe / long-press). Team id behind Details.
5. **Vault**: header with your role; state banners (opening, waiting for the key, approve this
   phone with its 6-digit code, not admitted yet, no key yet, only this phone holds the key);
   devices asking to be let in, with Approve / Deny; category and tag chips; search (names, tags,
   usernames, sites, never secret values); the items, swipe right to copy the password, left to
   trash; New item; menu: People and devices, Password health, Trash, Activity, Invite someone.
6. **Item**: every field, sensitive ones masked until revealed; copy (expiring), open website,
   live authenticator code with its countdown, password strength, tags, who created and changed
   it, previous values with Restore, Edit, Share, Move to trash.
7. **New / edit item** (sheet): name, kind (8 kinds as on the web), the kind's fields, the password
   generator (length 12–64, strength meter), tags.
8. **Share** (sheet): which fields, expiry (1 hour / 1 day / 7 days), optional passphrase; a link
   that opens on the web's `/share` page.
9. **People and devices**: members with roles (Admin changes roles, removes and rotates), devices
   holding the key (revoke, which rotates for an Admin), newcomers' default role, rotate key.
10. **Password health**, **Trash** (restore, Admin deletes forever) and **Activity**.
11. **Security** (tab): this phone (how its key is kept, auto-lock, Lock now, key id behind
    Details), recovery key (create or replace, shown once), restore this phone with a recovery
    code, sign out (or sign out and forget this phone).
12. **Sheets**: invitation link (share or copy, with what it grants), join with a link, the
    invitation prompt (join, joining, joined, failed).

## Features vs the web app

Same as the web: teams (list, create, invite), vaults (list, create open vaults, join, invite),
the vault key lifecycle (bootstrap, hand-out to entitled devices, device approval with
confirmation codes, deny, revoke, rotate, recovery keys: create, auto-adopt, restore), items of
all 8 kinds (list, filter by kind and tag, search, detail, reveal, copy, TOTP, strength, add,
edit with field-level updates, previous values and restore, trash, restore, delete forever),
share links, password health (weak, reused, old), activity, members and roles, the default role,
invitation links (`https://links.calimero.network/com.calimero.mero-pass/join?invitation=…` and
`calimero://…`). On iOS the payload is the SDK's 1.0 `OrgInvitation` JSON (`{"invitation": "inv_…",
"namespaceId", "name"?, "contextId"?}`) plus `kind`, `vaultId` and `vaultName`; a pre-1.0 signed
invitation is refused. Android and the web app still write the 0.x payload until their ports.

Left out, and why:

- **Private vault.** The web marks a personal namespace in its group metadata and closes it to
  newcomers (default capabilities 0); `MeroAppBackend` cannot read or write group metadata or
  capabilities, so a phone shows a personal vault as a team of one and cannot create one.
- **Invite-only vaults.** Creating or redeeming one needs a team invitation, which
  `MeroAppBackend` cannot mint or redeem (it admits to orgs only). A phone creates open vaults; an
  invite-only vault link admits to the team and says the vault itself could not be joined.
- **Team-level members, roles and removal** (the web's Team › People tab, TEE badges, member
  names from `@calimero-apps/names`): `MeroAppBackend` has no group-member reads or role
  operations. Vault members and roles (contract-level) are all there. For the same reason a
  phone hands keys to the vault's role holders without the team list the web passes as
  `allowed`, and leaves finishing team-level removals to the web.
- **Import / export** (CSV import, encrypted export file), **Connect X** (mero-bot OAuth set-up)
  and the **breach check** (Have I Been Pwned): follow-ups; the export format is PBKDF2 +
  AES-GCM like share links and ports the same way.
- **Opening share links** on the phone: links open on the web's public `/share` page.
- **Dark mode**: the apps follow the Calimero light style only.

## AutoFill (follow-up)

AutoFill is the biggest win for a phone and is deliberately not in this PR. What it needs:

- **iOS**: a Credential Provider extension (`ASCredentialProviderViewController`) in its own
  target, with the AutoFill Credential Provider entitlement; an App Group shared with the app
  (Keychain access group for the device key, plus a cache of vault keys or decrypted
  name/username/URL index sealed for the extension); `ASCredentialIdentityStore` kept in sync
  with logins' `url` + `username` on every vault reload; the extension opens the vault with the
  same `PassCore` (it fits the extension's memory budget) after a `LocalAuthentication` check, and
  returns `ASPasswordCredential`. Optional: one-time codes (`ASOneTimeCodeCredential`, iOS 18).
- **Android**: an `AutofillService` declared in the manifest with
  `BIND_AUTOFILL_SERVICE`, parsing `AssistStructure` for username/password fields and the web
  domain / package; `Dataset`s built from logins whose host matches, unlocked through an
  authentication `IntentSender` that runs `BiometricPrompt`; Digital Asset Links checks for apps;
  and `SaveInfo` to offer saving a new login into a chosen vault.
- **Both**: a background-safe way to read vaults without the UI (the relay session and device
  key must be reachable from the extension/service), a decision on what may be cached at rest
  for speed (only the encrypted records plus a sealed index), and tests for domain matching.

## Generated contract client

The contract calls are generated, never hand-written:
`ios/PassCore/Sources/PassGenerated/PassClient.swift` and
`android/app/src/main/kotlin/network/calimero/pass/generated/PassClient.kt`, from
`../logic/res/abi.json` with mero-devtools-js's abi-codegen. Regenerate both after a contract
change:

```sh
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
```

Each generated file declares its own `ContextContractCalling`; `PassTransport` (both platforms)
adapts the SDK's `contract.bound(contextId)` to it. On iOS the generated client is its own module
(`PassGenerated`) so its protocol does not shadow MeroKit's.

## Build and test

iOS:

```sh
cd ios
swift test --package-path PassCore      # crypto vectors, vault session, view models, on macOS
xcodegen generate && open MeroPass.xcodeproj
```

Android:

```sh
cd android
./scripts/fetch-sdk.sh                   # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

The view-model tests on both platforms run against the SDKs' fakes (`InMemoryAppBackend`) and the
in-memory vault, and mirror each other test for test.

## Configuration

- **iOS (1.0)**: `MeroNodeURL` (a node of your Cloud cluster; empty: the sign-in screen asks) and
  `MeroDevNodeURL` (the development node it offers) in `project.yml`; the node's consent page
  returns to `mero-pass://consent` (`MeroPassCallbackScheme`).
- **Android (0.x)**: sign-in returns to `mero-pass://enrol` (`meroEnrolCallback` in
  `gradle.properties`); `-PmeroCloudUrl=… -PmeroWalletUrl=… -PmeroRegistryUrl=…`.
- **Share links** point at `https://mero-pass.vercel.app/share`.
- **Font**: the web app ships no display face of its own, so headings use the system face,
  semibold.

## CI

`.github/workflows/mero-pass-ios.yml` (regenerate the vectors from the web's code and diff;
`swift test` on PassCore; XcodeGen and an unsigned simulator build) and
`.github/workflows/mero-pass-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android
lint, `assembleDebug`), each path-filtered to its folder and the test vectors.
