# Mero CRM — native mobile apps

Native iOS (SwiftUI) and Android (Jetpack Compose) clients for Mero CRM, next to the web app
(`../app`) and the contract (`../logic`, package `com.calimero.mero-crm`). The two apps have the
same screens, in the same order, with the same copy and matching icons (SF Symbols on iOS,
Material Symbols on Android).

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+; non-UI code in the local package `ios/Core` | swift-sdk `MeroKit` + `MeroKitUI` at `v0.5.0` |
| Android | `android/` | Compose + Material3, minSdk 26 | kotlin-sdk `mero-core` + `mero-compose` at `0.4.0` (not on Maven Central), composite build |

**The SDK pins** are set in `ios/project.yml` and
`ios/Core/Package.swift` (keep them equal), and `android/kotlin-sdk.ref`.

## How the apps reach Calimero

**Both apps run on Calimero 1.0.** They talk to a node of a Calimero Cloud cluster over the
sealed channel (`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and sign
in with a passkey; they run no node. The SDK's `MeroAppSession` builds `CalimeroAppBackend`, and
the view models keep their `MeroAppBackend` calls, each of which maps one to one:

| The app | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| workspace | namespace | organization (metadata `package = com.calimero.mero-crm`) |
| pipeline | context | app instance (`/apps/{app}/views`, `/intents`, `/events`) |
| invitation | `OrgInvitation` | org invite token (`POST /orgs/{org}/invites`, a passkey step-up; redeemed at `/invites/{token}/redeem`) |

Sign-in (iOS `ios/Sources/App/CloudAccess.swift`, Android `ui/SignInScreen.kt` +
`app/CrmViewModel.kt`, the same screen and copy):

- **Calimero Cloud:** your cluster, by name (its nodes come from the node directory and the client
  fails over between them) or by a node URL from cloud.calimero.network (`MeroNodeURL` in
  `ios/project.yml`, `meroCluster` in `android/gradle.properties` prefill it), then *Sign in with
  passkey* or *Create an account*. The device's passkey belongs to the cluster's relying party:
  add the `webcredentials:<rp-id>` associated domain (iOS) or the Digital Asset Links (Android)
  for a real cluster.
- **Development node:** a `merod local` node (`MeroDevNodeURL`, `http://localhost:2501` on iOS;
  `meroDevNodeUrl`, `http://10.0.2.2:2501` from the Android emulator), mock attestation allowed,
  with a software passkey kept on the phone. Android debug builds allow cleartext to that host only.
- **Approvals** (Workspaces → account menu): node releases and app upgrades waiting for you, per
  workspace and for your own apps. *Review* first shows the confirmation code the node's consent
  page will show, then opens that page in the system browser (Custom Tab on Android), which
  returns to `mero-crm://consent`. The app's own session cannot approve anything.
- On Android the Activity's passkey is handed to the session while it is on screen
  (`MeroAppSession.passkey`), so inviting someone gets its passkey step-up.

**The contract** is Mero CRM's component ABI (`../logic/res/abi.json`, from the web port): methods
and arguments in camelCase (`createDeal`, `dealId`, `expectedClose`), every u64 a decimal string
both ways (`value`, `expectedClose`, `dueAt` in; `value`, `expected_close`, `due_at`, `created_at`
… out), answers in v1's snake_case fields, and a refusal as `422 APP_ERROR {code, fields}`
(`NotFound {what, id}`, `Invalid {message}`, `Forbidden {message}`). Both apps call it through
`CrmClient` (iOS `ios/Core/Sources/CrmGenerated/CrmClient.swift`, Android
`android/.../generated/CrmClient.kt`) over `contract.bound(to: appId)`: views with `query`, calls
with `execute`. The client keeps v1's Swift / Kotlin surface, so the view models did not change;
`ContractSurfaceTests` / `ContractSurfaceTest` pin its method names, parameters and number
encoding to the ABI.

Refusals read as plain words (`ErrorText`): a cancelled passkey prompt, a session that ended
(`LoginRequired`), a node that may not serve the account (`WrongNode`) or is busy
(`UnavailableError`), a release deadline (`ReleaseDeadlineError`, "open Approvals"), a stale
consent (`ConsentStale`), and the contract's own `APP_ERROR` codes.

A **workspace** is an org; a **pipeline** is an app instance directly in it, as the web app's
`addPipeline` creates them. The whole pipeline (stages, deals, people, activities, automations,
settings) is read in one round and every screen derives from that snapshot, like the web's
`useCrm`; an app event re-reads it (coalesced).

## Screens

1. **Sign in** — what the app is; on iOS a Calimero Cloud passkey (sign in or create an account) or a
   development node.
2. **Workspaces** — your workspaces with their pipelines; New workspace (name, first pipeline,
   currency), Add pipeline, Join with an invitation (paste a link), and the deep-link invitation
   sheet. Account menu with Sign out.
3. **Pipeline** (tab) — the board: a summary row (open deals, in pipeline, weighted), stage chips,
   and one horizontally swipeable column per stage with its count, compact total, win probability
   and bar. Each card shows health, title, organization · person, value, owner, the next step
   (or "No next step") and "Idle Nd". A card's `…` (or long-press) opens **Move to stage…**, with
   Won and Lost (lost-reason presets) — the phone's version of dragging a card.
4. **Deals** (tab) — Open / Won / Lost / All with counts, search, sort (newest, value, expected
   close, health), "Only mine", new deal.
5. **Deal** — status, value and who; Won / Lost / Move or Reopen; the stage strip (tap to move);
   Details (edit sheet, linked person with Email / Call); the **deal assistant** (health score and
   reasons, win likelihood, suggested next steps scheduled in one tap or "Fix" opening the editor,
   follow-up email draft to copy, open in Mail or log as an activity, "Copy AI coaching prompt");
   Activities (schedule, tick off, Tomorrow, delete); Notes (add, delete your own); delete deal
   (creator only); technical ids behind **Details**.
6. **People** (tab) — People and Companies (gathered from the organization on people and deals),
   search, new person.
7. **Person** — Email, Call, new deal for them; contact details, their deals, what is scheduled
   with them; edit, delete (creator only).
8. **Company** — open and won value, people, deals; new deal or person at that company.
9. **To-dos** (tab) — kind filter, search, "Only mine", Overdue / Today / Upcoming / Recently
   done; swipe to complete or delete, `…` for Tomorrow / Open deal / Delete; schedule a new one
   (with or without a deal). The tab badge counts your overdue to-dos.
10. **More** (tab) — Insights, Stages, Automations, Pipeline settings, Invite people (share or copy
    a link), Switch pipeline, Sign out, technical ids behind Details.
11. **Insights** — open pipeline, weighted, won this month, win rate, average deal, sales cycle;
    value by stage, forecast by close month, lost reasons, by owner, deals that need attention.
12. **Stages** — rename, re-weight, reorder (up / down), add, delete (refused while it holds open
    deals). **Automations** — read-only. **Pipeline settings** — currency, idle threshold.

All 32 contract methods are wired; `addAutomation`, `setAutomationEnabled` and
`deleteAutomation` are in the client but the phone shows automations read-only.

## Compared with the web app

Same: pipeline, deals, deal page with the assistant (the rules in `app/src/utils/crm.ts`, ported
one for one in `Assistant`/`Insights` and tested against the same cases), people, to-dos,
insights, stages, settings, workspaces, invitations
(`links.calimero.network/com.calimero.mero-crm/join?invitation=…`). The payload is the SDK's 1.0
`OrgInvitation` shape, `{"invitation": "inv_…", "namespaceId", "name"}`, on both phones. The web
port passes the org invite token itself in `?invite=`, so a link does not yet cross between the
web and the phones. Pre-1.0 signed invitations are refused.

Left out, and why:

- **Editing automations** — read-only on the phone by design; they are set up once, on the web.
- **Member names, roles, member list, setting your name** — not ported to the phones yet
  (`MeroAppBackend.listMembers` / `setMemberName` exist on 1.0), so owners and authors show as
  "You" or a short account id. Owners stored by the web are still honoured and offered.
- **Pipeline names across devices** — the phones keep the names they gave their own pipelines and
  number the others ("Pipeline 2"); reading app-instance names (`listContextEntries`) is a follow-up.
- **Light / dark switch** — the apps follow the Calimero light style only, like the other mobile
  apps.
- **Drag and drop, keyboard shortcuts, TEE badge** — desktop affordances.

## Build and test

```bash
# iOS (never against a simulator from a dev machine; CI builds the app)
cd ios/Core && swift test               # client against the ABI, rules, view models: 27 tests
cd .. && xcodegen generate              # writes MeroCRM.xcodeproj (not committed)
xcodebuild build -project MeroCRM.xcodeproj -scheme MeroCRM -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO

# Android
cd android
./scripts/fetch-sdk.sh                  # kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

CI: `.github/workflows/mero-crm-ios.yml` (Core tests on macOS, XcodeGen + simulator build) and
`.github/workflows/mero-crm-android.yml` (ktlint, detekt, unit tests, lint, `assembleDebug`),
each path-filtered to its folder.

## The contract client

`CrmClient` (Swift `ios/Core/Sources/CrmGenerated/`, Kotlin
`android/.../crm/generated/client/`) is generated from `../logic/res/abi.json` by core's
`mero-app-build codegen`. After a contract change run `scripts/mobile-codegen.sh` at the repo root,
commit, and update the method table in `ContractSurfaceTests` / `ContractSurfaceTest`; CI's
`Mobile clients` workflow fails on a stale client. Until the logic derives `AbiType`, the ABI names
the answer types (`DealView`, `StageView`, ...) without their shape, so the client answers their
JSON and the hand-kept types in `CrmCore/Records.swift` and `crm/generated/CrmRecords.kt` read it.

## Configuration

- iOS: Info.plist keys in `ios/project.yml`: `MeroNodeURL` (your Cloud cluster's name or a node
  URL; empty: the sign-in screen asks), `MeroDevNodeURL` (the development node it offers),
  `CrmCallbackScheme` (default `mero-crm`; the consent page returns to `mero-crm://consent`),
  `CrmCallbackHost` / `CrmCallbackPath` for a verified https return.
- Android: Gradle properties in `android/gradle.properties`: `meroCluster` (a cluster name or a node
  URL; empty: the sign-in screen asks), `meroDevNodeUrl`, `meroConsentCallback` (default
  `mero-crm://consent`, also the manifest's intent filter).
- Invitation links open the apps as `calimero://com.calimero.mero-crm/join?invitation=…`; the
  https form needs Associated Domains / App Links on `links.calimero.network`, which that host does
  not publish for this app yet, so a pasted https link goes through **Join with an invitation**.
