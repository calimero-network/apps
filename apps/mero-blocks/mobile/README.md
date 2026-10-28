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
| iOS | `ios/` | SwiftUI + WKWebView, iOS 16+, XcodeGen | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `551fc78` (`feat/app-session`, swift-sdk#84), in `ios/project.yml` and `ios/BlocksCore/Package.swift` |
| Android | `android/` | Jetpack Compose + Material 3 + WebView, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `5574e5c` (`feat/app-session`, kotlin-sdk#67), composite build at the SHA in `android/kotlin-sdk.ref` |

**The SDK pins move to the merge commits once swift-sdk#84 and kotlin-sdk#67 land.** Bumping is one
line per platform (iOS: both `revision:` values; Android: `kotlin-sdk.ref`).

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
  `leave` all go to the app. **The web app's source is unchanged**: the mobile entry imports its
  modules, and the web build does not include it.
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
  the page's calls. On the app side `BridgeRouter` runs each call through the generated
  `BlocksClient` over `contract.bound(to: contextId)`: only the seven methods the game uses, views
  on `query` and mutations on `execute`, arguments decoded into the ABI's types (so a malformed or
  out-of-range edit never reaches the relay). `init` and anything else are refused.
- **Live updates.** The app subscribes to the world's relay events and forwards each as a nudge;
  the page re-reads the world and the roster. The page's own polling (players every 0.5 s, blocks
  every 5 s, the web build's values) covers a relay that cannot stream.
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

1. **Sign in** — what the app is, "Sign in with Calimero", an invited banner when a link is waiting.
2. **Worlds** — every world the account is in, with how many are playing; pull to refresh; swipe a
   row left to share an invitation, right to leave the world (confirmed); empty and no-relay
   states. The + menu has **Create world** (sheet: name, seed or random) and **Join with a link**
   (sheet: paste a link).
3. **Join this world?** — asked before an invitation link (opened or pasted) does anything; ids
   behind **Details**.
4. **Game** (landscape) — joining / loading / "Couldn't open this world" (retry, back) states, then
   the game. **Pause menu**: Resume, Invite friends (share sheet), look sensitivity, Save & leave
   world, ids behind **Details**.
5. **Settings** — player name (shown over your head), look sensitivity, account behind **Details**,
   sign out (confirmed), the three.js acknowledgement.

## Features vs the web app

Done: account sign-in; the world list; create a world (its own namespace, an open subgroup and the
context, with `{name, seed, now}`, as `createWorld` does); invitations in the web app's format both
ways (`https://links.calimero.network/com.calimero.mero-blocks/join?invitation=<base58(deflate({invitation, groupAlias, contextId, groupId}))>`,
plus `calimero://`), redeemed by direct admission and an inheritance join of the world's context;
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

## Generated contract client

`ios/BlocksCore/Sources/BlocksCore/Generated/BlocksClient.swift` and
`android/app/src/main/kotlin/network/calimero/blocks/generated/BlocksClient.kt` are generated from
`../logic/res/abi.json` with `--transport-import` (they use the SDKs' `ContextContractCalling`, so no
adapter) and committed. Regenerate both after an ABI change:

```bash
ABI_CODEGEN=/path/to/mero-devtools-js/abi-codegen/dist/cli.js ./scripts/regenerate.sh
```

## Build and test

The game page — rebuild and commit it after an engine change (CI fails while it is stale):

```bash
./scripts/build-game.sh     # pnpm install (web app deps), build game/assets/game, run the page's bridge tests
```

iOS — the non-UI layer (generated client, the bridge, view models) is a local SwiftPM package that
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
by the web app's own encoder, and that the bundled page is there (`GameBundleTests` /
`GameBundleTest`; CI also checks it is inside the built `.app` and APK).

## Sign-in callback

Both apps default to `mero-blocks://enrol` (iOS: `MeroBlocksCallback*` keys in `project.yml`;
Android: `meroEnrolCallback` in `gradle.properties`). The hosted wallet returns only to `https://`
callbacks today, so production sign-in needs that wallet change or a verified https callback (iOS
Associated Domains, Android App Links), as for Mero Chat. Cloud, wallet and registry URLs are
overridable the same way.

## SDK notes

- "Me" for the contract is the device's signing key (`env::device_id()` under delegation). The
  session has no accessor for it, so the apps read it from the client: iOS
  `client.delegatedSession?.keys.signPublicKey`, Android `client.account.deviceKeys.load()?.signPublicKey`.
- `events(contextId)` carries only the event kind, not its payload, so the game cannot skip its
  own `BlocksChanged` echoes; it re-reads on every event, which the web build's merge already
  handles.
- `AppInvitation` writes `{invitation, <name>}` only; the world invitation also carries
  `contextId` and `groupId`, so `BlocksInvitation` encodes it with `InviteCodec` directly (and
  decodes the signed part with `AppInvitation`).
- The planned WebView host kit is not in the SDKs yet; this app's `GameModel` + `Bridge` is a
  candidate for it.

## CI

`.github/workflows/mero-blocks-ios.yml` (macOS: `swift test` on BlocksCore, XcodeGen, simulator
build, the game page inside the `.app`) and `.github/workflows/mero-blocks-android.yml` (the game
page rebuilt from the web engine and compared with the committed one; fetch the SDK, ktlint,
detekt, unit tests, Android lint, `assembleDebug`, the game page inside the APK), each
path-filtered to its folders.
