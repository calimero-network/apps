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
`AuthoredMap<"<game>/<ply>/<author>/<nonce>", MoveRecord>`, and every position in
the app is derived by replaying it. That is what makes a chess game a CRDT: two
nodes that concurrently write the same ply — both players moving in the same
instant, each valid against the state their own node could see — land on
different keys, and the READER elects one of them by a total order over
(timestamp, encoded bytes). Both replicas elect the same winner and the game
continues from it. A stored board could not do this; it would merge field by
field into a position no game ever reached.

The record itself is two fields, `{ uci, at }`, and that is deliberate. Which
game a move belongs to, which ply it is, who played it and how it reads in
notation were all stored once — and every one of them was a value a forger could
set while the reader was working the same thing out for itself. A stored value
that nothing reads is not harmless; it is an invitation for the next reader to
trust it.

**The contract hands out the legal moves.** `table()` returns the position AND
every legal move in it, so the frontend contains no chess engine at all — it
highlights the squares the contract named. The board therefore cannot offer a
move the node would refuse, and a modified client cannot play one.

**Results are derived, not written.** Checkmate, stalemate, insufficient
material, fivefold repetition and the seventy-five-move rule are properties of
the move list, computed on read. Only an ending a *person* causes — a
resignation, an agreed draw, a claimed one — is stored, and even that is
re-checked before it counts. So the result can never disagree with the moves,
and the losing node reaches the verdict itself.

Threefold repetition and the fifty-move rule are **claims**, as they are in the
rules of chess: the table offers a button, and the game goes on until someone
presses it. Fivefold and seventy-five moves are automatic.

## What holds against a node that does not run this code

A peer's node folds an incoming delta into storage — verify the author's
signature, authorize them at their causal cut, apply the actions. It does **not**
execute this contract, and membership is the default write boundary, so a
patched node can put whatever bytes it likes into any entity it may write. The
checks inside `play` bind only the node that runs them. Two rules follow, and
they shape every read in `lib.rs`:

**Nothing is trusted that can be derived.** The position, the SAN, the ply
ordering, the result and the current game index are all recomputed on read. A
forged row is inert: it sits in storage and in the root hash, and no honest node
folds it into a position. That is quarantine at interpretation, not prevention
at write — the write cannot be prevented, because nothing re-executes at receive
time.

**Everything else is owned.** Every row a player writes lives in an
`AuthoredMap`, whose entries carry a `StorageType::User { owner }` stamp. Core
verifies a per-action signature against that owner inside
`Interface::apply_action` on every receive path — an unsigned remote `User`
action is refused outright — so a member cannot author a row as someone else.
Keys name their author, the reader re-checks the stamp, and a key carries a
per-write nonce so a row can never be *occupied* against its rightful author
(without it, any member — a spectator, not even a player — could park a row on
the key the next move needs and wedge the table permanently).

| attempt | what stops it |
|---|---|
| an illegal move | the replay re-validates every move in the position it would be played in |
| a row that describes a different game than the one it is in | there is nothing on it to lie with: the ply, the notation and the attribution are all the reader's arithmetic |
| a move authored for the other player | they cannot sign as that account; the key/stamp mismatch drops the row |
| moving twice, or slotting a row in at any ply | the ply sequence is the reader's arithmetic, and each ply expects one specific author |
| a forged resignation, draw or result | endings are re-derived: a resignation must lose, an agreement needs the offer it answered, a claimed draw must be available in that position |
| a rematch that erases a live game | the game index is counted, not read: it advances only past a finished game, claimed by a seat holder |
| seat theft | claims are per-claimant rows, elected by the reader, and only their author can write one |
| burying the table under junk rows | a read scans the move map ONCE and buckets by ply, and tests a row's named author before paying for its owner stamp — so the rows nobody can delete cost a string compare each, not a full rescan per ply |

Two things remain. A player can **stall**, and because `stand` is refused once a
game has started, a member who sits down and walks away leaves that table
unusable — griefing rather than a breach (a table is a context; another costs
nothing), and an abandon rule is the honest fix. And a read is still **linear in
the total rows** a member has written, because the collection offers no way to
iterate keys or a prefix: the constant is small now, the slope needs a core API.
Nothing above lets anyone change a result.

**[`docs/trust-model.md`](docs/trust-model.md) is the long version**, and it is
written for someone building their own app rather than for someone reading this
one: what the storage tiers (`Public`, `Authored`, `Shared`, `Permissioned`,
`Frozen`) actually enforce and when to reach for each, the fourteen defects this
app shipped and fixed with the exploit for each one, and a checklist to run over
your own `#[app::state]`. If you are not sure how to use permissions and data
models on Calimero, start there.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test -p mero-chess` | the rules, the contract, perft, forged rows written straight into storage, and two replicas converging on concurrent writes | no |
| `pnpm -F mero-chess test` | the board helpers and the generated client vs the ABI | no |
| `pnpm -F mero-chess test:e2e` | the UI playing a whole game against a real node | a local `merod` |
| `merobox bootstrap run workflows/play-a-game.yml` | two real nodes across five games: a mate, a declined offer then an agreed draw, a claimed threefold, a resignation, a chair given up | yes (Docker) |

**`tests/perft.rs` is the one worth knowing about.** Counting the leaf nodes of
the move tree from the five standard positions is the only test that catches the
whole class of bugs unit tests miss — a castling right that survives a rook
capture, an en-passant capture that exposes the king, a promotion that generates
one move instead of four. Each changes the count by a knowable amount and
nothing else notices. The expected numbers are the published ones, so a wrong
generator cannot agree with them by construction.

`tests/converge.rs` covers the case neither of the others can reach: two
replicas writing **at the same instant** without having seen each other — two
people reaching for the same chair, one person moving from two devices, both
players resigning together — asserted by root-hash equality plus invariants on
the merged value. A merobox scenario is a sequence, so nothing in it is ever
genuinely concurrent.

The byzantine tests at the bottom of `src/tests.rs` cover the other half. They
write rows directly into the contract's maps under another account — which is
what a patched node does — and assert no reader is fooled: a move written for
the player to move by somebody else, a row at a ply the game has not reached, a
squatted key, a forged resignation, a draw agreed with nobody, a seat claimed on
another player's behalf, a rematch claimed by a spectator.

They are in-crate rather than a `converge_app` suite because that harness cannot
carry authored entries at all — *"`Shared` / `Authored` / `User` / `Frozen`
storage need the node's signing identity … test those with merobox workflows"* —
which is why `logic/workflows/play-a-game.yml` now carries the weight of proving
authored state replicates between real nodes. The forgery path itself (a patched
node emitting a delta) has no automated coverage here; it is enforced by core's
`Interface::apply_action`, which core tests directly.

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
