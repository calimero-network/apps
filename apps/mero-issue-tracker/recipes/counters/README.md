# Recipe: a tally (`Counter`) and votes

- **`Counter`**: `increment()`, `add(delta)` (negative for v1's `PNCounter`),
  `get()`. One leader orders every write, so there are no per-device slots to
  merge; the count is a stored integer. It counts calls, not people: use it for
  tallies nobody gains by inflating (views, likes).
- **Votes are not counters.** One vote per person is a row keyed
  `(item, account)` with the account taken from `env::caller()`: a second vote
  replaces the first, and nobody can vote as someone else. v1 needed an
  `Authored<IndexedMap>` owner stamp for that; here the key is the check. A
  per-item sum kept beside the rows makes `score` one read, and a maintained
  count makes `voters` one read.

`counter.rs` is a complete app module (state, methods, error).
