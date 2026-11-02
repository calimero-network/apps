# Battleships contract

A `calimero:app` component on core's component SDK: the lobby (players,
matches, results, stats) and every match's game in one app instance. See the
app's [README](../README.md) for the design, the trust model and what changed
from v1.

- `src/lib.rs` — the contract: `#[app::state]`, every method, the typed
  errors and the events.
- `crates/rules` — the rules with no SDK: the board and its cells (`board`),
  ships and the fleet (`ships`, `validation`), the reference placement the
  client's `lib/board.ts` mirrors (`players`), the board commitment and the
  audit every reveal goes through (`audit`). Its unit tests pin the commitment
  vector the client test shares.
- `tests/harness.rs` — whole matches on core's wasmtime engine (`TestApp`).
- `scenarios/*.json` — neutral steps run by `cargo test` and on `merod local`.

```bash
cargo test                                                                    # rules + harness + scenarios
cargo run --release --manifest-path ../../../tools/component-bundle/Cargo.toml -- build .   # res/abi.json
```
