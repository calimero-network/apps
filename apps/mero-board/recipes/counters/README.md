# Recipe: counters (`GCounter` / `PNCounter`) and votes

CRDT counters for likes, reactions, tallies, stock — anything many peers
increment concurrently and nobody gains by inflating. Two flavours:

- **`GCounter`** = `Counter<false>` — increment-only (page views, total likes).
  `increment()`, `value() -> u64`.
- **`PNCounter`** = `Counter<true>` — increment **and** decrement (stock,
  net adjustments). `increment()`, `decrement()`, `value_signed() -> i64`.

Each device's increments are tracked in their own slot and merged
conflict-free, so concurrent `+1`s from different nodes all count (no lost
updates). That is ALL a counter guarantees: it does not know who incremented
it, one person with two devices has two slots, every call adds one, and a plain
counter field is writable by any member — a patched node can set it to
anything. Use counters for tallies nobody gains by inflating (views, likes).

**Votes are not counters.** One vote per person, that nobody else can cast or
change, is a row per `(item, account)` in an `Authored<IndexedMap>` owned by the
voter, and a tally that counts a row only when its key names its owner.

`counter.rs` shows both: a global `GCounter` like tally, and per-item votes as
owned rows with an `item_id` index so a score is a seek. Drop the fields into a
service state and the methods into its logic impl, then rebuild WASM +
regenerate the client.
