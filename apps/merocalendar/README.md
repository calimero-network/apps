# Mero Calendar

A collaborative, peer-to-peer calendar built on the [Calimero](https://calimero.network)
network. Shared team calendars and truly private events — your schedule lives on
your own nodes, shared only with the people you invite.

- **Teams = namespaces.** A team is a Calimero namespace; everyone in the team
  shares **one** calendar context. Invite teammates with a code, and events sync
  P2P between your nodes.
- **Shared events** are owner-gated: a member only ever sees events they own or
  were invited to (as a peer).
- **Private events** use the SDK's `#[app::private]` node-local storage — they
  live only on your node and are **never** replicated to anyone else.
- **Display names**, light/dark themes, and a refreshed, accessible color palette
  for events.

## Architecture

| Layer | Path | Stack |
|-------|------|-------|
| Contract ("logic") | `logic/` | Rust → WASM, `calimero-sdk` / `calimero-storage` `0.11.0-rc.25` |
| Frontend ("app") | `app/` | React 19 + Vite 6, `@calimero-network/mero-react` + `mero-js` + `mero-ui` |

The contract keeps shared events in synced CRDT state (`UnorderedMap`), members +
usernames in synced state, and private events in node-local `#[app::private]`
storage. The frontend talks to a node over JSON-RPC (`execute`) and subscribes to
state changes over SSE.

## Prerequisites

- Rust + `wasm32-unknown-unknown` target (pinned by `logic/rust-toolchain.toml`)
- [`cargo-mero`](https://github.com/calimero-network/core/tree/master/tools/cargo-mero),
  pinned to the same core tag as the SDK — the ABI emitter is versioned with core:
  ```bash
  cargo install --git https://github.com/calimero-network/core --tag 0.11.0-rc.25 cargo-mero
  ```
- Node 20+ and `pnpm`
- A local [`merod`](https://github.com/calimero-network/core) node for development
- `merobox` + Docker for the workflow/integration tests (optional)

## Quick start

```bash
# Build the contract and install frontend deps
make setup

# Start a local node (builds the WASM, installs the app, creates a team calendar)
make dev-node

# Run the frontend (http://localhost:5174)
make frontend
```

Or the full two-node P2P stack in one shot:

```bash
make dev          # node1 + node2 + invite + frontend
```

Open the app, connect your node, create or join a team, and start scheduling.

## Build

```bash
make logic-build     # logic/src → logic/res/{merocalendar.wasm,abi.json,state-schema.json}
make app-build       # frontend → app/dist
make build           # both
make bundle          # dev-signed .mpk → logic/dist/ (fine locally, refused by the registry)
make bundle-release  # publishable .mpk, signed with $MERO_SIGN_KEY_FILE
make publish         # push a built .mpk to the App Registry (needs $CALIMERO_API_KEY)
```

`cargo mero` reads the bundle manifest — package, slug, icon, tags, links,
`minRuntimeVersion` — straight out of `[package.metadata.calimero]` in
`logic/Cargo.toml`; there is no hand-written `manifest.json` to keep in sync.
The release version is not taken from that file either: `--bump patch` asks the
registry for the highest published `appVersion` and increments it.

## Test

```bash
make logic-test-rust   # Rust unit tests (cargo test)
make unit              # frontend unit tests (vitest)
make e2e               # Playwright mocked e2e (no node needed)
make logic-test        # merobox single-node contract workflow (needs Docker)
make workflows         # merobox two-node sync workflow (needs Docker)
make integration       # Playwright integration tests against a running node
```

The contract is covered by Rust `TestHost` unit tests and a merobox
`logic-test.yml` workflow; the frontend has mocked Playwright specs (CI) and
integration specs that run against a real merobox-bootstrapped node.

## Project layout

```
logic/                Rust smart contract (the calendar state machine)
  src/lib.rs          contract: events, members, private events + #[cfg(test)] tests
  Cargo.toml          SDK pins + [package.metadata.calimero] bundle manifest
  build.sh            shim over `cargo mero build`, kept for scripts/dev-node.sh
app/                  React frontend
  src/api/            rpc.ts (JSON-RPC + admin-api), dataSource, appId
  src/pages/          landing, login, teams, calendar
  src/components/      calendar views + shared UI
workflows/            merobox workflow tests (e2e, integration-setup, logic-test)
scripts/              dev-node / dev-node2 / dev-invite / workflows runner
.github/workflows/    CI (unit + e2e + rust), integration, merobox, release
```

## License

MIT © Calimero Network
