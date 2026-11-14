# Mero Models

A Blender-style 3D modeller where the scene belongs to the people building it.

A scene is a Calimero app instance in a studio (an organization): objects,
meshes, materials and lights that everyone in the studio can open. Everyone in
the scene sees every change as it lands, sees what the others have selected and
where they are looking from, and the scene's admin decides who may edit —
enforced by the contract. It runs on core's component runtime (Calimero 1.0):
`calimero-sdk`, `merod local` in development, mero-js `CalimeroClient`.

```
apps/mero-models/
├── logic/                     Rust → wasm32-wasip2: a `calimero:app` component, its own workspace
│   ├── src/lib.rs             #[app::state] objects, mesh/texture refs, history, check-outs, roles
│   ├── src/blob.rs            BlobRef: a blob reference stored the way core counts references
│   ├── tests/harness.rs       TestApp on core's engine: every method, role and limit
│   ├── tests/scenarios.rs     every scenarios/*.json in the harness
│   ├── scenarios/             neutral steps, also run on merod local (`pnpm merod-local e2e`)
│   └── res/abi.json           the component's ABI, emitted by `tools/component-bundle`'s `build`
└── app/                       Vite + React + TypeScript + three.js
    ├── src/editor/            the modeller: no React in here except hooks.ts
    │   ├── model.ts           kinds, limits, hierarchy rules (mirrors the contract)
    │   ├── geometry.ts        typed-array triangle meshes with UVs: import, decimate, the draw path
    │   ├── poly.ts            the polygon cage: quads/n-gons, a UV per face corner, hard edges
    │   ├── polyops.ts         the modelling tools: loop cut, bevel, inset, extrude, bridge, knife…
    │   ├── modifiers.ts       the modifier stack: mirror, subdivision surface, array, solidify
    │   ├── polymesh.ts        cage ⇄ triangles: triangulate, split hard edges, recover quads
    │   ├── uv.ts              UV seams, conformal (LSCM) unwrap, smart project, island packing
    │   ├── bake.ts            texture baking: AO (ray traced, own BVH), edge/cavity masks, high→low normals
    │   ├── texgen.ts          smart materials: layered masks → base colour, ORM and normal textures
    │   ├── texturing.ts       bake → generate → upload as texture assets → plug into the material
    │   ├── png.ts             a deterministic PNG encoder for generated textures
    │   ├── lod.ts             LODs: quadric edge collapse that slides along seams but never tears them
    │   ├── collision.ts       convex-hull and box colliders
    │   ├── validate.ts        budget and import checks: triangles, texture memory, UVs, scale, edges
    │   ├── fbx.ts             a binary FBX 7.4 writer (read back by three.js's FBX loader in tests)
    │   ├── gameexport.ts      game export: per-engine naming, LOD chain, colliders, FBX zip or GLB
    │   ├── examples.ts        example assets, each built step by step with those tools
    │   ├── meshcodec.ts       the mesh blob format: compressed, deterministic, validated on read
    │   ├── blobs.ts           the scene's blobs through CalimeroClient, IndexedDB-cached by blob id
    │   ├── textures.ts        blob → image → three.js texture, per colour space
    │   ├── store.ts           zustand store: the scene, selection, undo/redo
    │   ├── sync.ts            optimistic writes, the outbox, read-back without flicker
    │   ├── viewport.ts        three.js: rendering, picking, gizmo, edit mode, peers
    │   ├── commands.ts        every menu item and shortcut, as one undoable change each
    │   ├── io.ts              OBJ/STL/glTF import, glTF/OBJ/STL/JSON export
    │   └── hooks.ts           sync, join, the event stream and presence, as React hooks
    ├── src/studio/            the panels: menu bar, toolbar, outliner, properties, share
    ├── src/generated/         MeroModelsClient: `meroctl app codegen` from res/abi.json (committed)
    ├── src/meroModels.ts      v1's answer shapes, and `u64` for the contract's u64 arguments
    ├── src/session.ts         target → client → passkey sign-in/up, the stored session
    ├── src/scenes.ts          scenes (app instances) in studios (orgs), invitations
    └── src/StudioPage.tsx     sign in, pick a scene, open the studio
```

## Run it

```bash
pnpm install
pnpm dev:local mero-models     # merod local + build + deploy + the Vite dev server on :5173
meroctl local dev apps/mero-models  # the same with core's meroctl (1.0.0-rc.24 or later)
```

Sign up in the browser with a passkey and press **New scene**: that creates a
studio (an organization) and the scene in it, with you as its admin. **Share**
mints an invite link to the studio (approved with your passkey); tick **Can
edit** beside someone to let them build. A second browser profile (another
passkey account) opens the link, signs in and sees every scene in the studio.

**Meshes and textures need core after `1.0.0-rc.7`.** They are the scene's
blobs, and component apps got blobs in core #4815, which landed after the
`1.0.0-rc.7` tag this repo pins (`component-core-tag`). On an rc.7 node the
blob routes answer `409 NOT_SUPPORTED`, so primitives, materials, lights,
hierarchy, check-outs and roles work, and saving a mesh or a texture does not.
See [Blobs](#blobs-and-large-models).

## Using it

| | |
| --- | --- |
| **Navigate** | left-drag orbits (middle-drag with the Select tool), right-drag pans, scroll zooms; the axis gizmo top-right snaps to a view |
| **Add** | `Shift+A`, the Add menu, or the toolbar: cube, UV/ico sphere, cylinder, cone, torus, plane, capsule, point/spot/sun lights, empty |
| **Transform** | `G` move · `R` rotate · `S` scale · `W` box select; hold `Ctrl` to snap; Global/Local space; numbers in Properties scrub when dragged and take arithmetic when typed |
| **Edit** | `Shift+D` duplicate · `X`/`Delete` delete · `H` hide, `Alt+H` show · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · Array… |
| **Hierarchy** | drag rows in the outliner · `Ctrl+G` group · `Ctrl+P` parent to active · `Alt+P` clear parent |
| **Object** | subdivide, smooth, decimate, flip normals, `Ctrl+J` join, `Ctrl+A` apply transforms, origin to geometry, mirror; a **modifier stack** per mesh in Properties (mirror, subdivision surface, array, solidify), saved with the mesh |
| **Edit mode** | `Tab` (converts a primitive to a cage of quads) · `1`/`2`/`3` vertex/edge/face select · `Alt`-click an edge for its loop, `Ctrl+Alt`-click for its ring (a face loop in face mode) · `Ctrl+L` linked · X-mirror moves |
| **Modelling** | `E` extrude (faces along normals, or an open border outward) · `I` inset · `Ctrl+B` bevel · `Ctrl+R` loop cut · `K` knife plane · `J` connect · bridge edge loops · `F` fill · `M` merge · `Ctrl+X` dissolve · smooth, subdivide, symmetrize · mark/clear sharp, sharp by angle · `X` delete. The panel bottom-left adjusts the last tool (width, cuts, thickness…) after the fact |
| **UVs** | Mark seams on edges (they draw red) and `U` unwrap — each piece is flattened conformally and the islands are packed into the 0–1 square at one texel density; or Smart project, which needs no seams. The **UV** button opens the UV editor: click an island to select it (Ctrl for one face), drag to move, box-select on empty space, rotate/flip/scale, Stretch colours faces by distortion, and the footer gives islands, px/m for a 512–4096 texture and coverage. **Checker** puts a numbered UV grid on every mesh |
| **Texturing** | Properties → Texturing: pick a smart material (worn painted metal, rusted iron, scuffed plastic, gun metal, gold, rubber, concrete, mossy stone, bark, foliage), tune its layers, and **Bake & texture**. It bakes occlusion, worn edges and cavities into the UV space, paints the layers through those masks, and uploads base colour, occlusion·roughness·metal and normal textures as the scene's assets — regenerating is a new version of the same three. Normals can come from the mesh's own subdivision (which is then switched off) or from a selected high-poly. With several objects selected each gets its own suggested material |
| **Examples** | Add → Examples: a sci-fi crate, a fuel drum, a sword, a modular corridor kit, a rock and tree — or all of them on one floor. Each is an ordinary editable cage, built by the same tools (`examples.ts` reads as the recipe) |
| **View** | `F` frame selected · `Home` frame all · `1`/`3`/`7` front/right/top (`Shift` for the opposite) · `5` ortho · `Z` cycles wireframe/solid/material |
| **Files** | import OBJ, STL, glTF/GLB, or a scene `.json`; export GLB, OBJ, STL or scene `.json`; `F12` renders a PNG |
| **Game export** | File → Game export… takes the selection (or the scene) to an engine: LOD 0 plus up to three levels of detail, a convex-hull or box collider, named the way Unreal (`SM_`, `_LOD1`, `UCX_…_00`), Unity (`_LOD0…`, `_Collider`) or Godot (`-colonly`) picks them up, as FBX zipped with its textures and a report, or as one GLB. Before it goes it checks the asset against a budget (hero, prop, background, mobile): triangles, BC7 texture memory, oversized or non-power-of-two textures, missing, overlapping or mirrored UVs, unapplied scale, non-manifold edges, n-gons |

## How it stores a scene

| field | collection | why |
| --- | --- | --- |
| `objects` | `UnorderedMap<id, SceneObject>` | one record per object; a later write replaces it whole |
| `meshes` | `UnorderedMap<id, MeshRow>` | the blob holding each mesh's vertices — a `BlobRef`, size, counts, author, note |
| `textures` | `UnorderedMap<id, TextureRow>` | each texture's image blob, size, colour space |
| `history` | `UnorderedMap<(asset, number), VersionRecord>` | every version of every mesh and texture, numbered per asset; one asset's history is a prefix read |
| `history_len` | `UnorderedMap<asset, u64>` | the number of each asset's last version |
| `locks` | `UnorderedMap<id, Lock>` | check-outs: who holds an asset and until when |
| `environment` | `Cell<Environment>` | the scene's name, background and ambient light |
| `members` | `UnorderedMap<account, Member>` | each person's display name, written only by their own `join` |
| `editors` | `Set<account>` | accounts an admin granted the editor role |

The design:

- **One record per object, replaced whole.** One log orders every write, so two
  people dragging the same cube end with the later write — never a cube that
  took its position from one and its colour from the other.
- **The hierarchy is the reader's.** Every reader resolves a missing parent or
  a loop to the root, the same way (`resolve_parents`, mirrored in `model.ts`).
- **Heavy data is blobs; state is references.** A mesh's vertices and a
  texture's pixels are the scene's own blobs (`POST /apps/{app}/blobs`), named
  by their SHA-256. State holds a small reference, every save also adds a
  version, and restoring writes an old blob id again — identical bytes are the
  identical blob, so nothing is copied. Decoding checks the blob against what
  its reference claims and refuses a mismatch.
- **Check-out is coordination.** While an asset is checked out, the contract
  refuses anyone else's write to it. Check-outs lapse (1 hour to 1 week), and
  an admin can release one.
- **Who may do what** is checked in each method against the caller: the
  scene's **admins** are its owner (its creator) and the organization's admins
  and owner; **editors** are accounts an admin granted the role; everyone else
  the scene reaches (members and guests of the organization) is a **viewer**,
  who may read and `join`.
- **Meshes are cages.** A mesh that has been modelled is stored as its
  polygon cage — faces of any size, a UV per face corner, its hard edges, its
  UV seams and its modifier stack (mesh blob format 3; format 2, without
  seams, is still read) — and the triangles are derived on every client that
  reads it. A triangle mesh imported from a DCC stays format 1, byte for byte,
  until someone edits it; then its triangles are paired back into the quads
  they came from. Edges steeper than 60° always draw hard; marking an edge
  sharp hardens a softer one and makes it a crease under subdivision.
- **Presence is not state.** Selections and cameras stream over the scene's
  presence channel (`/apps/{app}/presence`, at most 4 KiB a device, gone 7 s
  after its last refresh). Moving the camera is never a call; moving an object
  is one, sent once when the drag ends.

The frontend is optimistic: an edit shows at once and goes out through an
outbox that writes one change at a time and folds queued ones together. A read
never drags back an object whose write is still in flight (`sync.ts`,
`sync.test.ts`). Every event of the scene is a nudge to re-read it, with a slow
poll behind the stream.

## Blobs and large models

**One blob is at most 47.25 MiB (49,545,216 bytes).** A blob reaches the
cluster's other nodes base64-encoded inside one sealed request, which is at
most 64 MiB, with 1 MiB kept for the rest: `(64 MiB − 1 MiB) / 4 × 3` (core's
`node::MAX_BLOB_BYTES`). v1 allowed 512 MiB a blob. So:

- **A mesh is one blob, so one mesh is at most 47.25 MiB once encoded.** The
  mesh format is deflated positions, indices and UVs (`meshcodec.ts`): about
  12 bytes a vertex for positions, 4 an index, 8 a UV before compression, and
  typically half to a third of that after. A few million vertices fit; the
  4,000,000-vertex limit is only reachable for very regular geometry.
- **A texture is one blob.** A 4096² PNG is usually 10 to 40 MiB and fits; an
  8192² or 16,384² PNG usually does not. Use JPEG or WebP for colour maps at
  those sizes, or a smaller image.
- **Too large is refused before the upload**, with the encoded size and what to
  do (`blobs.ts`), and the contract refuses a reference that claims more
  (`Invalid`). Split a large model into several objects (each its own mesh
  blob), decimate it on import, or keep the heavy original in a DCC and import
  a game-ready version.
- **Every version is kept** while the history names it: a history row is a
  reference too, so a blob stays on the cluster as long as any mesh, texture or
  version row refers to it. `clearScene` drops every reference; a node then
  collects the blobs an hour later. A scene holds at most 100,000 blobs (core's
  per-app quota).

The contract stores each blob id as a `BlobRef` (`logic/src/blob.rs`): CBOR tag
51,739 around the blob's SHA-256, exactly the bytes core's
`calimero_sdk::BlobRef` writes. A node with core #4815 counts those
references and keeps the blobs they name; the pinned SDK (`1.0.0-rc.7`) has no
`BlobRef` yet, so the app writes the tag itself, and moving to the SDK's type
when the pin moves changes neither stored state nor the wire. Not used yet:
`BlobRef::info` (the node's own record of the size, to check a reference's
`size`) and `BlobRef::grant` (download links for someone not signed in).

## Limits

2 000 objects a scene, 200 per call; 4 000 000 vertices and 8 000 000
triangles a mesh; 16 384 pixels a side a texture; 47.25 MiB a mesh or texture
blob (above); 1 000 textures a scene; the newest 500 versions of an asset
listed. Vertex editing in the browser stops at 250 000 vertices — heavier
meshes are edited in a DCC and re-imported as a new version. An import over
the mesh limit is decimated to fit, and the status bar says by how much. A
modifier stack stops before any modifier that would take a mesh past
4 000 000 face corners, and says which it skipped.

Edit-mode selection is by vertex: an edge is selected when both ends are, and
switching to face mode selects every face whose corners are all selected (as
in Blender). Bevel makes one segment; the knife cuts along a plane, not a
drawn line.

LODs never tear a UV seam or a hard edge, so a low-poly hard-surface prop
stops simplifying early and the chain ends there rather than repeating a
level. FBX carries meshes, transforms, one material each and its base-colour
and normal textures; there are no LOD groups, skeletons or animation, and
FBX here is checked against three.js's FBX reader, not the Autodesk SDK.

Texturing runs in the page and takes a few seconds an object at 1024²
(occlusion is traced at a quarter of that and filtered up); a mesh whose UVs
overlap is laid out afresh first. There is no hand painting yet, and the
normal map is baked in a per-texel tangent frame that matches three.js's
closely but not MikkTSpace exactly.

Unwrapping a closed piece with no seam through it projects it instead (the
status bar says how many faces); the UV editor moves the selected faces' UVs
without dragging their neighbours along, and packing works in one square, not
in UDIM tiles.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo test --manifest-path apps/mero-models/logic/Cargo.toml           # harness + scenarios + BlobRef encoding
cargo run --release --manifest-path $M -- build apps/mero-models/logic  # res/mero_models.wasm + res/abi.json
pnpm -F mero-models lint && pnpm -F mero-models typecheck && pnpm -F mero-models test && pnpm -F mero-models build
pnpm merod-local e2e mero-models                                        # the scenarios on merod local
```

`tests/harness.rs` runs the contract on core's real engine as named accounts:
objects (order, creators, stamps, the 2,000 cap, validation and clamping), the
hierarchy rule, meshes and textures with their numbered history and restores,
the 47.25 MiB blob cap and the blob id form, check-outs (holding, extending,
lapsing, releasing, an admin breaking one), the environment, members, the
roles (the owner and the org's admins as admins, editors granted and revoked,
viewers refused), `clearScene`, and the access and wire checks. The scenarios
(`edit-a-scene.json`, the merobox workflow; `access.json`) run in the harness
and on `merod local`. They never name a blob: a JSON step cannot upload one,
and a node with blob support refuses a reference to a blob the scene does not
hold, so meshes and textures are covered by the harness only.

`pnpm -F mero-models test` covers the editor (geometry, the cage tools and
modifiers, examples, store, sync), the contract client against
`logic/res/abi.json`, the blob transport and its size cap, and the sign-in,
scene picker and invitation flow with a mocked client (`StudioPage.test.tsx`).

## What changed in the port, and why

The same methods, arguments, answers and events, with these differences a client sees:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `get_scene`, `set_environment`, `get_objects`, `get_objects_by_ids`, `put_objects`, `delete_objects`, `clear_scene`, `put_mesh`, `list_meshes`, `put_texture`, `list_textures`, `delete_textures`, `list_history`, `check_out`, `check_in`, `list_locks`, `get_members`, `grant_editor`, `revoke_editor`, `my_role` (`join` unchanged) | `getScene`, `setEnvironment`, `getObjects`, `getObjectsByIds`, `putObjects`, `deleteObjects`, `clearScene`, `putMesh`, `listMeshes`, `putTexture`, `listTextures`, `deleteTextures`, `listHistory`, `checkOut`, `checkIn`, `listLocks`, `getMembers`, `grantEditor`, `revokeEditor`, `myRole` | the ABI names methods and arguments in camelCase |
| argument names | `asset_id` | `assetId`; v1 names are `BadArgs` | the same |
| `now` | a number | a decimal string (`"1727000000000"`) | a `u64` parameter travels as a decimal string (D20); callers convert with `u64` from `src/meroModels.ts` |
| answers | snake_case fields, numbers | unchanged: snake_case fields, timestamps and sizes as JSON numbers | the records are plain serde structs |
| `init` | `init(name)`: the scene's first name | `init()`; the scene is named by its instance (`createApp(name, …)`), and `getScene.name` is `""` until an editor renames it | the harness and the node run `init` with no arguments; the studio shows the instance's name |
| errors | a message (`app::bail!`) | `422 APP_ERROR` `{ code, fields: { message } }` with `code` `Forbidden` (role), `Invalid` (an argument), `Locked` (someone else's check-out) | `#[app::error]`'s wire shape |
| events | tuple payloads (`ObjectsChanged(["a"])`, `MeshChanged("m")`) | named fields: `ObjectsChanged { ids }`, `ObjectsDeleted { ids }`, `MeshChanged { id }`, `TextureChanged { id }`, `TexturesDeleted { ids }`, `LocksChanged { ids }`, `MemberChanged { member }`, `RoleChanged { member }`, `EnvironmentChanged`, `SceneCleared` | component events carry named fields; the client only uses them as a nudge to re-read |
| admins | the context's creator | the instance's owner (its creator), **and** the organization's admins and owner | the org's roles; an org admin can already delete the instance |
| `grantEditor` | any account id | an account in the scene's organization (`Invalid` otherwise) | catches a typo |
| blob ids | 64 hex characters, either case | 64 **lowercase** hex characters: the `id` an upload answers | core's `BlobRef` form |
| blob size | at most 512 MiB | at most 47.25 MiB | one sealed request ([above](#blobs-and-large-models)) |
| blob sharing | uploaded with the context id and announced to every member's node (`blob_announce_to_context`) | the scene's own blobs; the cluster stores them and serves any member | one cluster per app |
| blob lifetime | kept on the nodes that held them | kept while a mesh, texture or history row refers to them, then one hour | host-tracked retention (core #4815) |
| history keys | `"<asset>/<stamp>/<author>/<blob>"` (two devices could write the same millisecond) | `(asset, number)`, numbered in log order | one log orders every write |
| check-outs and roles | enforced by every node at merge (`PermissionedStorage` capability maps) | checked in each method | only the methods write |
| `#[app::destructive]` on `deleteObjects`, `clearScene`, `deleteTextures` | a hint to clients | gone | the component SDK has no such marker (`clearScene` stays admin-only) |
| `getMembers` ids | the `UserStorage` slot's account | the account that called `join` | the same, from `env::caller()` |
| transport | JSON-RPC `execute` on your own node, a context id | `POST /apps/{app}/intents` and `/views` on any node of the cluster, an app id | one app per replicated log |

v1's convergence test (`tests/converge.rs`), its `TestHost` tests
(`src/tests.rs`, now `tests/harness.rs`) and its two-node merobox workflow
(`logic/workflows/edit-a-scene.yml`, now `scenarios/edit-a-scene.json`) are
gone: under one log there is nothing to converge.

The frontend changed with it: mero-react's provider and node login, the
context and namespace picker, namespace invitations, the desktop SSO hand-off,
namespace-wide member names (`@calimero-apps/names`), the generated
`MeroModelsClient` and the Playwright suites against merod 0.x are gone. It now
resolves its target from the build (`@calimero-apps/connect`: `merod local`
under `vite`, a Cloud cluster under `vite build`), signs in with a **passkey**,
lists and creates **scenes** (app instances) in **studios** (organizations:
v1's contexts in a namespace), invites with an **org invite link** (making it
is approved with your passkey; opening it, then signing in, redeems it and
opens a scene of that studio; the pending invite is `@calimero-apps/connect`'s
`createInviteStore`, dropped on sign-out; a member who may not add a scene is
told to ask an owner), keeps
blobs through `CalimeroClient.uploadBlob` / `downloadBlob`, follows the scene
with `client.events`, streams presence with `publishPresence` /
`presenceStream`, and calls the contract through `MeroModelsClient` (`src/generated/client.ts`),
which `meroctl app codegen` writes from `logic/res/abi.json` (`pnpm -F
mero-models codegen` after a contract change; CI fails when the committed copy
is stale). The records keep v1's snake_case fields and JSON-number `u64`s,
which the contract marks `#[abi(plain)]`, so the generated types describe them
and `src/meroModels.ts` re-exports them for the editor;
`src/client.test.ts` checks the class against `logic/res/abi.json`. The landing page's sign-in is the app's own
(`ownConnect`).

The phone apps (`mobile/`) are unchanged and still speak the v1 contract; see
`mobile/README.md`.

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to
start without `VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set where
the bundle's frontend is built (`app/.env.example`). The production frontend is
the one packed into the `.mpk` (`frontend-dir`), served by the cluster from the
package's own origin, and scenes are created from the package
(`com.calimero.mero-models`). The `frontend` link in `logic/Cargo.toml` and the
Vercel project (`app/vercel.json`) stay as the listing's link.

```bash
pnpm -F mero-models build
meroctl app pack apps/mero-models/logic --key <production key> --app-version <x.y.z>
```
