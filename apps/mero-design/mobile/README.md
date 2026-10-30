# Mero Design: native mobile apps

Native iOS and Android viewers for Mero Design, next to the web editor (`../app`) and the
contract (`../logic`, package `com.calimero.mero-design`). They have the same screens, copy, icons
(SF Symbols and the matching Material icons) and behaviour.

> **Calimero 1.0:** the iOS app runs on Calimero core 1.0 (passkeys, sealed channel, orgs, teams
> and app instances; see [On Calimero 1.0 (iOS)](#on-calimero-10-ios)). The Android app still
> speaks the 0.x API (wallet, relays) until kotlin-sdk is ported; the rest of this page describes
> the shared screens.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `a1ec644` (head of the 1.0 port, PR #85 `feat/calimero-1.0`; moves to its merge commit once it lands) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (merge commit of PR #67 on `main`), composite build from `android/kotlin-sdk.ref` |

**To bump a pin**, change it in every place it is set. On iOS that means
`ios/project.yml`, `ios/DesignCore/Package.swift` and `ios/DesignCore/Package.resolved`; on Android, `android/kotlin-sdk.ref`.

## View only

The phone is for looking at boards, not editing them: the editor (tools, selection handles,
properties, layers) is too big for a phone. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`). iOS: a passkey on the cluster (or a
  development node); Android: the wallet certifies the phone's key. The session is kept in the
  Keychain / Keystore and restored at launch.
- **Teams**: the account's orgs (0.x: namespaces) running Mero Design. Pull to refresh. On iOS,
  anything waiting for the person's approval (an update of Mero Design, a node release) shows on
  top; **Review** opens the node's consent page in the system browser.
- **Boards**: a team's boards (one subgroup with one context each, as the web app makes them),
  named by the board's own `get_board`, with its description and layer count. Swipe a board to
  share its link. Pull to refresh.
- **Board**: the board drawn read-only. Pinch to zoom, drag to pan, double-tap (or the fit
  button) to fit it. Live: it follows the node's (Android: relay's) event stream, or polls every 5 s when it
  cannot stream. Opening a board this account is not in yet joins its context (an open subgroup).
- **Present**: full screen, swipe between the board's screens in the web app's order (numbered
  `screen/Name @n` first, then reading order). A long screen fills the width and scrolls. "All
  screens" shows a grid to jump to one. A board with no screens presents the whole board as one
  slide.
- **Comments**: numbered pins on the board; a sheet lists them oldest first, each opens its thread.
  Editors and admins add comments (pinned to the middle of the current view) and replies; a viewer
  sees why they cannot. The first comment on a board asks for a name and `join`s the roster, so
  others see a name and not an id.
- **Who is here**: avatars of others whose pointer moved in the last 10 s, and their pointers on
  the board (`get_cursors`, the web app's window). The phone does not publish a pointer of its own.
- **Share**: the board's link, `https://links.calimero.network/com.calimero.mero-design/board?team=…&board=…`
  (also `calimero://com.calimero.mero-design/board?…`). Both apps open it at that board.
- **About this board**: layers, screens, comments, your access, the members, and the ids behind a
  Details disclosure.

Not on the phone: creating or editing shapes, layers, screens or the board; deleting comments;
creating teams or boards; team settings and roles; exports. On iOS an invitation link that opens
the app asks "Join this team?" and redeems it (`POST /invites/{token}/redeem`); on Android it
shows a note to accept it on the web or desktop.

## How a board is drawn

Natively, from the contract's elements, not in a web view. The scene format is small and
already drawn without Fabric by the web app's own SVG export (`app/src/utils/svgExport.ts`), so
both apps port that: `rect` (corner radius), `circle`, `line` and `arrow` (with the web's
arrowhead), `path` (SVG path data; the triangle, diamond, star and cloud shapes are regenerated at
their size), `text` (plain, and the box and sticky containers with the web's word wrap), `image`
(the blob, read from the app instance's blobs), opacity, rotation about the top-left corner, drop
shadows and the six stroke styles. Hidden layers are left out, as in every web export.

The part that turns elements into drawable nodes (`BoardScene`, in DesignCore on iOS and
`core/` on Android) is the same code on both platforms and unit-tested on both with the same
cases. Each platform only paints the nodes (`SceneRenderer`).

Known gaps: an `svg` element (an imported SVG file) is drawn as the web export's grey placeholder,
because neither platform rasterises arbitrary SVG markup without a web view; text uses the
platform's sans, serif or monospace face for the web's font families.

## On Calimero 1.0 (iOS)

The phone holds no node. It signs in to a Calimero 1.0 cluster with a passkey and talks to it
over the sealed channel (`calimero/sealed-http/v2`, opened only after the node's attestation is
verified). `MeroAppSession` gives a `MeroAppBackend` (the swift-sdk's `CloudAppBackend`):

| What | Wire |
| --- | --- |
| Sign in / create account / restore | `/auth/passkey/{login,register}/{begin,finish}`, `/auth/refresh` |
| Teams | the account's orgs running Mero Design (`GET /auth/me`) |
| Boards | the org's teams (`GET /orgs/{org}`), one app instance per board |
| Contract reads / writes | `POST /apps/{app}/views` / `POST /apps/{app}/intents` |
| Live updates | `GET /apps/{app}/events` (sealed SSE), polling as a fallback |
| Images | `MeroAppBackend.getBlob` → `/apps/{app}/blobs` |
| Join from an invitation link | `POST /invites/{token}/redeem` |
| Approvals | `POST /consent/requests` → the node's consent page in the system browser → `GET /consent/{id}/result` |

**Sign-in.** *Calimero Cloud*: enter the cluster's node URL (from cloud.calimero.network; bake
it in with `CalimeroClusterURL` in `ios/project.yml`), then **Sign in with passkey** or **Create
an account**. The device's passkey needs the cluster's relying party as an associated domain
(`webcredentials:<rp-id>`). *Development node*: a `merod local` node URL (default
`http://localhost:2501`, `DefaultNodeURL`); mock attestation is allowed and the SDK keeps a
software passkey for that node.

The consent page returns to `mero-design://consent` (`MeroDesignCallbackScheme`, or an https
host with `MeroDesignCallbackHost` / `MeroDesignCallbackPath`). `MeroPackageVersion` sets the
version new app instances run (empty: the latest).

Android still uses delegated execution (0.x): `MeroAppSession` finds the account's relay;
contract reads go through the relay's query and writes as signed warrants.

## Generated contract client

`DesignClient` is generated from `../logic/res/abi.json`; never edit it by hand:

- iOS: `ios/DesignCore/Sources/DesignCore/Generated/DesignClient.swift`
- Android: `android/app/src/main/kotlin/network/calimero/design/generated/DesignClient.kt`

After a contract change, regenerate both with `scripts/regenerate-client.sh` (set `ABI_CODEGEN`
to an abi-codegen `dist/cli.js` that has the `swift` and `kotlin` targets) and commit the result.
Views go through the bound contract's `query`, writes through `execute`.

## Build and test

iOS (Xcode 15+, `brew install xcodegen`):

```bash
cd ios
swift test --package-path DesignCore   # core + view models, on macOS
xcodegen generate && open MeroDesign.xcodeproj
```

Android (JDK 17, Android SDK 34):

```bash
cd android
./scripts/fetch-sdk.sh                 # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

iOS: build for a device with `xcodebuild build -project MeroDesign.xcodeproj -scheme MeroDesign
-destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO`; the cluster is chosen at sign-in
(see above).

Android sign-in returns to `mero-design://enrol`. Point it at another environment with
`-PmeroCloudUrl=` / `-PmeroWalletUrl=` / `-PmeroRegistryUrl=` / `-PmeroEnrolCallback=`.
The hosted wallet currently returns only to `https://` callbacks, so production sign-in needs that
wallet change or a verified https callback (as in Mero Chat).

CI: `.github/workflows/mero-design-ios.yml` (DesignCore tests on macOS, simulator build) and
`.github/workflows/mero-design-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
