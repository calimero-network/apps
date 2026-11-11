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

Package `network.calimero.sheets`. The app runs on Calimero 1.0: sign-in is a passkey on a
Calimero Cloud cluster (by name or node URL, `meroNodeUrl`), or a `merod local` development node
(`meroDevNodeUrl`, default `http://10.0.2.2:2501`, the host as the emulator sees it; debug builds
allow cleartext to it). The node's consent page returns to `meroConsentCallback` (default
`mero-sheets://consent`). Invitation links arrive on
`https://links.calimero.network/com.calimero.mero-sheets/join?…` and
`calimero://com.calimero.mero-sheets/join?…`.

`kotlin-sdk.ref` pins kotlin-sdk `0.4.0` (Calimero 1.0) by its release commit; for a new release, set it to
that tag's commit.
