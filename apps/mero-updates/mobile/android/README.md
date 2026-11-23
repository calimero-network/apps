# Hyperfeed Updates for Android

Jetpack Compose + Material 3, minSdk 26. Same screens, copy and behaviour as the iOS app
(`../ios`): sign in to a Calimero 1.0 cluster with a passkey, companies (create, join from an
invitation link), a company's audiences, and per audience the Updates, Asks, Q&A, KPIs and People
tabs with the post screen, the composer, settings, approvals and the account menu. The phone holds
no node; see [`../README.md`](../README.md) for the 1.0 model.

## Build

```bash
./gradlew ktlintCheck detekt testDebugUnitTest lintDebug assembleDebug
```

Needs JDK 17 and an Android SDK (`ANDROID_HOME` or `local.properties`). The debug APK lands in
`app/build/outputs/apk/debug/`.

Gradle properties (`-P` or `gradle.properties`): `meroCluster` (a Calimero Cloud cluster's name or
node URL the sign-in form prefills) and `meroDevNodeUrl` (a `merod local` node; empty:
`http://10.0.2.2:2501`, the host as the emulator sees it; plain http is allowed only to it). The
consent page returns to `mero-updates://consent`.

## SDK pin

`meroSdk` in `gradle/libs.versions.toml` pins the Calimero Kotlin SDK (`network.calimero:mero-kotlin`,
`mero-kotlin-compose`, `mero-kotlin-testkit` on Maven Central), published from calimero-network/core on
core's version. Each core release opens a pull request that moves it.

## Layout

- `app/src/main/kotlin/network/calimero/updates/generated/client/UpdatesClient.kt`: the contract
  client, generated from the component ABI; `generated/UpdatesRecords.kt` keeps the v1 types the
  screens read, and `core/ComponentWire.kt` converts between them and the client's JSON.
- `core/`: pure helpers ported from the web app's `lib/` (formatting, KPI parsing and deltas,
  templates and the composer state, whose JSON is the web draft's), the invitation link format
  and the error wording.
- `app/`: view models on `MeroAppBackend` (companies, company, audience, feed, post, composer,
  asks, Q&A, KPIs, people, settings) and `UpdatesViewModel`, which opens the `MeroAppSession` on the
  chosen cluster.
- `ui/`: Compose screens, the sign-in form and the approvals sheet. Headings use Power Grotesk
  (`res/font`), the web app's display face.
- `app/src/test/`: JVM tests of the helpers, the wire and the view models on `InMemoryAppBackend`
  + `RecordingContextContract`. No emulator.
