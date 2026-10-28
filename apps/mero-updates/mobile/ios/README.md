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

`project.yml` and `Core/Package.swift` pin swift-sdk `122bb0d` (`feat/app-session`, PR #84).
Once that PR merges, move both to the merge commit (or a release tag) together.

## Configuration

Info.plist keys set in `project.yml`; empty means the SDK default:

| Key | Default |
| --- | --- |
| `UpdatesCallbackScheme` | `mero-updates` (the wallet returns to `mero-updates://enrol`) |
| `UpdatesCallbackHost` / `UpdatesCallbackPath` | unset: set a host to use a verified https callback |
| `MeroCloudBaseURL`, `MeroWalletURL`, `MeroRegistryURL` | the hosted Calimero services |

Invitation links open the app as `calimero://com.calimero.mero-updates/join?invitation=…`; the
https form needs Associated Domains on `links.calimero.network`, which that host does not publish
for this app yet, so a pasted https link goes through **Join with an invitation** instead.
