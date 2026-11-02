# MeroPixArt

A collaborative image editor: layers in folders, masks, blend modes, curves,
non-destructive adjustments and free transform, that several people work in at
once. A component app on Calimero 1.0: the contract is on core's component SDK
(`calimero-app-sdk`, `wasm32-wasip2`), local development runs on `merod local`,
and the frontend talks to the local nodes in development and to Calimero Cloud in
production through mero-js's `CalimeroClient` (`@calimero-apps/connect`). See
[`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

| | |
|---|---|
| `logic/` | the contract (a standalone crate: its own `[workspace]` and `Cargo.lock`) |
| `logic/tests/` | `harness.rs` (every method on core's wasmtime engine, `TestApp`), `scenarios.rs` (every `scenarios/*.json`) |
| `logic/scenarios/` | `logic-test.json`, `e2e.json`, `integration.json` (v1's merobox workflows), `access.json` (the org's gate, guests, forged writes, blobs, the wire); run by `cargo test` and on `merod local` |
| `app/` | Vite + React frontend (the editor, its canvas compositor, the showcase documents) |
| `mobile/` | native iOS and Android viewers, **still v1** (see [Mobile](#mobile)) |

## Features

- **Layers & folders** — raster, text and fill layers inside real folders: a collapsible tree in the layers panel, drag-and-drop nesting, renameable, with inherited visibility & opacity. Selecting a folder selects its contents, so dragging it moves the whole group
- **Non-destructive adjustments** — brightness, contrast, saturation, hue, exposure, blur, invert — applied live at composite time via the canvas filter pipeline
- **Curves** — per-channel (RGB / R / G / B) spline editor, applied via a LUT
- **Blend modes** (all 16), per-layer opacity, **layer masks** (paint to hide/reveal)
- **Free transform** — move, scale, rotate, **shear** (skew X/Y), **mirror** (flip H/V) and a **corner-pin warp**, from either the on-canvas gizmo or the numeric Transform panel. Everything stays live transform params until you explicitly bake them with *Apply*
- **Paint tools** — brush, eraser, bucket fill, eyedropper — re-render the raster layer; only the 256 × 256 tiles a stroke touched are uploaded again
- **Image upload** — pixels stored as PNG tiles, each a blob of the project
- **Text layers** with font / size / color / style controls
- **Export** the composited document to PNG, JPG or SVG (downloaded, and kept in the project as a blob); **project gallery** per team
- **Showcase projects** — four complete documents (a product ad, an illustrated landscape, a geometric poster and a transform reference sheet) that load into a project from *File ▸ Open Showcase Project…*, or when you start a new project from one
- **Multi-member projects** — invite teammates to the team with a passkey-approved link
- **Roles checked by the contract** — owner (the document's admin) / editor / viewer (read-only by default)
- **Real-time** — every change is an event the other editors re-read on; live cursors are the node's presence, never written to the document
- Undo / redo, zoom & pan, keyboard shortcuts

> Remaining follow-ups: standalone adjustment layers, a finer warp mesh than four
> corner pins, and per-parent layer ordering. These used to be tracked in
> `TRACKER.md`, whose other 38 items had all shipped without being ticked off —
> so the file said 39 things were outstanding when three were. Removed; the three
> that are real are the ones named here.

### Showcase projects

The gallery in *File ▸ Open Showcase Project…* ships four documents. They are not
bitmaps: each one is a **recipe** — a list of paint operations per layer — rendered
in the browser when you open it (`app/src/showcase/`). That keeps them a few kB in
the bundle, crisp at any canvas size, and readable: you can see that the reflection
in *Sunset Ridge* is the mountain layer again with `flipV` and a gradient mask.

| Project | What it demonstrates |
| --- | --- |
| **Aurora Edition** | Screen-blended gradients, a perspective-warped product card, a live text layer, grain + vignette |
| **Sunset Ridge** | Mirrored reflections (`flipV`), gradient layer masks, non-destructive blur adjustments |
| **Bauhaus Grid** | A warped title, a 22° sheared bar, rotated type, multiply blending |
| **Transform Lab** | The same tile under ten transforms, side by side, with nested folders |

Opening one goes through the same contract calls a person would make by hand
(`updateDocument`, `addLayer`, `updateLayerContent`, `moveLayers`), so every
layer lands in the contract and reaches every other member.

To see them without a cluster: `cd app && pnpm dev`, then open
http://localhost:5173/scripts/showcase-preview.html.

## The model

| | Calimero 1.0 | v1 |
|---|---|---|
| a team | an organization | a namespace |
| a project | an instance of this app in the team's org | a subgroup and its context |
| the project's name and canvas | the instance's name, then the owner's first `updateDocument` | `init(name, description, width, height)` |
| joining | an org invite link (`?invite=<token>`, `&project=<app id>` to land in one project), approved with the inviter's passkey and redeemed after a sign-in | a namespace invitation link, then joining the project's context and waiting for it to sync |
| who you are | an account, signed in with a passkey | a node identity, signed in through the node |
| a layer's pixels | 256 × 256 PNG tiles, each a blob of the instance | one PNG blob per layer, announced to the context |
| live cursors | the node's presence (one entry per device, gone 7 s after its last refresh) | an `Authored` map in the document, written on every move |

Every member of a team (owner, admins, members, guests) reaches every project in
it, including projects made later, and may read it, join its roster and record
an export. Anyone else is refused before the contract runs (`404 NOT_FOUND` for
an outsider, `401 UNAUTHENTICATED` for an anonymous caller). Changing layers takes
the document's **editor** role (granted by its owner) or being its **owner**;
renaming, resizing, roles, handing the document on and clearing it take the owner.

## Architecture

```
mero-pixart/
├── logic/                         the contract (calimero-app-sdk): document, layers, tiles, roster, roles, exports
├── app/                           React + TypeScript + Vite
│   ├── src/api/pixart.ts          the typed contract client and the one adapter to the screens' shapes
│   ├── src/api/tiles.ts           a layer's pixels and mask as 256 × 256 PNG tiles
│   ├── src/api/presence.ts        live cursors on the node's presence channel
│   ├── src/api/teams.ts           teams = orgs, projects = app instances, invites
│   ├── src/session.ts             passkey sign-in/up, the stored session (@calimero-apps/connect)
│   ├── src/utils/transform.ts     one definition of a layer's matrix + warp mesh
│   ├── src/utils/layerTree.ts     the folder tree read off `parentId`
│   └── src/showcase/              the bundled demo documents, as paint recipes
└── mobile/                        native viewers (still v1)
```

The compositor caches each layer's prepared pixels (mask + adjustment filter),
keyed by a signature that deliberately excludes position, rotation and opacity —
so dragging one layer re-prepares only that layer (`utils/compositor.ts`
documents the measurements).

The contract holds **layer records** (kind, `parentId` for folder nesting, the
transform — position, scale, rotation, shear, mirror, corner-pin warp — opacity,
blend mode, adjustments, text properties) and, beside them, each raster layer's
**tiles**: `(layer, plane, tx, ty) → BlobRef`, `plane` the pixels or the mask.
A stroke writes only the tiles it changed: the editor compares each tile of the
layer with what it last loaded or wrote and uploads only the ones that differ
(`app/src/api/tiles.ts`); a tile erased to transparent is removed. A layer loads
its tiles a page at a time. Adjustments are **non-destructive**: stored as
parameters and applied at composite time, never baked into the pixels until an
explicit destructive edit.

## Run it

```bash
rustup target add wasm32-wasip2
# merod at component-core-tag (root Cargo.toml), once: see docs/COMPONENT-APPS.md
pnpm dev:local mero-pixart     # merod local + the contract + the app on http://localhost:5173/
```

Sign up with a passkey, create a team, a project in it, and paint. To try a
second person, open the team's **Invitations** link in another browser profile;
as the project's owner, make them an editor in the project's settings.

### Using the editor

- **Tools** (left rail): move, brush, eraser, bucket, eyedropper, text, transform, hand/zoom — shortcuts `V B E G I T` etc.
- **Layers** (right): a folder tree. Add raster/text/fill layers and folders, drag a row onto a folder to nest it (or onto the strip below the list to lift it out), click a folder's twirl to collapse its contents, double-click a name to rename. ⌘G groups the selection, ⌘⇧G ungroups. Selecting a folder selects everything inside it, so a drag on the canvas moves the group as one.
- **Transform** (right, collapsed by default — open it from its header or *Edit ▸ Transform Numerically…*): numeric position, angle, skew X/Y, mirror and the four warp corner pins, plus presets and *Apply* to bake. With the Transform tool the canvas gizmo does the same thing by hand.
- **Adjustments** (right): brightness/contrast/saturation/hue/exposure/blur/invert sliders + a Curves editor.
- **File menu**: open a showcase project, place an image, export PNG/JPG/SVG. **Top bar**: undo/redo, zoom, invite teammates, settings (roles, rename/resize).

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo fmt --manifest-path apps/mero-pixart/logic/Cargo.toml -- --check
cargo clippy --manifest-path apps/mero-pixart/logic/Cargo.toml --all-targets -- -D warnings
cargo clippy --manifest-path apps/mero-pixart/logic/Cargo.toml --target wasm32-wasip2 -- -D warnings
cargo test --manifest-path apps/mero-pixart/logic/Cargo.toml       # harness + scenarios
cargo run --release --manifest-path $M -- build apps/mero-pixart/logic   # res/abi.json
pnpm merod-local e2e mero-pixart                                   # the scenarios on merod local
pnpm -F mero-pixart lint && pnpm -F mero-pixart typecheck && pnpm -F mero-pixart test && pnpm -F mero-pixart build
```

- **Contract:** `tests/harness.rs` — roles and ownership, the roster, every layer
  method (patches, clamps, the folder tree and its cycle guard, the stack), tiles
  (a stroke writes only its tiles, erasing removes one, shrinking drops those
  outside, masks, paging, unknown blobs), batched `clearLayers`, exports, and the
  access gate (anonymous, outsider, guest, a viewer's forged writes, bad
  arguments, removed methods). The scenarios run the same calls as real accounts
  on `merod local` in CI.
- **Frontend (Vitest):** the adapter against the committed `logic/res/abi.json`
  (`api/pixart.test.ts`: method lists, 64-bit parameters, answer shapes), the tile
  diff (`api/tiles.test.ts`), presence, the screens with a mocked client
  (`App.test.tsx`: sign-in, teams, projects, invitations), and, as before, the
  transform algebra, the folder tree, the compositor, raster pixel math, the
  showcases, the store and the Layers/Transform panels. jsdom ships no 2D canvas,
  so the suite installs a stub (`src/test/canvasStub.ts`) with a real pixel buffer
  behind `getImageData`/`putImageData`.

## What changed in the port, and why

### Storage

| v1 (`calimero-storage`) | component SDK |
|---|---|
| `Ownable<LwwRegister<String>>` name and description, `Ownable<LwwRegister<Option<Canvas>>>` canvas, and their `Frozen` opening values | `document: Cell<Document>` (name, description, width, height, background), written only by the owner |
| the `Ownable` writer set | `owner: Cell<String>`, the app's owner at `init` |
| `PermissionedStorage<IndexedMap<LayerId, Layer>, ProtocolAuthorizer>`, `#[index]` on `parent_id` and `layer_index`, a last-writer-wins `Mergeable` | `layers: Table<LayerRow>`, indexes `stack` (`layerIndex`) and `children` (`parentId`), a count per kind; adjustments and text flattened into the row (a table record's fields are key parts) |
| a raster layer's `blob_id` (one PNG), `mask_blob_id` (one PNG) | `tiles: UnorderedMap<(layer, plane, tx, ty), BlobRef>`, 256 × 256 PNG tiles; the layer keeps `pixelsRev`, `maskRev`, `hasMask` |
| `UserStorage<Member>` | `members: UnorderedMap<account, Member>`, each entry written only by its account (`join`, `updateMemberUsername`) |
| `AccessControl` (admin tier + the `editor` role), projected onto the layers' capability map | `editors: Set<account>`; the admin is the owner |
| `Authored<UnorderedMap<device, CursorState>>` | nothing: cursors are the node's presence |
| (new) | `exports: UnorderedMap<(createdAt, id), Export>` + `exportIds`: exported images, each a blob |
| hand-written `Mergeable` rules, clock tie-breaks, `+1` clock bumps on re-parent and shift | gone: one leader orders every write in one log |

The write rules v1 kept in storage (`Ownable`, the projected role masks,
`UserStorage`, `Authored`) are checks in each method against `env::caller()`
before anything is written: a viewer's layer write is `Forbidden`, a non-owner's
rename, resize, grant, transfer or clear is `Forbidden`, and no method takes the
account it writes for. v1's forged-write tests are the same calls made as another
account (`tests/harness.rs`, `scenarios/e2e.json`, `scenarios/access.json`).

### What a client sees

| | v1 | now |
|---|---|---|
| method and argument names | `update_layer`, `blob_id`, `updated_at`, … | the same methods and arguments, camelCase: `updateLayer`, `blobId`, `updatedAt`, … |
| 64-bit integers | JSON numbers | **decimal strings**, in arguments (`updatedAt`, `timestamp`, `x`, `y`, a new layer's `createdAt`/`updatedAt`/`x`/`y`) and answers (`x`, `y`, `createdAt`, `updatedAt`, `joinedAt`, `pixelsRev`, `maskRev`) |
| `init` | `init(name, description, width, height)` | `init()`: the document starts as `""`, 1280 × 720, transparent; the frontend's first call as owner is `updateDocument(name, description, width, height)` |
| `getLayers`, `getMembers`, `listRoles` | the whole list | one page: `cursor`, `limit` (100 by default, 1,000 at most) in, `{ items, next }` out; the frontend follows `next` |
| a layer's pixels | `blobId` (a PNG blob) on the layer; `updateLayerContent(id, blobId, width, height, updatedAt)` | `pixelsRev` on the layer; `updateLayerContent(id, width, height, tiles, updatedAt)` with only the changed tiles (`[{ tx, ty, blobId \| null }]`, at most 1,024); `getLayerTiles(id, mask, cursor, limit)` reads them |
| a layer's mask | `maskBlobId`; `updateLayerMask(id, maskBlobId \| null, updatedAt)` | `hasMask`, `maskRev`; `updateLayerMask(id, tiles \| null, updatedAt)` |
| `addLayer` | took the whole `Layer`, including `blobId` and `createdBy` | takes the layer as the editor builds it; `blobId`, `createdBy` and the like are ignored (the author is always the caller); `kind` must be one of the five, sides at most 8,192; at most 500 layers (`TooMany`) |
| `updateLayer`, `updateTransform`, `updateAdjustments`, `updateText`, `moveLayer` | a write's `updatedAt` decided a merge | the later write holds; `updatedAt` is stored as given |
| `clearLayers` | cleared in one go | removes layers (with their tiles) until about 4,096 tiles are gone and answers `{ removed, more }`; call again while `more` (the frontend does) |
| `sendToBack` at index 0, `reorderLayers`, `moveLayers` | unbounded | at most 500 layers per call (`Invalid` past it) |
| `grantEditor`, `transferOwnership` | any 64-hex account id | an account of the project's organization (`Invalid` otherwise); a guest counts |
| `transferOwnership` | moved `Ownable` and the admin tier | moves the owner (the admin); the old owner becomes a viewer unless granted |
| `updateCursor`, `getCursors`, `CursorMoved` | document writes and reads | **removed**: cursors are presence (`publishPresence` / `presenceStream`), one per device, never in the log |
| exports | a local download only | also `addExport(blobId, name, format)` (anyone who reaches the project), `getExports(cursor, limit)` newest first, `deleteExport(id)` (its creator or the owner); events `ExportAdded`, `ExportDeleted` |
| blobs | ids any node could announce | a tile or export must name a blob the app holds (`UnknownBlob` otherwise); the node keeps a blob while a tile or an export refers to it |
| errors | `FunctionCallError` with a message string | `422 APP_ERROR`: `Forbidden { message }`, `NotFound { what, id }`, `Invalid { message }`, `UnknownBlob { blobId }`, `TooMany { what, limit }` |
| events | `LayerAdded(id)` etc., to every member of the context | the same names with named fields (`{ id }`, `{ member }`, `{ owner }`, `{}`), to everyone the project reaches (`Audience::All`), guests included; every event carries ids only |
| `getDocument.owner` | the `Ownable` owner, or none | the owner, always set |
| migrations | none | none |

Everything else (`getDocument`'s counts, `getRole`/`myRole`/`canEdit`, a
second `join` changing nothing, skew clamped to ±80°, `""` clearing a warp,
`moveLayers` skipping a move that would close a cycle, a deleted folder's
children moving to the top level, `bringToFront`/`sendToBack`) is as in v1.

### Frontend

- `MeroProvider`, the node login popup, the application-id lookup, the
  namespace / subgroup / context plumbing (`api/teamContexts.ts`,
  `api/selfRole.ts`, `api/loadProject.ts`), mero-react's join-sync banner, the SSE
  hook, mero-platform invitation links (`utils/invitation.ts`), the TEE badge,
  `@calimero-apps/names` and `@calimero-apps/members` are gone. The session is
  `@calimero-apps/connect` (`src/session.ts`, `src/sessionContext.tsx`):
  passkey sign-in/up, the session stored per app and per target.
- `src/api/pixart.ts` is the typed client and the **one adapter**: the screens
  still call `call(app, "get_layers", {})` with v1's names and get v1's shapes
  back (numbers, whole lists, `blobId` / `maskBlobId`, now cache keys naming a
  revision of the layer's tiles). `pixart.test.ts` checks its method lists and
  64-bit parameters against the committed `logic/res/abi.json`.
- `src/api/tiles.ts` replaces "encode the layer as one PNG and upload it": a
  commit uploads only the tiles that changed, a load reads the tile pages and
  draws them.
- `src/api/teams.ts`: teams are orgs (`/me`, `createOrg` with members allowed to
  create projects and invite, `getOrg`, `deleteOrg`, `removeMember`), projects
  are instances (`listApps` by the dev bundle or the package, `createApp(name,
  source, { org })`, `deleteApp`), invitations are org invites (`invite` is a
  passkey step-up). A name set for the whole team is org member metadata
  `{ name }`. Team settings promote, demote and remove members (passkey
  step-ups), and still carry a promotion onto the projects you own as editor
  access.
- v1's "Syncing…" states and the join-and-wait on a project are gone: nothing
  has to replicate before a member can open a project. The editor re-reads on
  the project's events (`client.events`).
- Exports are also kept in the project as blobs (`addExport`).
- The Playwright suites (the mocked editor specs, the journey, the landing spec,
  the landing media capture) and the v1 dev scripts and Makefile (two `merod
  0.x` nodes, merobox workflows) are removed: the end-to-end run is
  `pnpm merod-local e2e mero-pixart`, local development is `pnpm dev:local
  mero-pixart`, and the screens are tested with a mocked client. The landing
  page's recorded demo is kept as it was.

## Mobile

`mobile/ios` and `mobile/android` are **unchanged and still v1**: they are built
on the v1 Swift and Kotlin SDKs (`MeroAppSession`: relay, contexts, namespace
invitations), a client generated from the v1 ABI, and one PNG blob per layer,
and the pinned SDKs have no 1.0 client to port them to yet. They work only
against a v1 deployment of the app until those SDKs speak the 1.0 API.
`mobile/scripts/regenerate-client.sh` refuses the component ABI meanwhile.

## Production

The production frontend is the one bundled into the `.mpk` (`frontend-dir`), so
the cluster serves it from the package's own origin, where passkeys work. Build it
with `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set (see
`app/.env.example`); without them the production build refuses to connect.

The app makes no outbound HTTP calls (it declares no `outbound` prefixes), so an
operator configures no hosts and no secrets for it. Blobs (tiles and exports) are
the cluster's own blob store, per app instance.

## License

[MIT](./LICENSE) © Calimero Network
