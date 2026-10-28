# Mero Updates: native mobile apps

Native iOS and Android clients for Mero Updates, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-updates`). Both platforms have the same screens,
copy, icons (SF Symbols / Material, mapped) and flows.

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
  are warrants the device key signs. The generated `UpdatesClient` decides which per method.
- **Companies and audiences** are what the web app makes: a company is a namespace founded for
  the app; an audience is an open subgroup of it with one context, which holds the updates.
  Opening an audience joins its context when the account is not in it yet.
- **Invitations** use the web app's format, so a link from either side opens on the other:
  `https://links.calimero.network/com.calimero.mero-updates/join?invitation=<base58(deflate(json))>`
  with `{invitation, kind, groupId, groupAlias, audienceId?, contextId?, audienceName?}`. The
  namespace joined is read from inside the signed invitation. The older `?invite=` links are read
  too. Redeemed by direct admission through the relay.
- **Drafts** (`save_draft` / `list_drafts` / `delete_draft`) use the contract's `#[app::private]`
  storage exactly as the web does. On a phone the executing node is the account's relay, so a
  draft lives in that node's private storage and never replicates to investors. The payload is
  the web composer's JSON, so either client opens a draft the other saved on the same node.
- **Live updates** come from the relay's event stream (coalesced, 250 ms), with a poll as a
  fallback, like the web's `AudienceShell` revision.

## Screens

1. **Sign in**: what the app is, "Sign in with Calimero".
2. **Companies**: your companies, a new company, join with a pasted invitation link; an opened
   invitation link asks "Join …?" first and lands in the audience (or company) it names.
3. **Company**: its audiences, a new audience (born open, with its context), "Invite people"
   (whole company) and per-audience invites with Share / Copy, ids behind Details.
4. **Audience**, with five tabs and an account menu (avatar, top left):
   - **Updates**: the profile prompt until you have a name; for the team, "New update", the
     next-update-due card, templates (and "Reuse the last one"), private drafts (continue or
     discard) and the getting-started checklist; the category filter with unread counts; the
     feed with New tags, KPI / ask / reply counts and reactions.
   - **Asks**: open / resolved asks across every update, "I can help" (with or without a note,
     edit note, withdraw) for investors, accept / decline / undo and resolve for the team, and the
     contributions ledger.
   - **Q&A**: ask the team (or start a thread), all / unanswered.
   - **KPIs**: one card per metric with the latest change, a sparkline and the report history.
   - **People**: your profile and the categories you follow (mute), the team, investors with
     engagement, make / remove teammate (admins), who read what with the follow-up list.
   - Post screen (pushed from any tab): TL;DR, KPI tiles with the change since the previous
     report, sections, asks, reactions, one-level threaded replies (reply, edit your own, delete
     your own or any as the team) in a keyboard-safe reply bar, read receipts, and for the team
     edit / delete / mark answered.
   - Composer (full screen): title, category, TL;DR, KPIs (last value and delta while typing,
     one-tap known metrics), sections (add, move up, remove, "Thank N contributors"), asks
     (kind, title, detail, up to 10), Write / Preview, autosaved private draft, publish or save
     the edit.
   - Settings (team, from the account menu): company name, update cadence, categories (new,
     edit, archive, starter set).
   - Account menu: edit your profile, settings, invite to this audience, switch audience, sign
     out, ids behind Details.

The contract stores plain text, so the composer is a plain native editor and bodies render as
plain text, as on the web.

## Not on mobile (yet)

- **Deleting or leaving a company, deleting an audience.** `MeroAppBackend` has no group delete
  or leave call.
- **Member counts, "not joined" and TEE badges on the audience list.** The backend lists
  subgroups and their contexts only, not group members or metadata.
- **Namespace-wide names.** The web falls back to the name a person set for the whole
  namespace (`@calimero-apps/names`); the backend has no member-names call, so the apps show the
  audience profile name, else a short id. Setting your name here does not publish it namespace-wide.
- **Dark theme.** The apps use the Calimero light style only; the web app has a theme switch.
- **Push reminders** for the next update due. The SDKs have no push yet.

## Regenerating the contract client

`ios/Core/Sources/UpdatesCore/Generated/UpdatesClient.swift` and
`android/app/src/main/kotlin/network/calimero/updates/generated/UpdatesClient.kt` are generated
from `../logic/res/abi.json` with `calimero-abi-codegen --target swift|kotlin`. Do not edit
them; after a contract change run:

```bash
./scripts/regenerate-clients.sh
# or with a local build of the codegen:
ABI_CODEGEN="node /path/to/abi-codegen/dist/cli.js" ./scripts/regenerate-clients.sh
```

## CI

`.github/workflows/mero-updates-ios.yml` (macOS: `swift test` on the core package, XcodeGen and a
simulator build of the app) and `.github/workflows/mero-updates-android.yml` (fetch the SDK,
ktlint, detekt, unit tests, Android lint, `assembleDebug`), each path-filtered to its folder.
