# mero-blocks

[![CI](https://github.com/calimero-network/mero-blocks/actions/workflows/ci.yml/badge.svg)](https://github.com/calimero-network/mero-blocks/actions/workflows/ci.yml)
**Play it now: [mero-blocks.vercel.app](https://mero-blocks.vercel.app)** (offline mode needs no node)

**A browser-playable, Minecraft-style multiplayer voxel sandbox with no game
server — the world lives on [Calimero](https://calimero.network) nodes.**

This repo is a showcase of how far the Calimero stack can be pushed as a
real-time multiplayer game backend: block edits are CRDT contract state
replicated peer-to-peer, players are presence heartbeats, and the game itself
runs entirely in the browser (TypeScript + Three.js, custom voxel engine).

See **[PLAN.md](./PLAN.md)** for the full design document.

---

## What it showcases

1. **A Calimero context as a game world.** No dedicated server, no matchmaking
   infra. Creating a world = creating a context; joining = joining the
   context. Everyone who runs a node owns a full replica of the world.
2. **The seed + diff trick.** The contract never stores terrain. Every client
   generates the identical 128×64×128 world from a seed; the contract carries
   only the *override diff* (place = block id, break = explicit `0` — keys are
   never removed, staying clear of CRDT tombstone pitfalls). A world with
   thousands of edits is a few KB of consensus state, and joining costs
   exactly two queries.
3. **Skew-proof presence.** Heartbeats are silent CRDT writes stamped on a
   *room clock* (max of caller clock and newest row), with a two-pass
   mark/grace reap — a machine with a fast or backwards clock can never kill
   live players (the algorithm battle-tested in mero-meet).
4. **Derived state costs nothing.** Lighting (flood-fill sunlight + torch
   light) is recomputed locally from block events; the day/night cycle is a
   pure function of the world's `created_at`. Both are perfectly synchronized
   across peers with zero network traffic.
5. **Both auth paths, no friction.**
   - *Desktop:* the Calimero desktop opens the game with an SSO hash
     (`#node_url=…&access_token=…&context_id=…`) — the game auto-enters the
     shared world with **zero clicks**.
   - *Web:* the landing page redirects to your node's auth page
     (`/auth/login?callback-url=…`, the standard mero-js flow) and returns
     with tokens; a world picker then lists this app's contexts or creates a
     new one via the admin API.
   - *Offline:* no node at all — play locally, persist to localStorage, and
     reconcile with a shared world when you later connect.

## How it works

```
 browser A                    node A          node B                 browser B
┌────────────┐  set_blocks   ┌──────┐  CRDT  ┌──────┐  SSE nudge   ┌────────────┐
│ voxel      │ ────────────▶ │ WASM │ ◀────▶ │ WASM │ ───────────▶ │ re-pull    │
│ engine     │  (150ms batch)│ ctx  │ gossip │ ctx  │              │ overrides  │
│ + Three.js │ ◀──────────── └──────┘        └──────┘ ◀─────────── │ + remesh   │
└────────────┘  get_players / heartbeat (0.5s/2s, silent)            └────────────┘
```

- **Contract** (`logic/`, Rust on calimero-sdk, pinned to core
  **0.11.0-rc.13** git tags — the latest rc): `overrides: UnorderedMap<"x,y,z",
  {b, updatedAt}>` with per-key LWW, `players` presence map, room-clock reap.
- **Engine** (`app/src/engine/`, pure TS — unit-testable without a GPU):
  deterministic terrain (value noise + trees + ores), culled chunk mesher with
  per-vertex baked light, Amanatides–Woo raycast, AABB physics, day/night.
- **Renderer** (`app/src/renderer.ts`, the only Three.js file): one geometry
  per chunk, custom shader with a `dayFactor` uniform — time passing never
  remeshes anything.
- **Net** (`app/src/net/`): JSON-RPC `execute` calls (camelCase envelope, raw
  `argsJson`), SSE subscription decoding *both* event payload shapes seen
  across node versions, 150ms edit batching with echo suppression, and a
  reconcile pass (pull → merge → flush) on every (re)connect.

## Run it

```bash
make setup     # pnpm install
make dev       # http://localhost:5183 → "Play offline" needs no node at all
```

**Controls:** click to lock the mouse · WASD + Space · LMB **or Q** break ·
RMB **or E** place · 1–9/wheel select · **M** live world map · **O** options
(mouse sensitivity, key reference) · torches and glowstone are real light
sources. Everything works from the keyboard, so a MacBook trackpad never
needs a right-click.

For multiplayer, either open the app from the Calimero desktop (instant SSO)
or use the landing page: running local nodes are auto-discovered with
mero-react's `discoverLocalNodes` (health probe on the well-known dev ports) —
one click to connect — with a manual node-URL fallback.

A world is a **namespace subgroup + context**: creating one provisions the
app's namespace (once per node), a subgroup named after the world, and the
context inside it. To play together, mint an invite (**Invite friends** on the
landing page, or **Copy world invite** in the in-game options menu) — a
compact base58 string (curb's deflate+base58 format, pinned to the world's
group and context) — and a friend pastes it into **Join with invite** on their
own node.

## Tests — 189 total, all green

| suite | count | what it proves |
|---|---|---|
| `make unit` (vitest) | 139 | terrain determinism, meshing face counts, lighting flood-fill, raycast, physics, sync batching/echo/reconcile, session/auth/admin parsing |
| `make e2e` (Playwright, fully mocked node) | 30 | landing + web-login redirect, desktop SSO auto-enter, world picker (list/join/create), live edit round-trips, presence, persistence |
| `make logic-test` (cargo, native mock host) | 20 | LWW convergence, bounds, batch caps, clock-skew reap scenarios, rejoin self-heal |

## Contract API

| method | args | notes |
|---|---|---|
| `init` | `name, seed, now` | `now` anchors the shared day/night clock |
| `world_meta` | — | `{name, seed, createdAt}` |
| `set_blocks` | `edits: [{x,y,z,b}], now` | batched ≤512, LWW per block, emits `BlocksChanged(by)` |
| `get_overrides` | — | full diff `[{k: "x,y,z", b}]` |
| `join` / `leave` | `name?, now` | emits `PlayerJoined` / `PlayerLeft` |
| `heartbeat` | `t: transform, now` | silent presence write + reap pass |
| `get_players` | `now` | roster with `online` liveness |

## CI / CD

Every push and PR runs four gates in GitHub Actions; production only ships
when all of them are green:

1. **App** — typecheck, 139 vitest tests, production build
2. **Logic** — 20 contract tests on the native mock host + WASM build (the
   artifact feeds the merobox job)
3. **E2E mocked** — 30 Playwright tests against a fully mocked node
4. **E2E merobox** — two real `merod` nodes (rc.13 image) in Docker run the
   full world lifecycle: install app → namespace invite → create world →
   both players join → Alice builds → Bob sees it → Bob breaks a block →
   convergence asserted (`workflows/e2e.yml`, also runnable locally with
   `make workflows`)

On `main`, a fifth job then builds and deploys to Vercel
(**mero-blocks.vercel.app**) via `vercel build && vercel deploy --prebuilt`.

A push to `main` touching `logic/**` also builds, signs, and publishes the
contract bundle to the [Calimero App Registry](https://apps.calimero.network)
as `com.calimero.meroblocks` (`.github/workflows/deploy-bundle.yml`; version =
latest published + patch bump). Locally:

```bash
make bundle    # logic/build-bundle.sh → logic/res/mero-blocks-<ver>.mpk (signed)
make publish   # bundle + calimero-registry bundle push --remote
```

## Sister project

[**merraria**](../merraria) — the same architecture one dimension lower: a 2D
Terraria-style mining sandbox on Canvas2D with zero rendering dependencies
(the whole game is a 31 kB bundle).
