# Cell number & date formatting — design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Feature #1** of the spreadsheet-parity backlog (formatting → copy/paste+absolute refs+fill → undo/redo → function library → dynamic grid).

## Goal

Let a user format the *display* of a cell as a Number, Currency, Percent, or Date without
changing the underlying value or how formulas evaluate it. This is the highest-visual-return,
lowest-architectural-risk step toward spreadsheet parity: it adds a per-cell format layer and a
client-side renderer, and touches the formula engine not at all.

Non-goal (explicitly out of scope for v1):
- **Serial-number date math.** Dates are display-only formatting of a parseable date string; there
  is no epoch, no `A1+1 = next day`, no `TODAY()/DATE()`. That is a separate, larger feature.
- **Adjustable decimals (+/- decimal control).** v1 uses a fixed default decimal count per type.
  The format encoding reserves room for it so it can be a fast-follow with no schema change.
- **Cell styling** (bold/colour/borders/alignment), conditional formatting — separate features.

## Architecture

Format is **stored in the CRDT** (so it syncs to every peer) but **rendered client-side** — JS
`Intl` is far richer and safer for locale-aware number/date formatting than no_std Rust in WASM.

```
CRDT (Rust/WASM)                    Frontend (React/TS)
────────────────                    ───────────────────
CellData { …, format: String }  ──► formatValue(computed_value, format) ──► grid cell display
set_cell_format(sheet,r,c,fmt)  ◄── ContextMenu "Format ▸ …" on selection
```

### Data model (Rust logic — `logic/crates/spreadsheet/src/lib.rs`)

- Add one field to `CellData`: `format: String` (default `""` = Automatic/General).
- Add one method: `set_cell_format(sheet_id, row, col, format) -> Result<String>`.
  - Creates the cell if absent (formatting an empty cell is allowed), else updates the format
    field only, preserving `raw_value`/`computed_value`.
  - Bumps `updated_at`; emits `CellUpdated`.
- `set_cell` / `set_cell_formula` **preserve** any existing `format` on the cell (read-modify-write
  keeps the field). `clear_cell` removes the whole cell (value + format), matching today's behaviour.
- **Merge semantics:** `CellData` remains whole-cell LWW. Concurrent value-vs-format edits to the
  *same* cell resolve to the LWW winner — same caveat as every other concurrent same-cell edit today.
  `CellData::merge` must copy `format` from the winning side alongside `raw_value`/`computed_value`.
- **Format encoding:** a compact, colon-delimited string, extensible without a schema change.
  v1 values: `""` (Automatic), `number`, `currency`, `percent`, `date`. Future growth (not v1):
  `number:2`, `currency:USD`, `percent:1`, `date:iso`.

### Rendering (frontend — the testable core)

Pure function `formatValue(computedValue: string, format: string): string` (new module,
`app/src/spreadsheet/format.ts`), rendered by the grid in place of the raw computed value:

| format      | behaviour                                              | example              |
|-------------|--------------------------------------------------------|----------------------|
| `number`    | `Intl.NumberFormat`, 2 decimals, thousands separator   | `1234.5` → `1,234.50`|
| `currency`  | symbol + 2 decimals (default `$`/USD, swappable later) | `1234.5` → `$1,234.50`|
| `percent`   | ×100, append `%`, 0 decimals                           | `0.25` → `25%`       |
| `date`      | parse ISO/parseable date, render `YYYY-MM-DD`          | `2026-07-08` → `2026-07-08` |
| `""` / other| return the raw computed value unchanged                | `hello` → `hello`    |

Fallback rule: if the computed value does not parse as a number (for number/currency/percent) or as
a date (for date), return the raw computed value unchanged — never show `NaN`/`Invalid Date`. Error
strings like `#REF!` pass through untouched.

The grid shows `formatValue(cell.computed_value, cell.format)`. The **formula bar continues to show
`raw_value`** (unformatted). Because `formatValue` is pure, the bulk of the tests live here in
vitest with no node required.

### UI (frontend — right-click context menu)

- New `ContextMenu` component + a `contextmenu` handler on `SpreadsheetGrid`:
  prevent the native menu, position the menu at the cursor, capture the target cell/selection.
- One submenu: **Format ▸ Automatic · Number · Currency · Percent · Date**, with a check mark by
  the currently-active format (of the anchor cell).
- Applies to the **entire current selection** (reuses existing range selection), calling
  `ss.setCellFormat` for each cell in the rectangle.
- Dismiss on outside-click / Escape / scroll.

## Testing

- **Rust (`logic`):**
  - `set_cell_format` persists the format on a new and an existing cell.
  - `set_cell` / `set_cell_formula` preserve an existing format.
  - `CellData::merge` carries `format` from the LWW winner.
- **TS (`app`, the bulk):** `formatValue` unit tests — each type; negatives; zero; non-numeric input
  (passthrough); empty string; `#REF!` passthrough; percent of a fraction; currency grouping; a
  parseable date and an unparseable date (passthrough).
- **CSV export:** exports the **formatted display** (what the user sees), i.e. `formatValue(...)`.

## Rollout

This is a wasm change (new field + method + ABI/codegen), so:
1. Rust: add field + method + tests → `cargo test`.
2. Frontend: `format.ts` + tests, `ContextMenu`, grid wiring, regenerate ABI client → `tsc` + `vitest`.
3. `build-bundle.sh` → reinstall on the dev node (meroctl 0.11.0-rc.8 + cached admin token path).
4. Verify in a **fresh workspace** (contexts are version-locked to the wasm they were created with).

## Open decisions — resolved

- Fixed default decimals in v1 (no +/- control): **approved.**
- Date as display-only formatting of ISO strings (no date arithmetic): **approved.**
