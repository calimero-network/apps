# Recipe: counters (`GCounter` / `PNCounter`)

CRDT counters for likes, votes, reactions, tallies, stock, scores — anything
many peers increment concurrently. Two flavours:

- **`GCounter`** = `Counter<false>` — increment-only (page views, total likes).
  `increment()`, `value() -> u64`.
- **`PNCounter`** = `Counter<true>` — increment **and** decrement (votes,
  net score, stock). `increment()`, `decrement()`, `value_signed() -> i64`.

Each peer's contribution is tracked per-identity and merged conflict-free, so
concurrent `+1`s from different nodes all count (no lost updates). Use
`increment_for(&executor_id)` to attribute to a specific identity, or
`increment()` for the caller.

`counter.rs` shows both a per-key like counter (`UnorderedMap<Id, PNCounter>`)
and a global tally — drop the fields into a service state and the methods into
its logic impl, then rebuild WASM + regenerate the client.
