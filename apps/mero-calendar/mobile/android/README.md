# Mero Calendar for Android

A native Jetpack Compose (Material 3) client for Mero Calendar, the `com.calimero.mero-calendar`
app in [`../../logic`](../../logic). It runs the same contract as the web frontend in
[`../../app`](../../app), so people on Android, iOS and the web share the same teams, calendars and
events. It is built on the Calimero Kotlin SDK's app session (`MeroAppSession`, `MeroAppBackend`,
`ContextContract`) and a contract client generated from the ABI.

## Delegated execution only

The phone runs no node, and the app has no node-login screen, admin password or "node URL"
setting. It signs in with a Calimero account, and the account's relay works on its behalf:

| What | How | SDK |
|---|---|---|
| Sign in | The Calimero wallet certifies a key this device generated; the answer comes back on the `mero-calendar://enrol` callback | `MeroAppSession.signIn` / `handle(url)` |
| Session | Keys, session and nonces in Keystore-backed storage, restored on launch | `MeroAppSession.create` / `restore` |
| Teams | The account's namespaces running Mero Calendar | `MeroAppBackend.listNamespaces` |
| Create a team | Found a namespace through the relay (the cloud is asked to host it) | `foundNamespace` |
| Calendars | One open subgroup per calendar with one context in it (the web app's model), plus contexts made straight in the team | `listSubgroups`, `listContexts` |
| Create a calendar | An open subgroup, then the contract's context in it | `createSubgroup(isPublic = true)`, `createContext` |
| Open a calendar | Join its context when the account is not in it yet, retried while a just-joined team syncs | `isMember`, `joinContext` |
| Read events, members | `POST /admin-api/contexts/{id}/query` through the generated client | `contract.bound(contextId)` |
| Write events, your name | Signed warrants on `POST /admin-api/contexts/{id}/intents`. Never `/jsonrpc` | same |
| Invite | An invitation signed by this device, shared as the web app's link | `createInvitation` |
| Join | Direct admission at the relay the invitation names, then reconnect | `joinNamespace`, `session.didJoinNamespace()` |
| Live updates | The relay's event stream for the open calendar; polling every 10 s when it cannot stream | `events(contextId)` |

### Private events

On a node, a private event lives in the contract's `#[app::private]` storage. A relay has no
private storage for the accounts it serves, so — exactly as the web app does for an account
(`app/src/api/privateStore.ts`) — a private event, and an event with no invitees (which the
contract would route to its private storage), is kept **on this device only** and never sent to
the relay or the team. The store uses the web app's key (`mc-private-events:<account>:<team>`) and
record shape. A private event that later gets invitees and is no longer private is promoted to a
shared event (`create_event`), the contract's own one-way rule. A shared event cannot be made
private again (the sheet says so).

## Screens

Sign in → Your Teams (create, join with a link, invite) → a team's calendars (create, invite,
syncing state right after a join) → the calendar with Month / Week / Day / Agenda views, a
"Today" pill and period arrows (plus horizontal swipes) → the event sheet (create, edit,
view-only for someone else's event, delete) with Material date and time pickers, the 10-colour
palette, the private toggle and teammates to invite. Members, your name and Details (ids) are in
the calendar's overflow menu. Pull to refresh on the lists, swipe to delete in the agenda.

Invitation links use the web app's format, so a link from any side opens on the others:
`https://links.calimero.network/com.calimero.mero-calendar/join?invitation=<base58(deflate(payload))>`
with the payload `{"invitation": <signed invitation>, "__teamName": "<team>"}`. The app also
accepts `calimero://com.calimero.mero-calendar/join?invitation=…` and bare tokens, and refuses a
link naming another app.

Event times are stored as the web app stores them, JavaScript's `Date.prototype.toString()`
(`Wed Oct 28 2026 10:00:00 GMT+0100 (Central European Standard Time)`); all-day events are
`long-event` from 00:00 to 23:59.

## The generated contract client

`app/src/main/kotlin/network/calimero/calendar/generated/CalendarClient.kt` is generated from
`logic/res/abi.json` by `@calimero/abi-codegen`; do not edit it (ktlint and detekt skip it). To
regenerate after the ABI changes:

```bash
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/regenerate-client.sh
```

**Codegen gap, worked around in `data/HexIdTransport.kt`:** the ABI declares an event's `owner`
and `peers` as 32-byte `bytes`, so the generated types hold byte lists, but the contract's `UserId`
serialises as a 64-character hex string. `HexIdTransport` wraps the SDK's bound contract and
converts the two for `get_events` / `get_private_events` results and the event writes'
`event_data.peers`; every other call passes through byte for byte.

## Build and run

Needs JDK 17 and the Android SDK (platform 34).

```bash
cd apps/mero-calendar/mobile/android
./scripts/fetch-sdk.sh            # clone kotlin-sdk at the commit in kotlin-sdk.ref into .sdk/
./gradlew assembleDebug           # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug            # onto a device
```

The gates CI runs (`.github/workflows/mero-calendar-android.yml`):

```bash
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

### The SDK pin

The app session layer is on the kotlin-sdk branch `feat/app-session` (calimero-network/kotlin-sdk#67),
not in a release yet, so the SDK is built from source as a Gradle composite build:
`settings.gradle.kts` includes the checkout and substitutes it for the `network.calimero:mero-core`
/ `mero-compose` / `mero-testkit` coordinates. `kotlin-sdk.ref` pins
`0999426846c23c5821929c62547af3510c8b670b`; **once #67 merges, the pin moves to its merge commit.**

Which checkout: `-PmeroKotlinSdkDir=/path`, else `MERO_KOTLIN_SDK_DIR`, else `.sdk/kotlin-sdk`
(made by `scripts/fetch-sdk.sh`). The Android Gradle Plugin and Kotlin versions in
`gradle/libs.versions.toml` must equal the SDK's; compare them on every bump.

### Pointing it at another environment

All optional; empty means the SDK's defaults. Pass them with `-P` or put them in
`gradle.properties`: `meroCloudUrl`, `meroWalletUrl`, `meroRegistryUrl`, and `meroEnrolCallback`
(default `mero-calendar://enrol`; the manifest's intent filter is generated from it).

**Sign-in callback.** The hosted wallet currently redirects only to `https://` callbacks; app-scheme
callbacks need a pending wallet change. Until then, production sign-in needs an https App Link: set
`meroEnrolCallback` to it, publish `assetlinks.json` for `network.calimero.calendar`, and add an
`autoVerify` intent filter.

## Layout

```
app/src/main/kotlin/network/calimero/calendar/
  generated/ CalendarClient (codegen output)
  data/      HexIdTransport, EventTime, PrivateEventStore + KeyValueStore + LocalNames,
             CalendarRepository, TeamInvites, CalendarMath, EventDraft, ErrorText
  app/       TeamsModel, CalendarsModel, CalendarModel (plain StateFlow state holders over
             MeroAppBackend) and CalendarAppViewModel (owns the MeroAppSession and navigation)
  ui/        Compose screens and sheets
app/src/test/   JVM unit tests
```

## Tests

`./gradlew testDebugUnitTest` (29 tests) runs the view models against mero-testkit's
`InMemoryAppBackend` and `RecordingContextContract`: teams (list, relayless, create, hosting
warning, invite link round trip and join, foreign links refused), calendars (subgroups + root
contexts, create as open subgroup + context, open with retried join, give up after the window),
events (shared + device-private merge, private/peerless stays local, shared create with hex peers
and the web's date strings, promotion, update/delete routing, your name), plus `EventTime` against
the web app's `Date.toString()` form, `HexIdTransport` and `CalendarMath`.

## Not supported yet

- **Booking links**: the web app offers them only to a node login (a guest calls the owner's node
  under an access grant); an account has no node to issue one.
- **Year view**: month, week, day and agenda only.
- **Deleting or leaving teams and calendars, member roles and capabilities**: `MeroAppBackend` has
  no call for them yet. Members shows the names people set in the calendar (`get_members`).
- **Push notifications**: live updates run only while a calendar is open.
