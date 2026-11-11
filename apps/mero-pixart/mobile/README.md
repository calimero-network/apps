# Mero PixArt: native mobile apps

Native iOS and Android viewers for Mero PixArt, next to the web editor (`../app`) and the contract
(`../logic`, package `com.calimero.mero-pixart`). They have the same screens, copy, icons (SF Symbols
and the matching Material icons) and behaviour.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0`. **Calimero 1.0.** |
| Android | `android/` | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (Calimero 1.0), composite build from `android/kotlin-sdk.ref`. **Calimero 1.0.** |

**Both apps run on Calimero 1.0**, with the same screens and flows. On iOS the pin lives in `ios/project.yml` and `ios/PixartCore/Package.swift` (keep them
equal); on Android, `android/kotlin-sdk.ref`.

## Calimero 1.0

- **Sign in** with a passkey on the team's cluster (`MeroAppSession.signIn()`, the device's
  platform passkey), or **create an account** (`signUp(name:)`). The session (a 15-minute access
  token and a 30-day refresh token) is kept in the Keychain and refreshed at launch. Every request
  goes over the sealed channel to an attested node.
- **The cluster** is `MeroNodeURL` in `ios/project.yml` / `meroNodeUrl` in
  `android/gradle.properties`. Left empty, the sign-in screen asks for one: a cluster **name**
  (`eu-shared-1`, its nodes read from the node directory) or a node URL from Calimero Cloud's console.
- **Development**: on the sign-in screen, "Choose your cluster" (or "Change") takes any node URL
  and a "Development cluster" switch, which trusts mock attestation (`allowMock`) as `merod local`
  serves it (`cargo run -p merod -- local`, nodes on `http://127.0.0.1:2501-2503`). The app then
  keeps a soft passkey for that node and creates its account on the first sign-in. Or set
  `MeroNodeURL` and `MeroAllowMock: "YES"` in `project.yml`. On Android the switch suggests
  `meroDevNodeUrl` (`http://10.0.2.2:2501`, the host as the emulator sees it); debug builds allow
  cleartext to localhost / 10.0.2.2 only.
- **Words**: a PixArt team is a Calimero **organization**; a project is one of its Calimero
  **teams**, holding one **app instance** of `com.calimero.mero-pixart`.
- **Invitations** are org invite tokens (`POST /orgs/{org}/invites`, redeemed with
  `POST /invites/{token}/redeem`). The link keeps its URL; its payload is swift-sdk's
  `OrgInvitation`, `{"invitation": "inv_…", "namespaceId": "<team>", "name": "<team name>"}`, the
  shape every 1.0 client of the package reads (iOS, Android and the ported web app). Pre-1.0 signed
  invitations are refused. Minting one is a passkey step-up (on Android the Activity's
  `PlatformPasskey`).
- **Approvals**: when a node release or an app upgrade waits for the account (or an organization it
  owns), the teams list shows it under "Needs your approval". "Review" opens the **node's consent page in
  the system browser** (a Custom Tab on Android) after showing the request's **confirmation code**,
  which the page shows too; the page returns to `mero-pixart://consent`. The app never approves by itself.
  A call refused because a release deadline has passed says so in words.
- A real cluster's passkeys need the app to carry the `webcredentials:<rp-id>` Associated Domain of
  that cluster; it is not set in `project.yml` yet.

## View only, plus a few light actions

The editor (tools, brushes, masks, curves, transforms) stays on the web and desktop. What both apps do:

- **Sign in** with a Calimero account (`MeroAppSession`): a passkey on the 1.0 cluster (see
  above). The session is kept in the Keychain / Keystore and restored at launch.
- **Teams**: the account's organizations running Mero PixArt, and what needs your approval. Pull to refresh.
- **Projects**: a team's projects as a two-column gallery, each card a real thumbnail of the artwork
  (composited on the phone, at most 360 px), with its size and layer count. Long-press (Android) or
  touch and hold (iOS) to share the project's link. Pull to refresh. **Invite** (person-plus icon)
  makes a team invitation link in the web's format and opens the share sheet.
- **Artwork**: the composed image over a checkerboard. Pinch to zoom, drag to pan, double-tap to go
  between fit and 2.5×. Live: it follows the node's event stream, or polls every 5 s when it
  cannot stream, and redraws only when the document or a layer changed. Opening a project this
  account is not in yet joins it (an open team).
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
membership, invitations and events go through it. That is the SDKs' `CalimeroAppBackend` over the 1.0
`CalimeroClient` (contract reads are `/apps/{app}/views`, writes `/apps/{app}/intents`, blobs
`MeroAppBackend.getBlob` on `/apps/{app}/blobs`). Blobs are decoded
once into a cache shared by the gallery and the artwork.

## The contract clients

`PixartClient` (`ios/PixartCore/Sources/PixartCore/Generated/PixartClient.swift`,
`android/app/src/main/kotlin/network/calimero/pixart/generated/PixartClient.kt`) calls the
component contract's surface (`../logic/res/abi.json` on the component SDK): camelCase method and
argument names (`updateLayer { id, blendMode, scaleX, updatedAt, … }`); the top-level u64 / i64
arguments (`updatedAt`, `timestamp`, `x`, `y`) go out as decimal strings (`WireNumbers.swift`,
`WireNumbers.kt`), while integers inside records (`Layer`, `Member`, cursors) stay JSON numbers.
Refusals are `422 APP_ERROR` (`ViewOnly`, `OwnerOnly`, `Invalid { message }`), shown in plain words
(`PixartFormat.errorText`). `WireTests` / `WireTest` pin the wire. The 0.x abi-codegen does not read
a component ABI, so after a contract change update both clients by hand against `abi.json`.

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
`mero-pixart://consent`. Android: `-PmeroNodeUrl=` (cluster name or node URL),
`-PmeroDevNodeUrl=` and `-PmeroConsentCallback=` (default `mero-pixart://consent`).

CI: `.github/workflows/mero-pixart-ios.yml` (PixartCore tests on macOS, app build) and
`.github/workflows/mero-pixart-android.yml` (ktlint, detekt, unit tests, Android Lint,
`assembleDebug`), each path-filtered to its folder.
