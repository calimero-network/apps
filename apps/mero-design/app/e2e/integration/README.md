# Integration Tests

These tests run against a **real Calimero node** at `http://localhost:2430`.

## Prerequisites

1. A running node: `merod --home ~/.calimero/node1 run`
2. An application installed in a context
3. Set environment variables:
   ```
   INTEGRATION_NODE_URL=http://localhost:2430
   INTEGRATION_ACCESS_TOKEN=<jwt>
   INTEGRATION_CONTEXT_ID=<ctx-id>
   INTEGRATION_APP_ID=<app-id>
   ```

## Run

```bash
npx playwright test --project=integration
```

These tests are excluded from the default `npm run test:all` run (mocked only).
