# KV Store

The reference Calimero app, and the template every other app in this repo is
shaped after.

An `UnorderedMap<String, LwwRegister<String>>` in a Rust/WASM contract, driven
from a TypeScript client **generated out of that contract's own ABI**.

```
apps/kv-store/
├── logic/                 Rust → WASM. The whole backend.
│   ├── src/lib.rs         #[app::state], #[app::logic], #[app::event] + TestHost tests
│   ├── tests/converge.rs  3-replica convergence, no node, no wasm
│   ├── res/               abi.json + state-schema.json, emitted by `cargo mero build`
│   └── workflows/         merobox e2e across two real nodes
└── app/                   Vite + React + TypeScript
    └── src/generated/     the typed client — generated, committed, diffed in CI
```

## Run it

```bash
pnpm install                     # once, at the repo root
cargo mero build -p kv-store     # emits res/kv_store.wasm + res/abi.json
pnpm -F kv-store codegen         # regenerates src/generated from that ABI
pnpm -F kv-store dev             # http://localhost:5173
```

Install the wasm on a node, then use the app's own **Choose a context** screen —
under `AppMode.MultiContext` the auth callback returns tokens and an application
id and nothing else, so context selection is the app's job.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test -p kv-store` | `TestHost` unit tests + 3-replica convergence | no |
| `pnpm -F kv-store test` | the generated client covers the ABI | no |
| `merobox bootstrap run workflows/simple-store.yml` | two real nodes converging | yes |

The `cargo test` layer is the one worth knowing about: `converge_app` and
`TestHost` drive real CRDT state through a native mock host, so convergence is
testable with no node and no wasm at all.

## The three behaviours the e2e pins down

Easy to get subtly wrong, and all three pass a naive test:

- **`update_if_exists` must not insert.** Asserted *before* any write, so the map
  is genuinely empty — run it after a `set` and it passes either way.
- **`get_or_insert` returns the EXISTING value**, not the argument. If it
  returned the argument, `or_insert` would be overwriting, which is the opposite
  of the entry API's point.
- **`remove` and `clear` emit nothing for a no-op.** Emitting for an absent key
  broadcasts a change that never happened.

## Two caveats worth carrying to the next app

**The ABI loses `Option<T>`.** `get(key) -> Option<String>` is recorded as
`"kind": "string"`, so the generated client types it `Promise<string>` when a
missing key really returns `null`. Codegen makes **method names and argument
names** compile-time facts; it does not make nullability one. Needs fixing in
core's ABI emitter.

**`get_unchecked` panics on purpose.** It is in the contract as the
counter-example — a panic aborts the whole execution, so nothing in that call
commits. Keep it; it is the cheapest demonstration of why `get_result` exists.
