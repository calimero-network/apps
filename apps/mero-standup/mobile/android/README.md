# Mero Standup for Android

Jetpack Compose + Material3, minSdk 26. Same screens, copy and behaviour as the iOS app
(`../ios`): sign in with Calimero, teams (start, join from an invitation link), and per team the
Standup, Week, Decisions and Team tabs. Delegated execution only: the phone holds no node; reads
are the account relay's query, writes are warrants signed on the device.

## Build

```bash
./scripts/fetch-sdk.sh          # kotlin-sdk at the SHA in kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lintDebug assembleDebug
```

Needs JDK 17 and an Android SDK (`ANDROID_HOME` or `local.properties`). The debug APK lands in
`app/build/outputs/apk/debug/`.

Gradle properties (`-P` or `gradle.properties`): `meroCloudUrl`, `meroWalletUrl`,
`meroRegistryUrl` (empty = the SDK's hosted defaults) and `meroEnrolCallback`
(default `mero-standup://enrol`; its scheme and host become the manifest's intent filter).

## SDK pin

`kotlin-sdk.ref` pins kotlin-sdk `0999426846c23c5821929c62547af3510c8b670b`, the
`feat/app-session` branch (kotlin-sdk PR #67: `MeroAppSession`, `MeroAppBackend`,
`ContextContract`, mero-testkit's `InMemoryAppBackend`). It moves to the merge commit once that PR
lands. `settings.gradle.kts` includes the checkout as a composite build.

## Layout

- `app/src/main/kotlin/network/calimero/standup/generated/StandupClient.kt`: the contract client,
  generated from `logic/res/abi.json`. Do not edit; regenerate (from the repo root):

  ```bash
  node <abi-codegen>/dist/cli.js -i apps/mero-standup/logic/res/abi.json \
    -o apps/mero-standup/mobile/android/app/src/main/kotlin/network/calimero/standup/generated \
    --target kotlin --package network.calimero.standup.generated --client-name StandupClient
  ```

- `core/`: pure helpers ported from the web app's `lib/` (days, people, carry-forward, digest,
  tags, rich text) and the invitation link format (`base58(deflate({invitation, namespaceId,
  contextId}))`, byte-compatible with the web).
- `app/`: view models on `MeroAppBackend` (teams, team, board, week, decisions) and the
  `AndroidViewModel` holding the `MeroAppSession`.
- `ui/`: Compose screens.
- `app/src/test/`: JVM tests of the helpers and view models on `InMemoryAppBackend` +
  `RecordingContextContract`. No emulator.
