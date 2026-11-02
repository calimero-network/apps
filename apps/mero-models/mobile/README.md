# Mero Models: native mobile apps

Native iOS and Android viewers for Mero Models, next to the web studio (`../app`) and the contract
(`../logic`, package `com.calimero.mero-models`). They have the same screens, copy, icons (SF
Symbols and the matching Material icons) and behaviour, and they draw the 3D viewport with the
same code.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0` (Calimero 1.0) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `v0.2.0` (Calimero 1.0), composite build from `android/kotlin-sdk.ref` |
| Viewport | `viewer/` | three.js 0.185 + the web studio's drawing code, bundled into one local file | |

**Both apps run on Calimero 1.0** and call the scene's component contract as `../logic/res/abi.json`
declares it (the web port, #729). The SDKs are pinned to releases (swift-sdk
v0.5.0, kotlin-sdk v0.2.0). On iOS the pin lives in `ios/project.yml` and
`ios/ModelsCore/Package.swift` (keep them equal); on Android, `android/kotlin-sdk.ref`.

## Calimero 1.0

- **Sign in** has two tabs, the same on both phones:
  - **Calimero Cloud**: the cluster's name (`eu-shared-1`, its nodes read from the node directory
    and tried in order) or one of its nodes' addresses, then **Sign in with a passkey** (the
    device's platform passkey) or **Create an account** (a name, then a new passkey). Every
    request goes over the sealed channel to a node whose TDX attestation checked out.
  - **Development node**: a `merod local` node's URL (`http://127.0.0.1:2501` on iOS,
    `http://10.0.2.2:2501` from the Android emulator). The app trusts its mock attestation
    (`allowMock`), keeps a soft passkey for that node, and creates the account on the first
    sign-in.

  The session (a 15-minute access token and a 30-day refresh token) is kept in the Keychain /
  Keystore with the node it lives on, and refreshed at launch.
- **Words**: a studio is an **organization**; a scene is an **app instance** of
  `com.calimero.mero-models` in it (org-wide, or in one of its **teams**).
- **Invitations** are org invite links: `POST /orgs/{org}/invites` mints a token, the link carries
  it as the SDKs' `OrgInvitation`, and opening it redeems it (`POST /invites/{token}/redeem`).
  Minting is a passkey step-up, so the session gets the device's passkey (Android: the Activity on
  screen hands its `PlatformPasskey` to `MeroAppSession.passkey`).
- **Approvals**: when a node release or an app upgrade waits for the account (or a studio it owns),
  the studios list shows it under "Needs your approval". **Review** asks the node for a consent
  request and first shows its **confirmation code**; **Open the approval page** then opens the
  node's consent page in the system browser (Custom Tab on Android), which shows the same code
  and returns to `mero-models://consent`. The app never approves by itself.
- **Errors** read as words: a dismissed passkey prompt, an ended session, a node running a
  release the account has not approved (`WRONG_NODE`), a cluster that cannot be reached, a passed
  release deadline, a stale consent request, and the contract's `APP_ERROR` codes (`Forbidden`,
  `Invalid`, `Locked`, with the contract's own message when it sends one).
- A real cluster's passkeys need the app to carry that cluster's `webcredentials:<rp-id>`
  Associated Domain (iOS) / Digital Asset Links (Android); neither is set yet.

## View only

The phone is for looking at scenes, not modelling them. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`, see above). The session is kept in the
  Keychain / Keystore and restored at launch.
- **Studios**: the account's organizations running Mero Models; one invitation opens every scene in
  one. Pull to refresh.
- **Scenes**: a studio's scenes (app instances of the org, as the web's "New scene" makes them,
  plus any in its teams), named by each scene's own `getScene`, with object and member counts.
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
  `https://links.calimero.network/com.calimero.mero-models/join?invitation=…`
  (`base58(deflate(JSON))`). The payload is the SDKs' `OrgInvitation`,
  `{"invitation": "inv_…", "namespaceId": "<studio>", "contextId": "<scene>"}`, the shape every
  1.0 client of the package reads, so a link from either phone or the web opens on the others.
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
with `MeroAppBackend.getBlob` (`GET /apps/{app}/blobs/{blob}`): meshes and textures are the scene's
own blobs (core #4815). A node at `1.0.0-rc.7` answers blob routes `409 NOT_SUPPORTED`, so there
meshes stay placeholder boxes until the cluster runs the next core release; nothing changes in
the apps then.
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
membership, invitations, blobs and events go through it: the SDKs' `CalimeroAppBackend` over the
1.0 `CalimeroClient`, so contract reads are views on `/apps/{app}`. The apps make no contract
writes. Tests run the same view models on the SDKs' in-memory backend (`MeroKitTestSupport` /
`mero-testkit`), with the contract's answers scripted.

## Contract client

`ModelsClient` was generated by abi-codegen from the v1 ABI and moved to the component wire by
hand, because abi-codegen does not read component ABIs (`abiVersion`) yet. It takes the SDK's
`ContextContractCalling`, so `ModelsClient(transport: contract.bound(to: appId))` needs no
adapter. Against `../logic/res/abi.json`:

- method names and arguments are camelCase (`getScene`, `listLocks`, `listHistory(assetId)`);
- every `u64` argument (`now`) is a decimal string; answers keep v1's snake_case fields and
  JSON numbers;
- `init` takes no arguments and the node runs it, so the client has none.

The files: `ios/ModelsCore/Sources/ModelsCore/Generated/ModelsClient.swift` and
`android/app/src/main/kotlin/network/calimero/models/generated/ModelsClient.kt`. The unit tests
pin the wire (method names, `now` as a string). Once abi-codegen reads component ABIs, regenerate
both from `abi.json` instead.

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

The cluster is chosen on the sign-in screen. iOS can start on one with the `MeroNodeURL` /
`MeroNodes` / `MeroAllowMock` Info.plist keys in `ios/project.yml`; Android prefills the
Calimero Cloud field with `-PmeroCluster=<name or URL>`. Both receive the consent page's return
on `mero-models://consent`.

CI: `.github/workflows/mero-models-ios.yml` (ModelsCore tests on macOS, simulator build) and
`.github/workflows/mero-models-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder and the viewer bundle.
