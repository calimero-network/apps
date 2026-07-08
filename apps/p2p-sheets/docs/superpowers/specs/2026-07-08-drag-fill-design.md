# Drag-fill (with absolute-ref shifting) — design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Feature #2a** of the spreadsheet-parity backlog. First of two sub-projects under
"copy/paste + absolute refs + fill"; the sibling **copy/paste** (2b) reuses this feature's
reference-shifting engine. Backlog after these: undo/redo → function library → dynamic grid.

## Goal

Let a user drag a fill handle to fill a formula or a numeric series across adjacent cells,
with references shifting correctly — relative refs shift by the drag offset, `$`-anchored
(absolute) refs stay fixed. This builds the shared reference-shifting engine that copy/paste
will reuse, so absolute-ref support lands here (it has no observable effect without fill/copy).

Non-goals (explicitly out of scope for v1):
- **Copy/paste** — the sibling sub-project (2b), built next on this engine.
- **Date / text series** (Jan→Feb, Mon→Tue) — only numeric arithmetic series in v1.
- **Up / left fill and 2D diagonal fill** — v1 fills **down or right** (single axis), matching the
  bottom-right handle. `shiftFormula` itself handles arbitrary offsets (so copy/paste can go any
  direction later), but the fill UI only drives down/right.
- **Series with a stored "fill type" choice** (copy vs series toggle) — v1 auto-decides from the
  source (single cell → copy; 2+ numeric with a consistent step → series).

## Architecture

Fill computes new cell contents **client-side** and writes them through the existing
`setCell` — **no new Rust method**. Three units:

```
shiftFormula(formula, dRow, dCol)   pure TS — shift refs, keep $-anchored fixed   (the reusable engine)
fillSeries(sourceValues, count)     pure TS — numeric step detection / copy
Rust evaluator                      tolerate `$` in refs so =$A$1 evaluates like =A1  (only wasm change)
Fill UI                             handle at selection's bottom-right + drag → apply
```

### `shiftFormula(formula: string, dRow: number, dCol: number): string` — pure TS

New module `app/src/spreadsheet/shift.ts`. Scans a formula string and rewrites every cell/range
reference, shifting the row by `dRow` and the column by `dCol`, **except** components prefixed
with `$` (absolute), which stay fixed. Non-reference text (numbers, operators, function names) is
untouched.

Reference forms handled:
- Cell: `A1`, `$A1` (abs col), `A$1` (abs row), `$A$1` (abs both).
- Range: `A1:B2` and any mix of absolute endpoints — shift each endpoint independently.
- Cross-sheet: `Sheet1!A1`, `'Sheet 1'!A1:B2` — shift the cell part, keep the sheet qualifier
  (reuses the quoting rules from feature-set already in the codebase).
- Whole-column / whole-row (`A:A`, `1:1`): shift the column (for `A:A`) or row (for `1:1`) by the
  relevant offset; `$` anchors them.
- **Out-of-range shift** (row < 1 or col < 0 after shifting) → the reference becomes `#REF!` in the
  output formula (Excel/Sheets behavior). Non-formula source text is returned unchanged.

This mirrors, in TS, the reference-rewriting approach already used in Rust for rename
(`rewrite_sheet_qualifiers`): a character scan that recognizes quoted names and bare tokens.

### `fillSeries(sourceValues: string[], count: number): string[]` — pure TS

New module `app/src/spreadsheet/series.ts`. Given the source cells' **computed/raw values** and a
target `count`:
- **1 source value** → repeat it verbatim `count` times (a lone number is copied, not incremented).
- **2+ values, all numeric, constant difference** → continue the arithmetic sequence (`1,2 → 3,4,5`;
  `5,10 → 15,20`). Step = last − prev.
- **Otherwise** (non-numeric, or no constant step) → repeat the source pattern cyclically.

### Fill orchestration (frontend)

When a fill is applied over a target rectangle extending the source range down or right:
- For each target cell, find its **source cell** (the corresponding cell in the source range, by
  position modulo the source dimensions along the fill axis) and its offset `(dRow, dCol)` from that
  source.
- If the source cell holds a **formula** (`raw_value` starts with `=`) → write `shiftFormula(raw, dRow, dCol)`.
- Else if the whole source range is a **numeric series** → write the `fillSeries` value for that
  position.
- Else → copy the source cell's `raw_value` verbatim.
- **Copy the source cell's `format`** (feature #1) to each target via `setCellFormat`.
- Writes go through the existing `ss.setCell` / `ss.setCellFormat` per target cell.

### Rust evaluator tolerance

`logic/crates/spreadsheet/src/lib.rs`: the formula evaluator's reference parsing (`parse_cell_ref`
and the ident/quoted-ref paths) must **skip `$` characters** so `=$A$1`, `=A$1`, `=$A1` evaluate
identically to `=A1`. `$` is purely a fill/copy anchor; it has no effect on evaluation. This is the
only wasm change.

## UI — the fill handle

`app/src/components/SpreadsheetGrid.tsx`:
- Render a small square handle at the **bottom-right corner of the current selection** (single cell
  or range).
- Mouse-down on the handle starts a **fill drag** (a `fillDrag` state distinct from selection-drag);
  as the pointer moves down or right, highlight the prospective fill target with a dashed outline.
- On mouse-up, the grid reports the source range + target rectangle to `AppPage`, which runs the
  fill orchestration and writes the cells.
- Fill axis = whichever of down/right the drag traveled farther; the target extends the source along
  that one axis only (no diagonal).

## Testing

- **TS (bulk, TDD):**
  - `shift.ts`: relative shift; `$col`/`$row`/`$both` fixed; range endpoints; cross-sheet (sheet kept,
    cell shifted); whole-column/row; out-of-range → `#REF!`; non-formula passthrough; `dRow`/`dCol` = 0.
  - `series.ts`: single-value copy; ascending/descending/step≠1 arithmetic; non-numeric cyclic repeat;
    two-value step detection.
- **Rust:** `=$A$1`, `=A$1+$A2`, and a `$`-qualified range evaluate identically to their un-`$` forms.

## Rollout

Evaluator change is a wasm edit, so:
1. Rust: `$`-tolerance + tests → `cargo test`.
2. Frontend: `shift.ts` + `series.ts` + tests (TDD), fill-handle UI + orchestration → `tsc` + `vitest`.
3. `build-bundle.sh` → reinstall on the dev node (refresh token if 401, per the meroctl `nodes.toml`
   path) → verify drag-fill in a **fresh workspace** (contexts are version-locked).

## Open decisions — resolved

- Fill trigger = drag handle (not keyboard): **approved.**
- Series = numeric arithmetic only; direction = down/right single-axis: **approved.**
- Fill semantics (single-cell copy, multi-cell series, formula shift, formats copied): **approved.**
