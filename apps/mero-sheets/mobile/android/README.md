# Mero Sheets for Android

Jetpack Compose + Material3, minSdk 26. See [`../README.md`](../README.md) for the screens,
features and SDK notes.

| Path | What |
| --- | --- |
| `app/src/main/kotlin/network/calimero/sheets/generated/` | The generated contract client |
| `…/core/` | `WorkspaceModel`, `SpreadsheetModel`, grid layout (row and column order, formula display, number formats), charts, invitations |
| `…/app/`, `…/ui/` | The session view model and the Compose screens |
| `app/src/test/` | JVM tests of the models against mero-testkit's `InMemoryAppBackend` |

```bash
./scripts/fetch-sdk.sh          # the kotlin-sdk at kotlin-sdk.ref, built as a composite build
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

Package `network.calimero.sheets`. Sign-in returns to `meroEnrolCallback` (default
`mero-sheets://enrol`, in `gradle.properties`); invitation links arrive on
`https://links.calimero.network/com.calimero.mero-sheets/join?…` and
`calimero://com.calimero.mero-sheets/join?…`. Pass `-PmeroCloudUrl`, `-PmeroWalletUrl` or
`-PmeroRegistryUrl` for another environment.

`kotlin-sdk.ref` pins the SDK's `main` merge commit of PR #67.
