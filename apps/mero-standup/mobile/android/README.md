# Mero Standup for Android

Jetpack Compose + Material3, minSdk 26. Same screens, copy and behaviour as the iOS app
(`../ios`): sign in to a Calimero 1.0 cluster, teams (start, join from an invitation link,
approvals), and per team the Standup, Week, Decisions and Team tabs.

## On Calimero 1.0

- **Sign-in** (`StandupViewModel`, `SignInScreen`): Calimero Cloud by cluster name (node directory,
  `CalimeroClient.connect`) or node URL, every node attested (`CloudPolicy.production`), then the
  device's passkey (Credential Manager), or "Create an account". **Development node**: a
  `merod local` URL (`http://10.0.2.2:2501` from the emulator), mock attestation, a software passkey
  kept on the device. The session and the cluster's nodes are kept encrypted and restored on launch.
- The Activity hands the session its passkey while it lives (`attach` → `session.passkey`), so
  invites and member changes get their passkey step-ups.
- **Invitations** are org invite links (`OrgInvitation`, with the team's app instance and name).
- **Approvals** on Teams: Review shows the confirmation code, then opens the node's consent page in
  a Custom Tab, which returns to `mero-standup://consent`.
- **Contract**: `contract/StandupClient.kt`, a typed client of the component ABI (web PR #709):
  camelCase methods, arguments and results, absent options as `null`, timestamps as decimal
  strings, error codes (`StandupAppCode`) put into words by `ErrorText`.

## Build

```bash
./scripts/fetch-sdk.sh          # kotlin-sdk at the SHA in kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

Needs JDK 17 and an Android SDK (`ANDROID_HOME` or `local.properties`). The debug APK lands in
`app/build/outputs/apk/debug/`.

Gradle properties (`-P` or `gradle.properties`): `meroCluster` (the cluster name or node URL the
sign-in screen prefills), `meroDevNodeUrl` (default `http://10.0.2.2:2501`) and
`meroConsentCallback` (default `mero-standup://consent`; its scheme and host become the manifest's
intent filter). Plain http is allowed only to `10.0.2.2` and `localhost`.

## SDK pin

`kotlin-sdk.ref` pins kotlin-sdk `2.0.0` (Calimero 1.0) by its release commit; for a new release, set it
to that tag's commit.
`settings.gradle.kts` includes the checkout as a composite build.

## Layout

- `contract/StandupClient.kt`: the typed component-contract client.
- `core/`: pure helpers ported from the web app's `lib/` (days, people, carry-forward, digest,
  tags, rich text), the invitation link format and `ErrorText`.
- `app/`: view models on `MeroAppBackend` (teams, team, board, week, decisions, approvals) and the
  `AndroidViewModel` holding the `MeroAppSession`.
- `ui/`: Compose screens.
- `app/src/test/`: JVM tests of the contract client, helpers and view models on
  `InMemoryAppBackend` + `RecordingContextContract`. No emulator.
