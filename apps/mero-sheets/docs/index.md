---
title: Overview
layout: default
nav_order: 1
---

# mero-sheets

A collaborative, peer-to-peer spreadsheet built on [Calimero](https://calimero.network).
Live cursors, multiple sheet tabs, a formula engine with cross-sheet references,
formula autocomplete, and CSV download. One workbook is one app instance on a
Calimero 1.0 cluster, shared with the people in its organization.

## The two halves

- **`app/`** — a React + Vite + Tiptap client. It talks to the cluster through
  mero-js's `CalimeroClient` (passkey sign-in) and derives cell values with a
  client-side WASM copy of the recalc engine for instant echo.
- **`logic/`** — a `calimero:app` component (`wasm32-wasip2`) on core's
  component SDK. Only raw inputs are stored; computed values are **derived on
  read**. The same pure Rust engine also compiles to browser WASM.

## Start here

- [Architecture](architecture) — the inputs-only, derive-on-read model.
- [Recalc engine](recalc) — formulas, ranges, cross-sheet refs, client WASM.
- [Contributing](contributing) — build, test, and bundle.

> In production the frontend is the one packed into the app's bundle and served
> by the cluster; locally, `pnpm dev:local mero-sheets` runs `merod local`.
