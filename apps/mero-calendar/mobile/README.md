# Hyperfeed Calendar — native mobile apps

Native iOS and Android clients for Hyperfeed Calendar, next to the web frontend
(`../app`) and the contract (`../logic`, package `com.calimero.mero-calendar`).
Both have the same screens, copy, icons and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [mero-swift](https://github.com/calimero-network/core/tree/master/sdks/clients/mero-swift) `MeroKit` + `MeroKitUI` from core's release |
| Android | [`android/`](android/README.md) | Jetpack Compose + Material 3, minSdk 26 | [mero-kotlin](https://github.com/calimero-network/core/tree/master/sdks/clients/mero-kotlin) `mero-core` + `mero-compose` from core's release (Maven Central) |

Both pins are core releases: the Swift SDK installs from calimero-network/core's tag, the Kotlin SDK from Maven Central. Each core release opens a pull request that moves them.
To bump: iOS, the `exactVersion` / `exact:` values; Android, `meroSdk` in `gradle/libs.versions.toml`.

## Calimero 1.0

Both apps talk to a Calimero 1.0 cluster over the SDKs' sealed channel and
sign in with a passkey: Calimero Cloud (a cluster by name, through the node
directory, or a node URL) or a development node (`merod local`, mock
attestation, a software passkey kept on the device). A team is an org, each
calendar a team in it holding one app instance. Invitations are org invite
links; approvals (app upgrades, node releases) open the node's consent page in
the system browser after showing its confirmation code.

Contract calls go through `CalendarClient`, generated from the **component
contract**'s ABI (`logic/res/abi.json`) by core's `meroctl app codegen`
(`scripts/mobile-codegen.sh` at the repo root; CI's `Mobile clients` workflow
fails on a stale one):
camelCase methods and arguments, account ids as strings, `u64` values as
decimal strings, refusals as `APP_ERROR` codes put into words. **Private
events** are the contract's per-owner rows (`getPrivateEvents`,
`createPrivateEvent`, ...): only the owner's own calls read them, on any device.

## What both apps do

Sign in / out; list, create and join teams (the web app's invitation links,
`links.calimero.network/com.calimero.mero-calendar/join`, and `calimero://`),
share an invitation; list, create and open a team's calendars; month, week, day
and agenda views; create, edit and delete events with native date and time
pickers, all-day and private events, the web app's colors and invitees; members
and your display name; live updates with polling as the fallback.

Not on either yet: booking links (web only), the year
view, deleting or leaving teams and calendars and member roles (no
`MeroAppBackend` call yet), push notifications.

## CI

`.github/workflows/mero-calendar-ios.yml` (`swift test` of the calendar layer,
XcodeGen, unsigned iOS build) and `.github/workflows/mero-calendar-android.yml`
(fetch the SDK, ktlint, detekt, unit tests, Android lint, `assembleDebug`),
each path-filtered to its folder.
