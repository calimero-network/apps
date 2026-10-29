# Mero Chess — native mobile apps

Native iOS and Android clients for Mero Chess, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.mero-chess`). Both apps have the same screens, copy, icons (SF
Symbols ↔ Material Symbols) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `c9ca1a0` (`main`, merge of swift-sdk#84), in `ios/project.yml` and `ios/ChessCore/Package.swift` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (`main`, merge of kotlin-sdk#67), composite build at the SHA in `android/kotlin-sdk.ref` |

The SDK pins are the `main` merge commits of swift-sdk#84 and kotlin-sdk#67. Bumping is one
line per platform (iOS: both `revision:` values; Android: `kotlin-sdk.ref`).

## Delegated execution only

Neither app runs or logs into a node. The person signs in with their Calimero account (the wallet
certifies this device's key), and everything goes through the account's relay via the SDKs'
`MeroAppSession` / `MeroAppBackend`:

- **Reads** (`table`, `history`) are the relay's account-scoped query; **writes** (`play`, `sit`,
  `resign`, draws, `rematch`, `join`) are warrants the device key signs. Both go through the
  generated `MeroChessClient` over `contract.bound(to: contextId)`; no contract call is hand-written.
- **A table is one context**, created directly in its namespace ("club"), exactly as the web app's
  table picker does, so the namespace invitation a table mints is the one that admits to it.
- **Invitations** use the web app's format both ways
  (`https://links.calimero.network/com.calimero.mero-chess/join?invitation=<base58(deflate({invitation, namespaceId, contextId}))>`,
  plus `calimero://`), redeemed by direct admission (`joinNamespace`).
- **Live updates:** every relay event for the table is a nudge to re-read `table()`; a 6-second poll
  (the web app's interval) covers presence, which expires, and events missed while the stream
  reconnects.

The rules live in the contract (see `../docs/trust-model.md`): `table()` returns the position as a
FEN *and* every legal move in it, so the apps contain no chess engine. The board highlights only the
squares the contract named, asks for the promotion piece only when the contract lists one, and
nothing is shown optimistically.

## Screens

1. **Sign in** — what the app is, "Sign in with Calimero", an invited banner when a link is waiting.
2. **Tables** — every table in every club, with its title, players and whose move it is; pull to
   refresh; swipe a row to share an invitation; empty and no-relay states. The + menu has **New
   table** (sheet: title, club) and **Join with a link** (sheet: paste a link).
3. **Join this table?** — asked before an invitation link (opened or pasted) does anything; ids
   behind **Details**.
4. **Table** — the board between the two player bars (name, presence, captures, "To move", sit /
   play this side too / stand), the game card (status, offer / accept / decline / claim a draw,
   resign with confirmation, rematch), your name when not seated, the scoresheet and the record of
   finished games. Toolbar: invite (share sheet), refresh, **Details** (context, namespace, your id,
   FEN). Promotion picker sheet. Haptics on moves and primary actions.
5. **Account** — sign out (confirmed), account id behind **Details**, acknowledgements.

## Generated contract client

`ios/ChessCore/Sources/MeroChessGenerated/MeroChessClient.swift` and
`android/app/src/main/kotlin/network/calimero/chess/generated/MeroChessClient.kt` are generated from
`../logic/res/abi.json` by `@calimero-network/abi-codegen` (mero-devtools-js) and committed.
Regenerate both after an ABI change:

```bash
ABI_CODEGEN=/path/to/mero-devtools-js/abi-codegen/dist/cli.js ./scripts/regenerate.sh
```

(Without `ABI_CODEGEN` it runs the published CLI through `npx`; the Swift and Kotlin targets need a
build that has them.) Each generated file declares its own `ContextContractCalling`; a small adapter
(`ChessClient.swift` / `ChessClient.kt`) forwards it to the SDK's.

The piece artwork is exported from the web app by `scripts/export-pieces.mjs` (see
`THIRD_PARTY_NOTICES.md`).

## Build and test

iOS — the non-UI layer (generated client, board helpers, view models) is a local SwiftPM package
that builds and tests on macOS with no simulator:

```bash
cd ios
swift test --package-path ChessCore
brew install xcodegen && xcodegen generate && open MeroChess.xcodeproj
```

Android:

```bash
cd android
./scripts/fetch-sdk.sh            # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

The view-model tests run against the SDKs' fakes (`InMemoryAppBackend`, `RecordingContextContract`).

## Sign-in callback

Both apps default to `mero-chess://enrol` (iOS: `MeroChessCallback*` keys in `project.yml`; Android:
`meroEnrolCallback` in `gradle.properties`). The hosted wallet returns only to `https://` callbacks
today, so production sign-in needs that wallet change or a verified https callback (iOS Associated
Domains, Android App Links), as for Mero Chat. Cloud, wallet and registry URLs are overridable the
same way.

## Not in the apps (and why)

- **Namespace-wide display names** (`@calimero-apps/names`): the web app falls back to a name the
  player set for the whole namespace. The apps use the name given at the table (else a short id);
  the names package has no native port yet.
- **Heartbeat presence**: as on the web, presence is announced once on opening a table.
- **Push notifications** for "your move": not in the SDKs yet (see the mobile build plan).
- **Universal links**: `links.calimero.network` publishes no apple-app-site-association /
  assetlinks for this app, so an https invitation opens via the chooser (Android) or Safari; pasting
  the link into **Join with a link** always works. The `calimero://` scheme is registered by every
  Calimero app, so with several installed iOS hands it to one of them.

## CI

`.github/workflows/mero-chess-ios.yml` (macOS: `swift test` on ChessCore, XcodeGen, simulator build)
and `.github/workflows/mero-chess-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android
lint, `assembleDebug`), each path-filtered to its folder.
