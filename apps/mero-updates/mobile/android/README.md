# Mero Updates for Android

Jetpack Compose + Material 3, minSdk 26. Same screens, copy and behaviour as the iOS app
(`../ios`): sign in with Calimero, companies (create, join from an invitation link), a company's
audiences, and per audience the Updates, Asks, Q&A, KPIs and People tabs with the post screen,
the composer, settings and the account menu. Delegated execution only: the phone holds no node;
reads are the account relay's query, writes are warrants signed on the device.

## Build

```bash
./scripts/fetch-sdk.sh          # kotlin-sdk at the SHA in kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lintDebug assembleDebug
```

Needs JDK 17 and an Android SDK (`ANDROID_HOME` or `local.properties`). The debug APK lands in
`app/build/outputs/apk/debug/`.

Gradle properties (`-P` or `gradle.properties`): `meroCloudUrl`, `meroWalletUrl`,
`meroRegistryUrl` (empty = the SDK's hosted defaults) and `meroEnrolCallback`
(default `mero-updates://enrol`; its scheme and host become the manifest's intent filter).

## SDK pin

`kotlin-sdk.ref` pins kotlin-sdk `0999426846c23c5821929c62547af3510c8b670b`, the
`feat/app-session` branch (kotlin-sdk PR #67: `MeroAppSession`, `MeroAppBackend`,
`ContextContract`, mero-testkit's `InMemoryAppBackend`). It moves to the merge commit once that PR
lands. `settings.gradle.kts` includes the checkout as a composite build.

## Layout

- `app/src/main/kotlin/network/calimero/updates/generated/UpdatesClient.kt`: the contract client,
  generated from `logic/res/abi.json`. Do not edit; regenerate with `../scripts/regenerate-clients.sh`.
- `core/`: pure helpers ported from the web app's `lib/` (formatting, KPI parsing and deltas,
  templates and the composer state, whose JSON is the web draft's) and the invitation link
  format, byte-compatible with the web.
- `app/`: view models on `MeroAppBackend` (companies, company, audience, feed, post, composer,
  asks, Q&A, KPIs, people, settings) and the `AndroidViewModel` holding the `MeroAppSession`.
- `ui/`: Compose screens. Headings use Power Grotesk (`res/font`), the web app's display face.
- `app/src/test/`: JVM tests of the helpers and view models on `InMemoryAppBackend` +
  `RecordingContextContract`. No emulator.
