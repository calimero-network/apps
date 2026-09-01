# mero-blocks — Browser-playable multiplayer voxel sandbox on Calimero

A Minecraft-style voxel game that runs entirely in the browser, with a Calimero
context as the multiplayer backbone. No game server: the world is a CRDT-backed
Calimero application; peers sync block edits and player presence P2P through
their nodes, exactly like mero-meet uses a context as a signaling relay and
mero-design uses one as a collaborative canvas.

---

## 1. Design goals

- **Lightweight**: runs at 60fps in a browser tab on a laptop. Small fixed map,
  no infinite terrain, no heavy engine. Three.js for rendering only — all voxel
  logic (chunk storage, meshing, lighting, physics, raycasting) is our own
  plain TypeScript, unit-testable without a GPU.
- **Tiny network state**: the contract never stores raw chunk data. Terrain is
  generated **deterministically from a shared seed on every client**; the
  contract stores only the *diff* — a map of block overrides (place/break).
  A world with thousands of edits is still a few KB of consensus state.
- **Offline-first**: the whole world (seed + overrides + player position) is
  saved to localStorage. You can play solo with no node; when you connect, local
  pending edits are flushed to the context and the authoritative override set
  is merged back.
- **Real users visible in real time**: presence heartbeats through the contract
  (mero-meet pattern: room-clock normalization + mark/grace reap so clock skew
  between laptops can't reap live players), remote avatars interpolated
  client-side between updates.

## 2. World model

| Parameter | Value |
|---|---|
| Map size | 128 × 64 × 128 blocks (8 × 4 × 8 chunks) |
| Chunk size | 16 × 16 × 16, `Uint8Array(4096)` |
| Block types | air, grass, dirt, stone, sand, water, wood, leaves, plank, glass, brick, torch, glowstone, bedrock… (u8 ids, table in `blocks.ts`) |
| Terrain | value-noise heightmap + trees + ores, seeded PRNG (mulberry32), identical on every client for the same seed |
| Coordinates | world block coords `(x,y,z)` ints; chunk key `"cx,cy,cz"`; block key `"x,y,z"` |

**World = f(seed) + overrides.** `WorldStore.getBlock(x,y,z)` checks the
override map first, then the deterministic generator. Breaking a block writes
override `air`; placing writes the block id. This is what makes networking,
persistence, and chunk loading all trivial and identical.

## 3. Networking (Calimero)

### 3.1 Contract state (Rust, calimero-sdk, pinned to core 0.11.0-rc.13 git tag)

```rust
#[app::state(emits = Event)]
pub struct MeroBlocks {
    meta: WorldMeta,                          // seed, name, created_at (room clock base)
    overrides: UnorderedMap<String, u8>,      // "x,y,z" -> block id (0 = air)
    players: UnorderedMap<String, Player>,    // executor pk -> transform + heartbeat
}
```

- **No UnorderedSet remove+reinsert anywhere** (core tombstone-revive CRDT bug,
  fixed rc.10 but the pattern stays banned). Presence is a map with reap; block
  overrides are set-only (breaking = value 0, never `remove`).
- `Player`: `{ name, x, y, z, yaw, pitch, sel (hotbar block), last_seen, marked }`,
  camelCase serialization.
- **Clock skew**: `last_seen` is a *room clock* — `env::time_now()` normalized
  against `meta.created_at` deltas per the mero-meet fix: heartbeat stores the
  node's own time, reap uses two-pass mark(12s)-then-grace(12s) so a skewed
  clock marks but never instantly kills, and any fresh heartbeat unmarks.

### 3.2 Contract API

| Method | Kind | Purpose |
|---|---|---|
| `init(seed, name)` | ctor | fixes the world seed for everyone |
| `world_meta()` | query | seed + name → client boots generator |
| `set_blocks(edits: Vec<Edit>)` | mutate | batched place/break (`Edit {x,y,z,b}`), emits per-edit events |
| `get_overrides()` | query | full override map → join/late-load |
| `heartbeat(t: PlayerTransform)` | mutate | upsert presence + transform, runs reap pass |
| `leave()` | mutate | explicit despawn |
| `get_players()` | query | roster for late join |

### 3.3 Events (SSE)

Emitted with the **variant-name-as-key** format the node actually sends
(`{"BlocksChanged": {...}}`, *not* `{kind: ...}`) — mero-design lesson.

- `BlocksChanged { edits, by }` — apply overrides, remesh dirty chunks, relight
- `PlayerMoved { id, t }` — update remote avatar target (interpolated over ~250ms)
- `PlayerJoined { id, name }` / `PlayerLeft { id }` — roster + toast

### 3.4 Traffic budget & the three networked things

1. **Chunk loading** — *never networked as chunks.* Join = 1 query
   (`world_meta`) + 1 query (`get_overrides`), then everything is local
   generation. O(edits), not O(world).
2. **Player transforms** — heartbeat every **1s** while moving (3s idle),
   quantized (pos to 0.01, angles to 0.001). Remote avatars lerp between the
   last two transforms so 1Hz looks smooth. (Consensus channel ≈ mero-meet
   presence; a future upgrade is a WebRTC data channel for 10Hz, using the
   context purely for signaling — out of scope v1.)
3. **Lighting changes** — *derived, not networked.* Torch/glowstone edits are
   ordinary block edits; each client reruns the local flood-fill relight for
   dirty chunks. Day/night is `sharedElapsed = now - meta.created_at`, so the
   sun is in the same place for everyone with zero traffic.

### 3.5 Client sync layer (`app/src/net/`)

- `CalimeroClient` — thin wrapper over `@calimero-network/mero-js`
  (`execute`/`query` on the context, SSE subscribe with `**/sse**`-compatible
  endpoint, SSO tokens read from the URL hash — same bootstrapping as
  mero-design; **application id resolved URL-hash > stored > env**, the
  mero-chat 5c03312 lesson).
- `SyncEngine` — outbound edit queue with 150ms batching → `set_blocks`;
  inbound event application with echo-suppression (skip events `by === me`);
  reconcile pass on (re)connect: pull `get_overrides`, deep-merge, flush pending.
- `Presence` — heartbeat loop (documented rates), roster derived from
  heartbeats/events, never from a set (mero-meet roster lesson).
- **Offline mode**: no hash/node → everything above becomes a no-op and the
  game is pure local.

## 4. Engine (`app/src/engine/`) — all pure TS, no Three.js imports

| Module | Responsibility |
|---|---|
| `blocks.ts` | block registry: id, solid, opaque, emissive level, colors per face |
| `world.ts` | `WorldStore`: chunks map, overrides map, `getBlock/setBlock`, dirty-chunk tracking |
| `terrain.ts` | mulberry32 PRNG, 2D value noise, heightmap, trees, ores — deterministic |
| `mesher.ts` | per-chunk culled mesher → positions/normals/colors/indices `Float32Array`s; only faces adjacent to non-opaque blocks; vertex colors = block color × light |
| `lighting.ts` | 16-level sunlight column drop + BFS flood fill; block light from emissive blocks; per-voxel light grid per chunk; relight on edit |
| `raycast.ts` | Amanatides–Woo voxel DDA: camera ray → hit block + face normal (break/place targeting, 6-block reach) |
| `physics.ts` | AABB player (0.6×1.8) vs voxel sweep: gravity, jump, step, water drag; fixed 60Hz tick |
| `sim.ts` | day/night from shared elapsed time → sun light level + sky color |

**Renderer** (`renderer.ts`, the only Three.js file): one `BufferGeometry` mesh
per chunk rebuilt when dirty, `MeshBasicMaterial` with vertex colors (lighting
is baked — no GPU lights at all), pointer-lock FPS controls, remote-player
avatars (box body + name sprite), block-face highlight box.

## 5. UI (`app/src/ui/`)

- Connect screen: world name/seed, **Play offline** or **Connect** (SSO hash
  auto-connects, mero-react LoginModal-style manual node URL as fallback).
- HUD: crosshair, hotbar (1–9 block selection, wheel), F3-ish debug overlay
  (fps, pos, chunk, peers), player list with live names, toasts (join/leave/
  sync state), day/night tint.
- Controls: WASD + space, mouse look (pointer lock), LMB break, RMB place.

## 6. Persistence

`localStorage["mero-blocks/<worldId>"]` = `{ seed, name, overrides, player: {pos,yaw,pitch,sel}, savedAt }`
— saved every 5s (debounced) and on `beforeunload`; worldId = contextId when
connected, else local slug. Load-order on boot: saved local state → contract
reconcile. Identity fallback in `localStorage["mb-identity-<ctx>"]`
(mero-design pattern).

## 7. Testing

### Unit (vitest, target ≥120 tests)
- terrain determinism (same seed ⇒ identical chunks; different seeds differ)
- world store: override precedence, dirty-chunk marking incl. chunk-border edits
- mesher: exact face counts for known scenes (single cube = 6 faces; buried
  block = 0; glass/water don't cull neighbors wrongly)
- lighting: sunlight column, flood-fill around overhang, torch radius/falloff,
  relight after place/break
- raycast: axis hits, face normals, max-reach miss, negative coords
- physics: fall onto floor, jump apex, wall slide, corner cases at chunk borders
- net protocol: edit batching/coalescing (last-write-wins per key), echo
  suppression, event decoding of `{"BlocksChanged": ...}` shape, reconcile merge
- persistence codec round-trip

### E2E (Playwright, mocked node — mero-design patterns)
Mock routes: `**/sse**` (event stream), `**/jsonrpc**` (execute/query),
`HEAD **/auth/validate → 200`. Scenarios:
1. offline boot → world renders (canvas visible, debug shows chunks)
2. break block → placed override → survives reload (localStorage)
3. place block from hotbar selection
4. connect (hash tokens) → `world_meta`+`get_overrides` queried → remote
   override visible in world
5. incoming `BlocksChanged` SSE → world updates without reload
6. incoming `PlayerMoved`/`PlayerJoined` → avatar + player list update
7. local edit → outbound `set_blocks` jsonrpc captured with batched edits
8. `PlayerLeft` → avatar removed, toast shown

### Live integration (needs local node, not in CI): `make dev-nodes` two-node
harness (mero-meet style), manual 2-browser check.

## 8. Repo layout

```
mero-blocks/
  PLAN.md  README.md  Makefile
  logic/            # Rust WASM contract (calimero-sdk @ rc.13 git tags)
    Cargo.toml  src/lib.rs  build.sh
  app/              # Vite + TS + Three.js frontend
    package.json  vite.config.ts  vitest.config.ts  playwright.config.ts  index.html
    src/{engine,net,ui,state,utils}/...  main.ts
    tests/   (vitest)
    e2e/     (playwright, mocked)
```

## 9. Milestones (execution order)

1. **Engine core**: blocks, terrain, world store, mesher, lighting, raycast,
   physics + unit tests green.
2. **Renderer + game loop**: playable offline in browser.
3. **Contract**: state, methods, events; builds to wasm (rc.13 pins).
4. **Net layer**: client, sync engine, presence + protocol unit tests.
5. **UI polish**: HUD, hotbar, roster, connect screen, persistence.
6. **E2E**: mocked Playwright suite green.
7. README + Makefile (dev, build, test, bundle targets).

## 10. Risks / known gotchas baked in

- SSE payload is `{"Variant": data}` — decoder tolerates both shapes anyway.
- UnorderedSet tombstone bug → banned pattern (map-only design).
- Clock skew reap wars → room-clock + mark/grace (mero-meet fix).
- App-id must prefer URL hash before storage/env (mero-chat SSO-strip bug).
- Heartbeat loops must not capture stale state in memo deps (mero-meet
  "heartbeats never fired" bug) — game loop owns the timer, not React-style
  effects (we're vanilla TS, so this is structural).
- Batched `set_blocks` keeps consensus write rate ≪ click rate.
