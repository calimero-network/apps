# mero-sheets

A collaborative spreadsheet: live cursors, multiple sheet tabs, a formula engine
(94 functions — lookups, conditional aggregates, text and dates — plus
cross-sheet references), named ranges, styles, conditional formats and
validations, charts, comments, notes, attachments, workbook roles, protected
ranges, an activity log, private sheets and linked workbooks.

A component app on Calimero 1.0: the contract is on core's component SDK
(`calimero-app-sdk`, `wasm32-wasip2`), local development runs on `merod local`,
and the frontend talks to the local nodes in development and to Calimero Cloud
in production through mero-js's `CalimeroClient` (`@calimero-apps/connect`). See
[`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract (a standalone crate: its own `[workspace]` with `crates/recalc` (the formula engine), `crates/types` and `crates/recalc-wasm` (the engine for the browser), and its own `Cargo.lock`) |
| `logic/tests/` | `harness.rs` (every method family on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`) |
| `logic/scenarios/` | `spec-smoke.json` and `links.json` (v1's two Docker workflows, `logic/workflows/*.yml`), `access.json` (the org's gate, guests, forged writes, the wire); run by `cargo test` and on `merod local` |
| `app/` | Vite + React + Tiptap frontend; derives cell values with the browser copy of the engine for instant echo |
| `docs/` | the docs site: architecture, the recalc engine, contributing |
| `mobile/` | native iOS and Android apps, **still v1** (see [`mobile/README.md`](mobile/README.md)) |

## The model

| | Calimero 1.0 | v1 |
|---|---|---|
| a workspace | an organization | a namespace |
| a spreadsheet (workbook) | an instance of this app in the workspace's org | a context |
| joining | an org invite link (`?invite=<token>`, `&sheet=<app id>` to land in one workbook), redeemed after a passkey sign-in | a namespace invitation link, then joining the context and waiting for it to sync |
| who you are | an account, signed in with a passkey | a node identity, signed in through the node |

Every member of a workspace (owner, admins, members, guests) reaches every
workbook in it. Inside a workbook, v1's roles still apply: its owners (the
instance's creator first) name it, change roles and protect ranges; editors
change cells and structure; commenters comment; viewers read. Anyone outside the
org is refused before the contract runs (`404 NOT_FOUND`; `401 UNAUTHENTICATED`
for an anonymous caller).

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (root Cargo.toml), once: see docs/COMPONENT-APPS.md
pnpm dev:local mero-sheets    # merod local + the contract + the app on http://localhost:5173/
```

Sign up with a passkey and create a spreadsheet. To try a second person, open
**Invite** in another browser profile.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
L=apps/mero-sheets/logic
cargo fmt --manifest-path $L/Cargo.toml -- --check
cargo clippy --manifest-path $L/Cargo.toml --all-targets -- -D warnings
cargo clippy --manifest-path $L/Cargo.toml --target wasm32-wasip2 -- -D warnings
cargo test --manifest-path $L/Cargo.toml        # engine + harness + scenarios
cargo run --release --manifest-path $M -- build $L   # res/abi.json
pnpm merod-local e2e mero-sheets                 # the scenarios on merod local
pnpm -F mero-sheets lint && pnpm -F mero-sheets typecheck && pnpm -F mero-sheets test && pnpm -F mero-sheets build
```

## Production

The production frontend is the one packed into the bundle (`frontend-dir`),
served by the cluster from the package's own origin: build the app first
(`pnpm -F mero-sheets build`, with `VITE_CALIMERO_CLUSTER` and
`VITE_CALIMERO_MIN_RELEASE` set; see `app/.env.example`). The Vercel deployment
stays the listing's link.

The component is about 1.7 MB, so publishing a release bundle to the registry
waits on [app-registry#424](https://github.com/calimero-network/app-registry/pull/424)
(large bundles).

## What changed in the port, and why

### Storage

The workbook runs on its cluster's leader, which applies every write in one log,
so the hand-written `Mergeable` rules, owner-stamped keys and writer sets have
nothing left to decide; what they enforced is a check in each method against
`env::caller()`.

| v1 (`calimero-storage`) | component SDK |
|---|---|
| `Frozen<Founding>` | `founding: Cell<Founding>`, written once in `init` |
| `SharedStorage<LwwRegister<String>>` (the name; owners write) | `projectName: Cell<String>`; `initProject` is owners-only |
| `AccessControl` (admins = owners; named roles `viewer`, `commenter`) | `owners: Set<account>` (the app's owner at `init`) + `roles: UnorderedMap<account, "viewer" \| "commenter">` |
| `UserStorage<MemberData>` | `members: UnorderedMap<account, MemberData>`, written only for the caller |
| `SortedMap`/`UnorderedMap` keyed `"{sheet}\|{row}\|{col}"` (cells, formats, cell meta, styles, notes) and `"{sheet}\|r\|{id}"` (axes, sizes) | the same keys in `UnorderedMap<String, _>`: **one entry per cell**, so an edit writes that cell only; one sheet is one `starts_with("{sheet}\|")` range, read a page at a time. `cellCounts` / `axisCounts` keep each sheet's stored counts for the caps below |
| `WriteOnce<IndexedMap<String, ActivityData>>`, the author = the owner stamp | `activity: UnorderedMap<(at, author, nonce), ActivityData>`, read newest first from `since` |
| `Moderated<UnorderedMap<…CommentData>>` + `resolved` registers | `comments` (with an `author` field) + `resolved: Set<commentId>` |
| `UnorderedMap<String, RichText<DefaultMarks>>` | `notes: UnorderedMap<String, NoteDoc>`: formatted runs, at most 5,000 characters |
| `SharedStorage<IndexedMap<…ProtectionData>>`, `IndexedMap<…RuleData>`, charts, sizes, views | plain maps keyed by id; a sheet's rules or protections are read by filtering the map |
| `Moderated<…AttachmentData>` (a blob id string) | `attachments`, each holding a `BlobRef` (rc.8 blobs): the node keeps the blob while an attachment refers to it and lets it go when the attachment is removed; `created_by` checked in the method |
| `Moderated<IndexedMap<…PublicationData>>` + `env::xcall` + `#[app::xcall(from_same_app)]` | `publications` (`created_by` checked in the method); pushes are rc.8 `env::xcall`s to the target's `receiveLink` / `dropLink`, which `allow(app = "*")` and accept only a `Caller::App` equal to the `fromContext` they name |
| `#[app::private] Scratch` (node-local) | `privateSheets` / `privateCells`, keyed by the caller's account (see below: core has no private storage yet) |
| `HashMap`/`HashSet` in the formula engine | `BTreeMap`/`BTreeSet`: a component may not import `wasi:random/insecure-seed`, which std's `RandomState` needs. Results are unchanged |

### What a client sees

| | v1 | now |
|---|---|---|
| method names | `set_cell`, `get_cells`, … | every v1 method, camelCase: `setCell`, `getCells`, …; reads are `view`s |
| argument names | `sheet_id`, `row_id`, `raw_value`, … | camelCase: `sheetId`, `rowId`, `rawValue`, `newName`, `memberId`, `topRowId`, `targetContext`, `blobId`, … |
| argument records | `CellOp`/`AxisOp` (`{ name, payload }`), `StyleOp`, `RuleInput`, `ChartInput`, `AxisSize`, note deltas | unchanged |
| answers | snake_case fields; 64-bit integers as JSON numbers | the same snake_case fields; `created_at`, `updated_at`, `joined_at`, `at`, `last_edited_at` and `size` are **decimal strings**; `u32`s stay numbers |
| `getActivity` `since` | a number | a decimal string |
| timestamps | nanoseconds | still nanoseconds (the log entry's millisecond time × 10⁶) |
| member ids | 64-hex account keys | the account id the platform gives (`whoami`) |
| errors | `{ kind, data }` in a `FunctionCallError` | `422 APP_ERROR`: `NotFound`, `Invalid` or `Forbidden`, with `fields: { message }` (v1's `data`) |
| event fields | `sheet_id`, `row_id`, `rule_id`, `member_id` | camelCase (`sheetId`, `rowId`, `ruleId`, `memberId`); same events, same names |
| events | to every member of the context | to everyone the workbook reaches (`Audience::All`); `AlertTriggered` still names its recipients |
| who is in the workbook | the context's members | the org's owner, admins, members and guests. Members (and admins, the owner) edit unless given a role, as every context member did; **an org guest is a viewer** until an owner gives them a role (`setRole`, `editor` included). v1 had no guests |
| deleted rules, charts, protections, named ranges | tombstones (`deleted`, an empty target) | removed |
| a note edited by two people at once | merged character by character (RichText CRDT) | applied in log order: the later delta's offsets apply to the note as the earlier one left it. A component's `RichText` is one state field per app, so it cannot be a value in a per-cell map |
| private sheets | node-local, never replicated | **not private storage**: core 1.0.0-rc.8 has no `#[app::private]`. They are the caller's own rows in the workbook's state: no method shows them to anyone else, but they are replicated with the workbook and readable by whoever can read its raw state (the cluster's operator), not kept on one device |
| linked workbooks | `publish_range` pushed values with an `xcall`, again after every change and on `push_publication`; `receive_link`/`drop_link` were `#[app::xcall(from_same_app)]` | the same, on rc.8's `env::xcall`: the contract pushes when a link is made, after every change to its sheet and on `pushPublication` (a call, as in v1), and `unpublish` sends `dropLink`. The target accepts `receiveLink` / `dropLink` only from the platform's delivery, as `Caller::App(fromContext)`: any account (`Forbidden`, "only another workbook can push a link") or an app naming another workbook is refused. Differences: the target must be in the same organization (an xcall's rule), and any app of that organization that names itself correctly can push (v1: only the same app; rc.8's `allow` names app instances, not packages). A dropped link is removed, not tombstoned; one removed here (`unlink`) stays blocked |
| `targetContext` / `fromContext` | a 64-hex context id | an app instance id; a linked sheet's id is `link-{first 12 alphanumerics of the source}-{publication id}` |
| attachments | a blob announced to the context | an rc.8 blob of the app (`uploadBlob`); `addAttachment` takes its **hex id** (mero-js answers it as `id`) and stores a `BlobRef`: a blob the app does not hold is `NotFound`, `size` must be the node's recorded size, and the type is the node's unless it only recorded `application/octet-stream` (mero-js 28 uploads without one), then the client's. New view `grantAttachment(id)`: a one-hour download link (`?grant=`) |
| `clearCell` / a `Clear` op | blanked the cell in place (removing a CRDT key tombstones it) | removes the cell's value and format entries (one log has no tombstones) |
| list reads | every entry | the reads that grow with use are **paged**: `getCells(sheetId, cursor?, limit?)`, `getAllCells`, `getComments`, `getStyles`, `getNotedCells`, `getAttachments`, `getMembers` and `getPrivateCells` take `cursor` and `limit` (≤ 1,000) and answer `{ items, next }`; the client follows `next`. `getMembers` pages by account (the client sorts by arrival); `getAllCells` holds stored cells only (linked sheets: `getCells`). The rest answer a list, as in v1, of a capped collection |
| caps (new) | none | every collection a view or an evaluation reads whole is capped, so one call's reads are bounded: 200 sheets, 20,000 stored cells and 4,000 inserted or deleted rows and columns per sheet, 500 rules, 500 charts, 500 protected ranges, 1,000 names, 100 links made and 100 received, 50 private sheets and 5,000 private cells per account (`Invalid` past one). `setSizes` takes only rows and columns the sheet has. Deleting a sheet removes its rows, columns, sizes and frozen panes; its cells stay stored, never read |
| migrations | none | none |

Everything else (every method's checks, limits and error messages: 100 ops per
call, 2,000-character comments, 5,000-character notes, 50 logged changes, 2,000
linked cells, 20 frozen rows and columns, row and column ids, style values) is
as in v1.

### Frontend

- `MeroProvider`, mero-react, mero-platform, `@calimero-apps/names`, the generated `SpreadsheetClient` and its
  codegen, the desktop SSO hand-off, the namespace invitation codecs and the
  join-sync banner are gone. The session is `@calimero-apps/connect`
  (`src/session.ts`, `src/sessionContext.tsx`): a passkey sign-in or sign-up
  modal, the session stored per app and per target. The dev server runs on
  exactly `http://localhost:5173/` (`pnpm dev:local`).
- `src/api/spreadsheet/SpreadsheetClient.ts` is the typed adapter: v1's class,
  method names and parameter shapes, mapped to `client.call` / `client.view`
  with the ABI's names; it turns decimal strings back into numbers and follows
  `next` through paged views, so the screens still get whole lists.
  `SpreadsheetClient.test.ts` checks its method list and argument names against
  the committed `logic/res/abi.json` (all but `receiveLink` / `dropLink`, which
  only another workbook calls).
- `src/lib/workspaces.ts`: workspaces are orgs, spreadsheets are instances
  (`listApps` by the dev bundle or the package, `createApp(name, source, { org })`),
  invitations are org invites (`invite` is a passkey step-up). The first
  spreadsheet creates the workspace and lets members create spreadsheets and
  invite (a passkey step-up; refused, the app says so). Spreadsheets open at
  once: nothing joins a context or waits for it to sync.
- People: workspace roles are owner, admin, member and guest (`setMember`,
  `removeMember`, both passkey step-ups); workbook roles are the contract's.
  Workspace names come from org member metadata. The TEE replica policy section
  is gone (no 1.0 equivalent).
- Live cursors use the cluster's presence API (`publishPresence`,
  `presenceStream`), re-published every 3 s (an entry lapses after 7 s).
  Changes arrive on `client.events`; the status bar's peer-sync phases are gone.

### Removed

`logic/workflows/` (the v1 Docker workflows), `logic/tests/converge.rs`, the in-crate `TestHost`
tests (ported into `tests/harness.rs`), `res/state-schema.json`,
`rust-toolchain.toml` and `wasm-rustflags` (cargo-mero's wasm-opt only),
`test/perf/` and its docs (v1 node benchmarks), `app/e2e/` and the
Playwright configs, `app/src/generated/`, `app/scripts/codegen.mjs` and
`merod-install.mjs`.

`@calimero-apps/node-served` stays a dependency only because the shared,
generated landing page (`scripts/landing/template/LandingPage.tsx`) imports it.

### Not ported (core 1.0.0-rc.8 lacks it)

- **Private (node-local) storage** (`#[app::private]`): private sheets are the
  caller's own rows in the replicated state, as described above.
- **Character-by-character note merging**: a `RichText` is one state field per
  app, so a per-cell note is formatted runs applied in log order.
- Nothing here needs outbound HTTP, actions, event handlers, TEE methods or
  migrations (v1 had none), so no `outbound` hosts or secrets need configuring.
