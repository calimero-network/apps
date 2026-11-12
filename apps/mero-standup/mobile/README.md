# Mero Standup: native mobile apps

Native iOS and Android clients for Mero Standup, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-standup`). Both platforms have the same screens,
copy, icons and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0` (Calimero 1.0) |
| Android | [`android/`](android/README.md) | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (Calimero 1.0, `android/kotlin-sdk.ref`) |

**SDK pins.** Both are SDK releases. They live in
`Core/Package.swift` and `project.yml` on iOS, `kotlin-sdk.ref` on Android.

## Calimero 1.0

Both apps talk to a Calimero 1.0 cluster over the SDKs' sealed channel and sign in with a passkey:

- **Sign-in**: Calimero Cloud (a cluster by name, through the node directory, or a node URL; every
  node's attestation verified), or a development node (`merod local`, mock attestation, a software
  passkey kept on the device).
- **Teams** are an org with the team's app instance in it, named with `setTeamName`.
- **Invitations** are org invite links (the SDKs' `OrgInvitation`):
  `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<base58(deflate(json))>`
  with `{invitation: "inv_…", namespaceId, contextId, name}`, redeemed at
  `POST /invites/{token}/redeem`. Pre-1.0 signed links are refused.
- **Approvals** (an update of Mero Standup, a node release) show the node's confirmation code, then
  open its consent page in the system browser (a Custom Tab on Android).
- **Contract calls** go through `StandupClient`, generated from the **component contract**'s ABI
  (`logic/res/abi.json`) by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh` at the repo
  root; CI's `Mobile clients` workflow fails on a stale one): camelCase methods, arguments and results,
  timestamps as decimal strings, refusals as `APP_ERROR` codes put into words.
- **Live updates** come from the node's event stream (coalesced), with a poll as a fallback.

## Screens

1. **Sign in**: what the app is; Calimero Cloud (passkey sign-in or create an account) or a development node.
2. **Teams**: your teams, start one, join one with a pasted invitation link; an opened
   invitation link asks "Join this team?" first.
3. **Team**, with four tabs:
   - **Standup**: week strip (a dot per day, red when someone was blocked), your update (posted,
     or "Post update" which opens one sheet with Done / Next / Blockers carried forward from your
     last update), the team's updates with "I can help" on blockers and "Log decision", who has
     not posted today, what is blocking people right now, what was decided that day.
   - **Week**: each person's week; share or copy it as Markdown.
   - **Decisions**: search, tag filter, standing only, list or timeline; log a decision with tags,
     the people it was made with and the standup day it came from; supersede one (swipe or
     detail screen).
   - **Team**: rename the team, create and share an invite link, your name, the people the
     contract knows, switch team, sign out, and the ids behind a Details disclosure.

A first-run sheet asks for your name in a new team ("Later" is remembered per team).

## Not on mobile (yet)

- **Org-wide names.** A person's name on a team is the one set there with `setName` (the web app
  dropped its namespace-wide fallback too).
- **Dark theme.** The apps use the Calimero light style only; the web app has a theme switch.
- **Adding a second team to an existing namespace** (the web's "advanced: namespaces" panel).
- **Push reminders** to post. The SDKs have no push yet.

## CI

`.github/workflows/mero-standup-ios.yml` (macOS: `swift test` on the core package, XcodeGen and a
generic iOS build of the app) and `.github/workflows/mero-standup-android.yml` (fetch the SDK,
ktlint, detekt, unit tests, Android lint, `assembleDebug`), each path-filtered to its folder.
