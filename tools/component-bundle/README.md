# mero-component

Builds a component app (`calimero-app-sdk`, `wasm32-wasip2`) and packs it into
a signed `.mpk`, with core's own `calimero-app-build`, `calimero-bundle` and
`mero-sign` at `component-core-tag` (root `Cargo.toml`). `cargo mero bundle` at
that tag builds v1 (`wasm32-unknown-unknown`) apps only.

```bash
M=tools/component-bundle/Cargo.toml
cargo run --release --manifest-path $M -- build   apps/<app>/logic                # res/<lib>.wasm + res/abi.json
cargo run --release --manifest-path $M -- bundle  apps/<app>/logic --dev          # dev key: merod local only
cargo run --release --manifest-path $M -- bundle  apps/<app>/logic --key key.json --app-version 1.2.3
cargo run --release --manifest-path $M -- inspect dist/<package>-<version>.mpk    # files + verified manifest
cargo run --release --manifest-path $M -- abi     apps/<app>/logic/res/<lib>.wasm
```

The bundle is what `cargo mero bundle` writes for a single-service v1 app:
`manifest.json` first (signed), `app.wasm`, and the built frontend under
`frontend/` when `frontend-dir` (or `--frontend-dir`) names one. It reads the
same `[package.metadata.calimero]` keys; `min-runtime-version` must be set.
There is no `abi` artifact: the component carries its ABI in its own
`calimero:abi` section, which is what the node reads. Multi-service bundles and
cargo-mero's built-in default icon are not supported.

A standalone crate (its own `[workspace]` and `Cargo.lock`); CI runs `cargo
fmt`, `clippy -D warnings` and `cargo test` on it. See
[docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).
