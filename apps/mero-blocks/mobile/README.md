# Mero Blocks — native mobile apps

Native iOS and Android apps for Mero Blocks, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.mero-blocks`). The shell (sign-in, worlds, invitations, settings,
the pause menu) is native; the game itself is the web app's three.js engine, bundled into the app
and run in a WebView in a game-only mode, with its contract calls going through the native session.
Both apps have the same screens, copy, icons (SF Symbols ↔ Material Symbols), touch controls and
flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| Game page | `game/` | TypeScript, the web app's engine + Vite + three.js | — |
| iOS | `ios/` | SwiftUI + WKWebView, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0`, in `ios/project.yml` and `ios/BlocksCore/Package.swift` |
| Android | `android/` | Jetpack Compose + Material 3 + WebView, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (not on Maven Central), composite build at the SHA in `android/kotlin-sdk.ref` |

Both apps run on **Calimero 1.0**. The pins are the SDKs' 1.0 releases, swift-sdk
`v0.5.0` and kotlin-sdk `0.4.0`. To bump, change both `exact` versions on iOS and `kotlin-sdk.ref` on Android.

## Calimero 1.0

- **Sign in.** "Choose your cluster" offers **Calimero Cloud** (the cluster's name, whose nodes the
  node directory lists, or one node's URL; real TDX attestation) or a **Development node**
  (`merod local`, mock attestation; `http://127.0.0.1:2501` from the iOS Simulator,
  `http://10.0.2.2:2501` from the Android emulator). Then "Sign in with a passkey" or "Create an
  account". On a development node the app keeps a soft passkey for that node and creates its
  account on the first sign-in. The session is kept in the Keychain / encrypted preferences and
  refreshed at launch; every request goes over the sealed channel to an attested node. Build-time
  defaults: `MeroCluster` / `MeroNodeURL` / `MeroAllowMock` in `ios/project.yml`,
  `-PmeroCluster` / `-PmeroNodeUrl` / `-PmeroAllowMock` for Android.
- **Words**, as the web app's (`app/src/net/worlds.ts`): a world is its own **organization** with
  the world's **app instance** in it, created with `init({name, seed, now})` (u64 as decimal
  strings). Worlds the earlier 1.0 iOS build made (org + team + app instance) are still listed.
  "Me" for the contract (the game page's `myId`) is the account: the phone sends no `device`, so
  `PlayerView.id` is the account.
- **The contract** is the component ABI (`../logic/res/abi.json`): `worldMeta`, `getOverrides`,
  `getPlayers`, `overrideCount`, `join`, `heartbeat`, `leave`, `setBlocks`, camelCase, with `now`,
  `seed` and `createdAt` as decimal strings and `getOverrides` / `getPlayers` paged
  (`{items, next}`, followed to the end). `BlocksClient` (Swift and Kotlin) is hand-written for
  those calls; a unit test pins its method list. Its typed refusals (`APP_ERROR`: `TooManyEdits`,
  `TooManyDevices`, `BadDevice`, `Uninitialized`) and the node's errors (`ConfirmCancelled`,
  `LoginRequired`, `WrongNode`, `Unavailable`, `ReleaseDeadline`, `ConsentStale`) read as plain
  words (`BlocksText.error`).
- **Invitations** are org invite links. Minting one asks for your passkey (the node's step-up).
  The link's payload is the SDK's `OrgInvitation`, `{"invitation": "inv_…", "namespaceId": "…",
  "contextId"?: "…", "name"?: "…"}` (plus `groupId` for an earlier build's world). Joining
  redeems the token. The web app's own link (`<frontend>/?invite=inv_…`) pasted into "Join with a
  link" opens too: the org the node answers with leads to its first world.
- **Approvals**: when a node release or an app upgrade waits for the account (or a world it owns),
  the worlds list shows it under "Needs your approval". "Review" asks the node for a consent
  request, shows its **confirmation code** first, and then opens the **node's consent page in the
  system browser** (Custom Tab on Android), which shows the same code and returns to
  `mero-blocks://consent`. The app never approves by itself.
- A real cluster's passkeys need the `webcredentials:<rp-id>` Associated Domain (iOS) / Digital
  Asset Links (Android) of that cluster; neither is set yet.

## How the game runs

A native engine port is not worth it: the engine (`../app/src/engine`, `renderer.ts`,
`net/sync.ts`) is pure TypeScript plus one three.js file, and runs well in a WebView.

- **Bundled, not fetched.** `game/build.mjs` builds `game/src/main.ts` with the web app's own Vite
  and three.js into `game/assets/game/` (`index.html` + one classic `game.js`, three.js inlined,
  ~545 KB). That folder is committed and copied into both apps as they build (iOS: a folder
  reference in `project.yml` → `MeroBlocks.app/game/`; Android: an extra assets dir →
  `assets/game/`). Nothing is loaded from the network at run time. iOS loads it with
  `loadFileURL`; Android serves it from `https://appassets.androidplatform.net` with
  `WebViewAssetLoader`. Both refuse any other navigation.
- **Game-only mode.** `game/src/main.ts` is a second entry point over the same engine: no landing
  page, no node login, no world picker (the app does those), no pointer lock or keyboard. It waits
  for the app's `start` message (world, player name, "me", sensitivity, safe-area insets), reads
  `world_meta`, generates the terrain, and runs the web build's game loop.
- **The switch.** The web game talks to the contract only through `SyncEngine`, which takes an
  `exec(method, args)` function (`GameClient.exec` → mero-js on the web). The mobile entry hands it
  `bridge.exec` instead, so `join`, `heartbeat`, `set_blocks`, `get_overrides`, `get_players` and
  `leave` all go to the app, with those names and `now` as a number. The mobile entry imports the
  web app's modules, and the web build does not include it.
- **The bridge** (`game/src/bridge.ts` ↔ `Bridge.swift` / `Bridge.kt`), JSON text both ways:

  ```
  page → app   {"id":7,"op":"query","method":"get_players","args":{"now":1730000000}}
               {"op":"ready"} | {"op":"loaded"} | {"op":"menu"} | {"op":"haptic","style":"light"} | {"op":"fatal","message":"…"}
  app → page   {"type":"result","id":7,"ok":true,"result":[…]}  |  {"type":"result","id":7,"ok":false,"error":"…"}
               {"type":"start",…} | {"type":"event","kind":"…"} | {"type":"pause"} | {"type":"resume"} | {"type":"insets",…} | {"type":"settings",…}
  ```

  The page posts through `window.webkit.messageHandlers.meroBlocks` (iOS) or the
  `MeroBlocksAndroid` JavaScript interface; the app answers with
  `window.meroBridge.receive("<JSON as a string literal>")`. `window.meroBridge.query/execute` are
  the page's calls. On the app side `BridgeRouter` runs each call through `BlocksClient` over
  `contract.bound(to: contextId)`: only the methods the game uses, views on `query` and mutations
  on `execute`, arguments decoded into the ABI's types (so a malformed or out-of-range edit never
  reaches the node). It puts each call on the component wire (`get_players` → `getPlayers`, `now`
  as a decimal string, pages followed) and answers in the page's shapes (whole lists, `seed` and
  `createdAt` as numbers), so the bundled page works unchanged; the camelCase names are accepted
  too. `init` and anything else are refused.
- **Live updates.** The app subscribes to the world's events on the node and forwards each as a
  nudge; the page re-reads the world and the roster. The page's own polling (players every 0.5 s,
  blocks every 5 s, the web build's values) covers a node that cannot stream.
- **Lifecycle.** The game screen locks to landscape (the shell stays portrait on phones), hides the
  system bars, keeps the screen awake, and pauses the game (and saves) when the app goes to the
  background or the pause menu opens.

### Touch controls (HTML overlay, identical on both platforms)

Left thumb: a floating joystick wherever it lands on the left 42 % of the screen. Right side: drag
anywhere to look. Bottom right: **jump** (hold), **break** and **place** (tap for one, hold to
repeat at the web build's 250 ms). Bottom centre: the hotbar's nine blocks, tap to pick (lime
outline). Top left: the menu button (opens the native pause menu); top right: players online.
Icons are Material Symbols paths; haptics on place/break and hotbar picks.

## Screens

1. **Sign in** — what the app is; choose the cluster (Calimero Cloud or a development node), then "Sign in with a passkey" / "Create an account"; an invited banner when a link is waiting.
2. **Worlds** — every world the account is in, with how many are playing, and what needs your
   approval; pull to refresh; swipe a row left to share an invitation, right to leave the world
   (confirmed); an empty state. The + menu has **Create world** (sheet: name, seed or random) and **Join with a link**
   (sheet: paste a link).
3. **Join this world?** — asked before an invitation link (opened or pasted) does anything; ids
   behind **Details**.
4. **Game** (landscape) — joining / loading / "Couldn't open this world" (retry, back) states, then
   the game. **Pause menu**: Resume, Invite friends (share sheet), look sensitivity, Save & leave
   world, ids behind **Details**.
5. **Settings** — player name (shown over your head), look sensitivity, account behind **Details**,
   sign out (confirmed), the three.js acknowledgement.

## Features vs the web app

Done: passkey sign-in; the world list; create a world (its own organization and the app instance
in it, with `{name, seed, now}`, as `createWorld` does); org invite links
(`https://links.calimero.network/com.calimero.mero-blocks/join?invitation=…`, plus `calimero://`;
the web's `?invite=` link pastes in too), redeemed with the invite token; approvals on the node's
consent page;
the whole game (terrain, lighting, day/night, place/break, the hotbar, other players' avatars and
names, presence, live sync, the pose and edits saved on the device per world); player name.
New on mobile: leave a world, look sensitivity in the pause menu.

Not in the apps:

- **Node login and the desktop's SSO hash**: the phone holds no node; it uses the account path only.
- **The world map (M) and the FOV slider**: the map is a keyboard overlay in the web build; the
  phone uses a fixed 80° FOV, which suits a landscape phone. The debug overlay is left out too.
- **Push notifications** (someone joined your world): not in the SDKs yet.
- **Universal links**: `links.calimero.network` publishes no apple-app-site-association /
  assetlinks for this app, so an https invitation opens via the chooser (Android) or Safari; pasting
  it into **Join with a link** always works.

## Build and test

The game page — rebuild and commit it after an engine change (CI fails while it is stale):

```bash
./scripts/build-game.sh     # pnpm install (web app deps), build game/assets/game, run the page's bridge tests
```

iOS — the non-UI layer (the contract client, the bridge, view models) is a local SwiftPM package that
builds and tests on macOS with no simulator:

```bash
cd ios
swift test --package-path BlocksCore
brew install xcodegen && xcodegen generate && open MeroBlocks.xcodeproj
```

Android:

```bash
cd android
./scripts/fetch-sdk.sh            # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

The tests cover the bridge on both platforms (message decoding and encoding, the script literal,
routing each method to the right path with typed arguments, refusals), the view models against the
SDKs' fakes (`InMemoryAppBackend`, `RecordingContextContract`), invitations against a token minted
for 1.0 (and a 0.x one that is refused), and that the bundled page is there (`GameBundleTests` /
`GameBundleTest`; CI also checks it is inside the built `.app` and APK).

## Callbacks

Both apps: the node's consent page returns to `mero-blocks://consent` (iOS: `MeroBlocksCallback*`
keys in `project.yml`; Android: `meroConsentCallback`).

## SDK notes

- "Me" for the contract is the account (`session.account`), on both platforms.
- `events(contextId)` is forwarded as the event kind only, so the game cannot skip its own
  `BlocksChanged` echoes; it re-reads on every event, which the web build's merge already handles.
- The world invitation can carry `groupId` beside the SDK's `OrgInvitation` fields, so
  `BlocksInvitation` encodes it with `InviteCodec` directly.
- The planned WebView host kit is not in the SDKs yet; this app's `GameModel` + `Bridge` is a
  candidate for it.

## CI

`.github/workflows/mero-blocks-ios.yml` (macOS: `swift test` on BlocksCore, XcodeGen, an app
build, the game page inside the `.app`) and `.github/workflows/mero-blocks-android.yml` (the game
page rebuilt from the web engine and compared with the committed one; fetch the SDK, ktlint,
detekt, unit tests, Android lint, `assembleDebug`, the game page inside the APK), each
path-filtered to its folders.
