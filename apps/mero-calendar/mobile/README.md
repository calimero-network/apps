# Mero Calendar — native mobile apps

> **Status: on the v1 contract, not ported to the component runtime.** The web app and the
> contract (`../logic`) moved to Calimero 1.0 (core's component SDK, `CalimeroClient`, passkey
> accounts, orgs). These clients still speak the v1 contract through the v1 relay
> (`MeroAppSession`, namespaces, warrants, snake_case methods) with clients generated from the v1
> ABI, which `../logic/res/abi.json` no longer is. Porting them needs native clients for the 1.0
> node API (passkey sign-in, `/apps/{app}` calls and views, org invites, API keys, the event
> stream), which the pinned swift-sdk and kotlin-sdk do not have. Until they do, the apps keep
> their committed generated clients, and `android/scripts/regenerate-client.sh` refuses to run
> against the component ABI.

Native iOS and Android clients for Mero Calendar, next to the web frontend
(`../app`) and the contract (`../logic`, package `com.calimero.mero-calendar`).
Both have the same screens, copy, icons and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `c9ca1a0` (`main`, merge of PR #84) |
| Android | [`android/`](android/README.md) | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `ea8ded7` (`main`, merge of PR #67), composite build |

The pins are the SDKs' `main` merge commits of those PRs.

## Delegated execution only

Neither app runs or logs into a node. The phone holds a device key that the
person's Calimero account certifies, and the account's relay does the rest
through the SDKs' `MeroAppSession` / `MeroAppBackend`: teams are namespaces,
each calendar is an open subgroup with one context in it (the web app's model),
views go to the relay's `query`, writes are signed warrants on its `intents`.
Contract calls go through a client generated from `logic/res/abi.json`.

**Private events** live on the device, exactly as the web app keeps an
account's private events in the browser: a relay has no `#[app::private]`
storage for the accounts it serves. See [ios/README.md](ios/README.md#private-events).

## What both apps do

Sign in / out; list, create and join teams (the web app's invitation links,
`links.calimero.network/com.calimero.mero-calendar/join`, and `calimero://`),
share an invitation; list, create and open a team's calendars; month, week, day
and agenda views; create, edit and delete events with native date and time
pickers, all-day and private events, the web app's colors and invitees; members
and your display name; live updates with polling as the fallback.

Not on either yet: booking links (node logins only on the web too), the year
view, deleting or leaving teams and calendars and member roles (no
`MeroAppBackend` call yet), push notifications.

## CI

`.github/workflows/mero-calendar-ios.yml` (`swift test` of the calendar layer,
XcodeGen, unsigned iOS build) and `.github/workflows/mero-calendar-android.yml`
(fetch the SDK, ktlint, detekt, unit tests, Android lint, `assembleDebug`),
each path-filtered to its folder.
