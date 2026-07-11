# merraria

[![CI](https://github.com/calimero-network/merraria/actions/workflows/ci.yml/badge.svg)](https://github.com/calimero-network/merraria/actions/workflows/ci.yml)
**Play it now: [merraria.vercel.app](https://merraria.vercel.app)** (offline mode needs no node)

**A browser-playable, Terraria-style 2D multiplayer mining sandbox with no
game server — the world lives on [Calimero](https://calimero.network) nodes.**

Sister project of [**mero-blocks**](../mero-blocks): the same
world-as-a-context architecture one dimension lower, and radically lighter —
the entire game (engine, renderer, networking, UI) is plain TypeScript on a
Canvas2D and bundles to **~45 kB** with zero rendering dependencies.

See **[PLAN.md](./PLAN.md)** for the full design document.

---

## What it showcases

1. **A Calimero context as a game world.** Dig and build with friends; every
   tile edit is CRDT contract state replicated peer-to-peer between nodes.
   No server, no infra — whoever runs a node owns a replica of the world.
2. **The seed + diff trick.** The 400×200 tile world — rolling hills, worm-
   carved caves, depth-stratified ores (coal → iron → gold), lakes, trees —
   regenerates identically on every client from the seed in the contract. The
   network carries only the override diff (dig = explicit `0`, never a
   map-remove) and presence. Joining costs two queries.
3. **Gameplay depth on tiny state.** Per-tile dig hardness with crack
   progress, an inventory that gains what you mine and spends what you build,
   genuinely dark caves you light with torches (2D flood-fill lighting), a
   live minimap, and a shared day/night cycle that costs zero traffic.
4. **Skew-proof presence.** The mero-meet room-clock + two-pass mark/grace
   reap: silent heartbeats, roster polls with SSE nudges, and no way for a
   machine with a skewed clock to reap live players.
5. **Both auth paths, no friction.** Desktop SSO hash → zero-click auto-enter;
   web → node auth redirect (`/auth/login?callback-url=…`) + world picker
   (list / join / create via admin API); offline → localStorage persistence
   with reconcile-on-connect.

## How it works

```
 browser A                    node A          node B                 browser B
┌────────────┐  set_tiles    ┌──────┐  CRDT  ┌──────┐  SSE nudge   ┌────────────┐
│ 2D engine  │ ────────────▶ │ WASM │ ◀────▶ │ WASM │ ───────────▶ │ re-pull    │
│ + Canvas2D │  (150ms batch)│ ctx  │ gossip │ ctx  │              │ overrides  │
└────────────┘ ◀──────────── └──────┘        └──────┘ ◀─────────── └────────────┘
                get_players / heartbeat (1s/3s, silent)
```

- **Contract** (`logic/`, Rust on calimero-sdk, pinned to core
  **0.11.0-rc.13** git tags — the latest rc): `overrides:
  UnorderedMap<"x,y", {t, updatedAt}>` with per-key LWW + presence map.
- **Engine** (`app/src/engine/`, pure TS): deterministic terrain, 2D
  flood-fill lighting (80k cells — full recompute per edit is fast enough),
  platformer AABB physics (gravity, jump, swim), mining/inventory, day/night.
- **Renderer** (`app/src/renderer.ts`): Canvas2D tile window with per-tile
  light multiply and hash-based texture, sky gradient + sun/moon, remote
  miners with name tags, dig-crack overlay, whole-world minimap.
- **Net** (`app/src/net/`): identical layer to mero-blocks — JSON-RPC
  `execute`, dual-shape SSE decode, batched edits with echo suppression,
  reconcile on connect.

## Run it

```bash
make setup     # pnpm install
make dev       # http://localhost:5184 → "Play offline" needs no node at all
```

**Controls:** A/D move · Space/W jump · hold LMB to dig · RMB place ·
1–9/wheel select · torches light caves.

For multiplayer, open from the Calimero desktop (instant SSO) or click
**Connect a node** on the landing page.

## Tests — 140 total, all green

| suite | count | what it proves |
|---|---|---|
| `make unit` (vitest) | 103 | terrain determinism + cave/ore distribution, lighting, physics (incl. head bumps and swimming), mining/inventory, sync protocol, session/auth/admin parsing |
| `make e2e` (Playwright, fully mocked node) | 20 | landing + web login, desktop SSO auto-enter, world picker, live tile round-trips, presence, inventory persistence |
| `make logic-test` (cargo, native mock host) | 17 | LWW convergence, bounds, clock-skew reap scenarios, rejoin self-heal |

## CI / CD

Every push and PR runs four gates in GitHub Actions; production only ships
when all are green: **App** (typecheck + 103 vitest + build), **Logic** (17
contract tests + WASM build), **E2E mocked** (20 Playwright tests), and
**E2E merobox** — two real `merod` nodes (rc.13 image) in Docker running the
full world lifecycle: install → namespace invite → create world → both miners
join → Alice builds a shelter → Bob sees it → Bob digs it out → convergence
asserted (`workflows/e2e.yml`, locally via `make workflows`). On `main`, a
fifth job deploys to Vercel (**merraria.vercel.app**).

## Contract API

Same shape as mero-blocks with 2D coords: `init(name, seed, now)`,
`world_meta()`, `set_tiles(edits: [{x,y,t}], now)`, `get_overrides()`,
`join/leave`, `heartbeat(t, now)`, `get_players(now)`.
