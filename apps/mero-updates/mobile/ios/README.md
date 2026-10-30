# Mero Updates for iOS

SwiftUI, iOS 16+. See [../README.md](../README.md) for what the app does and how it talks to
Calimero.

```
Core/                          local Swift package UpdatesCore (no UI): `swift test` on macOS
  Sources/UpdatesCore/
    Generated/UpdatesClient.swift   generated from ../logic/res/abi.json — do not edit
    Format, Composer, UpdatesInvitation, Support     helpers ported from the web's lib/
    CompaniesModel, CompanyModel, AudienceModel, FeedModel, PostModel, ComposerModel,
    TabModels (asks, Q&A, KPIs, people, settings)    view models
  Tests/UpdatesCoreTests/      view-model and helper tests on MeroKitTestSupport's InMemoryAppBackend
Sources/App/                   SwiftUI screens, on MeroKitUI's MeroAppSession
Resources/Fonts/               Power Grotesk, the web app's display face (app/public/fonts/powerGrotesk)
project.yml                    XcodeGen spec (the .xcodeproj is not committed)
```

## Build

```bash
cd Core && swift test          # the core: generated client, helpers, view models
cd .. && xcodegen generate     # writes MeroUpdates.xcodeproj
open MeroUpdates.xcodeproj
```

## SDK pin

`project.yml` and `Core/Package.swift` pin swift-sdk `6c5f116`, the head of swift-sdk#85
(`feat/calimero-1.0`, the Calimero 1.0 port); it moves to the merge commit once that lands. Move
both together when bumping (to a newer commit or a release tag).

## Configuration

Info.plist keys set in `project.yml`:

| Key | Default |
| --- | --- |
| `MeroNodeURL` | empty: the sign-in screen asks for a node of your Calimero Cloud cluster |
| `MeroDevNodeURL` | `http://localhost:2501`: the *Development node* field (`merod local`, `allowMock`) |
| `UpdatesCallbackScheme` | `mero-updates` (the node's consent page returns to `mero-updates://consent`) |
| `UpdatesCallbackHost` / `UpdatesCallbackPath` | unset: set a host to use a verified https return |

Signing in with the device's passkey on a real cluster needs the `webcredentials:<rp-id>`
associated domain of the cluster's relying party; a development node uses a software passkey.

Invitation links open the app as `calimero://com.calimero.mero-updates/join?invitation=…`; the
https form needs Associated Domains on `links.calimero.network`, which that host does not publish
for this app yet, so a pasted https link goes through **Join with an invitation** instead.
