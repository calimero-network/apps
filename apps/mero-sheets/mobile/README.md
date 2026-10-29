# Mero Sheets: native mobile apps

Native iOS (SwiftUI) and Android (Jetpack Compose) clients for Mero Sheets, next to the web
frontend (`../app`) and the contract (`../logic`, package `com.calimero.mero-sheets`). The two apps
have the same screens, in the same order, with the same copy, icons (SF Symbols / Material Symbols,
mapped one to one) and flows. Scope: read spreadsheets and their charts on the phone, comment, and
change a single cell's value.

| | Folder | Stack | SDK (pinned) |
| --- | --- | --- | --- |
| iOS | [`ios/`](ios/README.md) | SwiftUI + Swift Charts, iOS 16+ | [swift-sdk](https://github.com/calimero-network/swift-sdk) `c9ca1a0` (`main` merge commit of PR #84) |
| Android | [`android/`](android/README.md) | Compose + Material3, minSdk 26 | [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) `ea8ded7` (`main` merge commit of PR #67) |

The pins are the SDKs' `main` merge commits of those PRs; bump them together in
`ios/project.yml` + `ios/Core/Package.swift` and `android/kotlin-sdk.ref`.

## Delegated execution only

No node runs on the phone. Both apps use the SDKs' `MeroAppSession`: Calimero Cloud sign-in (the
wallet certifies the device key), the account's relay from the Cloud manager, and a
`MeroAppBackend` over that relay. Reads go through the relay's account-scoped query, writes are
warrants the device key signs, and live updates are the relay's event stream for the open
spreadsheet, with 5-second polling when the stream is not available.

The model is the web app's (`app/src/lib/workspaces.ts`):

- a **workspace** is a namespace (`foundNamespace`, `listNamespaces`);
- a **spreadsheet** is one context bound directly to the namespace root, so a workspace invitation
  covers every spreadsheet in it. Creating one is `createContext`, then `init_project(name)` and a
  first tab, `Sheet 1`, as on the web. Its name is the workbook's own (`get_project`);
- **invitations** are the web app's links,
  `https://links.calimero.network/com.calimero.mero-sheets/join?invitation=<base58(deflate(payload))>`,
  with payload `{invitation, groupAlias, groupId, kind: "namespace", contextId?, projectName?, roomName?}`
  (`app/src/lib/inviteCodec.ts`). The spreadsheet open when Invite was pressed rides along and is
  opened after joining; `calimero://` links work too.

### Where values come from (no recalculation on the phone)

The contract computes every cell on read: `get_all_cells` returns each cell's `computed_value`,
evaluated on the node by the Rust engine in `logic/crates/recalc`. The web compiles the same engine
to WASM (`recalc-wasm`) only to echo an edit before the node answers. The phones show the node's
values as they are and do not recompute: after a value is changed, the cell shows what was typed
until the re-read (immediately after the write, then on each relay event) brings the recalculated
results. Two small pure pieces of the engine are ported, because the grid needs them to place and
show what the node stored:

- row and column order (`layout.rs`, `Axis::build`): cells are stored by row and column id, and
  inserted or deleted rows move ids off their implicit positions;
- formula display (`formula.rs`, `to_display`, plus the web's `sheetref.ts`): stored formulas name
  rows, columns and sheets by id; the cell sheet shows them as `=SUM(B2:B9)` and `Data!A1`.

## Screens

1. **Sign in**: Sign in with Calimero.
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
- **No service name on `createContext`.** The sheets bundle has one service, so the relay's default
  is the right one.

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
