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

The engine implements 94 functions across math, statistics, logic, lookup,
text, dates and information: `SUM`/`SUMIFS`/`SUMPRODUCT`, `COUNTIF(S)`,
`AVERAGEIF(S)`, `MEDIAN`, `STDEV`, `IF`/`IFS`/`IFERROR`/`SWITCH`,
`VLOOKUP`/`HLOOKUP`/`XLOOKUP`/`INDEX`/`MATCH`, `TEXT`/`TEXTJOIN`/`SUBSTITUTE`,
`DATE`/`EDATE`/`EOMONTH`/`TODAY`/`NOW`, and more. The list lives in one
place, `CATALOG` in `logic/crates/recalc/src/formula.rs`: the contract's
`get_functions` serves it, the browser reads it from the WASM engine for the
function help and autocomplete, and a test evaluates every entry's example,
so the help can never list a function the engine does not implement.

Arguments can be single cell references, ranges or literals mixed together,
as in Excel or Google Sheets. A range passed to an aggregate contributes only
its numbers (text and blanks are skipped); a value typed into the call is
coerced, so `SUM("3", TRUE)` is 4. Criteria take the usual forms: `">5"`,
`"<>done"`, `"a*"` (wildcards `*` and `?`, `~` to escape).

## Values and operators

Inside the engine a value is typed — number, text, logical, error, or empty —
so operators behave as a spreadsheet user expects: `+ - * / ^`, `&` for text,
`%` as a suffix, and the comparisons `= <> < <= > >=`, which yield `TRUE` or
`FALSE` (text compares case-insensitively; numbers sort before text before
logicals). `-2^2` is 4 and `2^3^2` is 64, as in Excel. Numbers display with at
most 15 significant digits, so `=0.1+0.2` shows `0.3`.

Dates are serial numbers counting days from 1899-12-30, the convention every
spreadsheet shares, so a date pasted from elsewhere means the same day here.
`TODAY()` and `NOW()` read the clock in UTC: the node's execution time on the
node, the browser's clock in the browser.

Transcendental math (`EXP`, `LN`, `LOG`, `POWER`, `^`) goes through the pure
Rust `libm` crate rather than std, so the node, the browser and native tests
share one implementation. std's versions come precompiled with an opcode
cargo-mero's `wasm-opt` rejects (see `logic/wasm-rustflags`).

## Ranges

A range is written `A1:B2` and expands to every cell in that rectangle.
Whole-column (`A:A`) and whole-row ranges are also supported, but
whole-column expansion is capped at `MAX_ROWS = 1000` rows — a formula that
needs to sum more than 1000 rows in a single column should use an explicit
range instead. Column references run from `A` to `ZZ` (`MAX_COLS = 702`),
and a whole-row range (`1:1`) spans all of them. Ranges
expand to their member cells individually rather than being tracked as a
compressed block dependency — simple and correct, at the cost of a larger
dependency graph on very wide ranges.

## Named ranges

A name stands for a reference: define `Costs` as `B2:B20` and write
`=SUM(Costs)`. Names are shared by everyone in the workbook
(`set_named_range` / `get_named_ranges` on the contract), stored with their
target in id form so they follow inserted and deleted rows, and resolved by the
engine through `Env::names`. A name must not read as a cell (`Q1`), a column
(`AB`) or a logical, and an unknown name evaluates to `#NAME?`.

## Rows and columns by id

References are resolved through each sheet's layout: which row id and column
id sit at each position (`layout.rs`). A single-cell reference names ids
directly; a range names its two corner ids and spans everything between them
in the current order, so a row inserted inside a range is part of it, as in
any spreadsheet. `to_display` and `to_stored` rewrite only the reference spans
of a formula (spacing, strings, function names and `$` anchors stay as
typed), converting between positions (what a person types) and ids (what is
stored).

## Cross-sheet references

A formula can reference a cell in another sheet with the `[id]!A1` syntax,
where `id` is the target sheet's id. This lets a summary sheet aggregate
totals computed elsewhere in the same workbook — the financial-model
scenario in the [performance report](performance) is built entirely around
this pattern. If the referenced sheet id doesn't exist, the reference
evaluates to `#REF!` rather than failing the whole computation.

## Errors

Errors are values in the family spreadsheet users already recognize:
`#DIV/0!`, `#VALUE!` (a value of the wrong type), `#NAME?` (an unknown
function or name), `#N/A` (a lookup that found nothing), `#NUM!`, `#REF!` for
a reference to a cell or sheet that doesn't exist, `#ERROR!` for a formula
that does not parse, and `#CYCLE!` for a cell that participates in — or
depends on — a circular reference. An error in an `IF` condition is the
result; it is never read as "true". Because evaluation
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
