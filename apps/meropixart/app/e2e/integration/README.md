# Integration Tests

These specs run against a **real Calimero node** over JSON-RPC (no mocks, no
browser UI). They verify the MeroPixArt contract end-to-end: the seeded
document, the seeded layers/members, and layer/cursor round-trips.

## How CI runs them

`.github/workflows/integration-ci.yml` builds the WASM, then
`workflows/integration-setup.yml` bootstraps a two-node merobox stack with a
seeded "Integration Project" context before running:

```bash
pnpm exec playwright test --project=integration
```

The context/app ids minted by merobox are **discovered at runtime** from the
node's admin API (`/admin-api/contexts` + `/admin-api/contexts/{id}/identities-owned`),
so nothing needs to be threaded through from the bootstrap step.

## Running locally

Point them at any running node. Discovery still works, or you can pin the ids:

```bash
INTEGRATION_NODE_URL=http://localhost:2460 \
INTEGRATION_CONTEXT_ID=<ctx-id> \
INTEGRATION_EXECUTOR_KEY=<owned-identity> \  # optional; enables mutation tests
INTEGRATION_ACCESS_TOKEN=<jwt> \             # optional on an open dev node
pnpm exec playwright test --project=integration
```

If no node is reachable and no context is discovered, every test **self-skips** —
the suite is safe to run anywhere. They're excluded from the default mocked run
(`pnpm e2e` / `--project=mocked`).
