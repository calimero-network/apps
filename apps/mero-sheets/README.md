# mero-sheets

A collaborative, peer-to-peer spreadsheet built on [Calimero](https://calimero.network).
Live cursors, multiple sheet tabs, a formula engine (`SUM`/`AVERAGE`/`MIN`/`MAX`/
`COUNT`, cross-sheet references), formula autocomplete, and CSV download — with
all data replicated between peers as CRDTs, no central server.

- **Live app:** deployed on Vercel (see the repo's Deployments).
- **Docs:** https://calimero-network.github.io/mero-sheets/

## What it is

mero-sheets is two halves:

- **`app/`** — a React + Vite + Tiptap web client. It talks to a local
  [merod](https://github.com/calimero-network/core) node over Calimero's
  JS SDK and derives cell values with a client-side WASM copy of the recalc
  engine for instant echo.
- **`logic/`** — a Rust workspace compiled to a WASM application bundle
  (`.mpk`). The spreadsheet is an inputs-only CRDT; computed values are
  derived on read (`recalc`). The same pure Rust engine compiles to browser
  WASM for the client (`recalc-wasm`).

> **Note:** the Vercel deployment serves the client. A working end-to-end
> session needs a merod node the app can reach (local or hosted). See the
> [architecture docs](https://calimero-network.github.io/mero-sheets/architecture).

## Repo layout

| Path | What |
|---|---|
| `app/` | React/Vite client (the deployable SPA) |
| `logic/` | Rust → WASM bundle: `spreadsheet`, `recalc`, `recalc-wasm`, `types` |
| `test/` | perf workflows (`test/perf/`) + `spec-smoke.workflow.yml` |
| `docs/` | the docs site (Jekyll) + design history under `docs/superpowers/` |

## Quickstart

Requires Node 22 (`.nvmrc`), pnpm, a Rust toolchain with the
`wasm32-unknown-unknown` target, and (for the smoke test) Docker + merobox.

```bash
pnpm install              # install workspace deps

pnpm app:dev              # run the client dev server
pnpm app:build            # production build → app/dist (what Vercel deploys)

pnpm logic:build          # build the WASM app bundle (.mpk)

pnpm test:smoke           # two-node merobox smoke workflow (needs Docker)
cd test/perf/lib && python3 -m pytest    # pure perf-generator/bench tests
```

See [`docs/contributing.md`](docs/contributing.md) for the full build/test
matrix and [`docs/performance.md`](docs/performance.md) for engine benchmarks.

## License

TBD.
