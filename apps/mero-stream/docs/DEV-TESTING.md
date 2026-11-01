# Developing and testing Mero Stream

Mero Stream is a component app ([docs/COMPONENT-APPS.md](../../../docs/COMPONENT-APPS.md)).
Development runs against **`merod local`**: three nodes on `127.0.0.1:2501-2503`
in one process, mock attestation, passkey ceremonies trusted from
`http://localhost:5173`. It replaces v1's Docker dev nodes (`make dev-nodes`)
and the Docker workflows.

## A two-person call on one machine

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local mero-stream       # cluster + build + deploy + http://localhost:5173/
```

1. In a Chrome profile, **create an account** (a passkey), **create a stream**,
   then a **room**. You land in the call.
2. **Invite** (on the stream or the room) and approve with your passkey. Copy
   the link.
3. Open the link in a second Chrome profile, create an account there, and press
   **Join**. The room opens.
4. **Go live** in both. Each profile decodes the other's 640×480 H.264 from the
   node's presence channel.

Real Google Chrome is needed for H.264: a bundled Chromium without proprietary
codecs has no `VideoEncoder` for it. `/stream` (64×48, the approach-3 probe)
needs only a camera.

`pnpm dev:local` keeps the cluster's state in `.merod-local/` across runs
(`--fresh` starts over) and writes `app/.env.development.local`
(`VITE_CALIMERO_TARGET=local`, the node list, the bundle hash). The pieces run
separately too: `pnpm merod-local up`, `pnpm merod-local deploy mero-stream`.

## Tests

```bash
cargo test --manifest-path apps/mero-stream/logic/Cargo.toml   # TestApp harness + scenarios
pnpm -F mero-stream lint typecheck test build                   # the frontend
pnpm merod-local e2e mero-stream                                # scenarios on merod local
```

What each one covers is in the [README](../README.md#test-it). CI runs all three
(`.github/workflows/components.yml`); the e2e job downloads core's release
`merod` at the pinned tag.

## What is gone

v1's dev tooling drove merod 0.x nodes in Docker over JSON-RPC: `scripts/dev-node.sh`,
`dev-node2.sh`, `dev-invite.sh` (two nodes and a namespace invitation),
`e2e-live-call.sh` with the browser drivers in `app/e2e` (an unattended two-node
480p call, the invite UI flow, screenshots), the capacity ladder
(`workflows/probes`) and `scripts/load-curve.py`. None of it applies to a
component app; `pnpm dev:local` and two browser profiles replace the manual
call, and the scenarios replace the Docker workflows. An unattended browser
call and a load generator against `merod local` are not written yet.
