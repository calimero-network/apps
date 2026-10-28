# Mero Standup: native mobile apps

Native iOS and Android clients for Mero Standup, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-standup`). Both platforms have the same screens,
copy, icons and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `122bb0d` |
| Android | [`android/`](android/README.md) | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0999426` (`android/kotlin-sdk.ref`) |

**SDK pins.** Both pin the SDKs' `feat/app-session` branches (swift-sdk PR #84, kotlin-sdk PR
#67), which add `MeroAppSession`, `MeroAppBackend` and `ContextContract`. The pins move to the
merge commits once those PRs land: `Core/Package.swift` and `project.yml` on iOS,
`kotlin-sdk.ref` on Android.

## Delegated execution only

Neither app runs or logs into a node. The person signs in with their Calimero account (the
wallet certifies the phone's device key), the Cloud manager names the relay that serves the
account, and everything goes through that relay through the SDKs' `MeroAppSession`:

- **Reads** (the contract's `read_only` views) are the relay's account-scoped query; **writes**
  are warrants the device key signs. The generated `StandupClient` decides which per method.
- **Teams** are what the web app makes: a namespace founded for the app, with the team's context
  created directly in it (not in a subgroup), named with `set_team_name`.
- **Invitations** use the web app's format, so a link from either side opens on the other:
  `https://links.calimero.network/com.calimero.mero-standup/join?invitation=<base58(deflate(json))>`
  with `{invitation, namespaceId, contextId}`. Redeemed by direct admission through the relay.
- **Live updates** come from the relay's event stream (coalesced), with a poll as a fallback.

## Screens

1. **Sign in**: what the app is, "Sign in with Calimero".
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

- **Namespace-wide names.** The web app falls back to the name a person set for the whole
  namespace (`@calimero-apps/names`). `MeroAppBackend` has no member-names call, so the apps show
  the team name, else a short id.
- **Dark theme.** The apps use the Calimero light style only; the web app has a theme switch.
- **Adding a second team to an existing namespace** (the web's "advanced: namespaces" panel).
- **Push reminders** to post. The SDKs have no push yet.

## Regenerating the contract client

`ios/Core/Sources/StandupCore/Generated/StandupClient.swift` and
`android/app/src/main/kotlin/network/calimero/standup/generated/StandupClient.kt` are generated
from `../logic/res/abi.json` with `calimero-abi-codegen --target swift|kotlin`. Do not edit
them; after a contract change run:

```bash
./scripts/regenerate-clients.sh
# or with a local build of the codegen:
ABI_CODEGEN="node /path/to/abi-codegen/dist/cli.js" ./scripts/regenerate-clients.sh
```

## CI

`.github/workflows/mero-standup-ios.yml` (macOS: `swift test` on the core package, XcodeGen and a
simulator build of the app) and `.github/workflows/mero-standup-android.yml` (fetch the SDK,
ktlint, detekt, unit tests, Android lint, `assembleDebug`), each path-filtered to its folder.
