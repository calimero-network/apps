# Mero Calendar for Android

A native Jetpack Compose (Material 3) client for Mero Calendar, the `com.calimero.mero-calendar`
app in [`../../logic`](../../logic). It calls the same component contract as the web frontend in
[`../../app`](../../app), so people on Android, iOS and the web share the same teams, calendars and
events. It is built on the Calimero Kotlin SDK's 1.0 app session (`MeroAppSession`,
`CalimeroAppBackend`, `ContextContract`) and a typed client of the contract. Its iOS twin is
[`../ios`](../ios/README.md): same screens, copy and flows.

## Calimero 1.0

| What | How | SDK |
|---|---|---|
| Sign in (Cloud) | A cluster by name (node directory) or a node URL, every node attested (`CloudPolicy.production`), then the device's passkey (Credential Manager). "Create an account" registers a new one | `CalimeroClient.connect`, `MeroAppSession.signIn` / `signUp` |
| Sign in (development) | A `merod local` URL (`http://10.0.2.2:2501` from the emulator), mock attestation, a software passkey kept on the device for that node | `CloudPolicy.development`, `SoftPasskey` |
| Session | Kept encrypted with the cluster's nodes, restored on launch | `EncryptedSessionStore`, `restore` |
| Teams | Orgs running Mero Calendar | `listNamespaces`, `foundNamespace` |
| Calendars | A team in the org holding one app instance | `listSubgroups`, `createSubgroup`, `createContext` |
| Events, members, your name | The typed contract client over the bound app instance (views / intents) | `contract.bound(appId)` |
| Invite / join | Org invite links (`OrgInvitation`, the team's name in `name`), redeemed at `POST /invites/{token}/redeem`; minting is a passkey step-up | `createInvitation`, `joinNamespace` |
| Approvals | App upgrades and node releases awaiting the person, on Your Teams. Review shows the confirmation code, then opens the node's consent page in a Custom Tab, which returns to `mero-calendar://consent` | `pendingApprovals`, `requestConsent(confirm)` |
| Live updates | The node's event stream for the open calendar; polling every 10 s otherwise | `events(appId)` |

The Activity hands the session its passkey (`CalendarAppViewModel.attach` → `session.passkey`)
while it lives, so member changes and invites get their step-ups.

## The contract client

`contract/CalendarClient.kt` is a typed client of the component contract (`logic/res/abi.json` of
the component port, web PR #720), the twin of the web app's `app/src/api/calendar.ts` and iOS's
`CalendarContract.swift`: camelCase methods and arguments, no `timestamp` arguments, account ids as
strings, `u64` values as decimal strings, and the contract's error codes (`CalendarAppCode`), which
`ErrorText` puts into words.

**Private events** are the contract's per-owner rows (`getPrivateEvents`, `createPrivateEvent`,
`updatePrivateEvent`, `deletePrivateEvent`): only the owner's own calls read them, on any device. A
peerless `createEvent` stays private too. Inviting someone to a private event promotes it
(`updatePrivateEvent`, same id); a shared event can't become private again.

Event times are stored as the web app stores them, JavaScript's `Date.prototype.toString()`; all-day
events are `long-event` from 00:00 to 23:59.

## Build and test

Needs JDK 17 and the Android SDK (platform 34).

```bash
cd apps/mero-calendar/mobile/android
./scripts/fetch-sdk.sh            # clone kotlin-sdk at the commit in kotlin-sdk.ref into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

### The SDK pin

`kotlin-sdk.ref` pins `1e3f27c2cb672651a34a743435144e291de66022`, the commit of the kotlin-sdk
`v0.2.0` release (Calimero 1.0), which is not on Maven Central. The SDK
is built from source as a Gradle composite build (`settings.gradle.kts`): `-PmeroKotlinSdkDir=/path`,
else `MERO_KOTLIN_SDK_DIR`, else `.sdk/kotlin-sdk`.

### Configuration

Optional `-P` / `gradle.properties` values: `meroCluster` (the cluster name or node URL the sign-in
screen prefills), `meroDevNodeUrl` (default `http://10.0.2.2:2501`) and `meroConsentCallback`
(default `mero-calendar://consent`; the manifest's intent filter is generated from it). Plain http
is allowed only to `10.0.2.2` and `localhost` (`res/xml/network_security_config.xml`).

## Layout

```
app/src/main/kotlin/network/calimero/calendar/
  contract/  CalendarClient (typed component contract)
  data/      EventTime, KeyValueStore + LocalNames, CalendarRepository, TeamInvites, CalendarMath,
             EventDraft, ErrorText
  app/       TeamsModel, CalendarsModel, CalendarModel, ApprovalsModel (StateFlow state holders
             over MeroAppBackend) and CalendarAppViewModel (session, sign-in, navigation)
  ui/        Compose screens and sheets
app/src/test/   JVM unit tests against mero-testkit's InMemoryAppBackend
```

## Not supported yet

- **Booking links**: in the contract, but only the web app offers them.
- **Passkey sign-in on a real cluster** needs the cluster's Digital Asset Links for the app.
- **Year view**, deleting or leaving teams and calendars, member roles, push notifications.
