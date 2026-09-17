# Mero Chess

Two-player chess where the board is not hosted anywhere.

A table is a Calimero context: two seats and a list of moves, replicated between
the players' own nodes. The **rules live in the contract** — legal moves, check,
mate, castling, en passant, promotion, and every one of the draws — so the node
you are talking to is the referee, and so is theirs.

```
apps/mero-chess/
├── logic/                  Rust → WASM. The whole backend.
│   ├── src/lib.rs          #[app::state], #[app::logic], #[app::event] — seats, moves, endings
│   ├── src/board.rs        position, move application, FEN
│   ├── src/movegen.rs      legal moves, check, mate, the terminal conditions
│   ├── src/notation.rs     UCI (the wire) and SAN (what a person reads)
│   ├── src/game.rs         replaying a move list into a position
│   ├── src/tests.rs        TestHost tests: who may sit, who may move, what ends a game
│   ├── tests/perft.rs      the standard perft positions — proof the movegen is right
│   ├── tests/converge.rs   3-replica convergence, no node, no wasm
│   ├── res/                abi.json + state-schema.json, emitted by `cargo mero build`
│   └── workflows/          merobox e2e: two real nodes playing a game
└── app/                    Vite + React + TypeScript
    └── src/generated/      the typed client — generated, committed, diffed in CI
```

## Run it

```bash
pnpm install                       # once, at the repo root
cargo mero build -p mero-chess     # emits res/mero_chess.wasm + res/abi.json
pnpm -F mero-chess codegen         # regenerates src/generated from that ABI
pnpm -F mero-chess dev             # http://localhost:5173
```

Install the bundle on a node, open the app, and use **Choose a table** — under
`AppMode.MultiContext` the auth callback returns tokens and an application id
and nothing else, so picking a table is the app's job. Invite the other player
with the link the table mints; they take the free seat.

**On your own?** Take both chairs. The contract allows one account to hold White
and Black on purpose — pass-and-play is how chess works when the other person is
in the room, and it is the only way to use the app before anyone else has a node.

## The design, in three decisions

**Moves are stored; a board never is.** State is
`UnorderedMap<"<game>/<ply>", MoveRecord>`, and every position in the app is
derived by replaying it. That is what makes a chess game a CRDT: two nodes that
concurrently write the same ply — both players moving in the same instant, each
valid against the state their own node could see — merge to ONE record by a
total order over (timestamp, encoded bytes), so both replicas elect the same
winner and the game continues from it. A stored board could not do this; it
would merge field by field into a position no game ever reached.

**The contract hands out the legal moves.** `table()` returns the position AND
every legal move in it, so the frontend contains no chess engine at all — it
highlights the squares the contract named. The board therefore cannot offer a
move the node would refuse, and a modified client cannot play one.

**Results are derived, not written.** Checkmate, stalemate, insufficient
material, fivefold repetition and the seventy-five-move rule are properties of
the move list, computed on read. Only an ending a *person* causes — a
resignation, an agreed draw, a claimed one — is stored. So the result can never
disagree with the moves, and the losing node reaches the verdict itself.

Threefold repetition and the fifty-move rule are **claims**, as they are in the
rules of chess: the table offers a button, and the game goes on until someone
presses it. Fivefold and seventy-five moves are automatic.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test -p mero-chess` | the rules, the contract, perft, 3-replica convergence | no |
| `pnpm -F mero-chess test` | the board helpers and the generated client vs the ABI | no |
| `pnpm -F mero-chess test:e2e` | the UI playing a whole game against a real node | a local `merod` |
| `merobox bootstrap run workflows/play-a-game.yml` | two real nodes playing to mate | yes (Docker) |

**`tests/perft.rs` is the one worth knowing about.** Counting the leaf nodes of
the move tree from the five standard positions is the only test that catches the
whole class of bugs unit tests miss — a castling right that survives a rook
capture, an en-passant capture that exposes the king, a promotion that generates
one move instead of four. Each changes the count by a knowable amount and
nothing else notices. The expected numbers are the published ones, so a wrong
generator cannot agree with them by construction.

`tests/converge.rs` covers the other half: two moves racing for the same ply, two
resignations crossing on the wire, two rematches at once. Each asserts both that
the replicas agree *and* what the surviving state says — a rule that loses data
deterministically converges too.

## The contract's surface

| method | what it does |
|---|---|
| `table(now)` | the whole table in one read: position, legal moves, seats, status, result, scoresheet |
| `history()` | every game played at this table, with its result |
| `join(name, now)` / `heartbeat(now)` | presence, so the other player's dot is honest |
| `sit(seat, name, now)` / `stand(now)` | take or leave a chair (leaving only before the first move) |
| `play(uci, now)` | play a move; returns its SAN |
| `resign(now)` | hand the game to the other side |
| `offer_draw(now)` / `accept_draw(now)` / `decline_draw(now)` | a draw offer, good only for the position it was made in |
| `claim_draw(now)` | threefold repetition or the fifty-move rule |
| `rematch(now)` | the next game, with the colours swapped |

Moves cross the wire as **UCI** (`e2e4`, `e7e8q`) because it is unambiguous
without a position; **SAN** (`Nf3`, `exd6`, `Qxf7#`) is computed once, by the
node that played the move, and stored alongside it — it depends on the position,
so two clients recomputing it could word the same move differently.

## Invitations and deep links

The `encodeInvitationPayload` family, ported from kv-store: a namespace
invitation plus the ids needed to open the table inside it, deflated and base58
encoded into `https://links.calimero.network/com.calimero.mero-chess/join?invitation=…`.
The deep link is captured before React mounts (see `src/main.tsx`) so it survives
the login reload, and redeeming it always asks first — following a link must not
join you to someone else's namespace on your behalf.
