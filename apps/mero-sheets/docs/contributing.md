---
title: Contributing
layout: default
nav_order: 6
---

# Contributing

## Prerequisites

- Node 22 (`.nvmrc`) + pnpm (via `corepack enable`)
- Rust toolchain with `rustup target add wasm32-unknown-unknown`
- `wasm-pack` **0.13.1** (pinned — the committed client WASM artifact must match)
- For smoke/perf e2e: Docker + `merobox` (`pipx install merobox`)

## Build

```bash
pnpm install
pnpm app:build        # client → app/dist
pnpm logic:build      # WASM app bundle (.mpk)
bash logic/build-recalc-wasm.sh   # regenerate the client recalc WASM artifact
```

## Test

```bash
# client unit tests (vitest)
pnpm --filter ./app test

# perf generators/bench (pure Python, no Docker)
cd test/perf/lib && python3 -m pytest

# two-node smoke workflow (Docker)
pnpm test:smoke

# node-level scenarios (Docker + merobox), from logic/ after
# `cargo mero bundle` has written dist/com.calimero.mero-sheets.mpk
merobox bootstrap run workflows/spec-smoke.yml   # every shared-state method, two nodes
merobox bootstrap run workflows/links.yml        # linked workbooks over xcall

# node-side perf sweeps (Docker) — see the Perf suite page
bash test/perf/run-perf.sh

# client e2e (Playwright)
cd app && npx playwright test
```

The Playwright global setup starts real `merod` nodes (three by default,
`NODE_COUNT` to change it) bootstrapped to each other, and installs the bundle
on each. Specs seed their own state through the UI with the helpers in
`app/e2e/helpers.ts`: `openNewWorkbook` creates a workbook on a node,
`enterCell` types into a cell, and `withTwoMembers` has a second member join
from another node with an invitation link, so the collaboration specs run
across real nodes. Start from fresh nodes: a node that has kept dozens of
workbooks from earlier runs syncs them all and slows every spec down.

## CI

Every contract method must be called by a merobox scenario under
`logic/workflows/` (`scripts/check-merobox-coverage.py`, in the monorepo's
App metadata job); a new method needs a step there in the same change.

- **`verify.yml`** — Calimero-Studio-managed gate; fires on `workshop/**` /
  `ai-builder/**` branches (dormant on `main`).
- **`recalc-wasm-freshness.yml`** — on PRs touching the recalc crates, rebuilds
  the client WASM artifact and fails if it drifts from the committed copy.
- **`pages.yml`** — builds and deploys this docs site to GitHub Pages.
