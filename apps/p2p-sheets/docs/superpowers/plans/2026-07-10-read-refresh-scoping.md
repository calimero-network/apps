# Read/Refresh Scoping (Recalc Phase 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound spreadsheet read cost to what is on screen — node evaluates only the requested sheet's dependency closure, client fetches only the active sheet — with zero change to computed values.

**Architecture:** Node keeps derive-on-read and the `recalc::evaluate` seam; `get_cells` feeds the evaluator a sheet-level closure instead of the whole workbook. Client `refresh()` fetches only the active sheet and refetches it on any context sync (the node resolves cross-sheet dependencies during eval, so the active sheet stays correct); download fetches all sheets on demand.

**Tech Stack:** Rust (logic WASM crate `p2p-sheets-spreadsheet`, toolchain stable, `cargo test`); TypeScript + React (`app/`, vitest node-env for pure logic, `tsc` + `vite build` for wiring).

## Global Constraints

- The `recalc::evaluate` interface must NOT change — scoping is a caller-side choice of inputs.
- Scoped `get_cells` must return values **byte-identical** to whole-workbook eval.
- `WorkbookInputs.sheet_ids` must always be **all existing sheet ids** (not just closure ids), so unknown-sheet → `#REF!` stays exact.
- Client resident `cells` holds the **active sheet only**; freshness comes from refetching the active sheet on **any** context CRDT sync event (never narrowed to "active sheet's own cells changed").
- Download fetches every sheet's cells **on demand** at export time — it must not read resident `cells`.
- vitest runs **node env, pure-logic `.test.ts` only** (`app/vitest.config.ts`); there is no React hook test harness, so hook/handler wiring is verified by `tsc --noEmit` + `vite build`, and correctness of scoped reads is covered by the Rust node tests.

---

### Task 1: Node — `sheet_closure` pure helper

**Files:**
- Modify: `logic/crates/spreadsheet/src/recalc.rs` (add `pub(crate) fn sheet_closure` + tests in the existing `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: existing `CellRef { sheet_id: String, row: u32, col: u32 }`, `crate::formula::precedents(formula: &str, home_sheet: &str) -> Vec<(String, u32, u32)>` (already imported via `use crate::formula;`).
- Produces: `pub(crate) fn sheet_closure(cells: &BTreeMap<CellRef, String>, requested_sheet: &str) -> HashSet<String>` — the set of sheet ids that must be evaluated to compute `requested_sheet` correctly (the requested sheet plus every sheet transitively referenced by a formula in the closure).

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `logic/crates/spreadsheet/src/recalc.rs` (the module already has `use super::*;` and a `cr(sheet, row, col)` helper):

```rust
    fn inputs(pairs: &[(CellRef, &str)]) -> BTreeMap<CellRef, String> {
        pairs.iter().map(|(k, v)| (k.clone(), v.to_string())).collect()
    }

    #[test]
    fn closure_excludes_independent_sheets() {
        // S1 only self-references; S2 is unrelated → closure(S1) = {S1}.
        let cells = inputs(&[
            (cr("S1", 0, 0), "=A2"),
            (cr("S1", 1, 0), "5"),
            (cr("S2", 0, 0), "9"),
        ]);
        assert_eq!(sheet_closure(&cells, "S1"), ["S1".to_string()].into_iter().collect());
    }

    #[test]
    fn closure_includes_directly_referenced_sheet() {
        let cells = inputs(&[
            (cr("S1", 0, 0), "=[S2]!A1"),
            (cr("S2", 0, 0), "5"),
        ]);
        assert_eq!(
            sheet_closure(&cells, "S1"),
            ["S1".to_string(), "S2".to_string()].into_iter().collect()
        );
    }

    #[test]
    fn closure_is_transitive_and_drops_unrelated() {
        // S1 → S2 → S3 chained; S4 unrelated.
        let cells = inputs(&[
            (cr("S1", 0, 0), "=[S2]!A1"),
            (cr("S2", 0, 0), "=[S3]!A1"),
            (cr("S3", 0, 0), "5"),
            (cr("S4", 0, 0), "9"),
        ]);
        assert_eq!(
            sheet_closure(&cells, "S1"),
            ["S1", "S2", "S3"].iter().map(|s| s.to_string()).collect()
        );
    }

    #[test]
    fn closure_of_sheet_with_no_cells_is_self() {
        let cells = inputs(&[(cr("S2", 0, 0), "9")]);
        assert_eq!(sheet_closure(&cells, "S1"), ["S1".to_string()].into_iter().collect());
    }

    #[test]
    fn closure_handles_cross_sheet_cycle() {
        // S1 ↔ S2 mutually reference; closure(S1) must include both and terminate.
        let cells = inputs(&[
            (cr("S1", 0, 0), "=[S2]!A1"),
            (cr("S2", 0, 0), "=[S1]!A1"),
        ]);
        assert_eq!(
            sheet_closure(&cells, "S1"),
            ["S1".to_string(), "S2".to_string()].into_iter().collect()
        );
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd logic && cargo test -p p2p-sheets-spreadsheet sheet_closure closure_ 2>&1 | tail -20`
Expected: FAIL — `cannot find function sheet_closure in this scope`.

- [ ] **Step 3: Implement `sheet_closure`**

Add this function to `logic/crates/spreadsheet/src/recalc.rs` (module scope, e.g. directly above `pub struct WorkbookInputs`):

```rust
/// The set of sheet ids that must be evaluated to compute `requested_sheet`
/// correctly: the requested sheet plus every sheet transitively referenced by a
/// formula reachable from it. Sheet-level (not cell-level) reachability — a
/// touched sheet is included in full, so the result is robust to `precedents()`
/// under-reporting a range/whole-column ref and stays identical to a
/// whole-workbook evaluation. Terminates: `closure` grows monotonically and is
/// bounded by the finite set of sheet ids present in `cells`.
pub(crate) fn sheet_closure(
    cells: &BTreeMap<CellRef, String>,
    requested_sheet: &str,
) -> HashSet<String> {
    let is_formula = |raw: &str| raw.trim_start().starts_with('=');
    let mut closure: HashSet<String> = HashSet::new();
    closure.insert(requested_sheet.to_string());
    loop {
        let mut added = false;
        for (cell, raw) in cells {
            if !is_formula(raw) || !closure.contains(&cell.sheet_id) {
                continue;
            }
            for (sid, _row, _col) in formula::precedents(raw, &cell.sheet_id) {
                if closure.insert(sid) {
                    added = true;
                }
            }
        }
        if !added {
            break;
        }
    }
    closure
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd logic && cargo test -p p2p-sheets-spreadsheet sheet_closure closure_ 2>&1 | tail -20`
Expected: PASS — 5 tests pass. Then run the whole crate to confirm no regressions: `cd logic && cargo test -p p2p-sheets-spreadsheet 2>&1 | tail -5` — all green.

- [ ] **Step 5: Commit**

```bash
git add logic/crates/spreadsheet/src/recalc.rs
git commit -m "feat(recalc): sheet_closure — sheet-level dependency reachability"
```

---

### Task 2: Node — `get_cells` evaluates the closure only

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` — `get_cells` (currently lines ~586–614, the `WorkbookInputs` construction) and add a test to the `#[cfg(test)] mod tests` block.

**Interfaces:**
- Consumes: `recalc::sheet_closure(&BTreeMap<CellRef, String>, &str) -> HashSet<String>` (Task 1); existing `recalc::WorkbookInputs { cells, sheet_ids }`, `recalc::evaluate`.
- Produces: no new public surface — `get_cells(sheet_id: String) -> app::Result<Vec<Cell>>` unchanged in signature and output shape, only faster.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `logic/crates/spreadsheet/src/lib.rs` (uses the existing `make_app()` harness and the `app.call` / `app.view` pattern):

```rust
    #[test]
    fn get_cells_scoped_matches_cross_sheet_and_ignores_unrelated() {
        let mut app = make_app();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        let s2 = app.call(|s| s.create_sheet("Sheet 2".into())).unwrap();
        let s3 = app.call(|s| s.create_sheet("Sheet 3".into())).unwrap();

        // S2!A1 = 5 ; S1!A1 = S2!A1 + 100 (cross-sheet dependency).
        app.call(|s| s.set_cell(s2.clone(), 0, 0, "5".into())).unwrap();
        app.call(|s| s.set_cell_formula(s1.clone(), 0, 0, format!("=[{s2}]!A1+100")))
            .unwrap();
        // S3 has an unrelated self-cycle — must never affect S1's read.
        app.call(|s| s.set_cell_formula(s3.clone(), 0, 0, "=A1".into())).unwrap();

        // Scoped get_cells(S1) still resolves the cross-sheet ref correctly.
        let s1_cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let a1 = s1_cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "105");

        // get_cells(S3) still flags its own cycle — scoping doesn't hide it.
        let s3_cells = app.view(|s| s.get_cells(s3.clone())).unwrap();
        let c = s3_cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(c.computed_value, "#CYCLE!");
    }

    #[test]
    fn get_cells_scoped_preserves_ref_to_missing_sheet() {
        let mut app = make_app();
        let s1 = app.call(|s| s.create_sheet("Sheet 1".into())).unwrap();
        // Reference a sheet id that does not exist → #REF! (all sheet ids are
        // passed to the evaluator, so this stays exact under scoping).
        app.call(|s| s.set_cell_formula(s1.clone(), 0, 0, "=[nope]!A1".into()))
            .unwrap();
        let cells = app.view(|s| s.get_cells(s1.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.computed_value, "#REF!");
    }
```

- [ ] **Step 2: Run the test to verify it fails or passes-for-the-wrong-reason**

Run: `cd logic && cargo test -p p2p-sheets-spreadsheet get_cells_scoped 2>&1 | tail -20`
Expected: these tests actually PASS against the current whole-workbook `get_cells` (the values are correct today). That is intended — they are the **anti-regression baseline**: they must still pass after the scoping change. Confirm they pass now, then proceed; Step 4 re-runs them after the change to prove scoping preserves the values.

- [ ] **Step 3: Scope the inputs in `get_cells`**

In `logic/crates/spreadsheet/src/lib.rs`, replace the `WorkbookInputs` construction in `get_cells`. The current code builds `inputs.cells` by inserting every non-empty cell. Change it to (a) collect all non-empty cells into a map first, (b) compute the sheet closure, (c) keep only cells on closure sheets. Replace the block that currently reads:

```rust
        let mut inputs = recalc::WorkbookInputs {
            cells: std::collections::BTreeMap::new(),
            sheet_ids,
        };
        let mut stored: Vec<(String, CellData)> = Vec::new();
        for (k, d) in self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
        {
            if !d.raw_value.is_empty() {
                inputs.cells.insert(
                    recalc::CellRef { sheet_id: d.sheet_id.clone(), row: d.row, col: d.col },
                    d.raw_value.clone(),
                );
            }
            stored.push((k, d));
        }
        let computed = recalc::evaluate(&inputs);
```

with:

```rust
        // Collect all non-empty cells once; `stored` retains every cell (the
        // output for the requested sheet is filtered from it below).
        let mut all_inputs: std::collections::BTreeMap<recalc::CellRef, String> =
            std::collections::BTreeMap::new();
        let mut stored: Vec<(String, CellData)> = Vec::new();
        for (k, d) in self
            .cells
            .entries()
            .map_err(|e| AppError::msg(format!("cells.entries: {e}")))?
        {
            if !d.raw_value.is_empty() {
                all_inputs.insert(
                    recalc::CellRef { sheet_id: d.sheet_id.clone(), row: d.row, col: d.col },
                    d.raw_value.clone(),
                );
            }
            stored.push((k, d));
        }

        // Sheet-level read scoping: evaluate only the requested sheet and the
        // sheets it transitively references. `sheet_ids` stays the FULL set so
        // unknown-sheet → #REF! detection is exact. Result is identical to a
        // whole-workbook eval (unreachable sheets cannot affect this sheet).
        let closure = recalc::sheet_closure(&all_inputs, &sheet_id);
        let inputs = recalc::WorkbookInputs {
            cells: all_inputs
                .into_iter()
                .filter(|(k, _)| closure.contains(&k.sheet_id))
                .collect(),
            sheet_ids,
        };
        let computed = recalc::evaluate(&inputs);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd logic && cargo test -p p2p-sheets-spreadsheet 2>&1 | tail -8`
Expected: PASS — the two new `get_cells_scoped_*` tests plus every existing test (including `get_cells_derives_dependent_values_on_read`, `#CYCLE!`, `#REF!`, cross-sheet) still green.

- [ ] **Step 5: Build the WASM bundle to confirm it compiles for the target**

Run: `cd logic && cargo build -p p2p-sheets-spreadsheet --target wasm32-unknown-unknown --release 2>&1 | tail -5`
Expected: builds clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add logic/crates/spreadsheet/src/lib.rs
git commit -m "feat(recalc): scope get_cells to the requested sheet's closure"
```

---

### Task 3: Client — on-demand full-workbook download

**Files:**
- Create: `app/src/spreadsheet/download.ts`
- Create: `app/src/spreadsheet/download.test.ts`
- Modify: `app/src/hooks/useSpreadsheet.ts` (add a `getSheetCells` read to the return interface + hook)
- Modify: `app/src/pages/app/AppPage.tsx` — `handleDownload` (currently lines ~661–690)

**Interfaces:**
- Consumes: `formatValue(computed: string, format: string) => string` from `app/src/spreadsheet/format.ts`; `SpreadsheetClient.getCells({ sheet_id }): Promise<Cell[]>`.
- Produces: `sheetsToCsv(sheets: CsvSheet[]): string`; hook read `getSheetCells(sheetId: string) => Promise<Cell[]>`.

- [ ] **Step 1: Write the failing test**

Create `app/src/spreadsheet/download.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sheetsToCsv } from './download';

describe('sheetsToCsv', () => {
  it('emits a header + quoted grid per sheet, padding gaps', () => {
    const csv = sheetsToCsv([
      {
        name: 'Sheet 1',
        cells: [
          { row: 0, col: 0, computed_value: '1', format: '' },
          { row: 0, col: 1, computed_value: '2', format: '' },
          { row: 1, col: 1, computed_value: 'x', format: '' },
        ],
      },
    ]);
    expect(csv).toBe('# Sheet 1\n"1","2"\n"","x"\n');
  });

  it('escapes embedded double quotes', () => {
    const csv = sheetsToCsv([
      { name: 'S', cells: [{ row: 0, col: 0, computed_value: 'a"b', format: '' }] },
    ]);
    expect(csv).toBe('# S\n"a""b"\n');
  });

  it('emits header + blank line for an empty sheet', () => {
    expect(sheetsToCsv([{ name: 'Empty', cells: [] }])).toBe('# Empty\n');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/spreadsheet/download.test.ts 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./download` (module does not exist yet).

- [ ] **Step 3: Implement `sheetsToCsv`**

Create `app/src/spreadsheet/download.ts` (this is the exact CSV logic currently inlined in `AppPage.handleDownload`, extracted and made pure):

```ts
/**
 * Pure CSV serialization for the workbook download. One `# <sheet name>` header
 * per sheet followed by its cells as a quoted, comma-separated grid padded to
 * the used bounding box; a trailing blank line separates sheets. Cell values are
 * display-formatted (formatValue) and inner double-quotes are doubled per CSV.
 */
import { formatValue } from './format';

export interface CsvCell {
  row: number;
  col: number;
  computed_value: string;
  format: string;
}

export interface CsvSheet {
  name: string;
  cells: CsvCell[];
}

export function sheetsToCsv(sheets: CsvSheet[]): string {
  const lines: string[] = [];
  for (const sheet of sheets) {
    lines.push(`# ${sheet.name}`);
    if (sheet.cells.length > 0) {
      const maxRow = sheet.cells.reduce((m, c) => Math.max(m, c.row), 0);
      const maxCol = sheet.cells.reduce((m, c) => Math.max(m, c.col), 0);
      for (let r = 0; r <= maxRow; r++) {
        const rowData: string[] = [];
        for (let c = 0; c <= maxCol; c++) {
          const cell = sheet.cells.find((x) => x.row === r && x.col === c);
          const val = cell
            ? formatValue(cell.computed_value, cell.format).replace(/"/g, '""')
            : '';
          rowData.push(`"${val}"`);
        }
        lines.push(rowData.join(','));
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/spreadsheet/download.test.ts 2>&1 | tail -8`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Add a `getSheetCells` read to the hook**

In `app/src/hooks/useSpreadsheet.ts`, add to the `UseSpreadsheetReturn` interface (near `exportAll`):

```ts
  /** Fetch one sheet's cells on demand (off the mutation queue) — used by download. */
  getSheetCells: (sheetId: string) => Promise<Cell[]>;
```

And in the hook body (near the other read wrappers, before `return`), add:

```ts
  const getSheetCells = useCallback(
    (sheetId: string) => (client ? client.getCells({ sheet_id: sheetId }) : Promise.resolve([])),
    [client],
  );
```

Then include `getSheetCells` in the returned object.

- [ ] **Step 6: Rewire `handleDownload` to fetch all sheets on demand**

In `app/src/pages/app/AppPage.tsx`, add the import near the other spreadsheet imports:

```ts
import { sheetsToCsv } from '../../spreadsheet/download';
```

Replace the current `handleDownload` (the `useCallback` that iterates `ss.cells` per sheet) with:

```ts
  const handleDownload = useCallback(async () => {
    // Fetch every sheet's cells on demand — resident `cells` holds only the
    // active sheet, so a full snapshot must be pulled at export time.
    const sheetData = await Promise.all(
      ss.sheets.map(async (sheet) => ({
        name: sheet.name,
        cells: await ss.getSheetCells(sheet.id),
      })),
    );
    const blob = new Blob([sheetsToCsv(sheetData)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_DISPLAY_NAME.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ss]);
```

- [ ] **Step 7: Type-check, test, and build**

Run: `cd app && npx tsc --noEmit && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -5`
Expected: `tsc` clean; all vitest tests pass (including the new `download.test.ts`); `vite build` succeeds.

- [ ] **Step 8: Commit**

```bash
git add app/src/spreadsheet/download.ts app/src/spreadsheet/download.test.ts app/src/hooks/useSpreadsheet.ts app/src/pages/app/AppPage.tsx
git commit -m "feat(app): download fetches all sheets on demand via pure sheetsToCsv"
```

---

### Task 4: Client — active-sheet-only refresh

**Files:**
- Modify: `app/src/hooks/useSpreadsheet.ts` — `UseSpreadsheetArgs` + `refresh`
- Modify: `app/src/pages/app/AppPage.tsx` — move the `activeSheetId` state above the `useSpreadsheet` call (currently line ~54) and pass it in

**Interfaces:**
- Consumes: `SpreadsheetClient.getCells({ sheet_id }): Promise<Cell[]>`; `getSheetCells` (Task 3) is unaffected.
- Produces: `useSpreadsheet` now requires `activeSheetId: string | null` in `UseSpreadsheetArgs`; `cells` holds only the active sheet's cells.

> **Verification note:** this task changes a React hook and its call site. The repo's vitest harness is node-env pure-logic only (`app/vitest.config.ts`), so there is no failing-unit-test step here — correctness of the *values* a scoped read returns is already covered by the Task 2 Rust tests; this task is wiring and is verified by `tsc --noEmit` + `vite build`. This is an approved deviation from the write-a-failing-test-first cycle, justified solely by the absence of a hook test harness (do not add one — out of scope).

- [ ] **Step 1: Add `activeSheetId` to the hook args**

In `app/src/hooks/useSpreadsheet.ts`, extend `UseSpreadsheetArgs`:

```ts
export interface UseSpreadsheetArgs {
  contextId: string | null;
  executorPublicKey: string | null;
  /** The sheet currently displayed — refresh() fetches only this sheet's cells. */
  activeSheetId: string | null;
}
```

And destructure it in the hook signature:

```ts
export function useSpreadsheet({
  contextId,
  executorPublicKey,
  activeSheetId,
}: UseSpreadsheetArgs): UseSpreadsheetReturn {
```

- [ ] **Step 2: Scope `refresh` to the active sheet**

In `app/src/hooks/useSpreadsheet.ts`, replace the body of the `refresh` `useCallback` — the part that fetches every sheet's cells — so it fetches only the active sheet, and add `activeSheetId` to its dependency array:

```ts
  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [fetchedSheets, fetchedCursors, fetchedFunctions] = await Promise.all([
        client.listSheets(),
        client.getCursors(),
        client.getFunctions(),
      ]);

      // Fetch ONLY the active sheet's cells. The node derives cross-sheet
      // references during eval, so the active sheet is correct without holding
      // other sheets' cells; any context sync refetches the active sheet.
      const activeCells = activeSheetId
        ? await client.getCells({ sheet_id: activeSheetId })
        : [];

      setSheets(fetchedSheets.sort((a, b) => a.position - b.position));
      setCells(activeCells);
      setCursors(fetchedCursors);
      if (fetchedFunctions.length > 0) setFunctions(fetchedFunctions);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [client, activeSheetId]);
```

Because `refresh` now depends on `activeSheetId`, the existing `useEffect(() => { void refresh(); }, [refresh])` re-runs on tab switch, and the existing `useSubscription(..., () => { void refresh(); })` refetches the active sheet on every context sync. No other change is needed to those effects.

- [ ] **Step 3: Move `activeSheetId` above the hook call and pass it in (AppPage)**

In `app/src/pages/app/AppPage.tsx`:

1. Cut the line `const [activeSheetId, setActiveSheetId] = useState<string | null>(null);` (currently ~line 95) and paste it **above** the `const ss = useSpreadsheet({ ... })` call (currently ~line 54), so the variable exists before the hook call.
2. Add `activeSheetId` to the `useSpreadsheet` argument object:

```tsx
  const ss = useSpreadsheet({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
    activeSheetId,
  });
```

(Keep the existing `contextId`/`executorPublicKey` fields exactly as they are; only add `activeSheetId`.)

- [ ] **Step 4: Type-check and build**

Run: `cd app && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: `tsc` clean (in particular, `useSpreadsheet` callers now satisfy the required `activeSheetId` arg); `vite build` succeeds.

- [ ] **Step 5: Run the full unit suite (no regressions)**

Run: `cd app && npx vitest run 2>&1 | tail -6`
Expected: all pure-logic tests pass (this task adds none but must not break existing ones).

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/useSpreadsheet.ts app/src/pages/app/AppPage.tsx
git commit -m "feat(app): refresh fetches only the active sheet (cross-sheet stays correct via node)"
```

---

## Self-Review

**Spec coverage:**
- §6.3 sheet-level closure → Task 1 (`sheet_closure`) + Task 2 (`get_cells` rewire, all-sheet-ids preserved, `#REF!`/`#CYCLE!` tests). ✓
- §6.4 active-sheet-only refresh → Task 4 (hook arg + scoped `refresh`, refetch-active-on-sync retained). ✓
- §6.4 download fetches all on demand → Task 3 (`sheetsToCsv` + `getSheetCells` + `handleDownload`). ✓
- Freshness trigger stays broad → Task 4 Step 2 note (existing `useSubscription` retained). ✓
- Provably-identical values → Task 2 anti-regression tests + all existing tests must stay green. ✓

**Type consistency:** `sheet_closure(&BTreeMap<CellRef,String>, &str) -> HashSet<String>` produced in Task 1, consumed verbatim in Task 2. `getSheetCells(sheetId: string) => Promise<Cell[]>` produced in Task 3, unrelated to Task 4. `UseSpreadsheetArgs.activeSheetId: string | null` added in Task 4 and passed from AppPage. `CsvSheet`/`CsvCell` local to `download.ts`, used by its test. Consistent.

**Ordering:** 1 → 2 (2 uses `sheet_closure`); 3 → 4 (download must fetch on demand *before* `refresh` stops holding all sheets, else download breaks between tasks). Node (1,2) and client (3,4) are otherwise independent.

**Placeholder scan:** none — every code step contains complete code.
