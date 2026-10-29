# Mero CRM — native mobile apps

Native iOS (SwiftUI) and Android (Jetpack Compose) clients for Mero CRM, next to the web app
(`../app`) and the contract (`../logic`, package `com.calimero.mero-crm`). The two apps have the
same screens, in the same order, with the same copy and matching icons (SF Symbols on iOS,
Material Symbols on Android).

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | `ios/` | SwiftUI, iOS 16+; non-UI code in the local package `ios/Core` | swift-sdk `MeroKit` + `MeroKitUI` at `c9ca1a0` (merge commit of PR #84 on `main`) |
| Android | `android/` | Compose + Material3, minSdk 26 | kotlin-sdk `mero-core` + `mero-compose` at `ea8ded7` (merge commit of PR #67 on `main`), composite build |

**The SDK pins** are set in `ios/project.yml` and
`ios/Core/Package.swift` (keep them equal), and `android/kotlin-sdk.ref`.

## Delegated execution only

Neither app runs a node. Sign-in, the account's relay, deep links and invitations are the SDKs'
`MeroAppSession`; namespaces, contexts, invitations and live events are `MeroAppBackend`; every
contract call goes through the generated `CrmClient` over `contract.bound(to: contextId)`
(views with `query`, writes with `execute`).

A **workspace** is a namespace; a **pipeline** is a context directly in it, as the web app's
`addPipeline` creates them. The whole pipeline (stages, deals, people, activities, automations,
settings) is read in one round and every screen derives from that snapshot, like the web's
`useCrm`; a context event re-reads it (coalesced), and the app polls when the relay cannot stream.
A pipeline still replicating to a new member shows "Syncing…" and retries, not an error.

## Screens

1. **Sign in** — what the app is, Sign in with Calimero.
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

All 33 contract methods are wired; `add_automation`, `set_automation_enabled` and
`delete_automation` are in the generated client but the phone shows automations read-only.

## Compared with the web app

Same: pipeline, deals, deal page with the assistant (the rules in `app/src/utils/crm.ts`, ported
one for one in `Assistant`/`Insights` and tested against the same cases), people, to-dos,
insights, stages, settings, workspaces, invitations in the web's link format
(`links.calimero.network/com.calimero.mero-crm/join?invitation=…`, payload
`{invitation, groupAlias, groupId, kind}`), so links work across web and phone.

Left out, and why:

- **Editing automations** — read-only on the phone by design; they are set up once, on the web.
- **Member names, roles, member list, setting your name** — `MeroAppBackend` has no member
  listing or member metadata, so owners and authors show as "You" or a short account id. Owners
  stored by the web are still honoured and offered.
- **Pipeline names across devices** — the web writes and reads a context-metadata record through
  the node admin API, which the app backend does not expose; the phone keeps the names it gave
  its own pipelines and numbers the others ("Pipeline 2").
- **Light / dark switch** — the apps follow the Calimero light style only, like the other mobile
  apps.
- **Drag and drop, keyboard shortcuts, TEE badge** — desktop affordances.

## Build and test

```bash
# iOS (never against a simulator from a dev machine; CI builds the app)
cd ios/Core && swift test               # generated client, rules, view models: 23 tests
cd .. && xcodegen generate              # writes MeroCRM.xcodeproj (not committed)

# Android
cd android
./scripts/fetch-sdk.sh                  # kotlin-sdk at kotlin-sdk.ref, into .sdk/
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

CI: `.github/workflows/mero-crm-ios.yml` (Core tests on macOS, XcodeGen + simulator build) and
`.github/workflows/mero-crm-android.yml` (ktlint, detekt, unit tests, lint, `assembleDebug`),
each path-filtered to its folder.

## Regenerate the client

The contract clients are generated from `../logic/res/abi.json` and committed
(`ios/Core/Sources/CrmGenerated/CrmClient.swift` — its own module, because it declares its own
`ContextContractCalling` — and `android/.../generated/CrmClient.kt`). After a contract change:

```bash
ABI_CODEGEN="node /path/to/abi-codegen/dist/cli.js" ./scripts/regenerate-clients.sh
```

The generated `ContextContractCalling` is bridged to the SDK's bound contract by `CrmTransport`
(iOS, `Core/Sources/CrmCore/Support.swift`) and `crmClient()` (Android, `core/Support.kt`).

## Configuration

- iOS: Info.plist keys in `ios/project.yml` — `CrmCallbackScheme` (default `mero-crm`, the wallet
  returns to `mero-crm://enrol`), `CrmCallbackHost` / `CrmCallbackPath` for a verified https
  callback, `MeroCloudBaseURL`, `MeroWalletURL`, `MeroRegistryURL` (empty: the hosted defaults).
- Android: Gradle properties in `android/gradle.properties` — `meroEnrolCallback` (default
  `mero-crm://enrol`, also the manifest's intent filter), `meroCloudUrl`, `meroWalletUrl`,
  `meroRegistryUrl`.
- Invitation links open the apps as `calimero://com.calimero.mero-crm/join?invitation=…`; the
  https form needs Associated Domains / App Links on `links.calimero.network`, which that host does
  not publish for this app yet, so a pasted https link goes through **Join with an invitation**.
- Kotlin's `InviteLink.tokenFromPasted` does not check the app, so `CrmInvitation.parse` checks the
  link's slug itself and refuses another app's invitation (Swift passes `expectedSlug`).
