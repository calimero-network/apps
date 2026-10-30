# Battleships — native mobile apps

Native iOS and Android clients for Battleships, next to the web frontend (`../app`) and the two
services (`../logic`: lobby, `../logic/crates/game`: game). Both apps have the same screens, copy,
icons (SF Symbols / Material Icons) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `a1ec644` (head of swift-sdk#85, `feat/calimero-1.0`, Calimero 1.0; moves to its merge commit once it lands), in `ios/project.yml`, `ios/BattleshipsCore/Package.swift` and `Package.resolved` |
| Android | `android/` | Jetpack Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (merge commit of kotlin-sdk#67 on `main`), composite build from `android/kotlin-sdk.ref` |

## How the apps reach Calimero

**iOS runs on Calimero 1.0.** The app talks to a node of a Calimero Cloud cluster over the sealed
channel (`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and signs in with
a passkey. `MeroAppSession` builds the SDK's `CloudAppBackend`; the words map one to one:

| The app | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| lobby | namespace | organization (metadata `package = com.calimero.battleships`) |
| lobby / match | context | app instance (`POST /apps {package, service, org}`) |
| invitation | `OrgInvitation` | org invite token (`POST /orgs/{org}/invites`, redeemed at `/invites/{token}/redeem`) |

Sign-in (`ios/Sources/App/CloudAccess.swift`):

- **Calimero Cloud:** a node URL of your cluster (from cloud.calimero.network; `MeroNodeURL` in
  `ios/project.yml` prefills it), then *Sign in with passkey* or *Create an account*. The device's
  passkey belongs to the cluster's relying party: add the `webcredentials:<rp-id>` associated
  domain to the app for a real cluster.
- **Development node:** a `merod local` node (`MeroDevNodeURL`, `http://localhost:2501` by
  default), mock attestation allowed (`allowMock`), with a software passkey the SDK keeps for it.
- **Approvals** (account menu): node releases and app upgrades waiting for you, per lobby and for
  your own apps. *Review* opens the node's consent page in the system browser, which returns to
  `battleships://consent`. The app's own session cannot approve anything.

**Android still runs on 0.x** (delegated execution through the account's relay, wallet sign-in);
its port follows the kotlin-sdk's.

## Screens

1. **Sign in**: what the game is; on iOS a passkey (Calimero Cloud) or a development node; an
   invitation that arrived first is named.
2. **Lobbies**: every lobby (namespace) you are in; new lobby sheet; join with a pasted link;
   pull to refresh; sign out.
3. **Lobby**: Matches / Players / Record tabs. Your matches (in play first), players you can
   challenge, your wins/losses/played and the lobby's history. Invite (share or copy a link) and
   New match (pick an opponent).
4. **Match**:
   - *Place your fleet*: tap a square to place the selected ship (it slides back from the edge),
     tap a placed ship to turn it, pick a ship in the tray to place or move it (long-press /
     context menu to take it back), Across/Down, Shuffle, Clear, then Deploy.
   - *Waiting* for the opponent to deploy.
   - *Battle*: whose turn it is, their waters / your fleet, tap a square to aim and tap again (or
     Fire) to shoot. Hits, misses, sunk ships and shots waiting for an answer each have their own
     look and icon; both fleets' sunk counts.
   - *Result*: Victory / Defeat / Checking the boards / No winner, why it ended, both boards,
     Rematch and back to the lobby.
   - Ids, the commitment and the keys sit behind **Details**.

Live updates: the relay's event stream for the open lobby or match, with a poll as the fallback
and safety net (5 s in a match, 10 s in a lobby).

## The two services

The bundle has a lobby service and a game service. Both clients are generated
(`scripts/codegen.sh`), one Swift module / Kotlin package each (each generated file declares its own
`ContextContractCalling`):

- `ios/BattleshipsCore/Sources/LobbyGenerated`, `.../GameGenerated`
- `android/app/src/main/kotlin/network/calimero/battleships/generated/{lobby,game}`

As in the web app, the lobby context and every match's game context live in the namespace's root
group (the game reports the result to the lobby with an `xcall`, which only works inside one
group). A lobby is a namespace founded through the relay plus a context of the `lobby` service; a
match is `create_match` in the lobby, a context of the `game` service with the match's `init`
arguments, then `set_match_context_id`. The lobby context is found by its service name, never by
being first.

**Services on iOS (1.0).** An instance is created per service with
`MeroAppBackend.createContext(…, service:)` and tagged with its service in its metadata
(`{"name", "service"}`), so the lobby is found by service, never by being first
(`ServiceBattleshipsBackend`). Android still goes through the 0.x account admin
(`admin.createContext(CreateContextRequest(serviceName:))`).

## The board never leaves the phone

The game is a SHA-256 commit-reveal, byte for byte the web app's (`app/src/lib/board.ts`) and the
contract's (`compute_commitment`):

    commitment = hex(SHA256(borsh(Vec<u8> cells) || salt))   // 4-byte LE length, 100 cells, 16-byte salt

CryptoKit on iOS, `java.security.MessageDigest` on Android, the salt from `SecRandomCopyBytes` /
`SecureRandom`. Deploying seals the fleet, saves the cells and salt on the device FIRST (iOS
Keychain, this device only; Android private SharedPreferences with backup off; the web app's JSON
under the web app's key), and only then files the commitment. Each shot at you is answered from
that board automatically; when the answers end the match the board is revealed and every reader
audits it. A fleet deployed on another device cannot be answered from here; the match says so.

Both test suites pin two vectors computed with the web app's own `computeCommitment` (one is also
the contract's `commitment_vector_shared_with_the_client`), and assert that nothing but the
commitment is sent before the reveal.

**Codegen gap.** The generated `revealBoard` types the contract's `salt: [u8; 16]` (ABI
`bytes` with `size: 16`) as a `String`; the contract reads a JSON array of 16 numbers (what the web
app's `CalimeroBytes` sends). `reveal_board` is therefore the one call written by hand
(`GameClient.reveal` / `GameApi.reveal`); every other call goes through the generated clients.
`get_current_turn` returns `null` once a match is over, which the generated `String` decode
refuses; it is read leniently.

## Invitations

iOS links carry Calimero 1.0's org invite token in the SDK's shape (`InvitationLinkPayload`):
`https://links.calimero.network/com.calimero.battleships/join?invitation=<base58(deflate(json))>`
with `{"invitation": {"orgId", "token"}, "namespaceId", "__lobbyName", "__inviterKey"}`. Pre-1.0
signed invitations are not read (a 1.0 cluster cannot redeem them). Android and the web app still
write the 0.x `{"invitations": [{"groupId", "invitation", "groupAlias"}]}` payload until their
ports. `calimero://com.calimero.battleships/join?…` and pasted links open the same join sheet.

## Build and test

```bash
# iOS (no simulator needed for the logic)
cd ios
swift test --package-path BattleshipsCore
xcodegen generate && open Battleships.xcodeproj

# Android
cd android
./scripts/fetch-sdk.sh          # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

Regenerate the contract clients after an ABI change:

```bash
CODEGEN=/path/to/mero-devtools-js/abi-codegen/dist/cli.js ./scripts/codegen.sh
```

iOS: the cluster is `MeroNodeURL` and the development node `MeroDevNodeURL` (`ios/project.yml`
Info keys); the consent page returns to `battleships://consent`. Android: sign-in callbacks
default to `battleships://enrol`, with the Cloud, wallet and registry URLs in
`android/gradle.properties`.

CI: `.github/workflows/battleships-ios.yml` (`swift test` on the core package, then a simulator
build of the app) and `battleships-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.

## Not in the mobile apps yet

- **Display names.** The web app shows namespace member names; the apps show "You" and short
  player keys. The SDK's app session has no member-metadata read yet.
- **Members who have not opened the lobby.** The web lists the group's members and marks who has
  not opened the lobby; the apps list players from the contract's `get_players` (who you can
  actually challenge). The group member list is not on `MeroAppBackend`.
- **Push notifications** for "your turn": the apps refresh live while open (events + polling).
- **Typing a player key by hand**: challenge is by picking a player who opened the lobby.
