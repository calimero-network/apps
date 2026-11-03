# Mero Design: native mobile apps

Native iOS and Android viewers for Mero Design, next to the web editor (`../app`) and the
contract (`../logic`, package `com.calimero.mero-design`). They have the same screens, copy, icons
(SF Symbols and the matching Material icons) and behaviour.

> **Calimero 1.0:** both apps run on Calimero core 1.0 (passkeys, sealed channel, orgs and app
> instances) and call the component contract; see [On Calimero 1.0](#on-calimero-10).

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0` |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `v0.2.0` (not on Maven Central), composite build from `android/kotlin-sdk.ref` |

**To bump a pin**, change it in every place it is set. On iOS that means
`ios/project.yml` and `ios/DesignCore/Package.swift`; on Android, `android/kotlin-sdk.ref`.

## View only

The phone is for looking at boards, not editing them: the editor (tools, selection handles,
properties, layers) is too big for a phone. What both apps do:

- **Sign in** with a passkey on a Calimero 1.0 cluster (`MeroAppSession`), or on a development
  node. The session is kept in the Keychain / Keystore and restored at launch.
- **Teams**: the account's orgs running Mero Design. Pull to refresh. Anything waiting for the
  person's approval (an update of Mero Design, a node release) shows on top; **Review** shows the
  confirmation code, then opens the node's consent page in the system browser / a Custom Tab.
- **Boards**: a team's boards (the app instances in its org, as the web app makes them), named by
  the board's own `getBoard`, with its description and layer count. Swipe a board to share its
  link. Pull to refresh.
- **Board**: the board drawn read-only. Pinch to zoom, drag to pan, double-tap (or the fit
  button) to fit it. Live: it follows the instance's event stream, polling every 5 s after a
  stream ends. Every member of the team's org reaches its boards; there is nothing to join.
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
creating teams or boards; team settings and roles; exports. A team invitation link that opens the
app (`https://links.calimero.network/com.calimero.mero-design/join?invitation=…`) asks "Join this
team?" and redeems it (`POST /invites/{token}/redeem`), then opens the team.

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

## On Calimero 1.0

The phone holds no node. It signs in to a Calimero 1.0 cluster with a passkey and talks to it
over the sealed channel (`calimero/sealed-http/v2`, opened only after the node's attestation is
verified). `MeroAppSession` gives a `MeroAppBackend` (the SDK's `CalimeroAppBackend`):

| What | Wire |
| --- | --- |
| Sign in / create account / restore | `/auth/passkey/{login,register}/{begin,finish}`, `/auth/refresh` |
| Teams | the account's orgs running Mero Design (`GET /auth/me`) |
| Boards | the app instances in the org (`GET /apps`), one per board |
| Contract reads / writes | `POST /apps/{app}/views` / `POST /apps/{app}/intents` |
| Live updates | `GET /apps/{app}/events` (sealed SSE), polling as a fallback |
| Images | `MeroAppBackend.getBlob` → `/apps/{app}/blobs` |
| Join from an invitation link | `POST /invites/{token}/redeem` |
| Approvals | `POST /consent/requests` → confirmation code in the app → the node's consent page → `GET /consent/{id}/result` |

**Sign-in.** *Calimero Cloud*: the cluster's name (looked up in the Calimero directory) or one of
its node URLs (iOS: `CalimeroClusterURL` in `ios/project.yml`; Android: `-PmeroCluster`), then
**Sign in with passkey** or **Create an account**. The device's passkey needs the cluster's
relying party as an associated domain (`webcredentials:<rp-id>`) / Digital Asset Links.
*Development node*: a `merod local` node URL (iOS `DefaultNodeURL`, `http://localhost:2501`;
Android `-PmeroDevNodeUrl`, `http://10.0.2.2:2501`); mock attestation is allowed and a software
passkey is kept for that node. Android allows cleartext to it in debug builds only.

On Android the Activity hands the session its passkey (`MeroAppSession.passkey`) while it is on
screen, for the step-ups (joining from an invitation needs none).

The consent page returns to `mero-design://consent` (iOS `MeroDesignCallbackScheme`, or an https
host with `MeroDesignCallbackHost` / `MeroDesignCallbackPath`; Android `-PmeroConsentCallback`).
Errors read in plain words: a cancelled passkey prompt, an ended session, a busy or unavailable
cluster, a release deadline, a stale approval, and the contract's `Forbidden` / `Invalid`
refusals (by their `message`).

## The contract client

`DesignClient` is still generated from v1's ABI and types every answer: the component contract
(`../logic`, see #732) answers elements, members, comments, cursors and the board unchanged. Only
the request differs, so one transport per platform (`ComponentTransport`, in
`ios/DesignCore/Sources/DesignCore/Transport.swift` and `android/.../core/Support.kt`) maps each
call onto the component wire, as the web app's `src/api/meroDesign.ts` does:

- method and argument names become camelCase (`add_comment` → `addComment`, `comment_id` →
  `commentId`);
- 64-bit integer arguments travel as decimal strings (`timestamp`, `updatedAt`, `createdAt`, and
  `x`/`y` of `addComment`, `updateElement`, `updateCursor`); an omitted optional is sent `null`;
- `get_elements` (at most 1,000 elements on the component) is read whole through
  `getElementsPage`.

Do not edit the generated files by hand:

- iOS: `ios/DesignCore/Sources/DesignCore/Generated/DesignClient.swift`
- Android: `android/app/src/main/kotlin/network/calimero/design/generated/DesignClient.kt`

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

The iOS demo (Debug, `-MeroDemo YES`) answers the component wire from fixtures, for the UI tour
and screenshots.

CI: `.github/workflows/mero-design-ios.yml` (DesignCore tests on macOS, simulator build) and
`.github/workflows/mero-design-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
