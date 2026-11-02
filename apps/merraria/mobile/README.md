# Merraria — native mobile apps

Native iOS and Android apps for Merraria, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.merraria`). Both apps have the same screens, copy, icons (SF
Symbols ↔ Material Symbols), controls and flows, and both are landscape-only.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen, WKWebView | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `c9ca1a0` (swift-sdk#84 merge commit on `main`), in `ios/project.yml` and `ios/MerrariaCore/Package.swift` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26, WebView | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (kotlin-sdk#67 merge commit on `main`), composite build at the SHA in `android/kotlin-sdk.ref` |

**The SDK pins are the `main` merge commits of swift-sdk#84 and kotlin-sdk#67.** Bumping is one
line per platform (iOS: both `revision:` values; Android: `kotlin-sdk.ref`).

## How it is put together

The shell is native: sign-in (`MeroAppSession`), the world list, creating and joining worlds,
invitations and settings. The game is the web app's own Canvas2D engine, unchanged, running in a
WKWebView / Android WebView from files bundled in the app:

- `game/www/` is the web app's production build (`scripts/build-game.sh`), committed. iOS ships it as
  the `www/` folder resource and serves it under the `merraria-game://` scheme; Android packages it
  as the `www/` asset folder and serves it through `WebViewAssetLoader`. Nothing is loaded from the
  network at runtime.
- The page is opened with `?host=native`. With that flag **and** an app message channel present, the
  web app (`../app/src/native/host.ts`) skips its landing, session and world picker and runs only the
  game. In a browser nothing changes.
- **Bridge.** Every contract call the engine makes goes to the app as
  `window.meroBridge.query/execute(method, args)`. The app answers it with the generated
  `MerrariaClient` over `contract.bound(to: contextId)`, method by method: only the contract's
  views (`get_overrides`, `get_players`, `world_meta`) as `query` and its writes (`heartbeat`,
  `join`, `leave`, `set_tiles`) as `execute`, with arguments decoded into the contract's types;
  `init` and anything else is refused. The protocol is documented at the top of `host.ts` and
  implemented in `GameBridge.swift` / `GameBridge.kt`.
- **Identity.** The player's id is the one the contract's `join` returns (this device's key, as the
  contract keys avatars), so the engine filters itself out of the player list.
- **Live updates.** Relay events for the world are forwarded as re-read nudges; the engine's own
  polling covers presence and gaps.
- **Controls** are native, over the WebView (which takes no touches itself): a D-pad (left, right;
  the game has no use for down), jump, mine and place (held, like the mouse buttons), tap the world
  to target a tile within reach (otherwise the buttons act on the tile in front of the player),
  the hotbar with counts, and pause. `TouchControls` maps them to the game's input.
- The screen stays awake while playing; leaving the foreground pauses the game, releases every
  control and saves.

## Screens

1. **Sign in** — what the game is, "Sign in with Calimero", an invited banner when a link is waiting.
2. **Worlds** — every world the account is in, with its player count; pull to refresh; swipe a row to
   share an invitation; empty and no-relay states. The + menu has **Create world** (sheet: name and
   seed, as on the web) and **Join with a link** (sheet: paste a link).
3. **Join this world?** — asked before an invitation link (opened or pasted) does anything; ids
   behind **Details**.
4. **Game** — full screen: the world, the controls, "Syncing the world…" until joined. **Pause**
   menu: back to game, invite friends (share sheet), zoom, ids behind **Details**, save & leave.
   Loading and error covers (try again / back to worlds).
5. **Settings** — player name, zoom, the account behind **Details**, sign out.

## Generated contract client

`ios/MerrariaCore/Sources/MerrariaCore/Generated/MerrariaClient.swift` and
`android/app/src/main/kotlin/network/calimero/merraria/generated/MerrariaClient.kt` are generated
from `../logic/res/abi.json` by `@calimero-network/abi-codegen` with `--transport-import`, so they take
the SDKs' own `ContextContractCalling` (no adapter). Regenerate both after an ABI change:

```bash
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate.sh
```

After a change to the web app, rebuild and commit the game bundle: `./scripts/build-game.sh`.

## Build and test

iOS — the non-UI layer (generated client, world list, invitations, the bridge, the touch mapping,
and a check that the bundled game is complete and local) is a SwiftPM package that tests on macOS:

```bash
cd ios
swift test --package-path MerrariaCore
xcodegen generate && open Merraria.xcodeproj
```

Android:

```bash
cd android
./scripts/fetch-sdk.sh
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

The model tests run against the SDKs' fakes (`InMemoryAppBackend`, `RecordingContextContract`). The
web side of the bridge is tested in `../app/tests/nativeHost.test.ts`.

## Sign-in callback

Both apps default to `merraria://enrol` (iOS: `MerrariaCallback*` keys in `project.yml`; Android:
`meroEnrolCallback` in `gradle.properties`). The hosted wallet returns only to `https://` callbacks
today, so production sign-in needs that wallet change or a verified https callback, as for Mero Chat.

## Not in the apps (and why)

- **Keyboard and mouse** controls, the web's debug overlay and its HTML hotbar: replaced by the
  native controls and hotbar.
- **Leaving or deleting a world**: the web app has neither; "Save & leave world" leaves the game,
  as on the web.
- **Universal links**: `links.calimero.network` publishes no apple-app-site-association / assetlinks
  for this app, so an https invitation opens via the chooser (Android) or Safari; pasting it into
  **Join with a link** always works.

## CI

`.github/workflows/merraria-ios.yml` (`swift test` on MerrariaCore, XcodeGen, simulator build) and
`.github/workflows/merraria-android.yml` (fetch the SDK, ktlint, detekt, unit tests, Android lint,
`assembleDebug`), each path-filtered to its folder and `game/`.
