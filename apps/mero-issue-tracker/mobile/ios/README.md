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

```bash
xcodebuild build -project MeroIssues.xcodeproj -scheme MeroIssues \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO   # device SDK, no simulator
```

Bundle id `network.calimero.issues`.

## On Calimero 1.0

The phone holds no node. It signs in to a Calimero 1.0 cluster with a passkey and talks to it over
the sealed channel (`calimero/sealed-http/v2`, opened only after the node's attestation is
verified). The swift-sdk's `CalimeroAppBackend` maps the app layer onto the 1.0 API:

| What | SDK | Wire |
| --- | --- | --- |
| Sign in / create account / restore / sign out | `MeroAppSession.connect(nodeURL:allowMock:)`, `signIn()` / `signUp(name:)` / `restore()` / `signOut()` | `/auth/passkey/{login,register}/{begin,finish}`, `/auth/refresh`; session in the Keychain (`network.calimero.issues`) |
| Workspaces | `listNamespaces()` / `foundNamespace(name:)` | the account's **orgs** running the tracker (`GET /auth/me`), `POST /orgs` + org metadata |
| Repositories | `listContexts(groupId:)` / `createContext` | the org's **app instances** of `com.calimero.mero-issue-tracker` that are in no team (`POST /apps {access: org}`) |
| Issues, comments, statuses | generated client over `contract.bound(to:)` | `POST /apps/{app}/views` (reads), `POST /apps/{app}/intents` (writes) |
| Live updates | `events(contextId:)`, polling as a fallback | `GET /apps/{app}/events` (sealed SSE) |
| Invite / join | `createInvitation` / `joinNamespace` + `session.didJoinNamespace()` | `POST /orgs/{org}/invites` → invite token; `POST /invites/{token}/redeem` |
| Approvals | `session.pendingApprovals(org:)` + `session.client.requestConsent(_:callback:)` (`ApprovalsModel`) | `POST /consent/requests` → the node's consent page in the system browser → `GET /consent/{id}/result` |

In the app's words a **workspace** is a Calimero org and a **repository** an app instance.

### Sign-in

- **Calimero Cloud**: enter the cluster's node URL (from cloud.calimero.network; bake it in with
  `CalimeroClusterURL`), then **Sign in with passkey** or **Create an account**. The node's TDX
  attestation is verified (`CloudPolicy.production`). The device's passkey needs the cluster's
  relying party as an associated domain (`webcredentials:<rp-id>`, see `project.yml`).
- **Development node**: a `merod local` node URL (default `http://localhost:2501`,
  `DefaultNodeURL`). The client allows mock attestation (`allowMock`) and makes and keeps a
  software passkey for that node.

### Invitations

A link is `https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<token>`
(or `calimero://com.calimero.mero-issue-tracker/join?invitation=…`), the token being
`base58(deflate(json))` of
`{"invitation":"inv_…","namespaceId":"…","name":"…","groupAlias":"…","kind":"namespace"}`:
the SDK's `OrgInvitation` payload (the workspace's name in `name`) plus the web app's legacy fields. The invite token is a bearer secret;
anyone holding the link can join until it expires. Pre-1.0 (signed group) links are refused.

### Approvals

Node releases and upgrades of an app instance are approved only on the node's own consent page.
**Workspace → Needs your approval** lists what waits for the signed-in person (updates of the
tracker, node releases their org approves); **Review** opens the page in the system browser, which
returns to `mero-issues://consent`.

### Configuration

`project.yml` sets these Info.plist keys:

- `CalimeroClusterURL`: the cluster's node URL. Empty: the sign-in screen asks.
- `DefaultNodeURL`: the development node the sign-in screen prefills.
- `MeroPackageVersion`: the version new repositories run. Empty: the latest.
- `IssuesCallbackScheme` (`mero-issues`) or `IssuesCallbackHost` / `IssuesCallbackPath` for a
  verified https return: where the consent page sends the person back.

### The SDK pin

The swift-sdk is pinned by revision to `35148e4de782c065f777e80c592d9548acd645cd`, the head of its
Calimero 1.0 port (calimero-network/swift-sdk#85, branch `feat/calimero-1.0`), in `project.yml`,
`Core/Package.swift` and `Core/Package.resolved`. It moves to that PR's merge commit once it lands;
bump all three together.
