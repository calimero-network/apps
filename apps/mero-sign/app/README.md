# Mero Sign: the web frontend

Vite + React, on mero-js's `CalimeroClient` through `@calimero-apps/connect`:
`merod local` under `vite`, the Calimero Cloud cluster in a production build.
See the app's [README](../README.md) for running it, the data layer and what
changed in the port to Calimero 1.0.

```bash
pnpm dev:local mero-sign          # from the repo root: merod local + deploy + this dev server on :5173
pnpm -F mero-sign lint typecheck test build
```
