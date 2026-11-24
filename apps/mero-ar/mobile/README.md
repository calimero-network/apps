# Mero AR — native iOS app

The iPhone and iPad app for Mero AR, next to its served sign-in page (`../app`) and the contract
(`../logic`, package `com.calimero.mero-ar`). iOS only: it is an ARKit and RoomPlan app, and an
Android AR client would be new work rather than a port.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI + ARKit + RealityKit + RoomPlan (SceneKit preview without ARKit), iOS 17+, XcodeGen | [mero-swift](https://github.com/calimero-network/core/tree/master/sdks/clients/mero-swift) `MeroKit` + `MeroKitUI` from core's release, in `ios/project.yml` and `ios/MeroARCore/Package.swift` |

The pin is an SDK release; bump both `exactVersion` / `exact:` values together (core's fleet bump
moves them).

## Layout

- **`ios/MeroARCore/`** — the non-UI layer as a local SwiftPM package, tested on macOS with no
  simulator (`swift test --package-path ios/MeroARCore`):
  - `Generated/MeroArClient.swift`, the typed contract client `meroctl app codegen` writes from
    `../logic/res/abi.json` (`scripts/mobile-codegen.sh` at the repo root; CI's `Mobile clients`
    workflow fails on a stale one). Until the logic derives `AbiType`, the ABI names its records
    without their shape, so the client answers their JSON and `MeroARService` reads it into the
    models below.
  - `MeroARService` (one room's contract, through the generated client over `RoomContract`),
    `RoomCluster` (the cluster: views, calls, events, blobs, homes, invites, upgrades; `CloudCluster`
    is a Calimero 1.0 cluster), `SceneStore`, the scene and room models, furniture, invitations,
    and the sample living room.
- **`ios/Sources/`** — the app: sign-in and session (`AppState`), the AR and 3D-preview views,
  the lobby, people, scanning, and `Debug/FixtureCluster` (an in-memory cluster for tests and the
  UI tests' `MEROAR_FIXTURE=1` launch).
- **`ios/Tests/`, `ios/UITests/`** — the app's tests on the fixture cluster.

## Calimero 1.0

- **Sign-in**: Calimero Cloud on Mero AR's served page in the system sign-in sheet
  (`MeroClient.signInWithServedPage`, back to `mero-ar://signed-in`), with its step-ups approved
  there (`mero-ar://approved`) and organization actions on the node's consent page
  (`mero-ar://consent`); or a **development node** (`merod local`, mock attestation, a software
  passkey kept for that node).
- **A home is an organization** holding Mero AR, and its rooms are app instances of
  `com.calimero.mero-ar` in it. Invitations are org invite links.
- **Live updates** are the room's sealed event stream; while it is down the room re-reads every few
  seconds.

## Build and test

```bash
cd ios
xcodegen generate                                  # MeroAR.xcodeproj (not committed)
swift test --package-path MeroARCore               # the core package, on macOS
xcodebuild build -project MeroAR.xcodeproj -scheme MeroAR \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

`make app-gen`, `make app-build` and `make app-test` in `apps/mero-ar` do the same; `make dev`
starts a development cluster for the app (`../scripts/dev-cluster.sh`, Docker on a Mac).
CI: `.github/workflows/mero-ar-ios.yml`.
