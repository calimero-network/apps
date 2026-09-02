---
title: Recalc engine
layout: default
nav_order: 3
---

# Recalc engine

The recalc engine is the pure evaluator behind every computed cell in
mero-sheets. It has no CRDT awareness and no I/O: given a snapshot of raw
cell inputs, it returns computed values. That purity is deliberate — it is
what lets the exact same code run on the node (native Rust, evaluating on
read) and in the browser (compiled to WASM, evaluating instantly on every
keystroke), and guarantees the two always agree.

## Functions

Formulas support the standard aggregate set: `SUM`, `AVERAGE`, `COUNT`,
`MIN`, and `MAX`. Each takes one or more arguments, and arguments can be
single cell references, ranges, or literals mixed together — the same
shape a spreadsheet user expects from Excel or Google Sheets.

## Ranges

A range is written `A1:B2` and expands to every cell in that rectangle.
Whole-column (`A:A`) and whole-row ranges are also supported, but
whole-column expansion is capped at `MAX_ROWS = 1000` rows — a formula that
needs to sum more than 1000 rows in a single column should use an explicit
range instead. Column references are limited to a single letter (`A`–`Z`);
double-letter columns (`AA`, `AB`, …) are not currently parsed. Ranges
expand to their member cells individually rather than being tracked as a
compressed block dependency — simple and correct, at the cost of a larger
dependency graph on very wide ranges.

## Cross-sheet references

A formula can reference a cell in another sheet with the `[id]!A1` syntax,
where `id` is the target sheet's id. This lets a summary sheet aggregate
totals computed elsewhere in the same workbook — the financial-model
scenario in the [performance report](performance) is built entirely around
this pattern. If the referenced sheet id doesn't exist, the reference
evaluates to `#REF!` rather than failing the whole computation.

## Errors

Bad references and dependency cycles are reported as error values in the
same family spreadsheet users already recognize: `#REF!` for a reference to
a cell or sheet that doesn't exist, and `#CYCLE!` for a cell that
participates in — or depends on — a circular reference. Because evaluation
walks a topologically sorted dependency graph, cycle detection is exact: a
cell either has a well-defined evaluation order or it doesn't, with no
heuristic iteration limit involved. An error value read by a downstream
formula propagates, the same way `#DIV/0!` or `#VALUE!` would.

## How evaluation works

Evaluation happens in three phases. First, every formula is parsed to
extract the cells it reads — single references, expanded ranges, and
cross-sheet refs — producing a dependency graph. Second, that graph is
topologically sorted (using an iterative algorithm, not recursion, since
the runtime has no deep-stack guarantee), which also identifies any cell
that cannot be ordered because it sits on a cycle. Third, cells are
evaluated once each, strictly in dependency order, so every formula sees
its precedents' already-computed values. There is no fixed-point sweep and
no re-evaluation pass — a single, terminating walk over an acyclic graph.

This replaces an older design where every mutation re-evaluated the entire
workbook repeatedly until values stopped changing. That approach was both
slow (cost scaled with cell count times iteration count on every write) and
fragile under collaboration, since a merged CRDT update had no hook to
trigger recomputation on a peer that hadn't made the edit itself. The
current model stores only raw inputs in replicated state and derives
computed values fresh on every read — see [Architecture](architecture) for
why that split exists.

## One engine, two homes

The evaluator lives in its own dependency-free Rust crate (`recalc`),
compiled to two targets. On the node, it runs natively as part of the
`logic/` WASM application bundle, deriving values whenever a peer reads a
sheet — the authoritative computation used for late joiners and
cross-client verification. In the browser, the identical crate is compiled
to a small WASM module (`recalc-wasm`) and loaded by the `app/` client,
which keeps a warm, in-memory copy of every sheet's raw inputs and
re-derives affected values locally, in-process, on every keystroke — with
zero network round trip.

Because both the node and the client run the same deterministic function
over the same inputs, their outputs agree by construction: there is no
reconciliation logic between two independently-implemented engines, only
the client's usual job of merging its own optimistic, not-yet-synced edits
with whatever the node's replicated state confirms. The client-side WASM
artifact is built ahead of time and committed to the repo (see
[Contributing](contributing)) so that deploys don't need a Rust toolchain
on the build machine — only the prebuilt `.wasm` and its glue code, bundled
like any other client asset.
