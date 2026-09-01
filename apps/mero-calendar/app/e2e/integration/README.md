# Integration tests

These specs drive the **Mero Calendar contract** against a **real Calimero
node** over JSON-RPC — no mocks, no browser UI. They verify the seeded shared
event, member usernames, a create/read/delete round-trip, and that private
events stay out of the shared calendar.

## How CI runs them

`.github/workflows/integration-ci.yml` builds the WASM, then
`workflows/integration-setup.yml` bootstraps a two-node merobox stack with a
seeded calendar context before running:

```bash
pnpm exec playwright test --project=integration
```

merobox mints context/app ids dynamically, so the context is **discovered at
runtime** from the node's admin API (`/admin-api/contexts` +
`/admin-api/contexts/{id}/identities-owned`).

## Running locally

Point them at any running node (merobox node-1's RPC/Admin port is **2528**;
2428 is P2P):

```bash
INTEGRATION_NODE_URL=http://localhost:2528 \
INTEGRATION_CONTEXT_ID=<ctx-id> \         # optional; auto-discovered otherwise
INTEGRATION_EXECUTOR_KEY=<owned-identity> \ # optional; enables mutation tests
INTEGRATION_ACCESS_TOKEN=<jwt> \           # optional on an open dev node
pnpm exec playwright test --project=integration
```

If no node is reachable, every test **self-skips** — the suite is safe to run
anywhere. They're excluded from the default mocked run (`pnpm e2e`).
