# Copy / Cut / Paste + Delete — design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Feature #2b** of the spreadsheet-parity backlog. Sibling of drag-fill (2a); reuses
2a's reference-shifting engine (`shiftFormula`). Backlog after this: undo/redo →
function library → dynamic grid.

## Goal

Let a user copy, cut, and paste cells/ranges — with formula references shifting
correctly on copy (relative refs move by the paste offset, `$`-anchored refs stay
fixed) — and delete the contents of a selection. Interoperate with external
spreadsheets (Excel/Sheets) through the system clipboard as TSV. Reuse the pure
`shiftFormula(formula, dRow, dCol)` engine built in 2a.

Non-goals (explicitly out of scope for v1):
- **Paste-special** (values-only, formats-only, transpose) — easy follow-ups on this
  foundation.
- **Tiling** a copied block to fill a larger target selection (Sheets behavior) — v1
  anchors the block once at the selected cell.
- **Undo/redo** — the next backlog item; paste/cut/delete are ordinary writes for now.

## Architecture

Copy/paste computes new cell contents **client-side** and writes them through the
existing `setCell` / `clearCell` / `setCellFormat` — **no new Rust method, no wasm
change**. `shiftFormula` (2a) already handles arbitrary offsets, `$`-anchors, and
double-quoted string literals, so the whole feature is frontend wiring.

```
clipboard.ts   pure TS — region <-> TSV (computed values) for the system clipboard
paste.ts       pure TS — planPaste(payload, anchor): compute target writes
Native events  copy/cut/paste on the grid; Delete/Backspace clears the selection
Clipboard state  AppPage holds the internal payload + cut flag
```

### Clipboard mechanics — native events, hybrid fidelity

The grid container handles the browser's native `copy`, `cut`, and `paste` events.
`clipboardData` is available synchronously in these events, so no async clipboard
API and no permission prompts. Hybrid fidelity:

- **On copy / cut:** `e.preventDefault()`, then
  - write **TSV of the selection's computed values** to the system clipboard
    (`e.clipboardData.setData('text/plain', tsv)`), so external apps receive values;
  - stash a full-fidelity **internal payload** in AppPage state:
    `{ cells: { dr, dc, raw, format }[], rows, cols, cut, sourceRect, tsv }` where
    `dr`/`dc` are offsets from the selection's top-left, `raw`/`format` are the
    cell's stored values, and `tsv` is the exact string written to the system
    clipboard (used to detect our own copy on paste).
- **On paste:** `e.preventDefault()`, read `text = e.clipboardData.getData('text/plain')`.
  - If an internal payload exists **and** `text === payload.tsv` → it's our own copy:
    paste with **full fidelity** via `planPaste`.
  - Otherwise → **external** data: parse `text` as TSV (`fromTSV`) and paste the
    grid as **raw values** anchored at the selected cell (`format: ''`).

This makes in-app paste lossless (formulas + refs shift, formats copied) while
cross-app paste carries values both directions.

### `clipboard.ts` — pure TS

New module `app/src/spreadsheet/clipboard.ts`.

- `toTSV(values: string[][]): string` — join a rectangular grid of cell strings into
  TSV: cells joined by `\t`, rows by `\n`. No quoting (the formula language has no
  tab/newline literals; external tabs/newlines inside a cell are not a v1 concern).
- `fromTSV(text: string): string[][]` — split TSV into a grid: split on `\n` for rows
  (strip a single trailing `\n`), then `\t` for cells. Ragged rows are preserved
  as-is (short rows stay short).

The caller builds the `values` grid for `toTSV` from the selection's **computed**
values (so external apps get numbers, not `=SUM(...)`).

### `paste.ts` — pure TS

New module `app/src/spreadsheet/paste.ts`.

```
interface ClipCell { dr: number; dc: number; raw: string; format: string }
interface ClipPayload {
  cells: ClipCell[]; rows: number; cols: number;
  cut: boolean; sourceRect: Rect;
}
interface PasteWrite { row: number; col: number; raw: string; format: string }

planPaste(payload: ClipPayload, anchor: CellCoord): PasteWrite[]
```

For each `cell` in `payload.cells`, the target is `(anchor.row + cell.dr, anchor.col + cell.dc)`.
- **Copy** (`cut === false`): a formula (`raw` starts with `=`) is shifted by
  `shiftFormula(raw, anchor.row - sourceRect.top, anchor.col - sourceRect.left)`;
  a non-formula `raw` is written verbatim.
- **Cut** (`cut === true`): `raw` is written **verbatim** (no shift — a move keeps
  references pointing where they did, matching Excel/Sheets).
- Each write carries the cell's `format`.

Note the offset for copy equals `anchor - sourceRect.top-left`, which is exactly the
translation of the whole block, so `shiftFormula` shifts every relative ref by the
same delta a human would expect.

External paste does not use `planPaste`: the caller maps the `fromTSV` grid to
`PasteWrite[]` directly with `raw = value`, `format = ''`, anchored at the selected
cell.

### `rectCells` helper — pure TS

Small helper in `refs.ts` alongside `normalizeRect`:
`rectCells(rect: Rect): CellCoord[]` — enumerate every `{row, col}` in an inclusive
rect. Used by Delete (clear the selection) and by Cut's source-clear on paste.

### Grid bounds

The grid is a fixed `ROWS × COLS`. Any paste write whose target `row`/`col` falls
outside `[0, ROWS)` / `[0, COLS)` is **dropped** (clipped), so pasting a block near
the bottom-right edge writes only the cells that fit. `planPaste` returns all writes;
the AppPage write loop filters out-of-bounds targets before writing.

### Frontend wiring (AppPage + grid)

- **Clipboard state** in AppPage: `clipboard: ClipPayload | null`.
- **Copy/Cut:** on the native event, build the payload from the current selection
  (`selectionRange ?? single selectedCell`), write TSV, store payload (with
  `cut` set). Cut does **not** clear the source immediately — the source is cleared
  on the paste that consumes the cut (Excel/Sheets behavior); a cut that is never
  pasted leaves the source intact.
- **Paste:** internal → `planPaste` → `setCell`/`clearCell` + `setCellFormat` per
  write (same write loop shape as `handleFill`); if the consumed payload was a
  `cut`, afterward clear every cell in `payload.sourceRect` (content+format) and drop
  the clipboard. External → map `fromTSV` grid to writes anchored at the selection.
- **Delete/Backspace:** clear every cell in `rectCells(selectionRange ?? selectedCell)`
  via `ss.clearCell` (content **and** format). Replaces today's dead no-op case in the
  grid's `handleKeyDown` (the "Handled in AppPage" comment is stale — no handler
  exists, so Delete currently does nothing).
- The grid forwards native `onCopy`/`onCut`/`onPaste` from its container to AppPage
  callbacks; `Delete`/`Backspace` route through the existing keyboard handler.

### Visual — copied/cut region outline

- A **dashed outline** on the copied/cut source region (a transient prop on the grid,
  set from AppPage's clipboard state), so the user can see what's on the clipboard.
- Cut region rendered slightly **dimmer** than copy to distinguish move from copy.
- Cleared when: a paste consumes it, `Escape` is pressed, or a new copy/cut replaces it.

## Keyboard bindings

- **Copy:** Cmd+C (mac) / Ctrl+C — via the native `copy` event (fires for both).
- **Cut:** Cmd+X / Ctrl+X — native `cut` event.
- **Paste:** Cmd+V / Ctrl+V — native `paste` event.
- **Delete:** `Delete` or `Backspace` (when a cell is selected and not editing).
- **Escape:** clears the copied/cut region highlight.

Native `copy`/`cut`/`paste` events fire on the correct platform shortcut automatically,
so no manual Cmd-vs-Ctrl detection is needed. They only fire when the grid (or a child)
has focus and no text input is capturing the event, which is the desired scoping.

## Testing

- **TS (bulk, TDD):**
  - `clipboard.ts`: `toTSV` (grid → TSV, single cell, multi-row); `fromTSV` (parse,
    trailing newline stripped, ragged rows); round-trip.
  - `paste.ts`: `planPaste` copy (relative refs shift by the anchor delta; `$` fixed;
    cross-sheet qualifier preserved); cut (formulas verbatim, no shift); multi-cell
    block anchoring (each `dr/dc` placed correctly); format carried per cell.
  - `rectCells`: enumerates an inclusive rect (single cell, row, block).
- **Manual (in-browser, as with drag-fill 2a — no grid unit tests):** copy a formula
  block and paste (refs shift); cut and paste (source cleared, refs unchanged); copy
  to Excel/Sheets (values land); paste TSV from Excel (values land); Delete clears a
  range (content+format); Escape clears the marching outline.

## Rollout

Frontend-only — no wasm change, no reinstall, no namespace recreation.
1. `clipboard.ts` + `paste.ts` + `rectCells` + tests (TDD) → `vitest`.
2. Grid event forwarding + AppPage wiring + copied-region outline → `tsc`.
3. `npm run build` → reload the app → manual verification checklist above.

## Open decisions — resolved

- Clipboard model = **hybrid** (internal full-fidelity + system-clipboard TSV): **approved.**
- **Cut** included in v1 (move, refs unshifted, source cleared on paste): **approved.**
- Paste target = **anchor at the selected cell**, source dimensions (no tiling): **approved.**
- Delete = **content + format** (full wipe via `clearCell`): **approved.**
- Paste-special and tiling: **out of scope for v1.**
