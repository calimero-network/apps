# Battleships — native mobile apps

Native iOS and Android clients for Battleships, next to the web frontend (`../app`) and the
component contract (`../logic`). Both apps have the same screens, copy, icons (SF Symbols /
Material Icons) and flows, and both run on **Calimero 1.0**.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0`, in `ios/project.yml`, `ios/BattleshipsCore/Package.swift` and `Package.resolved` |
| Android | `android/` | Jetpack Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (not on Maven Central), composite build from `android/kotlin-sdk.ref` |

Both pins are SDK releases (kotlin-sdk is not on Maven Central, so Android builds it from source).
To bump: iOS, the `exactVersion` / `exact:` values; Android, `kotlin-sdk.ref` (the new tag's commit).

## How the apps reach Calimero

The apps talk to nodes of a Calimero 1.0 cluster over the sealed channel
(`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and sign in with a
passkey. `MeroAppSession` builds the SDK's `CalimeroAppBackend`; the words map one to one:

| The app | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| lobby | namespace | organization |
| the lobby's game | context | one app instance of `com.calimero.battleships` in the org (`POST /apps {package, org}`) |
| match | — | rows in that instance, keyed by match id (no instance per match) |
| invitation | `OrgInvitation` | org invite token (`POST /orgs/{org}/invites`, a passkey step-up; redeemed at `/invites/{token}/redeem`) |
| player name | `listMembers` | org member metadata `{name}` |

Sign-in (iOS `ios/Sources/App/CloudAccess.swift`, Android `ui/CloudAccess.kt` + `MainActivity.kt`):

- **Calimero Cloud:** the cluster's name (looked up in the Calimero directory) or a node URL of
  it, then *Sign in with passkey* or *Create an account*. iOS prefills it from `MeroNodeURL`
  (`ios/project.yml`), Android from `-PmeroCluster` (`android/gradle.properties`). The device's
  passkey belongs to the cluster's relying party: add the `webcredentials:<rp-id>` associated
  domain (iOS) / Digital Asset Links (Android) for a real cluster.
- **Development node:** a `merod local` node (iOS `MeroDevNodeURL`, `http://localhost:2501`;
  Android `meroDevNodeUrl`, `http://10.0.2.2:2501`), mock attestation allowed, with a software
  passkey the app keeps for it. Android allows cleartext to it in debug builds only.
- **Approvals** (account menu): node releases and app upgrades waiting for you, per lobby and for
  your own apps. *Review* shows the confirmation code first, then opens the node's consent page
  in the system browser / a Custom Tab, which returns to `battleships://consent`. The app's own
  session cannot approve anything.

## The contract

The apps call the component contract as the web app does, through `BattleshipsClient`, generated
from `../logic/res/abi.json` by core's `mero-app-build codegen` into
`ios/BattleshipsCore/Sources/BattleshipsCore/Generated/` and `android/.../generated/`. Run
`scripts/mobile-codegen.sh` at the repo root after an ABI change (CI's `Mobile clients` workflow
fails on a stale client). Until the logic derives `AbiType`, the ABI names the contract's types
without their shape, so the client answers their JSON and `Contract.swift` / `core/Contract.kt`
read it into the types they keep:

- calls `registerPlayer`, `createMatch`, `commitBoard`, `proposeShot`, `acknowledgeShot`,
  `revealBoard`; views `getPlayers`, `getMatches`, `getPlayerStats`, `getHistory`, `getShots`,
  `getIncomingShots`, `getMatchState`, `getCurrentTurn`, … with camelCase arguments
  (`matchId`, `shotId`, `boardBytes`);
- result fields stay snake_case; u64s (`created_ms`, `finished_ms`, `wins`, …) arrive as decimal
  strings;
- `revealBoard` sends `boardBytes` and the 16-byte `salt` as base64url (no padding);
- refusals are `422 APP_ERROR {code, fields}`, shown in words per code (`NotFound`, `Invalid`,
  `Forbidden`, `Finished`, `MatchIdCollision`, `AlreadyCommitted`, `CommitmentMismatch`;
  `Invalid` / `Forbidden` carry their own sentence). Transport errors read plainly too: a
  dismissed passkey sheet, an ended session, a busy cluster, a release deadline, a stale consent.

A lobby is found as the org's one app instance; `createMatch` starts a match (status `Pending`
until both fleets are committed, and a pending match opens straight to fleet placement). One event
stream per lobby keeps the lobby and the open match fresh, with a poll as the safety net (5 s in a
match, 10 s in a lobby).

## Screens

1. **Sign in**: what the game is; Calimero Cloud (passkey) or a development node; an invitation
   that arrived first is named.
2. **Lobbies**: every lobby you are in; new lobby sheet; join with a pasted link; pull to refresh;
   Approvals; sign out.
3. **Lobby**: Matches / Players / Record tabs. Your matches (in play first), players you can
   challenge (by the name they set in the org), your wins/losses/played and the lobby's history.
   Invite (share or copy a link) and New match (pick an opponent).
4. **Match**:
   - *Place your fleet*: tap a square to place the selected ship (it slides back from the edge),
     tap a placed ship to turn it, pick a ship in the tray to place or move it (long-press /
     context menu to take it back), Across/Down, Shuffle, Clear, then Deploy.
   - *Waiting* for the opponent to deploy.
   - *Battle*: whose turn it is, their waters / your fleet, tap a square to aim and tap again (or
     Fire) to shoot.
   - *Result*: Victory / Defeat / Checking the boards / No winner, why it ended, both boards,
     Rematch and back to the lobby.
   - Ids, the commitment and the accounts sit behind **Details**.

## The board never leaves the phone

The game is a SHA-256 commit-reveal, byte for byte the web app's and the contract's:

    commitment = hex(SHA256(borsh(Vec<u8> cells) || salt))   // 4-byte LE length, 100 cells, 16-byte salt

CryptoKit on iOS, `java.security.MessageDigest` on Android, the salt from `SecRandomCopyBytes` /
`SecureRandom`. Deploying seals the fleet, saves the cells and salt on the device FIRST (iOS
Keychain, this device only; Android private SharedPreferences with backup off), and only then files
the commitment. Each shot at you is answered from that board automatically; when the answers end
the match the board is revealed and the contract audits it. A fleet deployed on another device
cannot be answered from here; the match says so.

Both test suites pin two commitment vectors shared with the web app and the contract, and assert
that nothing but the commitment is sent before the reveal.

## Invitations

Links carry Calimero 1.0's org invite token in the SDK's shape (`OrgInvitation`):
`https://links.calimero.network/com.calimero.battleships/join?invitation=<base58(deflate(json))>`
with `{"invitation": "inv_…", "namespaceId", "name", "__lobbyName", "__inviterKey"}`. Pre-1.0
signed invitations are not read (a 1.0 cluster cannot redeem them).
`calimero://com.calimero.battleships/join?…` and pasted links open the same join sheet. (The web
app's own links are `?invite=<token>&lobby=<app>` on its origin.)

## Build and test

```bash
# iOS (no simulator needed)
cd ios
swift test --package-path BattleshipsCore
xcodegen generate
xcodebuild build -project Battleships.xcodeproj -scheme Battleships \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO

# Android
cd android
./scripts/fetch-sdk.sh          # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

The iOS demo (Debug, launch argument `-MeroDemo YES`) runs the whole app on an in-memory backend
that answers the component contract's wire shape; `UITests/TourTests.swift` screenshots it.

CI: `.github/workflows/battleships-ios.yml` (`swift test` on the core package, then a build of the
app) and `battleships-android.yml` (ktlint, detekt, unit tests, Android Lint, `assembleDebug`),
each path-filtered to its folder.

## Not in the mobile apps yet

- **Members who have not opened the lobby.** The apps list players from the contract's
  `getPlayers` (who you can actually challenge), not every org member.
- **Setting your display name** in the org from the app (names set on the web show up).
- **Push notifications** for "your turn": the apps refresh live while open (events + polling).
- **An Android demo mode**: the in-memory demo is iOS only.
