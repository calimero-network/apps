# Mero Kombat: native mobile apps

Native iOS and Android clients for Mero Kombat, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.mero-kombat`). Both apps are **landscape only** and have the same
screens, copy, icons (SF Symbols ↔ Material Symbols) and flows. The fight itself is the **web app's
engine** (`../app/src/game`, unchanged) running in a WebView, bundled into the app as local assets.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI + WKWebView, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `6c5f116` (head of `feat/calimero-1.0`, swift-sdk#85; moves to its merge commit once it lands), in `ios/project.yml` and `ios/KombatCore/Package.swift`. **Calimero 1.0.** |
| Android | `android/` | Jetpack Compose + Material 3 + WebView, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (kotlin-sdk#67 merge commit on `main`), composite build at the SHA in `android/kotlin-sdk.ref` |
| Game page | `web/` | TypeScript, built with the web app's Vite | the web app's engine, imported as is |

**The iOS app runs on Calimero 1.0; the Android app (kotlin-sdk#67's `main` merge commit) still
speaks the 0.x API until kotlin-sdk is ported.** Bumping is one
line per platform (iOS: both `revision:` values; Android: `kotlin-sdk.ref`).

## Calimero 1.0 on iOS

- **Sign in** with a passkey on the arena's cluster (`MeroAppSession.signIn()`, the device's
  platform passkey), or **create an account** (`signUp(name:)`). The session (a 15-minute access
  token and a 30-day refresh token) is kept in the Keychain and refreshed at launch. Every request
  goes over the sealed channel to an attested node.
- **The cluster** is `MeroNodeURL` in `ios/project.yml` (a node from Calimero Cloud's console, plus
  `MeroNodes` for failover). Left empty, the sign-in screen asks for one.
- **Development**: on the sign-in screen, "Choose your cluster" (or "Change") takes any node URL
  and a "Development cluster" switch, which trusts mock attestation (`allowMock`) as `merod local`
  serves it (`cargo run -p merod -- local`, nodes on `http://127.0.0.1:2501-2503`). The app then
  keeps a soft passkey for that node and creates its account on the first sign-in. Or set
  `MeroNodeURL` and `MeroAllowMock: "YES"` in `project.yml`.
- **Words**: an arena lives in an **organization** (one link admits to every arena in it) and is an **app instance** of `com.calimero.mero-kombat` there. The fighters' positions travel as the arena's **1.0 presence** (`CalimeroPresenceChannel`: `POST /apps/{app}/presence`, read off `/apps/{app}/presence/stream`; at most 4 KiB a slice, which a fighter's JSON slice is far under). The bridge protocol between the game page and the app is unchanged.
- **Invitations** are org invite tokens (`POST /orgs/{org}/invites`, redeemed with
  `POST /invites/{token}/redeem`). The link keeps its URL; its payload is swift-sdk's
  `OrgInvitation`, `{"invitation": "inv_…", "namespaceId": "…", "contextId"?: "…", "name"?: "…"}`,
  which every 1.0 client of the package reads. Android and the web still use the 0.x signed
  invitation until they are ported, so links do not cross between them and iOS yet.
- **Approvals**: when a node release or an app upgrade waits for the account (or an organization it
  owns), the arenas list shows it under "Needs your approval". "Review" opens the **node's consent page in
  the system browser**; the page returns to `mero-kombat://consent`. The app never approves by itself.
  A call refused because a release deadline has passed says so in words.
- A real cluster's passkeys need the app to carry the `webcredentials:<rp-id>` Associated Domain of
  that cluster; it is not set in `project.yml` yet.

## Android (0.x): delegated execution

The Android app runs and logs into no node. The person signs in with their Calimero account (the wallet
certifies this device's key), and everything goes through the account's relay via the SDKs'
`MeroAppSession` / `MeroAppBackend`:

- **Reads** (`arena`, `history`) are the relay's account-scoped query; **writes** (`act`, `sit`,
  `stand`, `pick`, `rematch`, `join`) are warrants the device key signs. All go through the generated
  `KombatClient` over `contract.bound(to: contextId)`; no contract call is hand-written.
- **An arena is one context**, created directly in its namespace, exactly as the web app's picker does,
  so the namespace invitation an arena mints is the one that admits to it.
- **Invitations** use the web app's format both ways
  (`https://links.calimero.network/com.calimero.mero-kombat/join?invitation=<base58(deflate({invitation, namespaceId, contextId}))>`,
  plus `calimero://`), redeemed by direct admission (`joinNamespace`).
- **Movement is presence, actions are transactions**, as on the web: the page streams this fighter
  at 15 slices a second through the relay's presence (`RelayPresenceClient`, device-signed), newest
  slice wins and stale ones are dropped (`SlicePublisher`); every finished action is one `act`.
- **Live updates:** every relay event for the arena is a nudge to re-read `arena()` (coalesced, at
  least 160 ms apart, as the web app); a 3-second poll covers missed events.

## The game page and the bridge

`web/src/main.ts` is a second entry point for the web engine: it mounts `Game` from
`../app/src/game/controller.ts` on one full-screen canvas in a game-only mode (no router, no landing
page, no mero-react, no network). `scripts/build-web.sh` builds it with the web app's Vite into one
classic-script `game.js` + `index.html` and copies them to `ios/Resources/Game` and
`android/app/src/main/assets/game`, where they ship in the app package (committed; rebuild after an
engine change). **No web-app source is changed**: the entry point lives here and imports the engine.

The bridge (`web/src/protocol.ts`, `Bridge.swift`, `Bridge.kt`, same wire form, pinned by unit tests
on both platforms):

- Page → native: JSON posted to `webkit.messageHandlers.meroBridge` / `MeroBridgeAndroid`:
  `ready`, `query`/`execute` (from `window.meroBridge.query/execute(method, args)`), `presence`, `over`.
- Native → page: `window.meroGame.receive(…)`: `boot` (mode, seat, fighters), `state` (each
  `arena()` read), `slice` (the opponent), `press` (the fight pad), `result`, `pause`/`resume`,
  `restart`, `mute`.
- `query`/`execute` are answered by `GameCalls` through the generated client, with an allowlist: the
  page can send `act` and read `arena`/`history`, nothing else (it can never sit, stand or rematch).

## Controls

The web app's keycaps become a native **fight pad**, identical on both platforms: left thumb an
8-way directional pad (dead zone in the middle, 22.5° diagonals), right thumb a 2×2 cluster, Block and
Special over Punch and Kick. `DPad` / `PadTracker` / `PadAction` map touches to the engine's
`Controls.press(button, down)` (unit-tested on both platforms). Touches are read in the raw touch
pass (UIKit `touchesBegan/Moved`, Compose `pointerInput`), and each change is sent at once; the engine
simulates it locally on the next 60 Hz step. Haptic on each action press. The screen stays awake on
the fight screen; going to the background releases every button and pauses the page.

**Latency is the risk, not presence:** the opponent's position travels as relay presence, and each
action is a relay round trip before it counts. Input itself never waits on the network, but **test a
real fight on cellular** (both phones off Wi-Fi) before calling this done; the top bar shows the
confirmed transaction count and the last round trip.

## Screens

1. **Sign in**: what the app is; on iOS "Sign in with a passkey" / "Create an account" on the cluster (Android: "Sign in with Calimero"); "Practice vs CPU"; an invited banner.
2. **Arenas**: Practice vs CPU first, then every arena (both fighters, title, players, tx count,
   state); pull to refresh; swipe to invite; empty and no-relay states. The + menu has **New arena**
   (sheet: title, namespace) and **Join with a link**.
3. **Join this arena?**: asked before an invitation does anything; ids behind **Details**.
4. **Arena** (the fight): the game edge to edge, the fight pad, a bar with back, title, status,
   tx meter, sound, **Fighters** (both corners with presence and wins, Fight here / Leave, your name,
   fighter select, how to fight, rematch) and a menu (Invite, **Record**, Refresh, **Details**).
   Watching: "Take a corner". Waiting: "Invite an opponent". Match over: "Rematch".
5. **Practice**: the same fight against the CPU, offline; choose your fighter; rematch.
6. **Account**: sign out (confirmed), account id behind **Details**.

## Generated contract client

`ios/KombatCore/Sources/KombatCore/Generated/KombatClient.swift` and
`android/app/src/main/kotlin/network/calimero/kombat/generated/KombatClient.kt` are generated from
`../logic/res/abi.json` with `--transport-import`, so they take the SDK's `ContextContractCalling`
directly. Regenerate after an ABI change:

```bash
ABI_CODEGEN=/path/to/mero-devtools-js/abi-codegen/dist/cli.js ./scripts/regenerate.sh
```

## Build and test

```bash
./scripts/build-web.sh                         # the game page, into both apps (needs `pnpm install`)

cd ios
swift test --package-path KombatCore           # bridge, pad mapping, view models (macOS, no simulator)
brew install xcodegen && xcodegen generate && open MeroKombat.xcodeproj

cd ../android
./scripts/fetch-sdk.sh                         # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

View-model tests run against the SDKs' fakes (`InMemoryAppBackend`, `RecordingContextContract`).

## Callbacks

iOS: the node's consent page returns to `mero-kombat://consent` (`MeroKombatCallback*` keys in
`project.yml`); the cluster is `MeroNodeURL` / `MeroNodes` / `MeroAllowMock`. Android: sign-in
returns to `mero-kombat://enrol` (`meroEnrolCallback` in `gradle.properties`); the hosted wallet
returns only to `https://` callbacks today, so production sign-in needs a verified https callback.
Cloud, wallet and registry URLs are overridable the same way.

## Not in the apps (and why)

- **The chain panel** (tps chart, p50/p95, per-transaction log): reduced to the top bar's meter and
  the Details sheet; a chart over the fight would cost thumb room on a phone.
- **Namespace-wide display names** read back for unnamed corners (`@calimero-apps/names`): sitting
  publishes your name to the namespace (`setMemberName`), but an unnamed corner reads "Corner 1/2".
- **Fighter portraits** drawn by the engine: the shell uses a figure in the fighter's colour.
- **Universal links**: `links.calimero.network` publishes no apple-app-site-association/assetlinks
  for this app; pasting the link into **Join with a link** always works.
