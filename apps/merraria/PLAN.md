# merraria — Browser-playable 2D Terraria-style multiplayer sandbox on Calimero

Sister project to mero-blocks: same Calimero networking spine (seed +
override-diff world, presence heartbeats, SSE events), but a side-view 2D
tile world rendered on a plain `<canvas>` — no WebGL, no engine dependency at
all. Even lighter than mero-blocks.

---

## 1. Design goals

- **Zero rendering deps**: Canvas2D tile renderer with a camera, dirty-region
  aware. Whole game is plain TypeScript.
- **Terraria feel**: side view, gravity, jump, dig down / build up, caves, ores,
  trees, day/night with smooth 2D flood-fill lighting (sunlight from the sky,
  torches underground).
- **Same networking contract shape as mero-blocks** (2D coords): world =
  f(seed) + overrides; presence map with room-clock mark/grace reap; SSE
  variant-keyed events; offline-first localStorage persistence.

## 2. World model

| Parameter | Value |
|---|---|
| Map size | 400 × 200 tiles (w × h), tile = 16px sprite-less colored cells with simple texturing (noise shading per tile) |
| Tile types | air, dirt, grass, stone, sand, wood, leaves, plank, torch, ore_coal, ore_iron, ore_gold, water, bedrock, brick, glass (u8) |
| Terrain | 1D value-noise surface line, dirt depth band, stone below, worm-walk caves, ore pockets, trees on grass, bedrock floor — all from seeded mulberry32 |
| Physics | AABB player 0.75×1.9 tiles, gravity 30 t/s², jump 12 t/s, swim in water |
| Reach | 5 tiles, dig with LMB (hold = progress per tile hardness), place RMB |

**World = f(seed) + overrides** — identical philosophy and code shape as
mero-blocks: `world.getTile(x,y)` = override ?? generated. Digging writes
override 0 (air); placing writes the tile id.

## 3. Networking (Calimero)

Contract is structurally identical to mero-blocks' (rust, calimero-sdk pinned
to core 0.11.0-rc.13 git tags), with 2D coords:

```rust
#[app::state(emits = Event)]
pub struct Merraria {
    meta: WorldMeta,                       // seed, name, created_at
    overrides: UnorderedMap<String, u8>,   // "x,y" -> tile id
    players: UnorderedMap<String, Player>, // pk -> {name,x,y,vx,facing,sel,last_seen,marked}
}
```

Methods: `init(seed,name)`, `world_meta()`, `set_tiles(Vec<Edit{x,y,t}>)`,
`get_overrides()`, `heartbeat(transform)`, `leave()`, `get_players()`.
Events: `TilesChanged{edits,by}`, `PlayerMoved{id,t}`, `PlayerJoined`,
`PlayerLeft`. Same banned patterns (no UnorderedSet remove+reinsert; breaking =
value 0, never map-remove), same mark/grace reap with room-clock normalization,
same camelCase serialization.

**Networked things**
1. *Chunk/region loading*: none — join = `world_meta` + `get_overrides`, world
   regenerates locally. O(edits).
2. *Player transforms*: 1s heartbeat while moving (3s idle), remote players
   lerped; facing + animation state derived from velocity.
3. *Lighting*: derived from tile edits locally (2D flood fill); day/night from
   shared `created_at` clock — zero traffic.

Client sync layer is the same three modules as mero-blocks (`CalimeroClient`,
`SyncEngine` with 150ms batch + echo suppression + reconcile-on-connect,
`Presence`), with the same SSO-hash bootstrapping (hash > stored > env app id)
and offline no-op mode.

## 4. Engine (`app/src/engine/`) — pure TS

| Module | Responsibility |
|---|---|
| `tiles.ts` | tile registry: solid, opaque, emissive, hardness, colors |
| `world.ts` | tile store: generated columns + override map, dirty tracking |
| `terrain.ts` | PRNG, 1D noise surface, caves (drunken walk), ores, trees |
| `lighting.ts` | 2D light grid: sky light propagates down/out, torch BFS, 16 levels, recompute dirty regions |
| `physics.ts` | AABB vs tile sweep, gravity/jump/swim, 60Hz fixed tick |
| `mining.ts` | dig progress per hardness, reach check, crack overlay stages |
| `sim.ts` | day/night cycle (10 min), sky gradient, ambient light level |

**Renderer** (`renderer.ts`): Canvas2D, camera follows player, draws visible
tile window with per-tile light multiply, parallax sky + sun/moon, remote
players (colored capsule + name tag), crack overlay, selection outline.

## 5. UI

Connect screen (offline / SSO hash / manual node URL), hotbar (placeable tiles
+ counts mined — simple inventory: dig a tile, gain it, place consumes),
minimap (whole 400×200 world at 1px/tile, explored-by-light), player list,
toasts, debug overlay (F3).

## 6. Persistence

`localStorage["merraria/<worldId>"]` = `{seed, name, overrides, inventory,
player, savedAt}` — 5s debounced + `beforeunload`; identity fallback key
`mt-identity-<ctx>`. Reconcile with contract on connect (pull, merge, flush
pending).

## 7. Testing

### Unit (vitest, target ≥100)
- terrain determinism, surface continuity (no cliffs > jump height at spawn),
  cave/ore bounds
- world store override precedence + dirty regions
- lighting: sky column through air, cave darkness, torch radius, relight on dig
- physics: fall/land, jump apex, head bump, wall block, swim
- mining: hardness timing, reach limit, inventory add/consume
- net protocol: batch coalescing LWW, echo suppression, `{"TilesChanged":...}`
  decode, reconcile merge
- persistence round-trip

### E2E (Playwright, mocked node — same route mocks: `**/sse**`, `**/jsonrpc**`,
`HEAD **/auth/validate`)
1. offline boot renders world + HUD
2. dig tile → inventory increments → survives reload
3. place tile consumes inventory
4. connect via hash → meta+overrides queried → remote edits applied
5. SSE `TilesChanged` updates canvas without reload
6. `PlayerJoined`/`PlayerMoved` → remote player + list
7. local dig → outbound `set_tiles` jsonrpc captured batched
8. `PlayerLeft` cleanup + toast

## 8. Repo layout

```
merraria/
  PLAN.md  README.md  Makefile
  logic/    # Rust WASM contract
  app/      # Vite + TS, Canvas2D
    src/{engine,net,ui,state,utils}/  tests/  e2e/
```

## 9. Milestones

1. Engine: tiles/terrain/world/lighting/physics/mining + unit tests.
2. Canvas renderer + game loop → playable offline.
3. Contract (rc.13) + net layer + protocol tests.
4. UI polish + inventory + minimap + persistence.
5. Mocked Playwright e2e suite.
6. README + Makefile.

## 10. Shared gotchas honored (see mero-blocks PLAN §10)

SSE variant-keyed payloads, UnorderedSet ban, room-clock reap, hash-first app
id, structural (non-effect) heartbeat timer, batched writes.
