# Mero Calendar for iOS

A native SwiftUI client for [Mero Calendar](../../) on the same contract as the
web app (`com.calimero.mero-calendar`, [`logic/`](../../logic)), built on the
swift-sdk's `MeroAppSession` (MeroKit / MeroKitUI). Its Android twin is
[`../android`](../android); both have the same screens, copy and flows.

## On Calimero 1.0

The phone holds no node. It signs in to a Calimero 1.0 cluster with a passkey
and talks to it over the sealed channel (`calimero/sealed-http/v2`, opened only
after the node's attestation is verified). The swift-sdk's `CalimeroAppBackend`
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
| Read events / members | `CalendarClient` over `contract.bound(to:)` → `query` | `POST /apps/{app}/views` |
| Create / edit / delete events, set your name | `CalendarClient` → `execute` | `POST /apps/{app}/intents` |
| Live updates | `events(contextId:)`; 10 s polling as a fallback | `GET /apps/{app}/events` (sealed SSE) |
| Approvals (an update of Mero Calendar, a node release) | `session.pendingApprovals(org:)` + `MeroClient.requestConsent(_:callback:)` (`ApprovalsModel`) | `POST /consent/requests` → the node's consent page in the system browser → `GET /consent/{id}/result` |

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
`{"invitation":"inv_…","namespaceId":"…","name":"…"}` (the SDK's `OrgInvitation`,
the same payload kotlin-sdk writes, with the team's name in `name`). The invite token is a
bearer secret: anyone holding the link can join until it expires. Pre-1.0 links
(signed group invitations) are refused.

### Approvals

Releases of the node and upgrades of an app instance are approved only on the
node's own consent page. **Your Teams** shows what waits for the signed-in
person (upgrades of Mero Calendar, node releases their org approves); **Review**
opens the page in the system browser, which returns to
`mero-calendar://consent`.

## Private events

Private events are the contract's per-owner rows: `getPrivateEvents`,
`createPrivateEvent`, `updatePrivateEvent`, `deletePrivateEvent`. Only the
owner's own calls read them, so they follow the account to every device. A
peerless `createEvent` stays private too (the contract routes it). Editing a
private event so that it invites someone promotes it with `updatePrivateEvent`
(same id). A shared event can't be made private again; the toggle says so.

## The contract client

`Core/Sources/CalendarContract/CalendarContract.swift` is a typed client of
the component contract (`logic/res/abi.json` of the component port, web PR
#720), the twin of the web app's `app/src/api/calendar.ts` and of the Android
app's `contract/CalendarClient.kt`: camelCase methods and arguments, no
`timestamp` arguments, account ids as strings, `u64` values as decimal
strings (`U64`), and the contract's error codes (`CalendarAppCode`), which
`ErrorText` puts into words. `CalendarContractTests` pins the method list.

## Screens

Sign in → **Your Teams** (create, join with a link, invite from a team's
context menu, pull to refresh, pending approvals, empty states) → a **team's
calendars** (new calendar, invite, Details) → the **calendar**: Month (grid with
event dots, the selected day's events below), Week and Day (hour grid, all-day
strip, overlapping events side by side, the current time), Agenda (by day,
swipe to delete). The **event sheet** creates, edits or (not yours) shows an
event: title, all day, native date and time pickers, private, the web app's ten
colors, invite teammates, description, delete. Plus **Members**, **Your name**
(asked on a calendar's first open, `setUsername`) and **Details**.

## Layout

```
project.yml                  XcodeGen spec (the .xcodeproj is generated, not committed)
Core/                        local SwiftPM package, checked on macOS with `swift test`
  Sources/CalendarContract/  the typed component-contract client
  Sources/CalendarCore/      EventTime, CalendarRepository,
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
swift-sdk to its `v2.0.0` release (tag commit `189bcb5`). To bump it, change the
version in all three files.

### Pointing it at another environment

`project.yml` sets these Info.plist keys:

- `CalimeroClusterURL`: the cluster's name or a node URL. Empty: the sign-in screen asks.
- `DefaultNodeURL`: the development node the sign-in screen prefills.
- `MeroPackageVersion`: the version new calendars run. Empty: the latest.
- `MeroCalendarCallbackScheme` (`mero-calendar`, so `mero-calendar://consent`)
  or `MeroCalendarCallbackHost` / `MeroCalendarCallbackPath` for a verified
  https return (Associated Domains): where the consent page sends the person back.

## Not supported yet

- **Booking links**: the contract has them (and the client covers them), but
  the phone app doesn't offer them yet; they stay on the web app.
- **Passkey step-up** (`412 CONFIRM_REQUIRED`) is handled by the SDK with the
  device's passkey; the app adds no UI of its own for it.
- **Year view** (the web app's year grid).
- **Deleting or leaving a team or calendar, member roles and capabilities**:
  `MeroAppBackend` has the calls on 1.0, but the app doesn't offer them yet. Members shows the calendar's
  `getMembers` names.
- **Universal links** for `https://links.calimero.network/…`: needs an
  Associated Domains entitlement; `calimero://com.calimero.mero-calendar/join?…`
  opens the app, and an https link can be pasted into **Join with a link**.
- **Notifications**: none while the app is closed.
