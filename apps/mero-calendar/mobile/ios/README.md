# Mero Calendar for iOS

A native SwiftUI client for [Mero Calendar](../../) on the same contract as the
web app (`com.calimero.mero-calendar`, [`logic/`](../../logic)), built on the
swift-sdk's `MeroAppSession` (MeroKit / MeroKitUI). Its Android twin is
[`../android`](../android); both have the same screens, copy and flows.

## On Calimero 1.0

The phone holds no node. It signs in to a Calimero 1.0 cluster with a passkey
and talks to it over the sealed channel (`calimero/sealed-http/v2`, opened only
after the node's attestation is verified). The swift-sdk's `CloudAppBackend`
maps the app layer onto the 1.0 API:

| What | SDK | Wire |
| --- | --- | --- |
| Sign in / create account / restore / sign out | `MeroAppSession.connect(nodeURL:allowMock:)`, `signIn()` / `signUp(name:)` / `restore()` / `signOut()` | `/auth/passkey/{login,register}/{begin,finish}`, `/auth/refresh`; session in the Keychain (`network.calimero.calendar`) |
| Teams | `MeroAppBackend.listNamespaces()` | the account's **orgs** running Mero Calendar (`GET /auth/me`) |
| Create a team | `foundNamespace(name:)` | `POST /orgs` + org metadata `{name, package}` |
| Calendars in a team | `listSubgroups(namespaceId:)` + `listContexts(groupId:)` | the org's **teams** (`GET /orgs/{org}`), one **app instance** per calendar, plus any instance straight in the org |
| Create a calendar | `createSubgroup(…, isPublic: true)` + `createContext(…, initArgs: {})` | `POST /orgs/{org}/teams {join: everyone}` + `POST /apps {package, org, access: team}` |
| Open a calendar | `isMember` / `joinContext` (retried for 20 s, 90 s right after joining the team) | `GET /apps/{app}`; open teams inherit org membership |
| Invite / join | `createInvitation` / `joinNamespace` + `session.didJoinNamespace()` | `POST /orgs/{org}/invites` → invite token; `POST /invites/{token}/redeem` |
| Read events / members | generated `CalendarClient` over `contract.bound(to:)` → `query` | `POST /apps/{app}/views` |
| Create / edit / delete events, set your name | generated `CalendarClient` → `execute` | `POST /apps/{app}/intents` |
| Live updates | `events(contextId:)`; 10 s polling as a fallback | `GET /apps/{app}/events` (sealed SSE) |
| Approvals (an update of Mero Calendar, a node release) | `session.pendingApprovals(org:)` + `session.requestConsent(_:)` (`ApprovalsModel`) | `POST /consent/requests` → the node's consent page in the system browser → `GET /consent/{id}/result` |

In the app's words a **team** is a Calimero org, a **calendar** is a team in
that org with one app instance of Mero Calendar.

### Sign-in

- **Calimero Cloud**: enter the cluster's node URL (from
  cloud.calimero.network; bake it in with `CalimeroClusterURL`), then **Sign in
  with passkey** or **Create an account**. The node's TDX attestation is
  verified (`CloudPolicy.production`). The device's passkey needs the
  cluster's relying party as an associated domain (`webcredentials:<rp-id>`,
  see `project.yml`).
- **Development node**: a `merod local` node URL (default
  `http://localhost:2501`, `DefaultNodeURL`). The client allows mock
  attestation (`allowMock`) and makes and keeps a software passkey for that
  node, so no associated domain is needed.

### Invitations

An invitation link is
`https://links.calimero.network/com.calimero.mero-calendar/join?invitation=<token>`,
the token being `base58(deflate(json))` of
`{"invitation":{"orgId":"…","token":"inv_…"},"namespaceId":"…","__teamName":"…"}`
(the SDK's `InvitationLinkPayload` plus the team's name). The invite token is a
bearer secret: anyone holding the link can join until it expires. Pre-1.0 links
(signed group invitations) are refused.

### Approvals

Releases of the node and upgrades of an app instance are approved only on the
node's own consent page. **Your Teams** shows what waits for the signed-in
person (upgrades of Mero Calendar, node releases their org approves); **Review**
opens the page in the system browser, which returns to
`mero-calendar://consent`.

## Private events

The contract keeps private events in `#[app::private]` storage, which is
node-local. On 1.0 an app instance runs replicated across the cluster (calls
run on its Raft leader), so there is no one node to keep them on; the web app
keeps an account's private events in the browser (`app/src/api/privateStore.ts`). The phone does the same: a private
event, and a peerless one (which the contract would route to private storage),
is stored on the device only (`PrivateEventStore`, keyed by account + team,
each record carrying its calendar's context id; ids `local-…`). It is never
sent to the cluster. `get_private_events` / `create_private_event` are not called.

Editing a device-local event so that it is not private and has someone invited
promotes it: `create_event`, then the local copy is dropped (the contract's own
`update_private_event` promotes the same way). A shared event can't be made
private again; the toggle says so.

## Generated client

`Core/Sources/CalendarGenerated/CalendarClient.swift` is generated from the
contract's ABI and is not edited by hand. Regenerate it after the contract
changes:

```sh
# from the repo root
node <abi-codegen>/dist/cli.js -i apps/mero-calendar/logic/res/abi.json \
  -o apps/mero-calendar/mobile/ios/Core/Sources/CalendarGenerated \
  --target swift --client-name CalendarClient
```

The ABI declares `owner` / `peers` as 32-byte arrays, so the generated types
hold `[UInt8]`; the contract's `UserId` actually serialises as 64 hex
characters. `HexIdTransport` (the transport the generated client is given)
rewrites exactly those fields for `get_events` / `get_private_events` answers and
for the four event writes, and passes everything else through byte for byte.

## Screens

Sign in → **Your Teams** (create, join with a link, invite from a team's
context menu, pull to refresh, pending approvals, empty states) → a **team's
calendars** (new calendar, invite, Details) → the **calendar**: Month (grid with
event dots, the selected day's events below), Week and Day (hour grid, all-day
strip, overlapping events side by side, the current time), Agenda (by day,
swipe to delete). The **event sheet** creates, edits or (not yours) shows an
event: title, all day, native date and time pickers, private, the web app's ten
colors, invite teammates, description, delete. Plus **Members**, **Your name**
(asked on a calendar's first open, `set_username`) and **Details**.

## Layout

```
project.yml                  XcodeGen spec (the .xcodeproj is generated, not committed)
Core/                        local SwiftPM package, checked on macOS with `swift test`
  Sources/CalendarGenerated/ the generated contract client
  Sources/CalendarCore/      HexIdTransport, EventTime, CalendarRepository, PrivateEventStore,
                             TeamInvitation, CalendarMath, EventDraft, and the view models
                             (TeamsModel, CalendarsModel, CalendarModel, ApprovalsModel)
  Tests/CalendarCoreTests/   view-model and wire tests against InMemoryAppBackend
Sources/App/                 SwiftUI screens
```

## Build and test

```sh
cd apps/mero-calendar/mobile/ios
(cd Core && swift test)                         # the calendar layer, on macOS
brew install xcodegen && xcodegen generate
xcodebuild build -project MeroCalendar.xcodeproj -scheme MeroCalendar \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
open MeroCalendar.xcodeproj                     # run on a simulator or device
```

Bundle id `network.calimero.calendar`, iOS 16+. CI:
[`.github/workflows/mero-calendar-ios.yml`](../../../../.github/workflows/mero-calendar-ios.yml).

### The SDK pin

`Core/Package.swift`, `Core/Package.resolved` and `project.yml` pin the
swift-sdk by revision to `a1ec644130d4405a1bab7547654b1442cc559b49`, the head
of its Calimero 1.0 port (calimero-network/swift-sdk#85, branch
`feat/calimero-1.0`). It moves to that PR's merge commit once it lands. To bump
it, change the revision in all three files and regenerate.

### Pointing it at another environment

`project.yml` sets these Info.plist keys:

- `CalimeroClusterURL`: the cluster's node URL. Empty: the sign-in screen asks.
- `DefaultNodeURL`: the development node the sign-in screen prefills.
- `MeroPackageVersion`: the version new calendars run. Empty: the latest.
- `MeroCalendarCallbackScheme` (`mero-calendar`, so `mero-calendar://consent`)
  or `MeroCalendarCallbackHost` / `MeroCalendarCallbackPath` for a verified
  https return (Associated Domains): where the consent page sends the person back.

## Not supported yet

- **Booking links**: the web app offers them only to a node login (a guest's
  browser calls the owner's node under an access grant); the phone has no node.
- **Passkey step-up** (`412 CONFIRM_REQUIRED`) is handled by the SDK with the
  device's passkey; the app adds no UI of its own for it.
- **Year view** (the web app's year grid).
- **Deleting or leaving a team or calendar, member roles and capabilities**:
  `MeroAppBackend` has the calls on 1.0, but the app doesn't offer them yet. Members shows the calendar's
  `get_members` names.
- **Universal links** for `https://links.calimero.network/…`: needs an
  Associated Domains entitlement; `calimero://com.calimero.mero-calendar/join?…`
  opens the app, and an https link can be pasted into **Join with a link**.
- **Notifications**: none while the app is closed.
