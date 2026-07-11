# mero-blocks

Browser-playable multiplayer voxel sandbox (Minecraft-style) running on
[Calimero](https://calimero.network). No game server: a Calimero context *is*
the world — block edits are CRDT state, presence rides heartbeats, and media
never leaves the browser.

See **[PLAN.md](./PLAN.md)** for the full architecture and design decisions.

## The one idea everything hangs on

**World = f(seed) + overrides.** Terrain is generated deterministically from a
shared seed on every client; the contract stores only the diff (placed/broken
blocks) plus player presence. Joining a world costs two queries
(`world_meta`, `get_overrides`) — chunk data is never networked.

## Layout

```
logic/   Rust WASM contract (calimero-sdk @ core 0.11.0-rc.13 git tags)
app/     Vite + TypeScript + Three.js frontend
  src/engine/   pure-TS voxel engine (terrain, meshing, lighting, physics, raycast)
  src/net/      session (SSO hash), JSON-RPC, SSE decode, SyncEngine
  tests/        98 vitest unit tests
  e2e/          12 mocked Playwright tests
```

## Run it

```bash
make setup     # pnpm install
make dev       # http://localhost:5183 — click "Play offline", no node needed
```

**Controls:** click to lock the mouse; WASD + Space to move/jump; LMB break,
RMB place; 1–9 / wheel to pick a block; torches and glowstone are real lights.

## Multiplayer

Open the app from the Calimero desktop (tauri-app) — the SSO hash
(`#node_url=…&access_token=…&context_id=…`) connects you straight into the
context's shared world. Peers see your avatar + name in real time; edits
propagate via `set_blocks` batches → `BlocksChanged` SSE nudges → override
re-pull (event = nudge, state = truth).

Presence uses the mero-meet room-clock + two-pass mark/grace reap, so clock
skew between machines can never kill live players. Heartbeats are silent CRDT
writes (no SSE churn); rosters poll every 1.5s with SSE nudges for join/leave.

## Tests

```bash
make unit        # 98 vitest tests (engine + protocol)
make e2e         # 12 Playwright tests against a fully mocked node
make logic-test  # contract tests on the native mock host (TestHost)
```

## Contract API

| method | args | notes |
|---|---|---|
| `init` | `name, seed, now` | `now` anchors the shared day/night clock |
| `world_meta` | — | `{name, seed, createdAt}` |
| `set_blocks` | `edits: [{x,y,z,b}], now` | batched, ≤512, LWW per block, emits `BlocksChanged(by)` |
| `get_overrides` | — | full diff, `[{k: "x,y,z", b}]` |
| `join` / `leave` | `name?, now` | emits `PlayerJoined` / `PlayerLeft` |
| `heartbeat` | `t: transform, now` | silent presence write + reap pass |
| `get_players` | `now` | roster with `online` liveness |

Design rules honored (hard-won elsewhere): no `UnorderedSet` remove+reinsert
(tombstone bug), break = explicit `b: 0` (never map-remove), room-clock
normalized liveness, app-id resolution prefers the URL hash.
