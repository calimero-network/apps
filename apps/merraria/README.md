# merraria

Browser-playable 2D Terraria-style multiplayer mining sandbox on
[Calimero](https://calimero.network). Sister project of **mero-blocks** — same
networking spine (world = seed + override diff, presence heartbeats with
room-clock reap), one dimension lower and with *zero* rendering dependencies:
the whole game is plain TypeScript on a Canvas2D, bundling to ~31 kB.

See **[PLAN.md](./PLAN.md)** for the full architecture.

## What's in the world

Deterministic terrain from a shared seed: rolling hills, dirt/stone strata,
worm-carved caves, depth-stratified ores (coal → iron → gold), lakes, trees —
plus 2D flood-fill lighting (dark caves, torches), a day/night cycle shared by
every peer for free, dig-with-hardness mining, and an inventory that gains
what you mine and spends what you place.

## Layout

```
logic/   Rust WASM contract (calimero-sdk @ core 0.11.0-rc.13 git tags)
app/     Vite + TypeScript, Canvas2D (no engine deps at all)
  src/engine/   tiles, terrain, lighting, physics, mining, sim
  src/net/      session (SSO hash), JSON-RPC, SSE decode, SyncEngine
  tests/        75 vitest unit tests
  e2e/          10 mocked Playwright tests
```

## Run it

```bash
make setup     # pnpm install
make dev       # http://localhost:5184 — click "Play offline", no node needed
```

**Controls:** A/D move, Space/W jump; hold LMB to dig (hardness per tile),
RMB places the selected tile; 1–9 / wheel select; torches light caves.

## Multiplayer

Identical model to mero-blocks: open from the Calimero desktop with the SSO
hash; joining costs two queries (`world_meta` + `get_overrides`); edits batch
into `set_tiles` → `TilesChanged` SSE nudge → override re-pull; presence via
silent heartbeats + 1.5s roster polls, reaped with the mero-meet two-pass
mark/grace room-clock algorithm.

## Tests

```bash
make unit        # 75 vitest tests
make e2e         # 10 Playwright tests against a fully mocked node
make logic-test  # contract tests on the native mock host (TestHost)
```

## Contract API

Same shape as mero-blocks with 2D coords: `init(name, seed, now)`,
`world_meta()`, `set_tiles(edits: [{x,y,t}], now)`, `get_overrides()`,
`join/leave`, `heartbeat(t, now)`, `get_players(now)`. Digging stores an
explicit `t: 0` override — keys are never removed (CRDT tombstone safety).
