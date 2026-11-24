# Mero Tag — native iOS app

The iOS client for Mero Tag, next to the served sign-in page (`../app`) and the contract (`../logic`, package
`com.calimero.mero-tag`). iOS only: the app is MapKit and CoreLocation throughout, so there is no Android client.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, MapKit, CoreLocation, iOS 17+, XcodeGen | [mero-swift](https://github.com/calimero-network/core/tree/master/sdks/clients/mero-swift) `MeroKit` + `MeroKitUI` from core's release, in `ios/project.yml` and `ios/TagCore/Package.swift` |

The pin is an SDK release; core's fleet bump moves both values (`exactVersion` / `exact:`) together.

## Layout

- `ios/TagCore/` — the non-UI layer, a SwiftPM package tested with `swift test` on macOS (no simulator):
  - `Generated/TagClient.swift`, the typed contract client `meroctl app codegen` writes from
    `../logic/res/abi.json` (`scripts/mobile-codegen.sh` at the repository root; CI's `Mobile clients`
    workflow fails on a stale one). Every call goes through it, over the SDK's `ContextContract`.
  - `MeroService` reads the client's answers into the app models (the ABI names the records without their
    shape), `TrackerStore` keeps a space's trackers, members and presence live from the event stream, and
    `SpaceInvite` encodes the SDK's `InviteLink`.
  - `TagCoreTestSupport`, the fake transport and fixtures both test targets share.
- `ios/Sources/` — the app: sign-in and spaces (`App/AppState.swift`, on the SDK's `MeroClient`), the
  organization layer (`Services/SpaceDirectory.swift`), location (`Services/Location*.swift`) and the screens.
- `ios/Tests/` — the app's own tests (sign-in, creating and joining a space), on `TagCoreTestSupport`.

## Calimero 1.0

- **Sign in** opens Mero Tag's served page (`../app`, packed into the bundle) in the system sign-in sheet;
  the session comes back sealed to `mero-tag://signed-in` (`signInWithServedPage`). A development cluster
  (`merod local`) signs in with a software passkey on the device.
- **A space is an app instance** in an organization named after it; invitations are the SDK's `InviteLink`
  (`https://links.calimero.network/com.calimero.mero-tag/join?invitation=…`, or `merotag://join?invitation=…`).
- **Approvals** (founding an organization, invites, updates) go through the node's consent page and return to
  `mero-tag://consent`; a passkey step-up returns to `mero-tag://approved`.

## Build and test

```bash
make core-test    # swift test the TagCore package
make app-gen      # MeroTag.xcodeproj from ios/project.yml (brew install xcodegen)
make app-build    # build for the simulator
```

`make dev` (from `apps/mero-tag`) starts a `merod local` cluster in Docker and installs the contract; the
Simulator reaches it at `http://localhost:2501`.
