# Battleships on Calimero

A two-player P2P battleship game built on [Calimero](https://calimero.network), using namespaces, multi-service bundles, private storage, and CRDT-based state sync.

**[View Architecture Docs](https://calimero-network.github.io/battleships/)**

## How It Works

Two players on separate Calimero nodes play battleships with fully decentralized state. Ship placements are stored in **private storage** (never replicated), while game state syncs automatically via **CRDTs** over gossipsub. The app uses four core Calimero features:

- **Namespaces** — identity scoping, recursive invitations, subgroup-based access control
- **Multi-Service Bundles** — two WASM services (lobby + game) in one `.mpk` bundle
- **Private Storage** — `#[app::private]` ship boards that never leave the node
- **xcall** — cross-context calls from game to lobby when a match ends

## Project Structure

```
battleships/
├── app/                          # React + TypeScript frontend
│   ├── src/hooks/                # useBattleshipsLobby, useNamespaceBootstrap
│   ├── src/api/lobby/            # LobbyClient (codegen from lobby-abi.json)
│   └── src/api/game/             # GameClient (codegen from game-abi.json)
├── logic/                        # Cargo workspace (3 crates)
│   ├── crates/types/             # GameError, PublicKey (shared, no SDK dep)
│   ├── crates/lobby/             # LobbyState + 6 methods → lobby.wasm
│   ├── crates/game/              # GameState + 9 methods → game.wasm
│   └── build-bundle.sh           # Builds both WASMs + packages .mpk
├── e2e/                          # Merobox E2E workflow
└── architecture/                 # Architecture docs (GitHub Pages)
```

### Multi-Service Bundle

The `battleships-0.3.2.mpk` bundle contains:

| File | Description |
|------|-------------|
| `manifest.json` | Multi-service manifest with services array |
| `lobby.wasm` | Lobby service — matchmaking, player stats, match history |
| `game.wasm` | Game service — gameplay, private boards, shot resolution |
| `lobby-abi.json` | ABI for LobbyClient codegen |
| `game-abi.json` | ABI for GameClient codegen |

Each context specifies which service to run via `service_name` at creation time.

## Quick Start

### Prerequisites

- Node.js 20+ and pnpm 9+
- Rust (stable) with `wasm32-unknown-unknown` target
- [Merobox](https://github.com/calimero-network/merobox) for local dev/E2E

### Build

```bash
# Install frontend dependencies
pnpm --dir app install

# Build WASM bundle (.mpk)
cd logic && ./build-bundle.sh

# Start frontend dev server
pnpm --dir app dev
```

### E2E Testing

```bash
pip install "merobox @ git+https://github.com/calimero-network/merobox.git@master"
cd e2e
merobox bootstrap run workflow-battleships-e2e.yml --e2e-mode
```

## Game Flow

1. **Create Namespace** — host creates namespace with battleships app, sets default capabilities
2. **Create Lobby** — lobby context in namespace root group (`service_name: lobby`)
3. **Invite Player** — recursive namespace invitation covers root + all subgroups
4. **Player Joins** — `joinNamespace` → auto-gets identity → joins lobby context
5. **Create Match** — lobby allocates match ID → create subgroup → add P2 → create game context (`service_name: game`)
6. **Place Ships** — both players place ships in private storage and publish a SHA-256 commitment (write-once)
7. **Take Turns** — `propose_shot` → `acknowledge_shot_handler` on target node → resolves against private board → answer synced
8. **Game Ends** — the answers show a fleet sunk → both boards are revealed and every reader audits them → the audited winner is reported by `xcall` to the lobby → stats/history derived from it

## What holds against a patched node

A member can run a node that skips every check in the contract, so the game
rests on storage types every node enforces:

- **Who plays is `Frozen` at init** — player keys, their accounts, the match id
  and the lobby. Nobody can swap a player or point the result elsewhere.
- **Every commitment, shot, answer and reveal is a `WriteOnce` row**, owned by
  its author's account and immutable for everyone, the author included. Turn,
  pending shot, placement and winner are derived from those rows, never stored.
- **Equivocation loses.** A second, different shot, answer or commitment from
  one player is a forfeit rather than a choice.
- **The commit-reveal is audited by every reader.** At match end both players
  publish `(board, salt)`; each node checks it against the commitment, checks
  it is a legal fleet, and replays every answer. The declared winner must pass
  to win; a winner who lied loses. A defender who never admits a hit runs out
  of misses: the 84th miss on a 100-cell board is a lie on its face.
- **The lobby** keeps each member's account → player key pairing in their own
  `UserStorage` slot, each match owned by its creator, and results write-once.
  A result counts only if the match's own game context reported it, it names
  the match's two players, and every report agrees.

What remains: a player who stops answering, or a winner who never reveals,
stalls the match (no timeouts); a member can register someone else's player key
as their own, which blocks matches against that key rather than stealing them;
and two devices of one account writing different rows at the same millisecond
collide on one write-once key.

## Game Rules

- **Fleet**: 1x5 (carrier), 1x4 (battleship), 2x3 (cruiser, submarine), 1x2 (destroyer)
- **Placement**: Ships must be straight, contiguous, and non-adjacent
- **Turns**: Players alternate shots. Target node resolves hit/miss against their private board
- **Win**: First player to sink all opponent ships wins — once their own revealed board passes the audit

## Development

```bash
# Frontend
pnpm --dir app lint              # Lint
pnpm --dir app exec tsc --noEmit # Typecheck
pnpm --dir app build             # Production build
pnpm --dir app test              # Tests

# Logic (Rust)
cd logic
cargo fmt --check                                        # Format check
cargo clippy --target wasm32-unknown-unknown -- -D warnings  # Clippy
cargo build --target wasm32-unknown-unknown --profile app-release  # Build WASM

# Generate ABI clients for frontend (LobbyClient + GameClient)
pnpm --dir app codegen
```

## Architecture Docs

The [architecture documentation](https://calimero-network.github.io/battleships/) covers:

- Namespace hierarchy and capability configuration
- Multi-service bundle structure (lobby + game services)
- Private vs shared storage boundaries
- Cross-context calls (xcall) from game to lobby
- CRDT state sync and delta propagation
- Complete game flow from namespace creation to match completion
- Calimero platform features used (9 features)

## License

MIT
