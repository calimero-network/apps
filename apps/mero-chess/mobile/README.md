# Mero Chess — native mobile apps

Native iOS and Android clients for Mero Chess, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.mero-chess`). Both apps have the same screens, copy, icons (SF
Symbols ↔ Material Symbols) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0`, in `ios/project.yml` and `ios/ChessCore/Package.swift` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `v0.2.0` (not on Maven Central), composite build at the SHA in `android/kotlin-sdk.ref` |

The pins are SDK releases. Bumping is one line per platform (iOS: both `exactVersion` / `exact:`
values; Android: `kotlin-sdk.ref`, the new tag's commit).

## Calimero 1.0

Both apps talk to a Calimero 1.0 cluster through the SDKs' `MeroAppSession` / `MeroAppBackend`,
over the sealed channel to an attested node:

- **Sign-in**: Calimero Cloud, by cluster name (`eu-shared-1`, its nodes read from the Cloud
  directory) or by a node URL, then the device's passkey ("Create an account" registers a new one);
  or a **Development node** (`merod local`, mock attestation allowed, a software passkey kept on the
  device for that node).
- **The contract** is the component port's (`../logic/res/abi.json`): views `table` / `history`,
  calls `join`, `sit`, `stand`, `play`, `resign`, `offerDraw`, `acceptDraw`, `declineDraw`,
  `claimDraw`, `rematch`, `heartbeat`. Every `now` and every `u64` in an answer is a decimal string;
  refusals are `APP_ERROR {code, fields}`, shown in the web app's words. The typed client
  (`ChessContract.swift` / `contract/MeroChessClient.kt`) is written by hand from the ABI, as the
  web app's `src/chess.ts` is (no client is generated from a component ABI yet); `ContractTests`
  checks its method lists against the committed ABI.
- **A table is one app instance**, created directly in an organization ("club"), so the org invite
  a table mints is the one that admits to it.
- **Invitations** are org invite links
  (`https://links.calimero.network/com.calimero.mero-chess/join?invitation=<base58(deflate({invitation: "inv_…", namespaceId, contextId}))>`,
  plus `calimero://`), redeemed with `POST /invites/{token}/redeem`. Pre-1.0 links are refused.
- **Approvals**: newer Mero Chess releases and node releases that wait for the person show on the
  Tables screen. "Review" first shows the node's confirmation code, then opens the node's consent
  page in the system browser (Custom Tab on Android); the page sends the person back to
  `mero-chess://consent`.
- **Live updates**: every event for the table is a nudge to re-read `table()`; a 6-second poll (the
  web app's interval) covers presence and events missed while the stream reconnects.
- **Errors** in plain words: a cancelled passkey prompt, an ended session, a node that doesn't serve
  the account, an unavailable cluster, a release deadline, a stale approval, and each contract code.

The rules live in the contract (see `../docs/trust-model.md`): `table()` returns the position as a
FEN *and* every legal move in it, so the apps contain no chess engine. The board highlights only the
squares the contract named, asks for the promotion piece only when the contract lists one, and
nothing is shown optimistically.

## Screens

1. **Sign in** — what the app is, Calimero Cloud (cluster name or URL, passkey sign-in or create
   an account) or a development node, an invited banner when a link is waiting.
2. **Tables** — every table in every club, with its title, players and whose move it is; pull to
   refresh; swipe a row to share an invitation; empty states; what waits for approval. The + menu has **New
   table** (sheet: title, club) and **Join with a link** (sheet: paste a link).
3. **Join this table?** — asked before an invitation link (opened or pasted) does anything; ids
   behind **Details**.
4. **Table** — the board between the two player bars (name, presence, captures, "To move", sit /
   play this side too / stand), the game card (status, offer / accept / decline / claim a draw,
   resign with confirmation, rematch), your name when not seated, the scoresheet and the record of
   finished games. Toolbar: invite (share sheet), refresh, **Details** (app instance, organization, your id,
   FEN). Promotion picker sheet. Haptics on moves and primary actions.
5. **Account** — sign out (confirmed), account id behind **Details**, acknowledgements.

## Piece artwork

The piece artwork is exported from the web app by `scripts/export-pieces.mjs` (see
`THIRD_PARTY_NOTICES.md`).

## Build and test

iOS — the non-UI layer (typed contract client, board helpers, view models) is a local SwiftPM package
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

## Consent callback and defaults

The node's consent page returns to `mero-chess://consent` (iOS: `MeroChessCallback*` keys in
`project.yml`, an https host replaces the scheme when set; Android: `meroConsentCallback` in
`gradle.properties`, the manifest filter follows it). The prefilled cluster and development node are
`CalimeroClusterURL` / `DefaultNodeURL` (iOS) and `meroCluster` / `meroDevNodeUrl` (Android). Passkey
sign-in on a real cluster needs the cluster's relying party as an associated domain (iOS
`webcredentials:`) or Digital Asset Links (Android).

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

`.github/workflows/mero-chess-ios.yml` (macOS: `swift test` on ChessCore, XcodeGen, build)
and `.github/workflows/mero-chess-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android
lint, `assembleDebug`), each path-filtered to its folder.
