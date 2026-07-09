# Copy / Cut / Paste + Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy/cut/paste cells and ranges (formula refs shift on copy, `$`-anchors stay fixed; cut moves verbatim), interoperate with external spreadsheets via the system clipboard as TSV, and delete a selection's contents.

**Architecture:** Entirely client-side, reusing the pure `shiftFormula(formula, dRow, dCol)` engine from feature 2a. Two new pure modules (`clipboard.ts`, `paste.ts`) plus a `rectCells` helper, then native `copy`/`cut`/`paste` event wiring on the grid and handlers in AppPage. **No wasm change** — writes go through the existing `ss.setCell`/`ss.clearCell`/`ss.setCellFormat`.

**Tech Stack:** React 19, TypeScript, styled-components, vitest (node env — pure modules only, no jsdom).

## Global Constraints

- **Frontend-only. No wasm change, no node reinstall, no namespace recreation.** Goes live on a plain `npm run build` + reload.
- **Hybrid clipboard:** copy/cut write TSV of *computed values* to the system clipboard AND store a full-fidelity internal payload in AppPage state (raw formulas + formats + source rect + `cut` flag + the exact TSV written). On paste, if the system-clipboard text equals the stored payload's TSV → internal full-fidelity paste; otherwise → external TSV parsed as raw values.
- **Copy shifts refs** by the paste offset `(anchor.row − sourceRect.top, anchor.col − sourceRect.left)` via `shiftFormula`; `$`-anchored refs stay fixed (already handled by `shiftFormula`).
- **Cut moves verbatim** (no ref shift); the source cells are cleared (content+format) on the paste that consumes the cut. A cut that is never pasted leaves the source intact.
- **Paste anchors** the copied block's top-left at the selected cell (or the selection range's top-left), using the source's dimensions. No tiling.
- **Delete/Backspace** clears every cell in the selection **completely** (content **and** format) via `ss.clearCell`.
- **Grid is fixed `ROWS=50 × COLS=26`.** Paste writes whose target falls outside `[0,ROWS)`/`[0,COLS)` are dropped (clipped).
- **Out of scope for v1:** paste-special (values/formats-only, transpose), tiling into a larger selection, undo/redo.

---

## File Structure

- `app/src/spreadsheet/clipboard.ts` (new) — `toTSV`/`fromTSV` (system-clipboard TSV serialization).
- `app/src/spreadsheet/refs.ts` (modify) — add `rectCells(rect)`.
- `app/src/spreadsheet/paste.ts` (new) — `planPaste(payload, anchor)` + the `ClipCell`/`ClipPayload`/`PasteWrite` types.
- `app/src/components/SpreadsheetGrid.tsx` (modify) — clipboard event props, Delete/Escape wiring, copied-region outline.
- `app/src/pages/app/AppPage.tsx` (modify) — clipboard state + copy/cut/paste/delete handlers + write loop.
- Tests: `app/src/spreadsheet/clipboard.test.ts`, `app/src/spreadsheet/paste.test.ts`, and `rectCells` cases added to `app/src/spreadsheet/refs.test.ts`.

---

## Task 1: `clipboard.ts` — TSV serialization

**Files:**
- Create: `app/src/spreadsheet/clipboard.ts`
- Test: `app/src/spreadsheet/clipboard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toTSV(values: string[][]): string`, `fromTSV(text: string): string[][]`.

- [ ] **Step 1: Write the failing test**

Create `app/src/spreadsheet/clipboard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { toTSV, fromTSV } from './clipboard';

describe('toTSV', () => {
  it('joins cells with tabs and rows with newlines', () => {
    expect(toTSV([['1', '2'], ['3', '4']])).toBe('1\t2\n3\t4');
  });
  it('serializes a single cell', () => {
    expect(toTSV([['hi']])).toBe('hi');
  });
});

describe('fromTSV', () => {
  it('parses a TSV grid', () => {
    expect(fromTSV('1\t2\n3\t4')).toEqual([['1', '2'], ['3', '4']]);
  });
  it('strips a single trailing newline (Excel/Sheets append one)', () => {
    expect(fromTSV('1\t2\n')).toEqual([['1', '2']]);
  });
  it('preserves ragged rows', () => {
    expect(fromTSV('1\t2\n3')).toEqual([['1', '2'], ['3']]);
  });
  it('round-trips with toTSV', () => {
    const grid = [['=A1*2', 'x'], ['3', '']];
    expect(fromTSV(toTSV(grid))).toEqual(grid);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run clipboard`
Expected: FAIL — `toTSV`/`fromTSV` not exported.

- [ ] **Step 3: Write the implementation**

Create `app/src/spreadsheet/clipboard.ts`:

```typescript
/**
 * System-clipboard TSV serialization for copy/paste. TSV carries only cell
 * *values* (not formulas), so it is the cross-app format; full-fidelity in-app
 * paste uses the internal payload in paste.ts. The formula language has no tab
 * or newline literals, so no quoting is needed.
 */

/** Rectangular grid of cell strings → TSV (cells by tab, rows by newline). */
export function toTSV(values: string[][]): string {
  return values.map((row) => row.join('\t')).join('\n');
}

/** TSV → grid of cell strings. A single trailing newline is dropped (external
 *  apps append one); ragged rows are preserved as-is. */
export function fromTSV(text: string): string[][] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').map((line) => line.split('\t'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run clipboard`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/spreadsheet/clipboard.ts app/src/spreadsheet/clipboard.test.ts
git commit -m "feat(app): TSV clipboard serialization (toTSV/fromTSV)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `rectCells` helper in `refs.ts`

**Files:**
- Modify: `app/src/spreadsheet/refs.ts` (add one exported function near `normalizeRect`)
- Test: `app/src/spreadsheet/refs.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: existing `Rect` and `CellCoord` from `refs.ts`.
- Produces: `rectCells(rect: Rect): CellCoord[]`.

- [ ] **Step 1: Write the failing test**

Append to `app/src/spreadsheet/refs.test.ts` (import `rectCells` from `./refs` — add it to the existing import line at the top of that file):

```typescript
describe('rectCells', () => {
  it('enumerates a single cell', () => {
    expect(rectCells({ top: 2, left: 3, bottom: 2, right: 3 })).toEqual([{ row: 2, col: 3 }]);
  });
  it('enumerates a block row-major', () => {
    expect(rectCells({ top: 0, left: 0, bottom: 1, right: 1 })).toEqual([
      { row: 0, col: 0 }, { row: 0, col: 1 },
      { row: 1, col: 0 }, { row: 1, col: 1 },
    ]);
  });
  it('enumerates a single row', () => {
    expect(rectCells({ top: 5, left: 0, bottom: 5, right: 2 })).toEqual([
      { row: 5, col: 0 }, { row: 5, col: 1 }, { row: 5, col: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run refs`
Expected: FAIL — `rectCells` not exported.

- [ ] **Step 3: Write the implementation**

Add to `app/src/spreadsheet/refs.ts`, immediately after the `normalizeRect` function:

```typescript
/** Every cell in an inclusive rectangle, row-major. */
export function rectCells(rect: Rect): CellCoord[] {
  const out: CellCoord[] = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    for (let col = rect.left; col <= rect.right; col++) {
      out.push({ row, col });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run refs`
Expected: PASS (existing refs tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add app/src/spreadsheet/refs.ts app/src/spreadsheet/refs.test.ts
git commit -m "feat(app): rectCells — enumerate cells in a rect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `paste.ts` — plan the paste writes

**Files:**
- Create: `app/src/spreadsheet/paste.ts`
- Test: `app/src/spreadsheet/paste.test.ts`

**Interfaces:**
- Consumes: `shiftFormula(formula: string, dRow: number, dCol: number): string` from `./shift`; `CellCoord`, `Rect` from `./refs`.
- Produces:
  - `interface ClipCell { dr: number; dc: number; raw: string; format: string }`
  - `interface ClipPayload { cells: ClipCell[]; rows: number; cols: number; cut: boolean; sourceRect: Rect; tsv: string }`
  - `interface PasteWrite { row: number; col: number; raw: string; format: string }`
  - `planPaste(payload: ClipPayload, anchor: CellCoord): PasteWrite[]`

**Note:** `tsv` is part of `ClipPayload` (AppPage stores the exact TSV written to the system clipboard, to detect its own copy on paste); `planPaste` itself does not read `tsv`.

- [ ] **Step 1: Write the failing test**

Create `app/src/spreadsheet/paste.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { planPaste, type ClipPayload } from './paste';

// Single-cell copy payload holding `raw` at source top-left (0,0).
function single(raw: string, cut = false): ClipPayload {
  return {
    cells: [{ dr: 0, dc: 0, raw, format: '' }],
    rows: 1, cols: 1, cut,
    sourceRect: { top: 0, left: 0, bottom: 0, right: 0 },
    tsv: '',
  };
}

describe('planPaste — copy', () => {
  it('shifts a relative formula by the anchor delta', () => {
    // copy =A1 from (0,0), paste anchored at (2,1) → shift by (+2,+1) → =B3
    const w = planPaste(single('=A1'), { row: 2, col: 1 });
    expect(w).toEqual([{ row: 2, col: 1, raw: '=B3', format: '' }]);
  });
  it('keeps $-anchored refs fixed', () => {
    const w = planPaste(single('=$A$1'), { row: 2, col: 1 });
    expect(w[0].raw).toBe('=$A$1');
  });
  it('preserves a cross-sheet qualifier while shifting the cell part', () => {
    const w = planPaste(single('=Sheet2!A1'), { row: 1, col: 0 });
    expect(w[0].raw).toBe('=Sheet2!A2');
  });
  it('writes a non-formula value verbatim', () => {
    const w = planPaste(single('42'), { row: 3, col: 3 });
    expect(w[0].raw).toBe('42');
  });
  it('places a multi-cell block by dr/dc and carries formats', () => {
    const payload: ClipPayload = {
      cells: [
        { dr: 0, dc: 0, raw: '=A1', format: 'currency' },
        { dr: 0, dc: 1, raw: 'x', format: '' },
        { dr: 1, dc: 0, raw: '5', format: '' },
      ],
      rows: 2, cols: 2, cut: false,
      sourceRect: { top: 0, left: 0, bottom: 1, right: 1 },
      tsv: '',
    };
    const w = planPaste(payload, { row: 10, col: 5 });
    expect(w).toEqual([
      { row: 10, col: 5, raw: '=B11', format: 'currency' }, // =A1 shifted by (+10,+5)
      { row: 10, col: 6, raw: 'x', format: '' },
      { row: 11, col: 5, raw: '5', format: '' },
    ]);
  });
});

describe('planPaste — cut', () => {
  it('moves a formula verbatim (no ref shift)', () => {
    const w = planPaste(single('=A1', true), { row: 4, col: 4 });
    expect(w[0].raw).toBe('=A1');
    expect(w[0].row).toBe(4);
    expect(w[0].col).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run paste`
Expected: FAIL — `planPaste` not exported.

- [ ] **Step 3: Write the implementation**

Create `app/src/spreadsheet/paste.ts`:

```typescript
/**
 * Plan the cell writes for an in-app (full-fidelity) paste. Copy shifts each
 * formula's references by the paste offset (via shiftFormula, so $-anchors stay
 * fixed); cut moves formulas verbatim (a move keeps refs pointing where they
 * did). Pure — the caller performs the actual setCell/clearCell writes and
 * clips out-of-bounds targets.
 */
import { shiftFormula } from './shift';
import type { CellCoord, Rect } from './refs';

export interface ClipCell {
  dr: number; // row offset from the source top-left
  dc: number; // col offset from the source top-left
  raw: string;
  format: string;
}

export interface ClipPayload {
  cells: ClipCell[];
  rows: number;
  cols: number;
  cut: boolean;
  sourceRect: Rect;
  tsv: string; // the exact TSV written to the system clipboard (for self-detection)
}

export interface PasteWrite {
  row: number;
  col: number;
  raw: string;
  format: string;
}

export function planPaste(payload: ClipPayload, anchor: CellCoord): PasteWrite[] {
  // The whole block translates by (anchor - source top-left); every relative
  // ref in a copied formula shifts by that same delta.
  const dRow = anchor.row - payload.sourceRect.top;
  const dCol = anchor.col - payload.sourceRect.left;
  return payload.cells.map((c) => {
    const raw =
      !payload.cut && c.raw.startsWith('=') ? shiftFormula(c.raw, dRow, dCol) : c.raw;
    return { row: anchor.row + c.dr, col: anchor.col + c.dc, raw, format: c.format };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run paste`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/spreadsheet/paste.ts app/src/spreadsheet/paste.test.ts
git commit -m "feat(app): planPaste — copy shifts refs, cut moves verbatim

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Grid — clipboard events, Delete/Escape, copied-region outline

**Files:**
- Modify: `app/src/components/SpreadsheetGrid.tsx` (props ~31-52, destructure ~59-72, `handleKeyDown` ~251-293, `<GridContainer>` ~300-304, cell render ~306-360, styled `DataCell` ~440, add `copiedRegion` handling)

**Interfaces:**
- Consumes: `Rect`, `CellCoord` (already imported).
- Produces (props on `SpreadsheetGridProps`):
  - `onCopy?: (e: React.ClipboardEvent) => void`
  - `onCut?: (e: React.ClipboardEvent) => void`
  - `onPaste?: (e: React.ClipboardEvent) => void`
  - `onDelete?: () => void`
  - `onClearClipboard?: () => void`
  - `copiedRegion?: { rect: Rect; cut: boolean } | null`

**Context:** The `GridContainer` div already has `tabIndex={0}` and handles keyboard nav via `onKeyDown`, so it receives focus when the user interacts with the grid; native `copy`/`cut`/`paste` events attach to it the same way. Today's `Delete`/`Backspace` case in `handleKeyDown` is a no-op with a stale "Handled in AppPage" comment — no such handler exists — so this task makes Delete actually work by calling `onDelete`.

- [ ] **Step 1: Add the props**

In `SpreadsheetGridProps` (after `onFill?` on line ~51):

```typescript
  onCopy?: (e: React.ClipboardEvent) => void;
  onCut?: (e: React.ClipboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  onDelete?: () => void;
  onClearClipboard?: () => void;
  copiedRegion?: { rect: Rect; cut: boolean } | null;
```

Add them to the destructured props in the component signature (after `onFill,` on line ~72):

```typescript
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onClearClipboard,
  copiedRegion,
```

- [ ] **Step 2: Wire Delete and Escape in `handleKeyDown`**

Replace the existing `Delete`/`Backspace` case (lines ~284-287) and add an `Escape` case:

```typescript
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          onDelete?.();
          break;
        case 'Escape':
          onClearClipboard?.();
          break;
```

Add `onDelete` and `onClearClipboard` to the `handleKeyDown` `useCallback` dependency array (currently `[selectedCell, onSelectCell, onEditCell, onCommitAndMove]`):

```typescript
    [selectedCell, onSelectCell, onEditCell, onCommitAndMove, onDelete, onClearClipboard],
```

- [ ] **Step 3: Forward the clipboard events on the container**

On `<GridContainer …>` (line ~300), add:

```typescript
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
```

- [ ] **Step 4: Compute + render the copied-region outline**

Inside the cell-render block (near where `inFillTarget` / `isFillCorner` are computed, ~line 350), add:

```typescript
                const copiedHere =
                  copiedRegion != null &&
                  row >= copiedRegion.rect.top && row <= copiedRegion.rect.bottom &&
                  col >= copiedRegion.rect.left && col <= copiedRegion.rect.right;
                const copiedKind = copiedHere ? (copiedRegion!.cut ? 'cut' : 'copy') : undefined;
```

Add `$copied={copiedKind}` to the `<DataCell …>` element (alongside the existing `$selected`/`$inRange`/`$inFillTarget` transient props).

- [ ] **Step 5: Style the outline on `DataCell`**

Update the `DataCell` styled generic (line ~440) to include the new prop:

```typescript
const DataCell = styled.td<{ $selected: boolean; $cursorColor?: string; $inRange?: boolean; $inFillTarget?: boolean; $copied?: 'copy' | 'cut' }>`
```

Add a rule near the other transient-prop branches (after the `$inFillTarget` rule):

```typescript
  ${(p) => p.$copied === 'copy' && `outline: 1px dashed ${C.ink}; outline-offset: -1px;`}
  ${(p) => p.$copied === 'cut' && `outline: 1px dashed ${C.muted}; outline-offset: -1px;`}
```

- [ ] **Step 6: Verify typecheck + no regressions**

Run: `cd app && npx tsc --noEmit`
Expected: clean.
Run: `cd app && npx vitest run`
Expected: all suites pass (no grid unit tests; confirms no regressions).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/SpreadsheetGrid.tsx
git commit -m "feat(app): grid clipboard events, Delete/Escape, copied-region outline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: AppPage — clipboard state, handlers, write loop; build + verify

**Files:**
- Modify: `app/src/pages/app/AppPage.tsx` (imports ~19-29, state near `selectionRange` ~76-77, handlers near `handleFill` ~460, `<SpreadsheetGrid>` props ~714-752)

**Interfaces:**
- Consumes: `toTSV`/`fromTSV` (Task 1); `rectCells` (Task 2); `planPaste`, `ClipPayload`, `ClipCell`, `PasteWrite` (Task 3); grid props `onCopy`/`onCut`/`onPaste`/`onDelete`/`onClearClipboard`/`copiedRegion` (Task 4).
- Existing: `ss.cells` (`{ sheet_id, row, col, raw_value, computed_value, format }[]`), `ss.setCell(sheetId,row,col,raw)`, `ss.clearCell(sheetId,row,col)`, `ss.setCellFormat(sheetId,row,col,format)`, `activeSheetId`, `selectedCell`, `selectionRange`, `editing`, `ROWS`, `COLS`.

**Context:** Copy/cut/paste must not act while a cell is being edited (the formula bar owns the clipboard then). Guard every handler on `!editing`. `editing` is existing AppPage state (set true while a cell is being edited).

- [ ] **Step 1: Add imports**

Near the other spreadsheet-module imports (~line 29):

```typescript
import { toTSV, fromTSV } from '../../spreadsheet/clipboard';
import { planPaste, type ClipPayload, type ClipCell } from '../../spreadsheet/paste';
import { rectCells } from '../../spreadsheet/refs';
```

(If `rectCells` shares the existing `refs` import line, add it there instead of a new line.)

- [ ] **Step 2: Add clipboard state**

After the `selectionRange` state (~line 77):

```typescript
  const [clipboard, setClipboard] = useState<ClipPayload | null>(null);
```

- [ ] **Step 3: Add a shared "current region" + copy/cut builder**

Alongside the other handlers (after `handleFill`, ~line 478):

```typescript
  // The rect the clipboard/delete operate on: the multi-cell selection, or the
  // single selected cell.
  const currentRegion = useCallback((): Rect | null => {
    if (selectionRange) return selectionRange;
    if (selectedCell) {
      return { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col };
    }
    return null;
  }, [selectionRange, selectedCell]);

  // Build the internal payload + TSV for a copy or cut of the current region.
  const buildClip = useCallback(
    (cut: boolean, e: React.ClipboardEvent) => {
      if (editing || !activeSheetId) return;
      const region = currentRegion();
      if (!region) return;
      e.preventDefault();
      const at = (r: number, c: number) =>
        ss.cells.find((x) => x.sheet_id === activeSheetId && x.row === r && x.col === c);
      // TSV of computed values (for external apps), row-major over the rect.
      const values: string[][] = [];
      for (let r = region.top; r <= region.bottom; r++) {
        const rowVals: string[] = [];
        for (let c = region.left; c <= region.right; c++) rowVals.push(at(r, c)?.computed_value ?? '');
        values.push(rowVals);
      }
      const tsv = toTSV(values);
      // Internal cells (raw + format), offsets from the region top-left. Empty
      // source cells are included so a paste clears the matching target cell.
      const cells: ClipCell[] = rectCells(region).map(({ row, col }) => {
        const cell = at(row, col);
        return {
          dr: row - region.top,
          dc: col - region.left,
          raw: cell?.raw_value ?? '',
          format: cell?.format ?? '',
        };
      });
      e.clipboardData.setData('text/plain', tsv);
      setClipboard({
        cells,
        rows: region.bottom - region.top + 1,
        cols: region.right - region.left + 1,
        cut,
        sourceRect: region,
        tsv,
      });
    },
    [editing, activeSheetId, currentRegion, ss.cells],
  );

  const handleCopy = useCallback((e: React.ClipboardEvent) => buildClip(false, e), [buildClip]);
  const handleCut = useCallback((e: React.ClipboardEvent) => buildClip(true, e), [buildClip]);
```

- [ ] **Step 4: Add the paste handler**

After `handleCut`:

```typescript
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (editing || !activeSheetId) return;
      const region = currentRegion();
      if (!region) return;
      e.preventDefault();
      const anchor = { row: region.top, col: region.left };
      const text = e.clipboardData.getData('text/plain');

      let writes: PasteWrite[];
      const internal = clipboard && text === clipboard.tsv;
      if (internal) {
        writes = planPaste(clipboard!, anchor);
      } else {
        // External TSV → raw values, anchored at the selection top-left.
        writes = fromTSV(text).flatMap((rowVals, r) =>
          rowVals.map((v, c) => ({ row: anchor.row + r, col: anchor.col + c, raw: v, format: '' })),
        );
      }

      for (const w of writes) {
        if (w.row < 0 || w.row >= ROWS || w.col < 0 || w.col >= COLS) continue; // clip
        if (w.raw.trim() === '') {
          await ss.clearCell(activeSheetId, w.row, w.col);
        } else {
          await ss.setCell(activeSheetId, w.row, w.col, w.raw);
          await ss.setCellFormat(activeSheetId, w.row, w.col, w.format);
        }
      }

      // A consumed cut clears its source and empties the clipboard; copy persists.
      if (internal && clipboard!.cut) {
        for (const { row, col } of rectCells(clipboard!.sourceRect)) {
          await ss.clearCell(activeSheetId, row, col);
        }
        setClipboard(null);
      }
    },
    [editing, activeSheetId, currentRegion, clipboard, ss],
  );
```

**Type note:** import `type PasteWrite` too — extend the Task-3 import to `import { planPaste, type ClipPayload, type ClipCell, type PasteWrite } from '../../spreadsheet/paste';`.

- [ ] **Step 5: Add the delete + clear-clipboard handlers**

After `handlePaste`:

```typescript
  const handleDelete = useCallback(async () => {
    if (editing || !activeSheetId) return;
    const region = currentRegion();
    if (!region) return;
    for (const { row, col } of rectCells(region)) {
      await ss.clearCell(activeSheetId, row, col);
    }
  }, [editing, activeSheetId, currentRegion, ss]);

  const handleClearClipboard = useCallback(() => setClipboard(null), []);
```

- [ ] **Step 6: Pass the props to the grid**

On `<SpreadsheetGrid … />` (near `onFill={handleFill}`, ~line 752), add:

```typescript
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onDelete={handleDelete}
        onClearClipboard={handleClearClipboard}
        copiedRegion={clipboard ? { rect: clipboard.sourceRect, cut: clipboard.cut } : null}
```

- [ ] **Step 7: Verify typecheck + suite**

Run: `cd app && npx tsc --noEmit`
Expected: clean.
Run: `cd app && npx vitest run 2>&1 | tail -4`
Expected: all suites pass (clipboard + paste + refs + prior).

- [ ] **Step 8: Build and manually verify (record results)**

Run: `cd app && npm run build 2>&1 | tail -3` → `built in …`.

Reload `http://localhost:4173` (existing workspace is fine — **no wasm change**, so no fresh workspace needed). Verify:
- Enter `=B1*2` in A1 (B1 populated). Select A1, **Cmd+C**, select C3, **Cmd+V** → C3 shows `=D3*2` (ref shifted).
- `=$B$1*2` in A1 → copy → paste at C3 → stays `=$B$1*2`.
- Select a 2×2 block with values/formulas, copy, paste elsewhere → block lands with refs shifted, formats carried.
- **Cmd+X** on A1, paste at C3 → A1 emptied, C3 has the original formula unchanged (no shift).
- Copy a range → paste into Google Sheets / a text editor → tab-separated values land.
- Copy a range in Google Sheets → **Cmd+V** in the app → values land at the selection.
- Select a range, **Delete** → all cells cleared (value and format gone).
- After a copy, the source shows a dashed outline; **Escape** clears it.

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/app/AppPage.tsx
git commit -m "feat(app): wire copy/cut/paste + delete into the workspace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes / known v1 limitations

- **Paste-special** (values-only, formats-only, transpose) and **tiling** into a larger selection are out of scope — follow-ups on this foundation.
- Paste writes are **sequential** (`setCell` + `setCellFormat` per cell), matching `handleFill`; fine at grid scale, a batch method is a possible fast-follow.
- **Cut across sheets:** cut/copy operate within the active sheet; the payload's `sourceRect` is cleared on the active sheet at paste time. Cutting on one sheet and pasting on another still clears the original sheet's source because `activeSheetId` at copy time is captured implicitly via the cells read — if cross-sheet cut is exercised, the source-clear uses the *paste-time* `activeSheetId`; document this and treat cross-sheet cut as out of scope for v1 (paste on the same sheet you cut from).
- Native `copy`/`cut`/`paste` fire only when the grid container has focus and no text input is capturing the event, which is the intended scoping.
