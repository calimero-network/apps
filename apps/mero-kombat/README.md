# Mero Kombat

A one-on-one arcade fighting game where every punch is a transaction.

Two fighters, two corners, best of three rounds — uppercuts, sweeps, flying
kicks and a special each. An arena is a Calimero context replicated between the
two fighters' own nodes. There is no game server: movement streams peer to peer
over ephemeral presence, and every action a fighter finishes is a contract call
on their node, gossiped to the other. Health, rounds and the winner are derived
by the contract from those calls, and the arena shows the transaction count,
throughput and confirm time live while you fight.

```
apps/mero-kombat/
├── logic/                  Rust → WASM. The whole backend.
│   ├── src/lib.rs          corners, actions, the damage table, rounds and matches derived on read
│   ├── src/tests.rs        TestHost tests: who may fight, what a blow is worth, how a match ends
│   └── workflows/          merobox e2e: two real nodes fighting a full match
└── app/                    Vite + React + TypeScript
    ├── src/game/           the engine: physics, poses, renderer, stage, HUD, sound, CPU, netcode
    ├── src/generated/      the typed client — generated, committed, diffed in CI
    ├── e2e/                one node in a browser; e2e/journey two nodes; e2e/duel the recorded fight
    └── scripts/            icon generator
```

## Run it

```bash
pnpm install                         # once, at the repo root
cargo mero build -p mero-kombat      # emits res/mero_kombat.wasm + res/abi.json
pnpm -F mero-kombat codegen          # regenerates src/generated from that ABI
pnpm -F mero-kombat dev              # http://localhost:5173
```

**No node?** Open `/practice` and fight the CPU. Nothing in practice is a
transaction; it is the same engine with nobody on the other side of the network.

Controls: **A/D** move, **W** jump, **S** crouch, **J** punch, **K** kick,
**L** block, **I** special. Crouch + punch is an uppercut, crouch + kick a sweep,
kick in the air a flying kick. Arrows + Z/X/C/V work too, and the keycaps under
the arena are pressable on a touch screen.

## The design, in three decisions

**Movement is presence; actions are transactions.** Where a fighter stands
changes sixty times a second and is worthless a moment later, so it travels over
the node's ephemeral channel (15 slices a second, never stored, no DAG growth).
Everything that decides the fight — a punch, a kick, a jump, a block — is one
`act` call when the action finishes, whether it connected or missed.

**Actions are stored; health never is.** State is
`WriteOnce<SortedMap<"<account>/<match>/<round>/<nonce>", Action>>`. Every read
sums the blows each corner landed in a round; the first round where a fighter
has taken 100 is decided, a double knock-out scores for nobody, and two round
wins take the match. A stored HP value could not converge — two nodes
subtracting concurrently would merge into a number no fight produced.

**The bars move now and settle on the contract.** A blow lands on the
attacker's screen first and travels in their next presence slice, so both bars
drop at once. Each blow carries the thrower's sequence number, and the contract
returns the same number with the blows it has counted, so the optimistic guess
and the stored truth are matched and nothing is subtracted twice.

## Trust

The attacker's client decides whether a blow connected — only it knows where its
own fist was. The contract bounds what a claim is worth (a fixed damage per move,
chip damage when blocked, a cap per round), refuses blows for rounds already
decided, and binds every row to its author with core's owner stamp, so a player
can only ever land blows for themselves. A modified client can claim blows it
did not land, as in any peer-to-peer fighting game; its own signed rows are the
record that it did.

## Tests

| Command | What it proves | Needs a node |
| --- | --- | --- |
| `cargo test -p mero-kombat` | corners, the damage table, rounds, best of three, rematches, the corner lock | no |
| `pnpm -F mero-kombat test` | the engine (hits, guards, launches, specials), the netcode (one tx per action, no double-counted blow), the generated client vs the ABI | no |
| `pnpm -F mero-kombat test:e2e` | the arena UI against a real node, and practice mode | a local `merod` |
| `pnpm -F mero-kombat test:journey` | two native nodes: login, invite, join, corners and blows crossing the wire | `merod` |
| `logic/workflows/fight-a-match.yml` | two merod containers fight a match through the contract and converge | Docker |
| `pnpm -F mero-kombat record:duel` | two nodes, two browsers, a full bot-fought match, stitched side by side into `test-results/duel/duel.mp4` | `merod`, ffmpeg |
