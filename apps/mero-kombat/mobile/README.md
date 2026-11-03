# Mero Kombat: native mobile apps

Native iOS and Android clients for Mero Kombat, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.mero-kombat`). Both apps are **landscape only** and have the same
screens, copy, icons (SF Symbols ↔ Material Symbols) and flows. The fight itself is the **web app's
engine** (`../app/src/game`, unchanged) running in a WebView, bundled into the app as local assets.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI + WKWebView, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0`, in `ios/project.yml` and `ios/KombatCore/Package.swift` |
| Android | `android/` | Jetpack Compose + Material 3 + WebView, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `v0.2.0` (not on Maven Central), composite build at the SHA in `android/kotlin-sdk.ref` |
| Game page | `web/` | TypeScript, built with the web app's Vite | the web app's engine, imported as is |

**Both apps run on Calimero 1.0** and call the contract's component ABI (`../logic/res/abi.json`
after apps#711). The SDK pins are releases: swift-sdk `v0.5.0` and kotlin-sdk `v0.2.0`.
Bumping is one line per platform (iOS: both `exactVersion` / `exact:` values; Android:
`kotlin-sdk.ref`, the new tag's commit).

## Calimero 1.0

- **Sign in**: "Sign in with Calimero Cloud" takes the cluster's **name** (its nodes come from the
  node directory, failover included) or a node's URL; then a passkey on that cluster ("Sign in with a
  passkey", or "Create an account"). Every request goes over the sealed channel to an attested node.
  The account session is kept in the Keychain / Keystore-encrypted preferences and refreshed at launch.
- **Development node**: the second sign-in button takes a `merod local` URL
  (`http://127.0.0.1:2501` from the iOS simulator, `http://10.0.2.2:2501` from the Android emulator)
  and trusts its mock attestation (`allowMock`). The app keeps a soft passkey for that node and
  creates its account on the first sign-in. Android allows cleartext http to those hosts in debug
  builds only (`src/debug`).
- **Presets** (optional; sign-in asks when unset): iOS `MeroNodeURL` / `MeroNodes` / `MeroAllowMock`
  in `ios/project.yml`; Android `-PmeroCluster=…`, `-PmeroNodeUrl=…`, `-PmeroAllowMock=true`.
- **Words**: an arena lives in an **organization** (one link admits to every arena in it) and is an
  **app instance** of `com.calimero.mero-kombat` there. Technical ids sit behind **Details**.
- **The contract** (`KombatClient`, typed by hand on both platforms from the component ABI, as the
  web app's `app/src/kombat.ts`): calls `join`, `pick`, `sit`, `stand`, `act`, `rematch`; views
  `arena`, `history`. Fields are camelCase (`matchIndex`, `mySeat`, `roundsWon`), every `u64` is a
  decimal string (`now`, `createdAt`, `totalActions`, `hits[].at`, `startedAt`), and `init(title?, now?)`
  gets both from the app. `ContractTests` / `ContractTest` check the method lists against the ABI.
- **Errors** read as words: the contract's refusals (`APP_ERROR` `CornerTaken`, `RoundOver`,
  `MatchNotFinished`, `MatchLimit`, …) in the web app's sentences, and the node's
  (`LoginRequired`, `WrongNode`, `Unavailable`, `ReleaseDeadline`, `ConsentStale`, a cancelled
  passkey).
- **Presence**: the fighters' positions travel as the arena's **1.0 presence**
  (`CalimeroPresenceChannel`: `POST /apps/{app}/presence`, read off `/apps/{app}/presence/stream`; at
  most 4 KiB a slice, which a fighter's JSON slice is far under). One slice in flight, only the
  newest waits (`SlicePublisher`); every finished action is one `act`.
- **Live updates**: every event of the arena is a nudge to re-read `arena()` (coalesced, at least
  160 ms apart, as the web app); a 3-second poll covers missed events.
- **Invitations** are org invite tokens (`POST /orgs/{org}/invites`, a passkey step-up; redeemed with
  `POST /invites/{token}/redeem`). The link is
  `https://links.calimero.network/com.calimero.mero-kombat/join?invitation=…` (plus `calimero://`);
  its payload is the SDKs' `OrgInvitation`,
  `{"invitation": "inv_…", "namespaceId": "…", "contextId": "…"}`, the same on iOS, Android and the
  web. Pre-1.0 links are refused.
- **Approvals**: when a node release or an app upgrade waits for the account (or an organization it
  owns), the arenas list shows it under "Needs your approval". "Review" asks the node, **shows the
  confirmation code first**, then opens the **node's consent page in the system browser** (Custom
  Tab on Android), which returns to `mero-kombat://consent`. The app never approves by itself.
- A real cluster's passkeys need the app to carry that cluster's `webcredentials:<rp-id>` Associated
  Domain (iOS) / Digital Asset Links (Android); neither is set yet.

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
- `query`/`execute` are answered by `GameCalls` through `KombatClient`, with an allowlist: the
  page can send `act` and read `arena`/`history`, nothing else (it can never sit, stand or rematch).
- The page's wire form predates the component ABI and is unchanged (snake_case `match_index`,
  `my_seat`, …; `now` a number). `GameCalls` is the one place it meets the contract's camelCase.

## Controls

The web app's keycaps become a native **fight pad**, identical on both platforms: left thumb an
8-way directional pad (dead zone in the middle, 22.5° diagonals), right thumb a 2×2 cluster, Block and
Special over Punch and Kick. `DPad` / `PadTracker` / `PadAction` map touches to the engine's
`Controls.press(button, down)` (unit-tested on both platforms). Touches are read in the raw touch
pass (UIKit `touchesBegan/Moved`, Compose `pointerInput`), and each change is sent at once; the engine
simulates it locally on the next 60 Hz step. Haptic on each action press. The screen stays awake on
the fight screen; going to the background releases every button and pauses the page.

**Latency is the risk, not presence:** the opponent's position travels as node presence, and each
action is a round trip to the cluster before it counts. Input itself never waits on the network, but **test a
real fight on cellular** (both phones off Wi-Fi) before calling this done; the top bar shows the
confirmed transaction count and the last round trip.

## Screens

1. **Sign in**: what the app is; "Sign in with Calimero Cloud" or "Development node", then "Sign in with a passkey" / "Create an account"; "Practice vs CPU"; an invited banner.
2. **Arenas**: Practice vs CPU first, then every arena (both fighters, title, players, tx count,
   state); "Needs your approval" when something waits; pull to refresh; swipe to invite; an empty
   state. The + menu has **New arena** (sheet: title, organization) and **Join with a link**.
3. **Join this arena?**: asked before an invitation does anything; ids behind **Details**.
4. **Arena** (the fight): the game edge to edge, the fight pad, a bar with back, title, status,
   tx meter, sound, **Fighters** (both corners with presence and wins, Fight here / Leave, your name,
   fighter select, how to fight, rematch) and a menu (Invite, **Record**, Refresh, **Details**).
   Watching: "Take a corner". Waiting: "Invite an opponent". Match over: "Rematch".
5. **Practice**: the same fight against the CPU, offline; choose your fighter; rematch.
6. **Account**: sign out (confirmed), account id behind **Details**.

## Contract client

`ios/KombatCore/Sources/KombatCore/Contract/KombatClient.swift` and
`android/app/src/main/kotlin/network/calimero/kombat/contract/KombatClient.kt` are typed by hand
from the component ABI: abi-codegen does not read a component ABI yet. They take the SDKs'
`ContextContractCalling` (`contract.bound(appId)`). After an ABI change, update both and the web
app's `kombat.ts` together.

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

The node's consent page returns to `mero-kombat://consent` on both platforms (iOS:
`MeroKombatCallback*` keys in `project.yml`; Android: `meroConsentCallback`, from which the
manifest's intent filter is built).

## Not in the apps (and why)

- **The chain panel** (tps chart, p50/p95, per-transaction log): reduced to the top bar's meter and
  the Details sheet; a chart over the fight would cost thumb room on a phone.
- **Organization-wide display names** for unnamed corners: orgs have no such record yet, so an
  unnamed corner reads "Corner 1/2" (the web app shows a short account id).
- **Fighter portraits** drawn by the engine: the shell uses a figure in the fighter's colour.
- **Universal links**: `links.calimero.network` publishes no apple-app-site-association/assetlinks
  for this app; pasting the link into **Join with a link** always works.
