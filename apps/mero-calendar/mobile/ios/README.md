# Mero Calendar for iOS

A native SwiftUI client for [Mero Calendar](../../) on the same contract as the
web app (`com.calimero.mero-calendar`, [`logic/`](../../logic)), built on the
swift-sdk's `MeroAppSession` (MeroKit / MeroKitUI). Its Android twin is
[`../android`](../android); both have the same screens, copy and flows.

## Delegated only

The phone holds no node and never talks JSON-RPC. It holds a device key your
Calimero account certifies, and the account's relay works for it:

| What | SDK | Wire |
| --- | --- | --- |
| Sign in / restore / sign out | `MeroAppSession.signIn()` / `restore()` / `signOut()` | wallet `account-enroll`, cloud `getAccountRelays`; keys in the Keychain (`network.calimero.calendar`) |
| Teams | `MeroAppBackend.listNamespaces()` | the account's namespaces running Mero Calendar |
| Create a team | `foundNamespace(name:)` | namespace founding through the relay, hosted by the cloud |
| Calendars in a team | `listSubgroups(namespaceId:)` + `listContexts(groupId:)` | one open subgroup per calendar with one context in it (the web app's model), plus any context straight in the team |
| Create a calendar | `createSubgroup(…, isPublic: true)` + `createContext(…, initArgs: {})` | governance op + context intent |
| Open a calendar | `isMember` / `joinContext` (retried for 20 s, 90 s right after joining the team) | `MemberJoinedOpen` |
| Invite / join | `createInvitation` / `joinNamespace` + `session.didJoinNamespace()` | signed invitation; direct admission at the admitting relay |
| Read events / members | generated `CalendarClient` over `contract.bound(to:)` → `query` | `POST /admin-api/contexts/{id}/query` |
| Create / edit / delete events, set your name | generated `CalendarClient` → `execute` | warrant on `POST /admin-api/contexts/{id}/intents` |
| Live updates | `events(contextId:)`; 10 s polling when the relay session can't stream | SSE |

## Private events

The contract keeps private events in `#[app::private]` storage, which is
node-local. An account has no node, and a relay has no private storage for the
accounts it serves, so the web app keeps an account's private events in the
browser (`app/src/api/privateStore.ts`). The phone does the same: a private
event, and a peerless one (which the contract would route to private storage),
is stored on the device only (`PrivateEventStore`, keyed by account + team,
each record carrying its calendar's context id; ids `local-…`). It is never
sent to the relay. `get_private_events` / `create_private_event` are not called.

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
context menu, pull to refresh, empty and relayless states) → a **team's
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
                             (TeamsModel, CalendarsModel, CalendarModel)
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

`Core/Package.swift` and `project.yml` pin the swift-sdk by revision to
`122bb0d71bb43b823cb9d694c4e70678a2ef8c89`, the head of
calimero-network/swift-sdk#84 (`feat/app-session`), which adds `MeroAppSession`,
`MeroAppBackend` and the test fakes. Once that PR merges, both pins move to its
merge commit (change the revision in both files and regenerate).

### Pointing it at another environment

`project.yml` sets these Info.plist keys; empty means the SDK default:
`MeroWalletURL`, `MeroCloudBaseURL`, `MeroRegistryURL`,
`MeroCalendarCallbackScheme` (`mero-calendar`, so `mero-calendar://enrol`) and
`MeroCalendarCallbackHost` / `MeroCalendarCallbackPath` for a verified https
callback (Associated Domains). The hosted wallet currently returns only to
`https://` callbacks; see the swift-sdk README.

## Not supported yet

- **Booking links**: the web app offers them only to a node login (a guest's
  browser calls the owner's node under an access grant); an account has no node.
- **Year view** (the web app's year grid).
- **Deleting or leaving a team or calendar, member roles and capabilities**:
  `MeroAppBackend` has no call for them yet. Members shows the calendar's
  `get_members` names.
- **Universal links** for `https://links.calimero.network/…`: needs an
  Associated Domains entitlement; `calimero://com.calimero.mero-calendar/join?…`
  opens the app, and an https link can be pasted into **Join with a link**.
- **Notifications**: none while the app is closed.
