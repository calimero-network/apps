# Mero Models: native mobile apps

Native iOS and Android viewers for Mero Models, next to the web studio (`../app`) and the contract
(`../logic`, package `com.calimero.mero-models`). They have the same screens, copy, icons (SF
Symbols and the matching Material icons) and behaviour, and they draw the 3D viewport with the
same code.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `a1ec644` (head of `feat/calimero-1.0`, PR #85; moves to its merge commit once it lands). **Calimero 1.0.** |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (`main` merge commit of PR #67), composite build from `android/kotlin-sdk.ref` |
| Viewport | `viewer/` | three.js 0.185 + the web studio's drawing code, bundled into one local file | |

**The iOS app runs on Calimero 1.0; the Android app still speaks the 0.x API until kotlin-sdk is
ported.** On iOS the pin lives in `ios/project.yml` and `ios/ModelsCore/Package.swift` (keep them
equal); on Android, `android/kotlin-sdk.ref`.

## Calimero 1.0 on iOS

- **Sign in** with a passkey on the studio's cluster (`MeroAppSession.signIn()`, the device's
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
- **Words**: a studio is an **organization**; a scene is an **app instance** of
  `com.calimero.mero-models` in it (org-wide, or in one of its **teams**).
- **Invitations** are org invite tokens (`POST /orgs/{org}/invites`, redeemed with
  `POST /invites/{token}/redeem`).
- **Approvals**: when a node release or an app upgrade waits for the account (or a studio it owns),
  the studios list shows it under "Needs your approval". "Review" opens the **node's consent page
  in the system browser**; the page returns to `mero-models://consent`. The app never approves by
  itself. A refused call because a release deadline has passed says so in words.
- A real cluster's passkeys need the app to carry the `webcredentials:<rp-id>` Associated Domain of
  that cluster; it is not set in `project.yml` yet.

## View only

The phone is for looking at scenes, not modelling them. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`): on iOS a passkey on the 1.0 cluster (see
  above); on Android the wallet certifies the phone's key. The session is kept in the Keychain /
  Keystore and restored at launch.
- **Studios**: the account's organizations (namespaces on Android's 0.x) running Mero Models; one
  invitation opens every scene in one. Pull to refresh.
- **Scenes**: a studio's scenes (contexts in its root group, as the web's "New scene" makes them,
  plus any in subgroups), named by each scene's own `get_scene`, with object and member counts.
  Swipe a scene to share a link to it. Pull to refresh.
- **Scene**: the 3D viewport with one-finger orbit, pinch to zoom and two-finger pan, a fit
  button, Solid / Rendered shading (the studio's two lit modes) and the grid. Tap an object to
  select it: a card shows its kind, triangle and vertex counts, and whether it is checked out,
  by whom, since when and until when. Under the viewport, three tabs:
  - **Objects**: the outliner (hierarchy, creation order, hidden objects dimmed), with a lock and
    the holder's name on anything checked out. Tap a row to select and frame it.
  - **Check-outs**: every live check-out (objects and textures), newest first: holder, since, until.
  - **People**: members and their roles.
  Live: the node's event stream (`/apps/{app}/events`), or a 5 s poll when it cannot stream (the
  web's interval).
- **Share**: mints an invitation to the studio and shares
  `https://links.calimero.network/com.calimero.mero-models/join?invitation=…` (payload
  `{invitation, namespaceId, contextId}`, `base58(deflate(JSON))`). On iOS `invitation` is the
  1.0 org invite, `{"orgId": "…", "token": "inv_…"}`, the shape every 1.0 client of the package
  reads (swift-sdk's `InvitationLinkPayload`). Android still mints the 0.x signed invitation; the
  two do not open each other's links until Android is ported.
- **Invitations**: such a link opened on the phone (or pasted under "Join with a link") asks to
  join, redeems it, and opens the scene.
- **About this scene**: counts, your role, and the ids behind a Details disclosure.

Not on the phone: modelling and every write (objects, meshes, materials, textures, environment),
check-out and check-in, roles, history and restore, imports and exports, live presence (peer
cameras and selections are ephemeral events the SDK does not expose). The web app has no comments,
so neither do these.

## How a scene is drawn

The web studio stores its own mesh format (`app/src/editor/meshcodec.ts`: deflated polygon cages
with a modifier stack, or triangle lists), primitives as parameters (`cube`, `torus`, … with a
segment count), PBR materials with texture blobs, and lights. None of that is glTF, OBJ or USDZ,
so neither SceneKit / ModelIO nor Filament / SceneView can load it, and a native port would mean
re-implementing the cage evaluation, the modifiers, the primitive generators and the material
model twice.

So the viewport is a web view, and only the viewport: `viewer/src/main.ts` imports the studio's
own `build.ts`, `geometry.ts`, `meshcodec.ts` and `textures.ts`, sets up the studio's lights,
grid, shading modes and selection outline, and `viewer/build.mjs` bundles it with three.js into
one self-contained file, `viewer/dist/viewer.html` (about 620 KB). Both apps ship that file as a
local resource (iOS: a bundle resource from `project.yml`; Android: an asset directory in
`app/build.gradle.kts`); nothing loads from a CDN. The native side reads the scene through the
contract and hands it to the page as JSON; the page asks for blobs by id and the app reads them:
on iOS with `MeroAppBackend.getBlob(blobId:contextId:)` (`/apps/{app}/blobs`), on Android with the
signed-in client's `admin.getBlob(blobId, contextId)`.
Everything around the viewport is native.

Because it is one file and the studio's code, both platforms render identically (same lighting,
background, controls), and identically to the web studio.

After changing `viewer/src` or the studio's drawing code, rebuild and commit the bundle:

```bash
pnpm install                                # once, at the repo root
node apps/mero-models/mobile/viewer/build.mjs
```

## Through `MeroAppBackend`

Neither app runs a node. `MeroAppSession` signs in and gives a `MeroAppBackend`: studios, scenes,
membership, invitations, blobs and events go through it. On iOS that is swift-sdk's
`CloudAppBackend` over the 1.0 `CalimeroClient` (contract reads are `/apps/{app}/views`); on
Android it is still the 0.x relay. The apps make no contract writes.

## Generated contract client

`ModelsClient` is generated from `../logic/res/abi.json` with `--transport-import`, so it takes
the SDK's `ContextContractCalling` and `ModelsClient(transport: contract.bound(to: contextId))`
works with no adapter. Never edit it by hand:

- iOS: `ios/ModelsCore/Sources/ModelsCore/Generated/ModelsClient.swift`
- Android: `android/app/src/main/kotlin/network/calimero/models/generated/ModelsClient.kt`

After a contract change, regenerate both with `scripts/regenerate-client.sh` (set `ABI_CODEGEN`
to an abi-codegen `dist/cli.js` that has the `swift` and `kotlin` targets) and commit the result.

## Build and test

iOS (Xcode 15+, `brew install xcodegen`):

```bash
cd ios
swift test --package-path ModelsCore   # view models, invitation format, approvals, formatting, on macOS
xcodegen generate && open MeroModels.xcodeproj
```

Android (JDK 17, Android SDK 34):

```bash
cd android
./scripts/fetch-sdk.sh                 # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

iOS: point the app at a cluster with the `MeroNodeURL` / `MeroNodes` / `MeroAllowMock` Info.plist
keys in `ios/project.yml` (or from the sign-in screen); the consent page returns to
`mero-models://consent`. Android: sign-in returns to `mero-models://enrol`; point it at another
environment with `-PmeroCloudUrl=` / `-PmeroWalletUrl=` / `-PmeroRegistryUrl=` /
`-PmeroEnrolCallback=`.

CI: `.github/workflows/mero-models-ios.yml` (ModelsCore tests on macOS, simulator build) and
`.github/workflows/mero-models-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder and the viewer bundle.
