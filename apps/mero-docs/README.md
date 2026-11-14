# Mero Docs

A document workspace: folders hold rich-text documents that the members of a
workspace edit together, live. A component app on Calimero 1.0: the contract is
on core's component SDK (`calimero-sdk`, `wasm32-wasip2`), local development
runs on `merod local`, and the frontend talks to the local nodes in development
and to Calimero Cloud in production through mero-js's `CalimeroClient`
(`@calimero-apps/connect`). See [`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract (a standalone crate: its own `[workspace]` and `Cargo.lock`) |
| `logic/src/rich.rs` | the text engine: Quill deltas, character ids, anchors and undo tokens on the SDK's Fugue `RichText` |
| `logic/tests/` | `harness.rs` (every method on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`), `guide.rs` (the agent guide's format) |
| `logic/scenarios/` | `docs-lifecycle.json`, `rich-body.json`, `registry.json` (v1's merobox workflows), `access.json` (the node's gate, guests, other members' content); run by `cargo test` and on `merod local` |
| `logic/GUIDE.md` | the agent guide the bundle carries |
| `app/` | Vite + React + BlockNote frontend |
| `mobile/` | native iOS and Android readers, **still v1** (see [Mobile](#mobile)) |

## The model

| | Calimero 1.0 | v1 |
|---|---|---|
| a workspace | an **organization** | a namespace |
| the workspace's registry (managers, tags, saved views) | an instance of this app in the org (team access on Docs' **app team**; org access in a legacy org), its id in the org's metadata (`registryApp`) | the `registry` service's context in the namespace's root group |
| a folder | a **team** of the org; a subfolder a team under it | a subgroup |
| Open / Restricted folder | a team anyone the parent reaches joins (`join: everyone`) / invite-only (`join: invite`) | subgroup visibility `open` / `restricted` |
| a folder's documents | an instance of this app with `team` access, its id in the team's metadata (`docsApp`, beside `color`) | the `docs` service's context in the subgroup |
| folder roles Manager / Editor / Viewer | team row `lead` / `member` / `readOnly` | group role + capabilities |
| member capabilities | org and team capability bits (`ORG_CAPABILITIES`) | v1 `MemberCapabilities` |
| joining | an org invite (`?invite=<token>`, naming the restricted folders' teams), redeemed after a passkey sign-in | a namespace invitation link, then joining each context and waiting for it to sync |
| who you are | an account, signed in with a passkey | a node identity, signed in through the node |
| presence and cursors | the node's presence API (`publishPresence`, `presenceStream`) | ephemeral context messages |
| images | blobs of the folder's documents instance (`uploadBlob`, `downloadBlob`) | context blobs |

The node decides who reaches an instance at all: the org's members reach the
registry; a folder's instance is reached by its team (an open team by everyone
who reaches its parent, a restricted one by its direct rows only). Anyone else is
refused before the contract runs (`404 NOT_FOUND`, `401 UNAUTHENTICATED` when
anonymous). A `readOnly` row reaches the folder but the node refuses every write
(`403`), which is how a Viewer stays read-only. The contract checks the rest,
stated on each method: a document's creator or the folder's moderator (whoever
created the folder's instance) deletes it; a comment is its author's, and the
moderator removes any; only the registry's owner names managers.

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (root Cargo.toml), once: see docs/COMPONENT-APPS.md
pnpm dev:local mero-docs      # merod local + the contract + the app on http://localhost:5173/
meroctl local dev apps/mero-docs  # the same with core's meroctl (1.0.0-rc.24 or later)
```

Sign up with a passkey, create a workspace, a folder in it, and a document. To
try a second person, invite them from the workspace's members panel and open the
link in another browser profile.

## Test it

```bash
cargo fmt --manifest-path apps/mero-docs/logic/Cargo.toml -- --check
cargo clippy --manifest-path apps/mero-docs/logic/Cargo.toml --all-targets -- -D warnings
cargo clippy --manifest-path apps/mero-docs/logic/Cargo.toml --target wasm32-wasip2 -- -D warnings
cargo test --manifest-path apps/mero-docs/logic/Cargo.toml       # harness + scenarios + guide
scripts/component-build.sh apps/mero-docs/logic                        # res/abi.json
pnpm merod-local e2e mero-docs                                   # the scenarios on merod local
pnpm -F mero-docs lint && pnpm -F mero-docs typecheck && pnpm -F mero-docs test && pnpm -F mero-docs build
```

## What changed in the port, and why

### Storage

v1 was a two-service bundle (`docs`, `registry`, and a shared `types` crate). A
component bundle has one service, so the one component carries both method sets
(their names never collided) and the frontend creates two kinds of instance
from it: the registry, and one per folder. Both kinds hold every collection; each
only ever fills its own.

| v1 (`calimero-storage`) | component SDK |
|---|---|
| `docs: UnorderedMap<String, DocRecord>` with `title: FugueText`, `body: RichDocument<DriveMarks>`, `tags: UnorderedSet`, `LwwRegister`s, a hand-written `Mergeable` | `docs: UnorderedMap<String, DocMeta>` (creator, times, last editor, archived); `docTags: Set<(doc, tag)>`; the title a `RichText` named `dt:<doc>` |
| `RichDocument`: a spine of block slots, each block a row with its own rich text | the block order a Fugue `Text` named `do:<doc>`, one character per block; `blocks: UnorderedMap<(doc, block), BlockRow>` (kind, depth, attributes, slot); `slots: UnorderedMap<(doc, slot), block>`; each block's text a `RichText` named `db:<doc>:<block>` |
| `DriveMarks` (`MarkSchema`): growing `bold`, `italic`, `underline`, `strike`, `textColor`, `backgroundColor`; non-growing `link`, `code`, `comment` | the same keys and the same growth, as the `expand` flag of each `RichText` mark (`rich::expands`) |
| `FugueText` / `RichText` deltas, anchors, undo (`DeltaUndo`, `Undo`) | rebuilt on the SDK's `RichText` in `src/rich.rs`: `chars`, `insert_after`, `delete_ids`, `mark_ids` |
| `headers: Moderated<UnorderedMap<String, u64>>` (creator = owner stamp, removable by the founder) | `createdBy` on `DocMeta`; `deleteDoc` checks the caller is the creator or `env::app_owner()` |
| `comments: Moderated<IndexedMap<String, Comment>>` (`#[index] doc_id`) | `comments: UnorderedMap<(doc, comment), CommentRow>` with `author`, `commentDocs: UnorderedMap<comment, doc>`, `commentTotal: Counter` |
| `search_indexes!` + `#[derive(Searchable)]` (the node's full-text index) | not in components at `1.0.0-rc.7`: `searchDocs` reads the folder's text itself (below) |
| registry `owner: Frozen<String>` + `AccessControl` | `env::app_owner()` and `managers: Set<String>` |
| registry `tags: UnorderedMap<String, TagRecord>` (per-field `LwwRegister`, tombstone merged by OR) | `tags: UnorderedMap<String, TagRow>`; the tombstone stays |
| registry `views` + `view_origins: WriteOnce<…>` (first saver) | `views: UnorderedMap<String, ViewRow>` with `createdBy`, kept from the first save |
| `DriveError` (`{kind, data}`) via `app::err!` | `#[app::error] Error { NotFound, Invalid, Forbidden }`, each `{ message }` |
| `tests/collab_convergence.rs`, `Script` merge tests | gone: one leader orders every write; the stale-view cases they guarded are `applyDeltaOn` / anchor tests in `harness.rs` |

The text stays a sequence CRDT (Tree-Fugue, core#4813) because an editor sends
an edit typed against a view a peer has since changed: every character has an
id, an insert names the character it follows, a delete names ids. So the
collaborative editing protocol the web editor speaks (`applyDeltaOn` with a base
text and an anchor, rebase by character ids on a refusal) is unchanged.

### What a client sees

| | v1 | now |
|---|---|---|
| method and argument names | `create_doc`, `include_archived`, `doc_id`, … | the same methods, camelCase: `createDoc`, `includeArchived`, `docId`, … |
| answers | snake_case fields (`created_at`, `can_delete`, `anchor_pos`, `next_cursor`, `created_by`) | camelCase (`createdAt`, `canDelete`, `anchorPos`, `nextCursor`, `createdBy`) |
| timestamps (`createdAt`, `updatedAt`, a comment's `createdAt`) | nanoseconds, JSON numbers | milliseconds (the log entry's time), **decimal strings**; `commentCount` and `searchDocs`' `total` decimal strings too |
| ids | `doc-<nonce>-<account>-<device>`, `cmt-…`, blocks and marks as bs58 borsh | `doc-<16 hex>`, `cmt-<16 hex>`, `blk-<16 hex>`, marks as decimal ids; all still opaque |
| character ids (`ids` runs) | `{replica: <node>, counter, len}` per writer | `{replica: "0", counter, len}`: one leader mints every id |
| anchors and undo tokens | bs58 borsh | `s`, `e`, `a<id>`, `b<id>` / a JSON inverse edit; both still opaque |
| accounts (`createdBy`, `updatedBy`, `author`, managers) | 64-hex node account ids | 1.0 account ids |
| `searchDocs` | the node's full-text index (BM25, snippets from the indexer) | every query word must start a word of the title or body, case-insensitive; a title match scores 2, a body match 1; snippet from the body (else the title), matches in `<b>`; reads the folder's text on each call |
| `searchDocs` on a node with search off | an error, the client fell back to its own text index | always answers |
| `deleteDoc` | removed the header, the record and the comments the deleter could remove | removes the title, every block's text, the tags and all the document's comments |
| who may delete a document or a comment | its creator / author or the founder (who created the folder's context) | its creator / author or `env::app_owner()` (who created the folder's instance) |
| `commentSchemaVersion` | the comment's per-entry schema version | `1` for a live comment, `null` otherwise |
| `listDocs`, `listComments`, `listTags`, `listViews`, `listManagers` order | storage order | key order (document, comment, tag, view id; account) |
| `addManager` | any 32-byte hex key | a member of the organization (`Invalid` otherwise) |
| `removeManager` of a non-manager | a no-op | `NotFound` |
| an op past the end of a text, an undeclared mark key, a malformed token | a storage error string | `Invalid { message }` |
| an unknown document, block, comment, tag or view | `"unknown document '…'"` or `{kind: NotFound}` | `NotFound { message }` |
| a read-only member's write | `ReadOnlyWriteRefused` from v1 core | `403` from the node (the team row is `readOnly`) |
| `passageCount`, positions, `anchorPos` | `usize` numbers | `u32` numbers |
| `getBlockDelta` / `spans` | `{text, attributes}` | the same |
| events | `DocCreated`, …, `MarkApplied { mark_id }` | the same events; `MarkApplied { markId }` |
| a text split or merged, then undone | the moved text kept its v1 ids | the moved text gets new ids (as v1's split did), so an undo token taken before the split no longer covers it |

### Frontend

The screens and components are unchanged; the client layer under them is new.

| v1 | now |
|---|---|
| `MeroProvider`, mero-react hooks, node login, desktop SSO | `src/calimero/session.tsx`: the target from the environment (merod local in `vite`, Cloud in `vite build`), passkey sign-in or sign-up, the stored session (`SessionStore`) |
| admin API (`listGroupMembers`, `createGroupInNamespace`, `createContext`, `addGroupMembers`, …) | `src/calimero/orgs.ts`: the same calls on organizations and teams, read from one `GET /orgs/{org}` snapshot; `src/calimero/react.tsx` has the hooks the screens used, by the same names |
| generated `DocsClient` / `RegistryClient` (abi-codegen) | `MeroDocsClient` (`src/generated/client.ts`), which core's `meroctl app codegen` writes from `logic/res/abi.json` (`pnpm -F mero-docs codegen`; CI fails when it is stale), for both the folder and the registry instances; `src/lib/docsApi.ts` turns its answers into v1's shapes (snake_case, nanoseconds) with `to*`; `src/client.test.ts` checks the class against the ABI |
| SSE subscriptions and ephemeral messages | `src/calimero/live.ts`: one `client.events` stream per instance, and the node's presence API for cursors |
| v1 errors (`RpcError`, `ReadOnlyWriteRefused`) | mero-js 28 typed errors (`src/calimero/errors.ts`); a node `403` on a write is the Read only message |

What a person sees differently:

- **Sign-in** is a passkey (sign in, or sign up with a name). No node URL, Cloud tab or desktop SSO.
- **Membership changes ask for the passkey**: roles and capabilities (twice when both change), adding and removing members, invites, member defaults, deleting or leaving a workspace.
- **Invite links** are org invite tokens (`?invite=<token>&…`), kept through sign-up and redeemed after a confirmation; a folder invite names the folder's team. v1 links no longer work.
- **Docs' app team** (core#4890): Docs reaches its organization only through `@calimero-apps/connect`'s org-app module (`scripts/check-org-app-module.py` fails CI otherwise). A new workspace gets Docs' team, **open** (everyone in the org has Docs); the registry uses team access on it, invites name it (a folder invite names it and the folder's team), and the workspace's member list is its people. App teams (Docs' and other apps') are never listed as folders. Once an admin keeps the org's apps apart in Calimero Home, an invite gives Docs only, **Remove** takes someone out of Docs (its team and their folder rows), and **Leave workspace** leaves Docs only, offering to leave the organization too when Docs was your last app there; in standalone and legacy orgs both are about the organization, as before. Adding Docs to an org whose apps have teams makes its team first (owners and admins only). An org from before app teams stays legacy; under `pnpm dev:local` (a raw bundle, no package) every workspace is legacy.
- **Folders stay their own teams**, not teams under Docs' app team: core rc.14 lets only an app team's leads create teams below it, so a member could no longer make a folder. In an org that keeps its apps apart, an *Open* top-level folder is therefore open to everyone in the organization who reaches it, not only to Docs' people; make a folder Restricted to keep it to the people listed.
- **No sync states**: "syncing from peers", "just joined", "not synced to your node" and their retries are gone; a joined workspace opens at once.
- **Folders**: the workspace list shows the organizations that hold an instance of this app; a Restricted folder you cannot reach is not listed; a folder under a parent you cannot see shows as Shared; members who only inherit an Open folder show as Editor.
- **Removed**: the dev rig panel, the document inspector, `?node=`. The dev server runs on `http://localhost:5173/`.
- Removed with them: Playwright (`e2e/`, both configs), `src/generated`, mero-react, `@calimero-apps/e2e-node`, abi-codegen, `loginPopup`, `components/dev`, `useApplicationId`, `useAppNamespaces`, `useSyncStatus`, `useNamespaceDisplayNames`, `useRegistryClient`, `lib/registryContext`, `lib/redeemInvite`, and the unit tests that only covered them.

### Removed

- `logic/crates/registry`, `logic/crates/types` (folded into the one crate), `logic/res/state-schema.json`, `logic/workflows/` (16 merobox workflows), `logic/tests/collab_convergence.rs`.
- `scripts/` (`local-rig.sh`, `registry-sync.sh`, `sync-wasm.sh`, `setup-cargo-mero.sh`, `on-res-change.mjs`): v1's three-node rig, the local registry sync and the cargo-mero installer. With the installer gone, the repo's `check-cargo-mero-pin.py` (and its test) and their CI steps go too; so do the `cargo test -p mero-docs*` `--ignored` steps and the `Browser E2E rich (mero-docs)` job in `ci.yml`.
- The merobox workflows about namespaces, folder groups, roles, visibility and Read only sweeps (`members`, `namespace-lifecycle`, `open-subgroup`, `restricted-privacy`, `folder-read-only`, `nested-read-only-*`, `open-restricted-collab`, `one-account-two-devices`) tested core v1's group machinery, not this contract. In 1.0 that is the node's team access, which core tests; `access.json` keeps what the contract itself decides.

## Mobile

`mobile/ios` and `mobile/android` are unchanged and remain v1. Their pinned Swift
and Kotlin SDKs (`MeroAppSession`) have no 1.0 client yet, so they work only
against a v1 deployment of the app (see `mobile/README.md`).
`mobile/scripts/regenerate-client.sh` refuses the component ABI so the committed
v1 clients are not overwritten.

## Production

The production frontend is the one the bundle carries (`frontend-dir =
"../app/dist"`): a Cloud node trusts passkey ceremonies only from frontends it
serves from a package. Build it with `VITE_CALIMERO_CLUSTER` and
`VITE_CALIMERO_MIN_RELEASE` set (see `app/.env.example`), then
`meroctl app pack apps/mero-docs/logic --key …`.
