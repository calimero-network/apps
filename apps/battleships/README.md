# Battleships on Calimero

A two-player P2P battleship game built on [Calimero](https://calimero.network), using namespaces, multi-service bundles, client-side commit-reveal boards, and CRDT-based state sync.

**[View Architecture Docs](https://calimero-network.github.io/battleships/)**

## How It Works

Two players — each on their own node, or playing as an **account** through a relay — play battleships with fully decentralized state. Ship placements stay **on the player's device** (the contract holds only a SHA-256 commitment, then the reveal), while game state syncs automatically via **CRDTs** over gossipsub. The app uses four core Calimero features:

- **Namespaces** — identity scoping, recursive invitations, subgroup-based access control
- **Multi-Service Bundles** — two WASM services (lobby + game) in one `.mpk` bundle
- **Commit-reveal boards** — the board and salt live in the browser's storage; `commit_board` records the hash, `reveal_board` opens it at the end and every reader audits it. No `#[app::private]` storage, which is what lets an account play through a relay (a delegated execution has none)
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
│   ├── crates/game/              # GameState + 11 methods → game.wasm
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
| `game.wasm` | Game service — commitments, shots, answers, reveals and the audit |
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
6. **Place Ships** — each client lays out its fleet, saves `(board, salt)` in the browser (`app/src/lib/boardStore.ts`, keyed by player key and match id), and files `commit_board(match_id, SHA256(borsh(board) || salt))` — write-once
7. **Take Turns** — `propose_shot` → the defender's client reads the pending shot from `get_match_state`, answers it from the board on its device with `acknowledge_shot(match_id, shot_id, hit)` — automatically, no prompt — and the answer is on record for every reader
8. **Game Ends** — the answers show a fleet sunk → each client calls `reveal_board(match_id, board_bytes, salt)` → every reader checks the reveal against the commitment, checks it is a legal fleet, and replays every answer its owner gave; an answer that does not match marks that player a cheater and the game goes to the opponent → the audited winner is reported by `xcall` to the lobby → stats/history derived from it

## What holds against a patched node

A member can run a node that skips every check in the contract, so the game
rests on storage types every node enforces:

- **Who plays is `Frozen` at init** — player keys, their accounts, the match id
  and the lobby. Nobody can swap a player or point the result elsewhere.
- **Every commitment, shot, answer and reveal is a `WriteOnce` row**, owned by
  its author's account and immutable for everyone, the author included. Turn,
  pending shot, placement and winner are derived from those rows, never stored.
- **The contract never holds a board.** Boards and salts stay on the device
  that placed them. A node — the player's own, the opponent's, or the relay an
  account plays through — has only the commitment until the reveal.
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
two devices of one account writing different rows at the same millisecond
collide on one write-once key; and a board lives in one browser's storage —
place the fleet on another device, or clear site data mid-match, and that
device can neither answer shots nor reveal.

## Game Rules

- **Fleet**: 1x5 (carrier), 1x4 (battleship), 2x3 (cruiser, submarine), 1x2 (destroyer)
- **Placement**: Ships must be straight, contiguous, and non-adjacent
- **Turns**: Players alternate shots. The target's client answers hit/miss from the board on its device; the reveal is replayed against every answer
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
- Device-held boards vs shared, write-once rows
- Cross-context calls (xcall) from game to lobby
- CRDT state sync and delta propagation
- Complete game flow from namespace creation to match completion
- Calimero platform features used (9 features)

## Owned keys are per owner (core 0.11.0-rc.57)

Since core 0.11.0-rc.57 every owned collection (`Authored…`, `WriteOnce`, `Moderated`,
`ModeratedOnce`) is one namespace per account: two accounts writing one key hold two
independent entries, and a key-only `get`, `contains`, `owner_of`, `owned_by_me` or `remove`
acts on the CALLER's own entry only. This app was migrated:

- **Lobby.** A match is read through `match_of`: among the holders of its id, the entry
  owned by the account that registered the id's `player1` key (the lowest such holder
  otherwise). Result rows are read per key with every holder's account (`entries_at`),
  because both players' nodes can now file a report under the same key. Creating a match
  still refuses an id **any** account holds. Test:
  `an_entry_filed_under_someone_elses_match_id_is_never_the_match`.
- **Game.** A player's commitments, shots, answers and reveals are read as that player's
  own entry at each key (`get_by`), once per key.

## License

MIT
