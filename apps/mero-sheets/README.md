# mero-sheets

A collaborative spreadsheet: live cursors, multiple sheet tabs, a formula engine
(94 functions — lookups, conditional aggregates, text and dates — plus
cross-sheet references), named ranges, styles, conditional formats and
validations, charts, comments, notes, attachments, workbook roles, protected
ranges, an activity log, private sheets and linked workbooks.

A component app on Calimero 1.0: the contract is on core's component SDK
(`calimero-sdk`, `wasm32-wasip2`), local development runs on `merod local`,
and the frontend talks to the local nodes in development and to Calimero Cloud
in production through mero-js's `CalimeroClient` (`@calimero-apps/connect`). See
[`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract (a standalone crate: its own `[workspace]` with `crates/recalc` (the formula engine), `crates/types` and `crates/recalc-wasm` (the engine for the browser), and its own `Cargo.lock`) |
| `logic/tests/` | `harness.rs` (every method family on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`) |
| `logic/scenarios/` | `spec-smoke.json` and `links.json` (v1's merobox workflows), `access.json` (the org's gate, guests, forged writes, the wire); run by `cargo test` and on `merod local` |
| `app/` | Vite + React + Tiptap frontend; derives cell values with the browser copy of the engine for instant echo |
| `docs/` | the docs site: architecture, the recalc engine, contributing |
| `mobile/` | native iOS and Android apps, **still v1** (see [`mobile/README.md`](mobile/README.md)) |

## The model

| | Calimero 1.0 | v1 |
|---|---|---|
| a workspace | an organization | a namespace |
| a spreadsheet (workbook) | an instance of this app in the workspace's org | a context |
| joining | an org invite link (`?invite=<token>`, `&sheet=<app id>` to land in one workbook), joined by the sign-up that carries it, or redeemed after a passkey sign-in | a namespace invitation link, then joining the context and waiting for it to sync |
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
| `SortedMap`/`UnorderedMap` keyed `"{sheet}\|{row}\|{col}"` (cells, formats, cell meta, styles, notes) and `"{sheet}\|r\|{id}"` (axes, sizes) | the same keys in `UnorderedMap<String, _>`; one sheet is one `starts_with("{sheet}\|")` read |
| `WriteOnce<IndexedMap<String, ActivityData>>`, the author = the owner stamp | `activity: UnorderedMap<(at, author, nonce), ActivityData>`, read newest first from `since` |
| `Moderated<UnorderedMap<…CommentData>>` + `resolved` registers | `comments` (with an `author` field) + `resolved: Set<commentId>` |
| `UnorderedMap<String, RichText<DefaultMarks>>` | `notes: UnorderedMap<String, NoteDoc>`: formatted runs, at most 5,000 characters |
| `SharedStorage<IndexedMap<…ProtectionData>>`, `IndexedMap<…RuleData>`, charts, sizes, views | plain maps keyed by id; a sheet's rules or protections are read by filtering the map |
| `Moderated<…AttachmentData>`, `Moderated<IndexedMap<…PublicationData>>` | maps with a `created_by` field |
| `#[app::private] Scratch` (node-local) | `privateSheets` / `privateCells`, keyed by the caller's account |
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
| who is in the workbook | the context's members | the org's owner, admins, members and guests (a guest edits, as every context member could) |
| deleted rules, charts, protections, named ranges | tombstones (`deleted`, an empty target) | removed |
| a note edited by two people at once | merged character by character (RichText CRDT) | applied in log order: the later delta's offsets apply to the note as the earlier one left it. A component's `RichText` is one state field per app, so it cannot be a value in a per-cell map |
| private sheets | node-local, never replicated | the caller's own rows in the workbook's state: no method shows them to anyone else, but they are in the replicated state, not on one device |
| linked workbooks | `publish_range` pushed values with an `xcall`, again after every change and on `push_publication`; `receive_link`/`drop_link` were `#[app::xcall(from_same_app)]` | core 1.0.0-rc.7 has no cross-app call for components, so **the client relays**: `pushPublication` is a view answering the values to deliver (`LinkPush`), and the browser calls `receiveLink` / `dropLink` on the target workbook as the person, who must be an editor there. Pushes happen when the link is made, on "push now" and after that browser's own edits; an edit made in another browser reaches the link on its next push. The origin is not verified by the node: a linked sheet records the `fromContext` the relayer named and `pushed_by` |
| `targetContext` / `fromContext` | a 64-hex context id | an app instance id; a linked sheet's id is `link-{first 12 alphanumerics of the source}-{publication id}` |
| attachments | a blob announced to the context | a blob in the app instance's blob store (`uploadBlob`); the contract records its id, as v1 did, and accepts `-` and `_` in it. Published mero-js 28.0.0 `uploadBlob` takes no content type, so a blob is served as `application/octet-stream` |
| list reads | every entry | every entry, read a page (1,000 rows) at a time within the fuel of one view |
| migrations | none | none |

Everything else (every method's checks, limits and error messages: 100 ops per
call, 2,000-character comments, 5,000-character notes, 50 logged changes, 2,000
linked cells, 20 frozen rows and columns, row and column ids, style values) is
as in v1.

### Frontend

- `MeroProvider`, mero-react, mero-platform, `@calimero-apps/names`,
  `@calimero-apps/node-served`, the generated `SpreadsheetClient` and its
  codegen, the desktop SSO hand-off, the namespace invitation codecs and the
  join-sync banner are gone. The session is `@calimero-apps/connect`
  (`src/session.ts`, `src/sessionContext.tsx`): a passkey sign-in or sign-up
  modal, the session stored per app and per target. The dev server runs on
  exactly `http://localhost:5173/` (`pnpm dev:local`).
- `src/api/spreadsheet/SpreadsheetClient.ts` is the typed adapter: v1's class,
  method names and parameter shapes, mapped to `client.call` / `client.view`
  with the ABI's names; it turns decimal strings back into numbers and owns the
  linked-workbook relay. `SpreadsheetClient.test.ts` checks its method list and
  argument names against the committed `logic/res/abi.json`.
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

`logic/workflows/` (merobox), `logic/tests/converge.rs`, the in-crate `TestHost`
tests (ported into `tests/harness.rs`), `res/state-schema.json`,
`rust-toolchain.toml` and `wasm-rustflags` (cargo-mero's wasm-opt only),
`test/perf/` and its docs (merobox node benchmarks), `app/e2e/` and the
Playwright configs, `app/src/generated/`, `app/scripts/codegen.mjs` and
`merod-install.mjs`.
