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

# node-side perf sweeps (Docker) — see the Perf suite page
bash test/perf/run-perf.sh

# client e2e (Playwright)
cd app && npx playwright test
```

## CI

- **`verify.yml`** — Calimero-Studio-managed gate; fires on `workshop/**` /
  `ai-builder/**` branches (dormant on `main`).
- **`recalc-wasm-freshness.yml`** — on PRs touching the recalc crates, rebuilds
  the client WASM artifact and fails if it drifts from the committed copy.
- **`pages.yml`** — builds and deploys this docs site to GitHub Pages.
