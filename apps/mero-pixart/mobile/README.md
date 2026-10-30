# Mero PixArt: native mobile apps

Native iOS and Android viewers for Mero PixArt, next to the web editor (`../app`) and the contract
(`../logic`, package `com.calimero.mero-pixart`). They have the same screens, copy, icons (SF Symbols
and the matching Material icons) and behaviour.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `a1ec644` (head of `feat/calimero-1.0`, PR #85; moves to its merge commit once it lands). **Calimero 1.0.** |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (`main` merge commit of PR #67), composite build from `android/kotlin-sdk.ref` |

**The iOS app runs on Calimero 1.0; the Android app still speaks the 0.x API until kotlin-sdk is
ported.** On iOS the pin lives in `ios/project.yml` and `ios/PixartCore/Package.swift` (keep them
equal); on Android, `android/kotlin-sdk.ref`.

## Calimero 1.0 on iOS

- **Sign in** with a passkey on the team's cluster (`MeroAppSession.signIn()`, the device's
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
- **Words**: a PixArt team is a Calimero **organization**; a project is one of its Calimero
  **teams**, holding one **app instance** of `com.calimero.mero-pixart`.
- **Invitations** are org invite tokens (`POST /orgs/{org}/invites`, redeemed with
  `POST /invites/{token}/redeem`). The link keeps its URL; its `invitation` is
  `{"orgId": "…", "token": "inv_…"}`, the shape every 1.0 client of the package reads (swift-sdk's
  `InvitationLinkPayload`). Android and the web still use the 0.x signed invitation until they are
  ported, so links do not cross between them and iOS yet.
- **Approvals**: when a node release or an app upgrade waits for the account (or an organization it
  owns), the teams list shows it under "Needs your approval". "Review" opens the **node's consent page in
  the system browser**; the page returns to `mero-pixart://consent`. The app never approves by itself.
  A call refused because a release deadline has passed says so in words.
- A real cluster's passkeys need the app to carry the `webcredentials:<rp-id>` Associated Domain of
  that cluster; it is not set in `project.yml` yet.

## View only, plus a few light actions

The editor (tools, brushes, masks, curves, transforms) stays on the web and desktop. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`): on iOS a passkey on the 1.0 cluster (see
  above); on Android the wallet certifies the phone's key. The
  session is kept in the Keychain / Keystore and restored at launch.
- **Teams**: the account's organizations (namespaces on Android's 0.x) running Mero PixArt. Pull to refresh.
- **Projects**: a team's projects as a two-column gallery, each card a real thumbnail of the artwork
  (composited on the phone, at most 360 px), with its size and layer count. Long-press (Android) or
  touch and hold (iOS) to share the project's link. Pull to refresh. **Invite** (person-plus icon)
  makes a team invitation link in the web's format and opens the share sheet.
- **Artwork**: the composed image over a checkerboard. Pinch to zoom, drag to pan, double-tap to go
  between fit and 2.5×. Live: it follows the node's event stream, or polls every 5 s when it
  cannot stream, and redraws only when the document or a layer changed. Opening a project this
  account is not in yet joins it (an open team on iOS, an open subgroup on Android).
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

## Through `MeroAppBackend`

Neither app runs a node. `MeroAppSession` signs in and gives a `MeroAppBackend`: teams, projects,
membership, invitations and events go through it. On iOS that is swift-sdk's `CloudAppBackend` over
the 1.0 `CalimeroClient` (contract reads are `/apps/{app}/views`, blobs
`MeroAppBackend.getBlob(blobId:contextId:)` on `/apps/{app}/blobs`); on Android it is still the 0.x
relay, with blobs from the signed-in client's `admin.getBlob(blobId, contextId)`. Blobs are decoded
once into a cache shared by the gallery and the artwork.

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
swift test --package-path PixartCore   # compositor, view models, invitations, approvals, on macOS
xcodegen generate && open MeroPixart.xcodeproj
```

Android (JDK 17, Android SDK 34):

```bash
cd android
./scripts/fetch-sdk.sh                 # the kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

iOS: point the app at a cluster with the `MeroNodeURL` / `MeroNodes` / `MeroAllowMock` Info.plist
keys in `ios/project.yml` (or from the sign-in screen); the consent page returns to
`mero-pixart://consent`. Android: sign-in returns to `mero-pixart://enrol`; point it at another
environment with `-PmeroCloudUrl=` / `-PmeroWalletUrl=` / `-PmeroRegistryUrl=` /
`-PmeroEnrolCallback=`.

CI: `.github/workflows/mero-pixart-ios.yml` (PixartCore tests on macOS, app build) and
`.github/workflows/mero-pixart-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
