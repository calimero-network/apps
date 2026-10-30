# Merraria — native mobile apps

Native iOS and Android apps for Merraria, next to the web frontend (`../app`) and the contract
(`../logic`, package `com.calimero.merraria`). Both apps have the same screens, copy, icons (SF
Symbols ↔ Material Symbols), controls and flows, and both are landscape-only.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+, XcodeGen, WKWebView | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `6c5f116` (head of `feat/calimero-1.0`, swift-sdk#85; moves to its merge commit once it lands), in `ios/project.yml` and `ios/MerrariaCore/Package.swift`. **Calimero 1.0.** |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26, WebView | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (kotlin-sdk#67 merge commit on `main`), composite build at the SHA in `android/kotlin-sdk.ref` |

**The iOS app runs on Calimero 1.0; the Android app (kotlin-sdk#67's `main` merge commit) still
speaks the 0.x API until kotlin-sdk is ported.** Bumping is one
line per platform (iOS: both `revision:` values; Android: `kotlin-sdk.ref`).

## Calimero 1.0 on iOS

- **Sign in** with a passkey on the world's cluster (`MeroAppSession.signIn()`, the device's
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
- **Words**: a world is its own **organization**, holding one open **team** and the world's **app instance**. The bridge protocol between the game page and the app is unchanged.
- **Invitations** are org invite tokens (`POST /orgs/{org}/invites`, redeemed with
  `POST /invites/{token}/redeem`). The link keeps its URL; its payload is swift-sdk's
  `OrgInvitation`, `{"invitation": "inv_…", "namespaceId": "…", "contextId"?: "…", "name"?: "…"}` plus the world's `groupId` (team),
  which every 1.0 client of the package reads. Android and the web still use the 0.x signed
  invitation until they are ported, so links do not cross between them and iOS yet.
- **Approvals**: when a node release or an app upgrade waits for the account (or an organization it
  owns), the worlds list shows it under "Needs your approval". "Review" opens the **node's consent page in
  the system browser**; the page returns to `merraria://consent`. The app never approves by itself.
  A call refused because a release deadline has passed says so in words.
- A real cluster's passkeys need the app to carry the `webcredentials:<rp-id>` Associated Domain of
  that cluster; it is not set in `project.yml` yet.

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

1. **Sign in** — what the game is; on iOS "Sign in with a passkey" / "Create an account" on the cluster (Android: "Sign in with Calimero"); an invited banner when a link is waiting.
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

## Callbacks

iOS: the node's consent page returns to `merraria://consent` (`MerrariaCallback*` keys in
`project.yml`); the cluster is `MeroNodeURL` / `MeroNodes` / `MeroAllowMock`. Android: sign-in
returns to `merraria://enrol` (`meroEnrolCallback` in `gradle.properties`); the hosted wallet returns
only to `https://` callbacks today, so production sign-in needs a verified https callback.

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
