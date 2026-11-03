# Mero Issue Tracker: native mobile apps

Native iOS (SwiftUI) and Android (Jetpack Compose) clients for Mero Issue Tracker, next to the web
frontend (`../app`) and the contract (`../logic`, package `com.calimero.mero-issue-tracker`). The two
apps have the same screens, in the same order, with the same copy, icons (SF Symbols / Material
Symbols, mapped one to one) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `v0.5.0` |
| Android | [`android/`](android/README.md) | Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `v0.2.0` (not on Maven Central) |

The pins are the SDKs' Calimero 1.0 releases (`ios/project.yml`, `ios/Core/Package.swift`,
`ios/Core/Package.resolved`, `android/kotlin-sdk.ref`).

## On Calimero 1.0

No node runs on the phone. Both apps sign in to a Calimero 1.0 cluster with a passkey and talk to
it over the sealed channel, opened only after the node's attestation is verified. The SDKs'
`MeroAppSession` builds a `CalimeroAppBackend`, which maps the app layer onto the cluster's model:

- a **workspace** is a Calimero **org** (`foundNamespace`, `listNamespaces`);
- a **repository** is an **app instance** of `com.calimero.mero-issue-tracker` in the org
  (`createContext(groupId: org)`), with its GitHub URL in the contract (`setRepoUrl` / `getRepoInfo`);
- reads are views (`POST /apps/{app}/views`), writes are calls (`POST /apps/{app}/intents`), and
  live updates are the instance's sealed event stream, with 5-second polling as a fallback.

### The contract

Both apps call the component contract (`../logic/res/abi.json`, `calimero:app@0.5.0`) exactly as the
web app's `app/src/tracker.ts` does:

- method, argument and field names are camelCase (`createIssue`, `issueId`, `resolutionCriteria`,
  `createdAt`);
- `createdAt`, `editedAt` and a status `count` are decimal strings on the wire;
- `listIssues` filters and `setAssignee`'s assignee are sent as explicit `null` when empty;
- a refusal is `422 APP_ERROR {code, fields}`: `NotFound {id}`, `Invalid {message}`,
  `Forbidden {message}`, shown in plain words.

abi-codegen has no target for a component ABI yet, so the typed clients are written by hand:
`ios/Core/Sources/IssueTrackerCore/Contract/IssueTrackerClient.swift` and
`android/app/src/main/kotlin/network/calimero/issues/contract/IssueTrackerClient.kt`. Their wire
tests (`ContractWireTests`, `ContractWireTest`) pin the method list and every argument name to the ABI.

### Sign-in

- **Calimero Cloud**: the cluster's **name** (its nodes come from the Calimero node directory) or
  one of its node URLs, then **Sign in with passkey** or **Create an account**. The node's TDX
  attestation is verified (`CloudPolicy.production`).
- **Development node**: a `merod local` URL (iOS `http://localhost:2501`, Android emulator
  `http://10.0.2.2:2501`). Mock attestation is allowed and a software passkey is kept on the
  device for that node.

### Invitations

An invitation is an org invite: the inviter's passkey approves `POST /orgs/{org}/invites`, and the
link carries the token as the SDK's `OrgInvitation` payload,
`https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<base58(deflate(json))>`
with `{"invitation":"inv_…","namespaceId":"<org>","name":"<workspace>","groupAlias":"<workspace>","kind":"namespace"}`;
`calimero://` links work too. Joining redeems it (`POST /invites/{token}/redeem`). Pre-1.0 (signed
group) links are refused. The token is a bearer secret until it is used or expires.

### Approvals

Node releases and updates of the tracker are approved only on the node's own consent page.
**Workspace → Needs your approval** lists what waits for the signed-in person. **Review** first
shows the request's confirmation code, then opens the consent page in the system browser (a Custom
Tab on Android); the page shows the same code and sends the person back to `mero-issues://consent`.

### Errors in words

`ConfirmCancelled` (passkey prompt dismissed), `LoginRequired` (session ended), `WrongNode` and
`Unavailable` (the cluster can't serve right now), `ReleaseDeadline` (a node release needs
approval first), `ConsentStale`, `PasskeyRequired`, and the contract's `APP_ERROR` codes each get a
plain sentence.

## Screens

1. **Sign in**: Calimero Cloud (cluster name or node URL, then passkey sign-in or create account)
   or a development node.
2. **Issues** tab: the open repo's issues grouped by status, search, filter chips (status,
   priority, assignee, label) in a Filters sheet, pull to refresh, swipe to mark Done / Reopen,
   long-press for "Move to…". The title is a repo switcher; the lime + files a new issue.
3. **Board** tab: one column per status (Open, In progress, Blocked, Done), swiped sideways one
   at a time, with a status chip row on top. Each card has a "Move to…" menu (no dragging).
4. **Workspace** tab: what needs your approval, the open workspace, Invite people, its repositories (switch, add, set the
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

- **Repository names.** `MeroAppBackend.listContexts` returns ids only. The creator's device
  remembers the name it gave; everyone else sees the name derived from the repo's GitHub URL
  (`acme/core` → `core`), else `Repo <id prefix>`.
- **Contract client protocol.** The clients declare their own `ContextContractCalling`; iOS adopts
  it for `BoundContextContract` in an extension, Android wraps the SDK's bound contract in
  `BoundTransport`.

## CI

`.github/workflows/mero-issue-tracker-ios.yml` (macOS: `swift test` on the Core package, then
XcodeGen and an app build) and `.github/workflows/mero-issue-tracker-android.yml` (fetch the
SDK, ktlint, detekt, unit tests, Android Lint, `assembleDebug`), each path-filtered to its folder.
