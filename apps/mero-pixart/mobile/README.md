# Mero PixArt: native mobile apps

Native iOS and Android viewers for Mero PixArt, next to the web editor (`../app`) and the contract
(`../logic`, package `com.calimero.mero-pixart`). They have the same screens, copy, icons (SF Symbols
and the matching Material icons) and behaviour.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `122bb0d7` (`feat/app-session`, PR #84) |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0999426` (`feat/app-session`, PR #67), composite build from `android/kotlin-sdk.ref` |

**The pins move to the merge commits once those two SDK PRs merge.** On iOS that means
`ios/project.yml` and `ios/PixartCore/Package.swift`; on Android, `android/kotlin-sdk.ref`.

## View only, plus a few light actions

The editor (tools, brushes, masks, curves, transforms) stays on the web and desktop. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`): the wallet certifies the phone's key. The
  session is kept in the Keychain / Keystore and restored at launch.
- **Teams**: the account's namespaces running Mero PixArt. Pull to refresh.
- **Projects**: a team's projects as a two-column gallery, each card a real thumbnail of the artwork
  (composited on the phone, at most 360 px), with its size and layer count. Long-press (Android) or
  touch and hold (iOS) to share the project's link. Pull to refresh. **Invite** (person-plus icon)
  makes a team invitation link in the web's format and opens the share sheet.
- **Artwork**: the composed image over a checkerboard. Pinch to zoom, drag to pan, double-tap to go
  between fit and 2.5×. Live: it follows the relay's event stream, or polls every 5 s when the relay
  cannot stream, and redraws only when the document or a layer changed. Opening a project this
  account is not in yet joins its context (an open subgroup of the team).
- **Layers**: the folder tree, front-most first, with each layer's kind, blend mode, opacity and lock.
  The eye shows or hides a layer **on this phone only**: it never writes to the contract, and the
  layer list and a pill over the artwork say so, with a Reset.
- **Export**: the composite as a PNG at full document size (capped at 8192 px), through the share
  sheet. It exports what the phone shows, so locally hidden layers stay out.
- **About this project**: description, size, layers, members (the roster), your access, and the ids
  behind a Details disclosure.
- **Invitations**: a `…/com.calimero.mero-pixart/join?invitation=…` link (https or `calimero://`)
  opens the app, asks to join the team, joins it, and opens it. Another app's link is refused.

Not on the phone: any editing (layers, pixels, masks, curves, adjustments, transforms, text);
creating or deleting teams and projects; renaming or resizing; roles and team settings; the live
cursors of other members; undo history. The web app has no comments, so there are none here either.

## How the artwork is drawn

Natively, from the layers the contract stores and their PNG blobs, not in a web view and not from a
stored flattened image (the contract keeps none). Both apps port the web's compositor
(`app/src/utils/compositor.ts`, `transform.ts`, `raster.ts`):

- layers by ascending `layerIndex`; folders contribute inherited visibility and multiplied opacity;
- raster layers from their blob, drawn at the layer's top-left and clipped to its box; fill layers
  as a solid (or their blob once painted); text layers with the platform's sans, serif or mono face
  at the stored size, colour, weight, style and alignment;
- each layer's own matrix (position, scale, mirror, shear, rotation, about the box centre) and its
  corner-pin warp as the web's 12×12 triangle mesh;
- layer masks (alpha × mask luminance) and the non-destructive adjustments (brightness + exposure,
  contrast, saturation, hue, invert, and blur as three box passes approximating the CSS gaussian);
- all 16 blend modes: Core Graphics `CGBlendMode` on iOS, `android.graphics.BlendMode` on Android 10+
  (on Android 8–9 the five PorterDuff modes; the other eleven draw as normal there).

The platform-free part (`LayerStack`, `LayerTree`, `LayerGeometry`, `Warp`, `ColorFilter`,
`PixelOps`) is the same code on both platforms and unit-tested on both with the same cases; each
platform only paints (`Renderer.swift`, Core Graphics; `Compositor.kt`, `android.graphics`).

Known gaps: curves are not applied (the web bakes them into the pixels, so a stored layer already
shows them); a layer that has both a blur and a warp is drawn blurred but unwarped; text uses the
platform's faces for the web's font families.

## Delegated execution only

Neither app runs or logs into a node. `MeroAppSession` signs in, finds the account's relay, and gives
a `MeroAppBackend`: namespaces, subgroups, membership, invitations and events go through it, contract
reads through the relay's query. Blobs are read with the signed-in client's
`admin.getBlob(blobId, contextId)`, because `MeroAppBackend` has no blob call yet, and decoded once
into a cache shared by the gallery and the artwork.

## Generated contract client

`PixartClient` is generated from `../logic/res/abi.json` with `--transport-import`, so it takes the
SDKs' own `ContextContractCalling` and `PixartClient(transport: contract.bound(to: id))` needs no
adapter. Never edit it by hand:

- iOS: `ios/PixartCore/Sources/PixartCore/Generated/PixartClient.swift`
- Android: `android/app/src/main/kotlin/network/calimero/pixart/generated/PixartClient.kt`

After a contract change, regenerate both with `scripts/regenerate-client.sh` (set `ABI_CODEGEN` to an
abi-codegen `dist/cli.js` with the `swift` and `kotlin` targets) and commit the result.

## Build and test

iOS (Xcode 15+, `brew install xcodegen`):

```bash
cd ios
swift test --package-path PixartCore   # compositor, view models, invitations, on macOS
xcodegen generate && open MeroPixart.xcodeproj
```

Android (JDK 17, Android SDK 34):

```bash
cd android
./scripts/fetch-sdk.sh                 # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

Sign-in returns to `mero-pixart://enrol`. Point the apps at another environment with the
`MeroCloudBaseURL` / `MeroWalletURL` / `MeroRegistryURL` Info.plist keys in `ios/project.yml`, or
`-PmeroCloudUrl=` / `-PmeroWalletUrl=` / `-PmeroRegistryUrl=` / `-PmeroEnrolCallback=` on Android.
The hosted wallet currently returns only to `https://` callbacks, so production sign-in needs that
wallet change or a verified https callback (as in Mero Chat).

CI: `.github/workflows/mero-pixart-ios.yml` (PixartCore tests on macOS, app build) and
`.github/workflows/mero-pixart-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
