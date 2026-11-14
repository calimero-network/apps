---
title: Contributing
layout: default
nav_order: 4
---

# Contributing

The contract is a component on core's component SDK; the repo-wide guide is
[docs/COMPONENT-APPS.md](https://github.com/calimero-network/apps/blob/main/docs/COMPONENT-APPS.md).

## Prerequisites

- Rust with the `wasm32-wasip2` target (`rustup target add wasm32-wasip2`)
- Node 20+ and pnpm
- For the local cluster: core's `merod` at the pinned tag (Linux)

## Build and test

```bash
# contract: fmt, clippy (host and wasm32-wasip2), the TestApp harness and
# every scenarios/*.json, plus the recalc engine's unit tests
cd logic
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo clippy --target wasm32-wasip2 -- -D warnings
cargo test

# the component and its ABI (res/abi.json is committed and diffed in CI)
cd ../../..
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- build apps/mero-sheets/logic

# frontend
pnpm -F mero-sheets lint typecheck test build

# everything on merod local: the cluster, the component, the dev server on :5173
pnpm dev:local mero-sheets
meroctl local dev apps/mero-sheets   # the same with core's meroctl (1.0.0-rc.24 or later)
pnpm merod-local e2e mero-sheets   # every scenario as real accounts on three nodes
```

The browser's copy of the formula engine (`app/src/engine/recalc/`) is
committed; rebuild it with `logic/build-recalc-wasm.sh` (wasm-pack) after a
change to `crates/recalc`.

## Scenarios

`logic/scenarios/*.json` are neutral steps run by `cargo test` on core's real
engine and by `pnpm merod-local e2e` on a three-node cluster. Each one's
`.org.json` names the accounts it needs. Add one for every new method.
