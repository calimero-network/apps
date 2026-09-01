---
title: Overview
layout: default
nav_order: 1
---

# p2p-sheets

A collaborative, peer-to-peer spreadsheet built on [Calimero](https://calimero.network).
Live cursors, multiple sheet tabs, a formula engine with cross-sheet references,
formula autocomplete, and CSV download — all data replicated between peers as
CRDTs, with no central server.

## The two halves

- **`app/`** — a React + Vite + Tiptap client. It talks to a local merod node
  over Calimero's JS SDK and derives cell values with a client-side WASM copy of
  the recalc engine for instant echo.
- **`logic/`** — a Rust workspace compiled to a WASM application bundle (`.mpk`).
  The spreadsheet is an **inputs-only CRDT**; computed values are **derived on
  read**. The same pure Rust engine also compiles to browser WASM.

## Start here

- [Architecture](architecture) — how the CRDT + derive-on-read model works.
- [Recalc engine](recalc) — formulas, ranges, cross-sheet refs, client WASM.
- [Performance](performance) — node-side engine benchmarks.
- [Perf suite](perf-suite) — how to run the benchmark workflows.
- [Contributing](contributing) — build, test, and bundle.

> The Vercel deployment serves the **client**. A working session needs a merod
> node the app can reach — see [Architecture](architecture).
