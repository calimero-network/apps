# Mero Updates: native mobile apps

Native iOS and Android clients for Mero Updates, next to the web frontend (`../app`) and the
contract (`../logic`, package `com.calimero.mero-updates`). Both platforms have the same screens,
copy, icons (SF Symbols / Material, mapped) and flows.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `MeroKit` + `MeroKitUI` at `v0.5.0` (Calimero 1.0) |
| Android | [`android/`](android/README.md) | Jetpack Compose + Material 3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `mero-core` + `mero-compose` at `0.4.0` (Calimero 1.0) |

**SDK pins.** Both pin the SDKs' Calimero 1.0 releases: `ios/Core/Package.swift` and
`ios/project.yml`, `android/kotlin-sdk.ref` (the release tag's commit).

## How the apps reach Calimero

Both apps run on **Calimero 1.0**. They talk to a node of a Calimero cluster over the sealed
channel (`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and sign in with
a passkey; the phone runs no node. `MeroAppSession` builds the SDK's `CalimeroAppBackend`, and the
view models keep their `MeroAppBackend` calls, each of which maps one to one:

| The app | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| company | namespace | organization (metadata `package = com.calimero.mero-updates`) |
| audience | subgroup (open) | team (`join: everyone`) |
| audience's context | context | app instance (`/apps/{app}/views`, `/intents`, `/events`) |
| invitation | `OrgInvitation` | org invite token, redeemed at `/invites/{token}/redeem` |

**Sign-in** (iOS `ios/Sources/App/CloudAccess.swift`, Android `UpdatesViewModel` + `SignInScreen`):

- **Calimero Cloud:** the cluster's **name** (its nodes come from the Calimero node directory) or
  one of its node URLs, then *Sign in with passkey* or *Create an account*. iOS prefills it from
  `MeroNodeURL`, Android from `-PmeroCluster`. The device's passkey belongs to the cluster's relying
  party: a real cluster needs the `webcredentials:<rp-id>` associated domain (iOS) or Digital Asset
  Links (Android).
- **Development node:** a `merod local` node (iOS `http://localhost:2501`, Android emulator
  `http://10.0.2.2:2501`), mock attestation allowed, with a software passkey kept for it.
- On Android the Activity hands its passkey to the session (`onCreate` / `onDestroy`), so inviting
  and member changes are approved with it; on iOS the SDK does this itself.

**Approvals** (Companies → account menu → Approvals): node releases and app upgrades waiting for
you, per company and for your own apps. *Review* first shows the request's **confirmation code**,
then opens the node's consent page (the system browser on iOS, a Custom Tab on Android), which
shows the same code and returns to `mero-updates://consent`. The app's own session cannot approve
anything.

**The contract** is the component ABI (`../logic/res/abi.json`), called exactly as the web app's
`app/src/lib/updatesClient.ts` does, through `UpdatesClient`, generated from it by core's
`meroctl app codegen`: camelCase methods and arguments, an unset parameter left out, the
`u64` argument `since` as a decimal string. The screens keep the v1 types (snake_case fields,
numbers), and `ComponentWire` (iOS `Core/Sources/UpdatesCore/ComponentWire.swift`, Android
`core/ComponentWire.kt`) converts between them and the client's JSON:

- out: a record argument's keys become camelCase (`UpdateInput {category_id}` → `{categoryId}`);
- in: keys become snake_case again and the `u64` fields (times and counts) arrive as decimal
  strings and become numbers;
- refusals are `422 APP_ERROR {code, fields: {message}}` (`NotFound`, `Invalid`, `Forbidden`), shown
  with the contract's message. `ConfirmCancelled`, `LoginRequired`, `WrongNode`, `Unavailable`,
  `ReleaseDeadline`, `ConsentStale` and `PasskeyRequired` each get a plain sentence.

The wire tests (`ComponentWireTests`, `ComponentWireTest`) call every client method and pin the
call/view split and every parameter name to the ABI; the model tests' fakes answer in the
component shape.

What both apps do:

- **Companies and audiences** are what the web app makes: a company is an org; an audience is an
  open team of it with one app instance, which holds the updates.
- **Invitations**: `https://links.calimero.network/com.calimero.mero-updates/join?invitation=<base58(deflate(json))>`
  with the SDK's `OrgInvitation` JSON plus this app's landing fields,
  `{"invitation": "inv_…", "namespaceId", "contextId"?, "name"?, "kind", "audienceId"?, "audienceName"?}`.
  Pre-1.0 signed invitations are refused. The older `?invite=` links are read too.
- **Drafts** (`saveDraft` / `listDrafts` / `deleteDraft`) are per account in the app's state, as
  in the component port: no other account can read them.
- **Live updates** come from the app instance's event stream (coalesced, 250 ms), with a poll as a
  fallback, like the web's `AudienceShell` revision.

## Screens

1. **Sign in**: what the app is; a Calimero Cloud cluster by name or node URL with a passkey (sign
   in or create an account), or a development node.
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

## The contract client

`UpdatesClient` (`ios/Core/Sources/UpdatesCore/Generated/UpdatesClient.swift`,
`android/app/src/main/kotlin/network/calimero/updates/generated/client/UpdatesClient.kt`) is
generated from `../logic/res/abi.json`: run `scripts/mobile-codegen.sh` at the repo root after a
contract change and update `ComponentWire`'s method table and the wire tests (CI's `Mobile clients`
workflow fails on a stale client). The v1 types the screens read (`UpdatesCore/Records.swift`,
`generated/UpdatesRecords.kt`, first generated from the v1 ABI) stay until the logic derives
`AbiType`; then the client types its answers itself.

## CI

`.github/workflows/mero-updates-ios.yml` (macOS: `swift test` on the core package, XcodeGen and a
build of the app) and `.github/workflows/mero-updates-android.yml` (fetch the SDK,
ktlint, detekt, unit tests, Android lint, `assembleDebug`), each path-filtered to its folder.
