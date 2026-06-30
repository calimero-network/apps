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
| Contract ("logic") | `logic/` | Rust → WASM, `calimero-sdk` / `calimero-storage` `0.11.0-rc.8` |
| Frontend ("app") | `app/` | React 19 + Vite 6, `@calimero-network/mero-react` + `mero-js` + `mero-ui` |

The contract keeps shared events in synced CRDT state (`UnorderedMap`), members +
usernames in synced state, and private events in node-local `#[app::private]`
storage. The frontend talks to a node over JSON-RPC (`execute`) and subscribes to
state changes over SSE.

## Prerequisites

- Rust + `wasm32-unknown-unknown` target, `jq`, `wasm-opt` (optional)
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
make logic-build   # logic/src → logic/res/merocalendar.wasm
make app-build     # frontend → app/dist
make build         # both
make bundle        # build WASM + create a signed .mpk release bundle
```

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
  build.sh            compile to res/merocalendar.wasm
  build-bundle.sh     package a signed .mpk (com.calimero.merocalendar)
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
