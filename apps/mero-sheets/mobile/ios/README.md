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

Bundle id `network.calimero.sheets`. Sign-in returns to `mero-sheets://enrol`; invitation links
arrive on `calimero://com.calimero.mero-sheets/join?invitation=…`. Set `SheetsCallbackHost`
in `project.yml` for a verified https callback, and `MeroCloudBaseURL` / `MeroWalletURL` /
`MeroRegistryURL` for another environment (empty means the SDK's defaults).

The swift-sdk is pinned by revision (the `main` merge commit of PR #84) in both `project.yml`
and `Core/Package.swift`; keep the two equal.
