# MeroDesign

A collaborative design tool on Calimero. Think Figma, but your design data is
shared only with the people you invite. A component app on Calimero 1.0: the
contract is on core's component SDK (`calimero-app-sdk`, `wasm32-wasip2`), local
development runs on `merod local`, and the frontend talks to the local nodes in
development and to Calimero Cloud in production through mero-js's
`CalimeroClient` (`@calimero-apps/connect`). See
[`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract (a standalone crate: its own `[workspace]` and `Cargo.lock`); `GUIDE.md` is the agent guide the bundle carries |
| `logic/tests/` | `harness.rs` (every method on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`) |
| `logic/scenarios/` | `design.json` (v1's workflow tests), `access.json` (the org's gate, guests, roles, wire checks); run by `cargo test` and on `merod local` |
| `app/` | React + TypeScript + Vite frontend (Fabric.js canvas) |
| `mobile/` | native iOS and Android viewers, **still v1** (see [Mobile](#mobile)) |

## Features

- Infinite canvas with pan and zoom
- Shapes: rectangles, circles, lines, arrows, freehand paths
- Images and SVGs, stored as blobs of the board (see [Images](#images-and-svgs))
- Text elements with font controls
- Teams: invite teammates with a link; every member sees every board in the team
- Export canvas to PNG or SVG
- Screens + presentation mode (Figma-style "Present"), see below
- Live updates from the board's event stream

## The model

| | Calimero 1.0 | v1 |
|---|---|---|
| a team | an organization | a namespace |
| a board | an instance of this app in the team's org | a subgroup and its context |
| joining | an org invite link (`?invite=<token>`), redeemed after a passkey sign-in | a namespace invitation link, then joining each board's context and waiting for it to sync |
| who you are | an account, signed in with a passkey | a node identity, signed in through the node (or the desktop app's SSO) |
| your name in a team | org member metadata `{ name }` | namespace member metadata |

Every member of a team (owner, admins, members, guests) reaches every board in
it, including boards made later. Anyone else is refused before the contract runs
(`404 NOT_FOUND` for an outsider, `401 UNAUTHENTICATED` for an anonymous caller).

## App layout

Every signed-in screen is one frame (`app/src/components/shell/DesignShell.tsx`):

- **Top bar** — team switcher (with "New team" in the menu), the open board's
  name, who is on the board, Present, Invite, the theme switch, and an account
  menu with Team settings and Logout.
- **Boards rail** — the team's boards with live thumbnails, "+" for a new board,
  and each board's ⋯ (Rename, Settings, Delete). A drawer on a phone.
- **Main** — the board, or the team's home grid when no board is open.
- **Settings** — a panel beside the board, addressed by the URL, with Team
  (members, roles, remove, your name) and Board (name, canvas access) sections.

| URL | Screen |
|---|---|
| `/teams` | Resumes the team and board you had open last on this cluster (else the first team) |
| `/teams/:teamId/projects` | The team's home grid (`/teams/:teamId` redirects here) |
| `/teams/:teamId/projects/:boardId` | A board (its app instance id) |
| `/boards/:boardId` | A board, its team looked up |
| `…?settings=team` / `…?settings=board` | Settings open on any of the above |

A new team or board opens as soon as it is created.

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (root Cargo.toml), once: see docs/COMPONENT-APPS.md
pnpm dev:local mero-design     # merod local + the contract + the app on http://localhost:5173/
```

Sign up with a passkey, create a team and a board, and draw. To try a second
person, copy the team's **Invite** link into another browser profile.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
L=apps/mero-design/logic/Cargo.toml
cargo fmt --manifest-path $L -- --check
cargo clippy --manifest-path $L --all-targets -- -D warnings
cargo clippy --manifest-path $L --target wasm32-wasip2 -- -D warnings
cargo test --manifest-path $L                                     # harness + scenarios
cargo run --release --manifest-path $M -- build apps/mero-design/logic   # res/abi.json
pnpm merod-local e2e mero-design                                  # the scenarios on merod local
pnpm -F mero-design lint && pnpm -F mero-design typecheck && pnpm -F mero-design test && pnpm -F mero-design build
```

The landing page's clips (`app/public/landing/*.webm` and their posters) are
committed. They were recorded by a Playwright harness against v1's mocked node,
which the port removed; record new ones by hand if the editor changes.

## Screens and presenting

A **screen** is one slide: a rectangle whose layer name sits in the top-level
`screen` group (`screen/01 Sign in`). Its area is the slide — everything painted
inside it is shown, clipped at its edge, exactly like a Figma frame.

- **Make one:** select the layers that belong together, open the **Screens** tab
  and choose **Create screen from selection**. A backdrop sized to the selection
  is added behind it. Select a single rectangle instead and that rectangle
  becomes the screen.
- **Present:** **▶ Present** in the toolbar (or the Screens tab) plays the
  screens, starting from the one the selection is on.
- **Order:** screens play in reading order — left to right, then top to bottom —
  until you **drag them into a different order** in the Screens tab (or use
  *Move up / Move down* in a row's ⋯ menu, or Alt+↑/↓ on a focused row). A
  reordered screen carries its place on the end of its name
  (`screen/Pricing @3`); the suffix is hidden in the UI and survives a rename.
- **Navigate:** → / Space / PageDown forward, ← / Shift+Space / PageUp back,
  Home / End, F for full screen, Esc to leave. **All screens** shows a filmstrip.
- **Long screens scroll:** a screen much taller than the window is shown at a
  readable width and scrolls; Space pages through it before moving on. Zoom
  can also be set to *Fill width* or *100%*.

Screens ride the element `label` like groups do, so there is no contract change:
every member sees the same screens and the same order, and the web design
starter (whose five screens were already labelled this way) presents out of the
box.

## Undo and redo

Undo (Ctrl/⌘+Z) and redo (Ctrl/⌘+Shift+Z or Ctrl+Y) take back **your own**
steps, and write the result to the node, so every member sees it. A step records
only the elements you changed (as they were before, and as you left them), and
undoing it writes back only the fields you changed: a teammate's shape, or their
recolour of a shape you then moved, survives your undo. A shape a teammate has
deleted since stays deleted. See `app/src/store/history.ts`.

## Lock and hide

Each row in the **Layers** tab has a padlock and an eye; on a group row they
act on every layer in it. **Shift+⌘/Ctrl+L** locks and **Shift+⌘/Ctrl+H**
hides the selection, and pressing again reverses it.

- **Hidden** layers are not painted, cannot be clicked, and are left out of
  every export (PNG, SVG, a group's export, a merge into one image, the HTML
  code export, project thumbnails) and of presenting. A hidden screen is not
  presented.
- **Locked** layers are painted and exported, but the canvas will not select,
  move, resize or delete them (a marquee skips them too). Select one in the
  Layers tab to unlock it. A lock is a convenience, not a permission: any
  editor can unlock.

Both are synced to every member and are undoable. Like stroke style, groups and
screens, they ride the element's `label` (`app/src/utils/elementMeta.ts`)
rather than contract fields: adding a field to the Borsh-stored `Element` would
need a migration of every element on every board. So there is no contract
change, and a board saved before this feature loads with everything unlocked
and shown.

## Starter projects

**Options → Starter projects** loads one into the board (an admin action; an
occupied board asks once before it is replaced):

- **Web design** — five app screens and a design system (`scripts/build-starter.mjs`).
- **Presentation** — an 8-slide deck about Calimero, one of them a tall
  scrolling screen; press **▶ Present** (`scripts/build-starter-presentation.mjs`).

`pnpm starter` regenerates both into `app/src/starter/`. The
presentation reads the live board, so a teammate's edit lands on the slide
being shown.

## What changed in the port, and why

### Storage

| v1 (`calimero-storage`) | component SDK |
|---|---|
| `PermissionedStorage<IndexedMap<ElementId, Element>>`, `#[index] layer_index`, whole-record LWW by `updatedAt` | `elements: Table<Element>`: one row per element keyed by its id, the paint order its stored `layerIndex`, read through the table's `paint` index; `elementCount: Counter` beside it; the later write wins |
| `UserStorage<Member>` with a dedicated merge clock | `members: UnorderedMap<account, Member>`, written only for the caller |
| `PermissionedStorage<UnorderedMap<CommentId, Comment>>` | `comments: UnorderedMap<id, StoredComment>` (the comment without its thread) |
| `PermissionedStorage<SortedMap<"{comment}/{created_at:020}/{reply}", CommentReply>>` | `replies: UnorderedMap<(comment, createdAt, reply), CommentReply>`, one row per reply; `replyCounts: UnorderedMap<comment, u64>` bounds a thread at 200 |
| `Authored<UnorderedMap<device, CursorState>>` | `cursors: UnorderedMap<account, CursorState>` |
| `Ownable<LwwRegister<String>>` name and description, `Frozen` init values | `name`, `description`, `owner: Cell<String>` |
| `AccessControl` (admin tier + the `editor` role), projected onto the writer sets | `admins`, `editors: Set<account>`, checked in each method |
| an image's `blobId: String`, `blob_announce_to_context` | `blobId: Option<BlobRef>`: the node keeps the blob while an element refers to it |

No stored value holds a list that grows: every element, comment, reply and
pointer is its own row, and every read of a collection is a page or a bounded
walk of an index.

The write rules v1 enforced at merge on every node are checks in each method
against `env::caller()`: only an editor (or admin) changes the canvas and
comments, only an admin grants roles and clears the board, only the owner
renames it or hands it on (`Forbidden` otherwise). v1's forged-write tests are
the same calls made as another account (`tests/harness.rs`,
`scenarios/access.json`).

### What a client sees

| | v1 | now |
|---|---|---|
| method names | `add_element`, `get_elements`, … | the same 37 methods, camelCase: `addElement`, `getElements`, … |
| argument names | snake_case (`updated_at`, `stroke_width`, `comment_id`, `new_owner`) | camelCase (`updatedAt`, `strokeWidth`, `commentId`, `newOwner`) |
| 64-bit arguments (`timestamp`, `updatedAt`, `createdAt`, and `x`/`y` of `updateElement`, `addComment`, `updateCursor`) | JSON numbers | **decimal strings** (`"1727000010000"`) |
| an `Element` (in `addElement(s)` and in every answer) | v1's JSON | v1's JSON except its 64-bit fields `x`, `y`, `createdAt`, `updatedAt`, which are **decimal strings** (it is a table record, D20); `cornerRadius` is `null` rather than absent when unset; `blobId` is absent, never `""`, while an image has no blob |
| other answers (`Member`, `Comment`, `CursorState`, `BoardInfo`, `MemberRole`) | v1's JSON | **unchanged**, numbers included: they are plain serde types, which the SDK does not rewrite. `ElementPatch` and `LabelUpdate` inside the batch calls keep v1's snake_case fields too |
| `init` | `{ name, description }` | no arguments; the board's name is the app instance's, and the creator sets it on the board with `updateBoard` right after creating it |
| `getBoard.name` | the init name until the owner renamed it | `""` until the owner set one (the client then shows the instance's name) |
| `getElements` | the whole board, a list | **one page**: `getElements(cursor, limit)` answers `{ items, next }` in paint order, `limit` 500 by default and at most 1,000; the web client follows `next` |
| `getComments` | every comment, a list | **one page**: `getComments(cursor, limit)` answers `{ items, next }`, at most 100 comments, each with its whole thread |
| `addReply` | any number of replies | at most 200 per thread (`Invalid`); deleting one makes room |
| `clearElements`, `clearComments` | everything in one call, `null` | at most 1,000 rows per call; answers how many are left (`"0"` when done). The web client calls until `"0"` |
| `getMembers`, `listRoles`, `getCursors` | everything | at most 1,000 each (bounded by the team's size) |
| `getElementsByIds` | any number of ids | at most 1,000 (`Invalid`) |
| who edits | board admins and explicit editors | the same, plus every **owner and admin of the team's org** (v1's web client granted that board by board on promotion and revoked it on demotion; the contract reads org roles now) |
| `grantEditor`, `transferOwnership` | any 64-hex account id | an account of the board's org, or the app's owner (`Invalid` otherwise) |
| `getRole` | an id that is not 64 hex is a viewer | anything that names nobody with a grant is a viewer |
| ownership | the board's creator | the app instance's owner at `init`; `transferOwnership` moves the board's owner and admin role, not the instance (its creator, or a team admin, still deletes it) |
| pointers | one per device; `identity` the device key | one per account; `identity` = `account` |
| blobs | `addElement` announced any blob id to the context | the element holds a `BlobRef`; a blob this board does not hold is refused, the whole call with it (see [Images](#images-and-svgs)) |
| concurrent edits | merged per record by `updatedAt`, the larger wins | one log orders every write; the later one wins whatever its `updatedAt` |
| errors | `FunctionCallError` with a message string | `422 APP_ERROR`: `Forbidden { message }`, `Invalid { message }` (the messages are v1's) |
| events | tuple payloads (`ElementAdded("id")`, `ElementsAdded(["a","b"])`, `LayerReordered()`) | the same event names with named fields: `{ id }`, `{ ids }`, `{ member }`, `{ identity }`, `{}` |
| `#[app::destructive]`, `#[app::idempotent]` | method hints | not in the component SDK |
| migrations | none | none |

### Images and SVGs

An image or SVG is a blob of the board's app instance, and the element holds it
as a `BlobRef` (core 1.0.0-rc.8, core#4815):

- the frontend uploads the bytes to the board's instance (`client.uploadBlob`,
  `POST /apps/{app}/blobs`) and sends the blob's id (its SHA-256, 64 hex) as
  `blobId`; members read it with `client.downloadBlob`;
- the node keeps a blob while an element refers to it, and forgets it once
  nothing does (deleting the last image of it, or clearing the board);
- a `blobId` the board does not hold is refused by the node (the run traps
  `HostDenied` and nothing is written). So when an element brings a blob from
  elsewhere (a paste from another board, a `.merodesign` project file), the web
  client uploads this browser's copy of the bytes first (the same bytes give the
  same id). One it has no copy of is added without its blob and shows the
  "unavailable" placeholder, rather than the whole batch failing.

No outbound host or secret is needed: the app makes no HTTP requests, cross-app
calls or actions (v1 had none to port).

### Not ported, and why

Nothing the v1 app did is missing. v1 had no event handlers, TEE methods,
private storage or migrations; its CRDT types (`LwwRegister`, the per-record
LWW merge, `Mergeable` on `Member`) became plain rows, because one log orders
every write.

### Frontend

- `MeroProvider`, the node login popup and desktop SSO, `useApplicationId`,
  mero-platform deep links and invitation codecs, `@calimero-apps/names`, the
  namespace / subgroup / context plumbing (`teamContexts.ts`, `appId.ts`) and
  the SSE client are gone. The session is `@calimero-apps/connect`
  (`src/session.ts`, `src/sessionContext.tsx`): passkey sign-in and sign-up, the
  session stored per app and per target. The rest of the app reaches the client
  through `src/api/client.ts`, as it reached v1's.
- `src/api/meroDesign.ts` is the **one adapter**: the screens still call
  `rpcCall(board, "update_element", { …, updated_at })` with v1's names, and it
  renames methods and arguments, turns 64-bit arguments into strings, and
  converts an element's 64-bit fields both ways. `rpc.ts` follows the paged
  reads' `next`, runs the chunked clears to `"0"`, and uploads a pasted
  image's blob to the board first. `meroDesign.test.ts` checks the adapter
  against the committed `logic/res/abi.json`.
- `src/api/rpc.ts` maps teams to orgs (`/me`, `createOrg` + member defaults,
  `deleteOrg`, `removeMember`, `setMember`, `invite` / `redeemInvite`, all but
  `/me` and `redeemInvite` passkey step-ups), boards to instances (`listApps` by
  the dev bundle or the package, `createApp(name, source, { org })`,
  `deleteApp`), and names to org member metadata (`src/api/names.ts`).
- Live updates are the instance's event stream (`client.events`), started after
  the entry the page last read; a dropped stream reconnects and re-reads the board.
- Gone with v1's plumbing: "Syncing…" while a joined team or board replicated,
  the TEE badge, "Leave" for a board's subgroup. The invite dialog mints a link
  on a click ("Create link"), because minting asks for your passkey. Deleting a
  team is its owner's, for everyone; renaming a board is its owner's.
- The Playwright suites (e2e, journey, landing media) and `scripts/` (v1's local
  dev nodes) are removed: the end-to-end run is
  `pnpm merod-local e2e mero-design`, and the screens are tested with a mocked
  client (`App.test.tsx`).

## Mobile

`mobile/ios` and `mobile/android` are **unchanged and still v1**: they are built
on the v1 Swift and Kotlin SDKs and a client generated from the v1 ABI, and the
pinned SDKs have no 1.0 client to port them to yet. They work only against a v1
deployment of the app until those SDKs speak the 1.0 API. Do not run
`mobile/scripts/regenerate-client.sh` until then.

## Production

The production frontend is the one bundled into the `.mpk` (`frontend-dir`), so
the cluster serves it from the package's own origin, where passkeys work. Build it
with `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set (see
`app/.env.example`); without them the production build refuses to connect.

## License

MIT OR Apache-2.0
