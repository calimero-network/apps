# MeroPixArt

A collaborative image editor on Calimero 1.0. Think Photoshop / Photopea, but your project lives on attested Calimero nodes that only the people in your team reach.

A **component app**: the contract is on core's component SDK (`calimero-sdk`, a `calimero:app` component on the node's wasmtime runtime), developed on `merod local`, and the frontend talks to a Calimero Cloud cluster in production (the local nodes in development) through mero-js's `CalimeroClient`. See [`docs/COMPONENT-APPS.md`](../../docs/COMPONENT-APPS.md).

## Features

- **Layers & folders** — raster, text and fill layers inside real folders: a collapsible tree in the layers panel, drag-and-drop nesting, renameable, with inherited visibility & opacity. Selecting a folder selects its contents, so dragging it moves the whole group
- **Non-destructive adjustments** — brightness, contrast, saturation, hue, exposure, blur, invert — applied live at composite time via the canvas filter pipeline
- **Curves** — per-channel (RGB / R / G / B) spline editor, applied via a LUT
- **Blend modes** (all 16), per-layer opacity, **layer masks** (paint to hide/reveal)
- **Free transform** — move, scale, rotate, **shear** (skew X/Y), **mirror** (flip H/V) and a **corner-pin warp**, from either the on-canvas gizmo or the numeric Transform panel. Everything stays live transform params until you explicitly bake them with *Apply*
- **Paint tools** — brush, eraser, bucket fill, eyedropper — re-render the raster layer to a new PNG blob
- **Image upload** — pixels stored as PNG blobs of the document (`POST /apps/{app}/blobs`); a layer names its blob by id
- **Text layers** with font / size / color / style controls
- **Export** the composited document to PNG or JPG; **project gallery** per team
- **Showcase projects** — four complete documents (a product ad, an illustrated landscape, a geometric poster and a transform reference sheet) that load into a project from *File ▸ Open Showcase Project…*, or when you start a new project from one
- **Multi-member projects** — invite teammates with a team (org) invite link
- **Roles** — the document's owner, editors and viewers (read-only by default); the team's owner and admins always edit
- **Live updates & cursors** over the app's event stream
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
(`update_document`, `add_layer`, `update_layer_content`, `move_layers`), so every
layer lands in the contract and reaches every other member.

To see them without a cluster:

```bash
cd app && pnpm dev
# then open http://localhost:5173/scripts/showcase-preview.html
```


## Mero Pixart's app team

An organization can hold several apps, each with its own **app team**
(core#4890; see Calimero Home's README). Mero Pixart reaches its organization only
through `@calimero-apps/connect`'s org-app module
(`scripts/check-org-app-module.py` fails CI otherwise):

- A new organization made here gets Mero Pixart's team at once, **open**
  (`standalone`: everyone in the org has the app). New projects use
  `{ kind: "team" }` access on it, invites name it (`appInvite`), and the
  people shown are its people (`appPeople`).
- Once an admin keeps the org's apps apart in Calimero Home (`shared`), an
  invite gives Mero Pixart only (the dialog says so) and only its people are shown.
  **Remove** and **Leave** take someone out of Mero Pixart, never out of the
  organization (leaving the last app there offers the org too); in open and
  legacy orgs both are about the org, as before.
- Adding Mero Pixart to an organization whose apps have teams makes its team
  first: owners and admins only (anyone else is told so), open in an open org
  and closed in one that keeps its apps apart.
- An organization from before app teams stays **legacy** (organization
  access, org-wide invites). Under `pnpm dev:local` the app runs from a raw
  bundle, which has no package, so every organization is legacy there.

## Layout

```
mero-pixart/
├── logic/                 the contract: a standalone component crate (wasm32-wasip2)
│   ├── src/lib.rs         document, layers, blob ids, roster, roles, cursors
│   ├── tests/harness.rs   TestApp: the built component on core's wasmtime engine
│   ├── tests/scenarios.rs every scenarios/*.json in the harness
│   ├── scenarios/         neutral steps, run by cargo test AND on merod local
│   └── res/abi.json       the component's ABI, committed, diffed in CI
├── app/                   Vite + React; CalimeroClient through @calimero-apps/connect
│   ├── src/generated/     MeroPixartClient: `meroctl app codegen` from logic/res/abi.json (`pnpm -F mero-pixart codegen`)
│   └── src/api/           session, teams (orgs), pixart.ts (the transport: refusals in v1's words), useApi
└── mobile/                native iOS / Android viewers, still on the v1 contract (see mobile/README.md)
```

## Run it

```bash
# merod at component-core-tag (Linux), once: see docs/COMPONENT-APPS.md
pnpm dev:local mero-pixart         # merod local, build + deploy, the app on http://localhost:5173
meroctl local dev apps/mero-pixart # the same with core's meroctl (1.0.0-rc.24 or later)
```

Sign up with a passkey, create a team, then a project. To try collaboration,
open an invitation link (*Projects ▸ Invitations*, or *Invite* in the editor) in
a second browser profile and sign up there.

## Commands

```bash
cargo test --manifest-path apps/mero-pixart/logic/Cargo.toml                 # harness + scenarios
scripts/component-build.sh apps/mero-pixart/logic                             # res/abi.json
meroctl app pack apps/mero-pixart/logic                                       # logic/dist/*.mpk, dev-signed
pnpm merod-local e2e mero-pixart                                              # scenarios on merod local
pnpm -F mero-pixart lint typecheck test build
```

## Production

The production frontend is the one packed into the bundle (`frontend-dir`), served
by the cluster from the package's own origin, and built with `VITE_CALIMERO_CLUSTER`
and `VITE_CALIMERO_MIN_RELEASE` (see `app/.env.example`). Projects are created from
the package `com.calimero.mero-pixart`.

## Data model

A **team** is a Calimero organization; a **project** is an instance of this app in
the team's org, holding one document. Who reaches a project is the org's business:
an account outside the team is refused by the node before the contract runs.

| state | what |
|---|---|
| `document: Cell<Document>` | name, description, canvas size, background, owner |
| `editors: Set<account>` | who the owner made an editor |
| `layers: UnorderedMap<id, Layer>` | every layer, at most 1,000; pixels and masks are blob ids |
| `members: UnorderedMap<account, Member>` | the roster (name, avatar, joined) |
| `cursors: UnorderedMap<account, CursorState>` | one pointer per person |

Pixels never enter the state: the frontend uploads each PNG to the document
(`client.uploadBlob(app, bytes)`) and stores the answer's 64-hex `id` in the layer.

## What changed in the port

| | v1 (calimero-sdk 0.12, merobox, MeroJs) | component (calimero-sdk 1.0.0-rc.7) |
|---|---|---|
| methods | snake_case (`update_layer`) | camelCase on the wire (`updateLayer`), same arguments in camelCase; the screens call the generated `MeroPixartClient` (`api.app(doc).updateLayer({ … })`) |
| 64-bit arguments | JSON numbers | `u64`/`i64` arguments (`updatedAt`, `timestamp`, `x`, `y`) are decimal strings. Integers inside records (a `Layer`, a `Member`, a cursor) stay numbers |
| reads | every method is a JSON-RPC call | the reads are views (`getDocument`, `getLayers`, `getLayer`, `getMembers`, `getCursors`, `getRole`, `myRole`, `canEdit`, `listRoles`) |
| errors | a message string | `ViewOnly`, `OwnerOnly`, `Invalid { message }`; a call before sign-in is the node's `401`, an outsider's its `404` |
| events | tuple variants (`LayerAdded("id")`) | named fields: `LayerAdded { id }`, `LayerUpdated { id }`, `LayerDeleted { id }`, `LayersReordered {}`, `MemberJoined { member }`, `MemberUsernameUpdated { member }`, `DocumentUpdated {}`, `CursorMoved { identity }`, `RoleUpdated { member }`, `OwnerTransferred { member }` |
| `init` | `init(name, description, width, height)` as context init params | the same, as `createApp`'s `initArgs`; every one optional (`"Untitled"`, 1280 × 720) |
| document owner | `Ownable` cells + `Frozen` initial values; admin tier of `AccessControl` | `document.owner`; admin == owner, as in v1 (only a transfer ever changed the admin tier) |
| editors | `AccessControl` role projected onto the layer map, enforced on merge | `editors: Set`, checked in every layer write. **New:** the team's (org's) owner and admins always edit, so v1's frontend step that granted them the editor role document by document is gone |
| grants and transfers | any 64-hex account id | an account the team holds (any org role, guests included); anything else is `Invalid` |
| `transferOwnership` | the previous owner lost admin and kept nothing | the previous owner becomes an editor |
| layers | `IndexedMap` with indexes on `parent_id`, `layer_index`, merged last-writer-wins on `updated_at` | a map of at most 1,000 layers (`addLayer` refuses more), read in one page and ordered by `(layerIndex, id)`. One log orders every write, so the **later call wins** whatever `updatedAt` it carries; `updatedAt` is stored as given |
| blob ids | base58 `BlobId`, announced to the context (`blob_announce_to_context`) | the 64-hex id `uploadBlob` answers (`id`); anything else is `Invalid`. No announce: an upload makes the blob the document's on every node |
| `join` / `updateMemberUsername` | any username | trimmed, 1 to 64 characters (`Invalid` otherwise) |
| cursors | keyed by device (two windows, two pointers) | keyed by account (one pointer per person); `identity` and `account` are both the account |
| `clearLayers` | admin only | owner only (the same person) |
| teams / projects | namespaces / subgroups each holding one context, joined and synced per node | orgs / app instances (`createOrg`, `createApp(name, source, { org, initArgs })`, `listApps`); nothing to join or sync |
| invitations | signed namespace invitations in a deflate+base58 link, desktop deep links | org invite tokens in `?invite=` (a passkey step-up to make, redeemed after sign-in) |
| sign-in | node URL / Cloud wallet, desktop SSO | passkeys (`signUp`/`signIn`), one target fixed at build |
| a person's name | namespace member metadata (`@calimero-apps/names`) | org member metadata (`setMemberMetadata`), shared by every app on the team |
| delete a project | delete the subgroup and context (team admins, subgroup admins) | `deleteApp` (its creator, or a team owner or admin) |

**Blobs on rc.7.** Component blobs are core#4815, which landed on core's master
after the `1.0.0-rc.7` tag. A node at rc.7 answers a component app's blob routes
with `409 NOT_SUPPORTED`, so on `merod local` at the pinned tag a raster layer's
pixels cannot be uploaded yet (text, fill, group and adjustment layers, and
everything else, work). The frontend already uses the blob routes #4815 serves.
When `component-core-tag` moves to a release with #4815, `Layer.blobId` and
`maskBlobId` should become `BlobRef`s (the SDK type #4815 adds): a blob that no
stored `BlobRef` refers to is forgotten after an hour, and a string id is not a
reference.

Removed: the merobox workflows (`logic/workflows/`, now `scenarios/`), the
`TestHost` unit tests (ported into `tests/harness.rs`), `res/state-schema.json`,
`calimero.json`, the Makefile and `scripts/` (merobox / merod 0.x dev nodes), the
Playwright suites (they drove a mocked or real v1 node), mero-react /
mero-platform / `@calimero-apps/names` / e2e-node, the namespace invitation codec,
desktop SSO, the join-sync gate and the subgroup walk.

## License

[MIT](./LICENSE) © Calimero Network
