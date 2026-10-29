# Mero Design: native mobile apps

Native iOS and Android viewers for Mero Design, next to the web editor (`../app`) and the
contract (`../logic`, package `com.calimero.mero-design`). They have the same screens, copy, icons
(SF Symbols and the matching Material icons) and behaviour.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `c9ca1a0` (merge commit of PR #84 on `main`) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (merge commit of PR #67 on `main`), composite build from `android/kotlin-sdk.ref` |

**To bump a pin**, change it in every place it is set. On iOS that means
`ios/project.yml` and `ios/DesignCore/Package.swift`; on Android, `android/kotlin-sdk.ref`.

## View only

The phone is for looking at boards, not editing them: the editor (tools, selection handles,
properties, layers) is too big for a phone. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`): the wallet certifies the phone's key.
  The session is kept in the Keychain / Keystore and restored at launch.
- **Teams**: the account's namespaces running Mero Design. Pull to refresh.
- **Boards**: a team's boards (one subgroup with one context each, as the web app makes them),
  named by the board's own `get_board`, with its description and layer count. Swipe a board to
  share its link. Pull to refresh.
- **Board**: the board drawn read-only. Pinch to zoom, drag to pan, double-tap (or the fit
  button) to fit it. Live: it follows the relay's event stream, or polls every 5 s when the relay
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
creating teams or boards; team settings and roles; exports. Invitations are not redeemed on the
phone yet (the web app's invitation token is deflate + base58 and the SDK has no decoder for it);
an invitation link shows a note to accept it on the web or desktop.

## How a board is drawn

Natively, from the contract's elements, not in a web view. The scene format is small and
already drawn without Fabric by the web app's own SVG export (`app/src/utils/svgExport.ts`), so
both apps port that: `rect` (corner radius), `circle`, `line` and `arrow` (with the web's
arrowhead), `path` (SVG path data; the triangle, diamond, star and cloud shapes are regenerated at
their size), `text` (plain, and the box and sticky containers with the web's word wrap), `image`
(the blob, read through the account's relay), opacity, rotation about the top-left corner, drop
shadows and the six stroke styles. Hidden layers are left out, as in every web export.

The part that turns elements into drawable nodes (`BoardScene`, in DesignCore on iOS and
`core/` on Android) is the same code on both platforms and unit-tested on both with the same
cases. Each platform only paints the nodes (`SceneRenderer`).

Known gaps: an `svg` element (an imported SVG file) is drawn as the web export's grey placeholder,
because neither platform rasterises arbitrary SVG markup without a web view; text uses the
platform's sans, serif or monospace face for the web's font families.

## Delegated execution only

Neither app runs or logs into a node. `MeroAppSession` signs in, finds the account's relay, and
gives a `MeroAppBackend`: namespaces, subgroups, membership and events go through it, contract
reads through the relay's query and writes as signed warrants. Images are read with the signed-in
client's `admin.getBlob(blobId, contextId)`, because `MeroAppBackend` has no blob call yet.

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

Sign-in returns to `mero-design://enrol`. Point the apps at another environment with the
`MeroCloudBaseURL` / `MeroWalletURL` / `MeroRegistryURL` Info.plist keys in `ios/project.yml`, or
`-PmeroCloudUrl=` / `-PmeroWalletUrl=` / `-PmeroRegistryUrl=` / `-PmeroEnrolCallback=` on Android.
The hosted wallet currently returns only to `https://` callbacks, so production sign-in needs that
wallet change or a verified https callback (as in Mero Chat).

CI: `.github/workflows/mero-design-ios.yml` (DesignCore tests on macOS, simulator build) and
`.github/workflows/mero-design-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
