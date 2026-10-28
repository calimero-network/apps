# Mero Models: native mobile apps

Native iOS and Android viewers for Mero Models, next to the web studio (`../app`) and the contract
(`../logic`, package `com.calimero.mero-models`). They have the same screens, copy, icons (SF
Symbols and the matching Material icons) and behaviour, and they draw the 3D viewport with the
same code.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `122bb0d7` (`feat/app-session`, PR #84) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0999426` (`feat/app-session`, PR #67), composite build from `android/kotlin-sdk.ref` |
| Viewport | `viewer/` | three.js 0.185 + the web studio's drawing code, bundled into one local file | |

**The SDK pins move to the merge commits once those two SDK PRs merge.** On iOS that means
`ios/project.yml` and `ios/ModelsCore/Package.swift`; on Android, `android/kotlin-sdk.ref`.

## View only

The phone is for looking at scenes, not modelling them. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`): the wallet certifies the phone's key.
  The session is kept in the Keychain / Keystore and restored at launch.
- **Studios**: the account's namespaces running Mero Models (the web calls them namespaces; one
  invitation opens every scene in one). Pull to refresh.
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
  Live: the relay's event stream, or a 5 s poll when the relay cannot stream (the web's interval).
- **Share**: mints a namespace invitation with the device key and shares the web app's own link,
  `https://links.calimero.network/com.calimero.mero-models/join?invitation=…` (payload
  `{invitation, namespaceId, contextId}`, `base58(deflate(JSON))`), so the link opens in the web
  app, the desktop app and these apps alike.
- **Invitations**: such a link opened on the phone (or pasted under "Join with a link") asks to
  join, joins the studio through the relay, and opens the scene.
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
contract and hands it to the page as JSON; the page asks for blobs by id and the app reads them
with the signed-in client's `admin.getBlob(blobId, contextId)` (`MeroAppBackend` has no blob call).
Everything around the viewport is native.

Because it is one file and the studio's code, both platforms render identically (same lighting,
background, controls), and identically to the web studio.

After changing `viewer/src` or the studio's drawing code, rebuild and commit the bundle:

```bash
pnpm install                                # once, at the repo root
node apps/mero-models/mobile/viewer/build.mjs
```

## Delegated execution only

Neither app runs or logs into a node. `MeroAppSession` signs in, finds the account's relay, and
gives a `MeroAppBackend`: namespaces, contexts, membership, invitations and events go through it,
contract reads through the relay's query. The apps make no contract writes.

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
swift test --package-path ModelsCore   # view models, invitation format, formatting, on macOS
xcodegen generate && open MeroModels.xcodeproj
```

Android (JDK 17, Android SDK 34):

```bash
cd android
./scripts/fetch-sdk.sh                 # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

Sign-in returns to `mero-models://enrol`. Point the apps at another environment with the
`MeroCloudBaseURL` / `MeroWalletURL` / `MeroRegistryURL` Info.plist keys in `ios/project.yml`, or
`-PmeroCloudUrl=` / `-PmeroWalletUrl=` / `-PmeroRegistryUrl=` / `-PmeroEnrolCallback=` on Android.
The hosted wallet currently returns only to `https://` callbacks, so production sign-in needs that
wallet change or a verified https callback (as in Mero Chat).

CI: `.github/workflows/mero-models-ios.yml` (ModelsCore tests on macOS, simulator build) and
`.github/workflows/mero-models-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder and the viewer bundle.
