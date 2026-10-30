# Mero Sheets: native mobile apps

Native iOS (SwiftUI) and Android (Jetpack Compose) clients for Mero Sheets, next to the web
frontend (`../app`) and the contract (`../logic`, package `com.calimero.mero-sheets`). The two apps
have the same screens, in the same order, with the same copy, icons (SF Symbols / Material Symbols,
mapped one to one) and flows. Scope: read spreadsheets and their charts on the phone, comment, and
change a single cell's value.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI + Swift Charts, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `35148e4` (head of swift-sdk#85, `feat/calimero-1.0`, Calimero 1.0; moves to its merge commit once it lands) |
| Android | [`android/`](android/README.md) | Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `ea8ded7` (`main` merge commit of PR #67) |

The pins are the SDKs' `main` merge commits of those PRs; bump them together in
`ios/project.yml` + `ios/Core/Package.swift` and `android/kotlin-sdk.ref`.

## How the apps reach Calimero

**iOS runs on Calimero 1.0.** The app talks to a node of a Calimero Cloud cluster over the sealed
channel (`calimero/sealed-http/v2`, after the node's TDX attestation is verified) and signs in with
a passkey; it runs no node. `MeroAppSession` builds the SDK's `CloudAppBackend`, and the view
models keep their `MeroAppBackend` calls, each of which maps one to one:

| The app | `MeroAppBackend` | Calimero 1.0 |
| --- | --- | --- |
| workspace | namespace | organization (metadata `package = com.calimero.mero-sheets`) |
| spreadsheet | context | org-wide app instance (`/apps/{app}/views`, `/intents`, `/events`) |
| invitation | `OrgInvitation` | org invite token, redeemed at `/invites/{token}/redeem` |

Sign-in (`ios/Sources/App/CloudAccess.swift`, the same file in every ported app):

- **Calimero Cloud:** a node URL of your cluster (from cloud.calimero.network; `MeroNodeURL` in
  `ios/project.yml` prefills it), then *Sign in with passkey* or *Create an account*. The device's
  passkey belongs to the cluster's relying party: add the `webcredentials:<rp-id>` associated
  domain to the app for a real cluster.
- **Development node:** a `merod local` node (`MeroDevNodeURL`, `http://localhost:2501` by
  default), mock attestation allowed (`allowMock`), with a software passkey the SDK keeps for it.
- **Approvals** (Workspace tab → Account): node releases and app upgrades waiting for you, per org and
  for your own apps. *Review* opens the node's consent page in the system browser, which returns
  to `mero-sheets://consent`. The app's own session cannot approve anything.

**Android still runs on 0.x** (delegated execution through the account's relay, wallet sign-in);
its port follows the kotlin-sdk's.

Live updates are the open spreadsheet's event stream, with 5-second polling when the stream is not
available.

The model is the web app's (`app/src/lib/workspaces.ts`):

- a **workspace** is a namespace (`foundNamespace`, `listNamespaces`);
- a **spreadsheet** is one context bound directly to the namespace root, so a workspace invitation
  covers every spreadsheet in it. Creating one is `createContext`, then `init_project(name)` and a
  first tab, `Sheet 1`, as on the web. Its name is the workbook's own (`get_project`);
- **invitations** are links,
  `https://links.calimero.network/com.calimero.mero-sheets/join?invitation=<base58(deflate(payload))>`.
  On iOS the payload is the SDK's 1.0 `OrgInvitation` JSON, `{"invitation": "inv_…", "namespaceId",
  "name"?, "contextId"?}`, plus `projectName` / `roomName`; pre-1.0 signed invitations are refused.
  Android and the web app still write the 0.x `{invitation, groupAlias, groupId, kind, …}`
  (`app/src/lib/inviteCodec.ts`) until their ports. The spreadsheet open when Invite was pressed rides along and is
  opened after joining; `calimero://` links work too.

### Where values come from (no recalculation on the phone)

The contract computes every cell on read: `get_all_cells` returns each cell's `computed_value`,
evaluated on the node by the Rust engine in `logic/crates/recalc`. The web compiles the same engine
to WASM (`recalc-wasm`) only to echo an edit before the node answers. The phones show the node's
values as they are and do not recompute: after a value is changed, the cell shows what was typed
until the re-read (immediately after the write, then on each event) brings the recalculated
results. Two small pure pieces of the engine are ported, because the grid needs them to place and
show what the node stored:

- row and column order (`layout.rs`, `Axis::build`): cells are stored by row and column id, and
  inserted or deleted rows move ids off their implicit positions;
- formula display (`formula.rs`, `to_display`, plus the web's `sheetref.ts`): stored formulas name
  rows, columns and sheets by id; the cell sheet shows them as `=SUM(B2:B9)` and `Data!A1`.

## Screens

1. **Sign in**: on iOS a Calimero Cloud passkey (sign in or create an account) or a development
   node.
2. **Spreadsheets** tab: the open workspace's spreadsheets, pull to refresh, swipe a row to invite
   people to it. The title switches workspaces (and makes a new one); the lime + makes a spreadsheet.
3. **Spreadsheet** (pushed): the workbook's tabs as chips (linked tabs marked), and the grid: a
   native scroll view with momentum and pinch to zoom, frozen header row and column, the sheet's
   own frozen rows and columns, column widths and row heights, number / currency / percent / date
   formats, bold, italic, underline, strikethrough, text and fill colours, alignment and wrapping,
   and a marker on cells with open comments. Tap a cell to select it; the bar at the bottom shows its
   reference, value and formula, a comments button and an Edit button. Double-tap to edit. The top
   bar has Charts (when the sheet has any), Comments, and a menu with Invite people and About.
4. **Cell** sheet: value, formula (display form) or the raw entry, format in words, style chips,
   who edited it and when, why it cannot be edited (formula, linked sheet, role, protected range),
   its comment threads with a composer, and Edit value.
5. **Edit value** sheet: one field, Save; empty clears the cell.
6. **Charts** sheet: the open sheet's charts drawn natively (Swift Charts on iOS, a Compose Canvas
   on Android): bar or line from zero, the web's series colours and tick rules, legend, Show data.
7. **Comments** sheet: every open thread in the workbook, jump to its cell, resolve or reopen,
   reply, edit or delete your own.
8. **About this spreadsheet**: name, tabs, your role, collaborators, where values come from, and a
   Details disclosure with the ids.
9. **Workspace** tab: the open workspace, Invite people, its spreadsheets, all workspaces (switch,
   create), the account and Sign out, Details.
10. Sheets: New workspace, New spreadsheet, Invite to workspace, and the Join confirmation when an
    invitation link opens the app.

Empty, loading, syncing (a just-joined workspace) and error states are on every screen.

## Features vs the web app

Done: workspaces (create, switch, invite, join), spreadsheets (list, create, open), tabs, the grid
with the web's formats, styles, sizes and frozen panes, charts, cell details with formulas in
display form, editing a cell's plain value (refused for formulas, linked sheets, viewers and
commenters, and protected ranges, as the web refuses them), comments (add, reply, resolve, reopen,
edit and delete your own), live updates.

Left out, and why:

- **Formula authoring.** Typing `=` is refused with "Formulas are written in the web app". Writing
  a formula needs the engine's `to_stored` and the function catalog; that stays on the web. If phone
  edits grow, the Rust `recalc` crate can be compiled natively for both platforms.
- **Recalculation on the phone.** See above: the node computes, the phone re-reads.
- **Conditional formats, colour scales and validation marks.** They are evaluated with the
  engine's condition matcher (`condition_matches` in `recalc-wasm`); without the engine on the phone
  the grid shows each cell's own style only.
- **Formatting, structure and sheet management** (styles, number formats, insert/delete rows,
  resize, freeze, new/rename/delete tabs, sort, filter, fill, paste), **notes, attachments, named
  ranges, protected-range editing, publications and links, private sheets, the activity log, roles,
  nicknames, presence cursors, CSV/XLSX export.** Web-only for now: the phone scope is view plus
  light edits.
- **Theme switch.** The apps use the Calimero light look only.

## SDK notes

- **Spreadsheet names** come from the contract (`get_project`), which every member can read; a name
  this device gave is used until the workbook answers. No metadata call is needed.
- **Generated client.** Generated with `--transport-import`, so it takes the SDK's
  `ContextContractCalling` and `contract.bound(to: contextId)` goes straight in, no adapter.
- **One service.** The sheets bundle has one service, so `createContext` (the package's default
  service) is the right call; no `createServiceContext`.

## Regenerate the contract clients

```bash
ABI_CODEGEN=/path/to/abi-codegen/dist/cli.js ./scripts/codegen.sh
```

Writes `ios/Core/Sources/SheetsCore/Generated/SheetsClient.swift` and
`android/app/src/main/kotlin/network/calimero/sheets/generated/SheetsClient.kt` from
`../logic/res/abi.json`. Views go through `query`, mutations through `execute`. Do not edit them.

## CI

`.github/workflows/mero-sheets-ios.yml` (macOS: `swift test` on the Core package, then XcodeGen and
a simulator build) and `.github/workflows/mero-sheets-android.yml` (fetch the SDK, ktlint, detekt,
unit tests, Android Lint, `assembleDebug`), each path-filtered to its folder.
