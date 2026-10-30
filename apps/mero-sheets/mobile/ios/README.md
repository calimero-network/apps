# Mero Sheets for iOS

SwiftUI, iOS 16+. See [`../README.md`](../README.md) for the screens, features and SDK notes.

| Path | What |
| --- | --- |
| `project.yml` | XcodeGen spec (`MeroSheets.xcodeproj` is generated, not committed) |
| `Core/` | SwiftPM package `SheetsCore`: the generated client, `WorkspaceModel`, `SpreadsheetModel`, the grid layout (row and column order, formula display, number formats), charts, invitations, and their tests |
| `Sources/App/` | The SwiftUI app |

```bash
cd Core && swift test          # models against MeroKitTestSupport's InMemoryAppBackend, no simulator
cd .. && xcodegen generate && open MeroSheets.xcodeproj
```

Bundle id `network.calimero.sheets`. Sign-in (Calimero 1.0) is a passkey on your Calimero Cloud
cluster (`MeroNodeURL` in `project.yml` prefills its node; empty: the sign-in screen asks) or a
development node (`MeroDevNodeURL`, `merod local`, mock attestation allowed). A real cluster's
passkey needs the `webcredentials:<rp-id>` associated domain. The node's consent page returns to
`mero-sheets://consent` (set `SheetsCallbackHost` for a verified https return); invitation links
arrive on `calimero://com.calimero.mero-sheets/join?invitation=…`.

The swift-sdk is pinned by revision (`35148e4`, the head of swift-sdk#85, `feat/calimero-1.0`;
it moves to the merge commit once that lands) in `project.yml`, `Core/Package.swift` and
`Core/Package.resolved`; keep them equal.
