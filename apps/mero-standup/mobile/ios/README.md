# Mero Standup for iOS

SwiftUI, iOS 16+. See [../README.md](../README.md) for what the app does. This iOS app runs
on **Calimero 1.0** (below); the Android app is not ported yet.

```
Core/                          local Swift package StandupCore (no UI): `swift test` on macOS
  Sources/StandupCore/
    Generated/StandupClient.swift   generated from ../logic/res/abi.json — do not edit
    Days, People, Drafts, Digest, RichText, StandupInvitation, Support
    TeamsModel, TeamModel, BoardModel, WeekModel, DecisionsModel, ApprovalsModel   view models
  Tests/StandupCoreTests/      view-model and helper tests on MeroKitTestSupport's InMemoryAppBackend
Sources/App/                   SwiftUI screens, on MeroKitUI's MeroAppSession
project.yml                    XcodeGen spec (the .xcodeproj is not committed)
```

## On Calimero 1.0

The phone holds no node. It signs in to a Calimero 1.0 cluster with a passkey and talks to it over
the sealed channel (`calimero/sealed-http/v2`, opened only after the node's attestation is
verified). The swift-sdk's `CalimeroAppBackend` maps the app layer onto the 1.0 API:

| What | SDK | Wire |
| --- | --- | --- |
| Sign in / create account / restore / sign out | `MeroAppSession.connect(nodeURL:allowMock:)`, `signIn()` / `signUp(name:)` / `restore()` / `signOut()` | `/auth/passkey/{login,register}/{begin,finish}`, `/auth/refresh`; session in the Keychain (`network.calimero.standup`) |
| Teams | `listNamespaces()` + `listContexts(groupId:)` | the account's **orgs** running Mero Standup, and their **app instances** (one per team) |
| Start a team | `foundNamespace(name:)` + `createContext(…)` | `POST /orgs` + org metadata, then `POST /apps {package, org}` |
| Invite / join | `createInvitation` / `joinNamespace` | `POST /orgs/{org}/invites` → invite token; `POST /invites/{token}/redeem` |
| Read / write | generated `StandupClient` over `contract.bound(to:)` | `POST /apps/{app}/views` / `POST /apps/{app}/intents` |
| Live updates | `events(contextId:)`, polling as a fallback | `GET /apps/{app}/events` (sealed SSE) |
| Approvals (an update of Mero Standup, a node release) | `session.pendingApprovals(org:)` + `session.requestConsent(_:)` (`ApprovalsModel`) | `POST /consent/requests` → the node's consent page in the system browser → `GET /consent/{id}/result` |

### Sign-in

- **Calimero Cloud**: enter the cluster's node URL (from cloud.calimero.network; bake it in with
  `CalimeroClusterURL`), then **Sign in with passkey** or **Create an account**. The node's TDX
  attestation is verified (`CloudPolicy.production`). The device's passkey needs the cluster's
  relying party as an associated domain (`webcredentials:<rp-id>`, see `project.yml`).
- **Development node**: a `merod local` node URL (default `http://localhost:2501`,
  `DefaultNodeURL`). The client allows mock attestation (`allowMock`) and makes and keeps a
  software passkey for that node.

### Invitations

A link is `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<token>`, the
token being `base58(deflate(json))` of
`{"invitation":"inv_…","namespaceId":"<org>","contextId":"<team app instance>","name":"<team name>"}`,
which is the SDK's `OrgInvitation` (`name` is optional, a legacy `teamName` is read too, and
extra fields are ignored). The invite token is a bearer secret. Pre-1.0 links (signed group
invitations) are refused.

### Approvals

Node releases and app upgrades are approved only on the node's own consent page. **Teams** shows
what waits for the signed-in person; **Review** opens the page in the system browser, which returns
to `mero-standup://consent`.

## Build

```bash
cd Core && swift test          # the core: generated client, helpers, view models
cd .. && xcodegen generate     # writes MeroStandup.xcodeproj
xcodebuild build -project MeroStandup.xcodeproj -scheme MeroStandup \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
open MeroStandup.xcodeproj
```

## SDK pin

`project.yml` and `Core/Package.swift` pin swift-sdk `35148e4de782c065f777e80c592d9548acd645cd`,
the head of its Calimero 1.0 port (calimero-network/swift-sdk#85, branch `feat/calimero-1.0`). It
moves to that PR's merge commit once it lands. Bump both together.

## Configuration

Info.plist keys set in `project.yml`:

| Key | Default |
| --- | --- |
| `CalimeroClusterURL` | empty: the sign-in screen asks for the cluster's node URL |
| `DefaultNodeURL` | `http://localhost:2501`, the development node the sign-in screen prefills |
| `MeroPackageVersion` | empty: new teams run the latest Mero Standup |
| `StandupCallbackScheme` | `mero-standup` (the consent page returns to `mero-standup://consent`) |
| `StandupCallbackHost` / `StandupCallbackPath` | unset: set a host to use a verified https return |

Invitation links open the app as `calimero://com.calimero.mero-standup/join?invitation=…`; the
https form needs Associated Domains on `links.calimero.network`, which that host does not publish
for this app yet, so a pasted https link goes through **Join with an invitation** instead.
