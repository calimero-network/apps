# Mero Issue Tracker: native mobile apps

Native iOS (SwiftUI) and Android (Jetpack Compose) clients for Mero Issue Tracker, next to the web
frontend (`../app`) and the contract (`../logic`, package `com.calimero.mero-issue-tracker`). The two
apps have the same screens, in the same order, with the same copy, icons (SF Symbols / Material
Symbols, mapped one to one) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `c9ca1a0` (`main`, merge of PR #84) |
| Android | [`android/`](android/README.md) | Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `ea8ded7` (`main`, merge of PR #67) |

The pins are the SDKs' `main` merge commits of those PRs (`ios/project.yml` +
`ios/Core/Package.swift`, `android/kotlin-sdk.ref`).

## Delegated execution only

No node runs on the phone. Both apps use the SDKs' `MeroAppSession`: Calimero Cloud sign-in (the
wallet certifies the device key), the account's relay from the Cloud manager, and a
`MeroAppBackend` over that relay. Reads go through the relay's account-scoped query, writes are
warrants the device key signs, and live updates are the relay's event stream for the open repo,
with 5-second polling when the stream is not available.

The model is the web app's:

- a **workspace** is a namespace (`foundNamespace`, `listNamespaces`);
- a **repository** is one context in the workspace's root group (`createContext(groupId: namespace)`),
  with its GitHub URL in the contract (`set_repo_url` / `get_repo_info`);
- **invitations** are the web app's links,
  `https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<base58(deflate(payload))>`,
  with payload `{invitation, groupAlias, groupId, kind: "namespace"}`; `calimero://` links work too.

## Screens

1. **Sign in**: Sign in with Calimero.
2. **Issues** tab: the open repo's issues grouped by status, search, filter chips (status,
   priority, assignee, label) in a Filters sheet, pull to refresh, swipe to mark Done / Reopen,
   long-press for "Move to…". The title is a repo switcher; the lime + files a new issue.
3. **Board** tab: one column per status (Open, In progress, Blocked, Done), swiped sideways one
   at a time, with a status chip row on top. Each card has a "Move to…" menu (no dragging).
4. **Workspace** tab: the open workspace, Invite people, its repositories (switch, add, set the
   GitHub URL), all workspaces (switch, create), the account and Sign out, and a Details
   disclosure with the ids.
5. **Issue** (pushed from Issues or Board): id, status, priority, title, who opened it;
   Status / Priority menus, free-text assignee, labels (add, remove); the four sections (Summary,
   Impact, Repro, Resolution criteria); Copy fix prompt; the activity thread with comments (edit and
   delete your own); a composer above the keyboard; Edit sections and Delete issue (author only)
   in the menu; Details disclosure.
6. Sheets: New issue, Edit issue, Filters, New workspace, Add a repository, Repository URL,
   Invite to workspace, and the Join confirmation when an invitation link opens the app.

Empty, loading, syncing (a just-joined workspace) and error states are on every screen.

## Features vs the web app

Done: workspaces (create, switch, invite, join), repositories (add, switch, GitHub URL), issue list
with search and the same four filters, board by status, issue detail, create (all four sections
required, priority, labels), status / priority / assignee / labels, the four sections editable,
comments (add, edit and delete your own), delete issue (author only), Copy fix prompt (the same
text as `app/src/utils/fixPrompt.ts`), live updates.

Left out, and why:

- **Members page, roles, aliases.** They need group admin calls (members, capabilities, aliases)
  that `MeroAppBackend` does not offer; people show as "You" or a short account key, and the
  assignee stays free text, as on the web.
- **"My issues" / Assignee: Me.** On the web it resolves the person's alias, which needs aliases.
- **Board drag and drop.** Replaced by "Move to…", as planned.
- **Theme switch.** The apps use the Calimero light look only.

## SDK gaps worked around

- **Repository names.** The web app publishes a repo's name in the context metadata record;
  `MeroAppBackend.listContexts` returns ids only and has no metadata call. The creator's device
  remembers the name it gave; everyone else sees the name derived from the repo's GitHub URL
  (`acme/core` → `core`), else `Repo <id prefix>`.
- **Generated client protocol.** The generated clients declare their own `ContextContractCalling`;
  iOS adopts it for `BoundContextContract` in an extension, Android wraps the SDK's bound contract
  in `BoundTransport`.
- **No service name on `createContext`.** The tracker bundle has one service, so the relay's
  default is the right one.

## Regenerate the contract clients

```bash
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/codegen.sh
```

Writes `ios/Core/Sources/IssueTrackerCore/Generated/IssueTrackerClient.swift` and
`android/app/src/main/kotlin/network/calimero/issues/generated/IssueTrackerClient.kt` from
`../logic/res/abi.json`. Views go through `query`, mutations through `execute`. Do not edit them.

## CI

`.github/workflows/mero-issue-tracker-ios.yml` (macOS: `swift test` on the Core package, then
XcodeGen and a simulator build) and `.github/workflows/mero-issue-tracker-android.yml` (fetch the
SDK, ktlint, detekt, unit tests, Android Lint, `assembleDebug`), each path-filtered to its folder.
