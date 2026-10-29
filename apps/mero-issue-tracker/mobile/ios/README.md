# Mero Issue Tracker for iOS

SwiftUI, iOS 16+. See [`../README.md`](../README.md) for the screens, features and SDK notes.

| Path | What |
| --- | --- |
| `project.yml` | XcodeGen spec (`MeroIssues.xcodeproj` is generated, not committed) |
| `Core/` | SwiftPM package `IssueTrackerCore`: the generated client, `WorkspaceModel`, `IssuesModel`, `IssueDetailModel`, invitations, formatting, and their tests |
| `Sources/App/` | The SwiftUI app |

```bash
cd Core && swift test          # models against MeroKitTestSupport's InMemoryAppBackend, no simulator
cd .. && xcodegen generate && open MeroIssues.xcodeproj
```

Bundle id `network.calimero.issues`. Sign-in returns to `mero-issues://enrol`; invitation links
arrive on `calimero://com.calimero.mero-issue-tracker/join?invitation=…`. Set `IssuesCallbackHost`
in `project.yml` for a verified https callback, and `MeroCloudBaseURL` / `MeroWalletURL` /
`MeroRegistryURL` for another environment (empty means the SDK's defaults).

The swift-sdk is pinned by revision (`main`, the merge commit of PR #84) in both `project.yml` and
`Core/Package.swift`; bump both together.
