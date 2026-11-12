# Merraria — native mobile apps

Native iOS and Android apps for Merraria, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.merraria`). Both apps have the same screens, copy, icons (SF
Symbols ↔ Material Symbols), controls and flows, and both are landscape-only.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen, WKWebView | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0`, in `ios/project.yml` and `ios/MerrariaCore/Package.swift` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26, WebView | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0`, composite build at the release commit in `android/kotlin-sdk.ref` |

**Both apps run on Calimero 1.0** and call the contract's component ABI (`../logic/res/abi.json`
after apps#710). The SDK pins are releases. Bumping is one line per platform (iOS: `exactVersion:` and
`exact:`; Android: `kotlin-sdk.ref`, set to the new tag's commit).

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
- **Words**: as on the web, a world is an **app instance** of `com.calimero.merraria` in an
  **organization** of its own (worlds an earlier build put in an open team are still listed and
  opened). Technical ids sit behind **Details**.
- **Creating a world** is the web app's three steps: the organization, the app instance (the
  contract's `init()` takes nothing), then `createWorld(name, seed, now)`, which only the creator may run.
- **The contract** (`MerrariaClient`, generated on both platforms from the component ABI, as the
  web app's client is): calls `createWorld`, `setTiles`, `join`, `heartbeat`, `leave`;
  views `worldMeta`, `getOverrides` (paged: `{items, next}`, read page by page), `getPlayers`.
  `seed`, `createdAt` and every `now` are u32 seconds. `ContractTests` / `ContractTest` check the
  method lists against the ABI.
- **Errors** read as words: the contract's refusals (`APP_ERROR` `NoWorld`, `WorldExists`,
  `WorldFull {max}`, `TooManyEdits {max}`) and the node's (`LoginRequired`, `WrongNode`,
  `Unavailable`, `ReleaseDeadline`, `ConsentStale`, a cancelled passkey).
- **Invitations** are org invite tokens (`POST /orgs/{org}/invites`, a passkey step-up; redeemed with
  `POST /invites/{token}/redeem`). The link is
  `https://links.calimero.network/com.calimero.merraria/join?invitation=…`; its payload is the SDKs'
  `OrgInvitation`, `{"invitation": "inv_…", "namespaceId": "…", "contextId"?: "…", "name"?: "…"}`
  (plus `groupId` for a world in a team), the same on iOS and Android. Pre-1.0 links are refused.
- **Approvals**: when a node release or an app upgrade waits for the account (or an organization it
  owns), the worlds list shows it under "Needs your approval". "Review" asks the node, **shows the
  confirmation code first**, then opens the **node's consent page in the system browser** (Custom
  Tab on Android), which returns to `merraria://consent`. The app never approves by itself.
- A real cluster's passkeys need the app to carry that cluster's `webcredentials:<rp-id>` Associated
  Domain (iOS) / Digital Asset Links (Android); neither is set yet.

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
  `window.meroBridge.query/execute(method, args)`. The page keeps the v1 method names
  (`host.ts`'s `V1_METHOD`), so any game bundle runs: views `get_overrides`, `get_players`,
  `world_meta` as `query`, writes `heartbeat`, `join`, `leave`, `set_tiles` as `execute`. The app
  answers each with `MerrariaClient` over `contract.bound(to: appId)` under the component name
  (`get_overrides` reads every `getOverrides` page and answers one array); `init`, `createWorld`
  and anything else is refused. The protocol is documented at the top of `host.ts` and
  implemented in `GameBridge.swift` / `GameBridge.kt`.
- **Identity.** The player's id is the one the contract's `join` returns (the account, as the
  contract keys avatars), so the engine filters itself out of the player list.
- **Live updates.** The world's events (`GET /apps/{app}/events`) are forwarded as re-read nudges;
  the engine's own polling covers presence and gaps.
- **Controls** are native, over the WebView (which takes no touches itself): a D-pad (left, right;
  the game has no use for down), jump, mine and place (held, like the mouse buttons), tap the world
  to target a tile within reach (otherwise the buttons act on the tile in front of the player),
  the hotbar with counts, and pause. `TouchControls` maps them to the game's input.
- The screen stays awake while playing; leaving the foreground pauses the game, releases every
  control and saves.

## Screens

1. **Sign in** — what the game is; "Sign in with Calimero Cloud" or "Development node", then "Sign in with a passkey" / "Create an account"; an invited banner when a link is waiting.
2. **Worlds** — every world the account is in, with its player count; pull to refresh; swipe a row to
   share an invitation; "Needs your approval" when something waits; an empty state. The + menu has **Create world** (sheet: name and
   seed, as on the web) and **Join with a link** (sheet: paste a link).
3. **Join this world?** — asked before an invitation link (opened or pasted) does anything; ids
   behind **Details**.
4. **Game** — full screen: the world, the controls, "Syncing the world…" until joined. **Pause**
   menu: back to game, invite friends (share sheet), zoom, ids behind **Details**, save & leave.
   Loading and error covers (try again / back to worlds).
5. **Settings** — player name, zoom, the account behind **Details**, sign out.

## Contract client

`MerrariaClient` (`ios/MerrariaCore/Sources/MerrariaCore/Generated/` and
`android/app/src/main/kotlin/network/calimero/merraria/generated/`) is generated from
`../logic/res/abi.json` by core's `mero-app-build codegen`: after an ABI change, run
`scripts/mobile-codegen.sh` at the repo root and commit (CI's `Mobile clients` workflow fails on a
stale client). Until the logic derives `AbiType`, the ABI names the world's types without their
shape, so the client takes and answers their JSON; `Contract/MerrariaContract.swift` and
`contract/MerrariaContract.kt` keep those types, the paging of `getOverrides`, the method lists and
the refusal sentences. An unset `option` argument goes as `null`, which the contract reads as none.

After a change to the web app, rebuild and commit the game bundle: `./scripts/build-game.sh`.

## Build and test

iOS — the non-UI layer (typed client, world list, invitations, the bridge, the touch mapping,
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

## Callbacks

The node's consent page returns to `merraria://consent` on both platforms (iOS: `MerrariaCallback*`
keys in `project.yml`; Android: `meroConsentCallback`, from which the manifest's intent filter is
built).

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
