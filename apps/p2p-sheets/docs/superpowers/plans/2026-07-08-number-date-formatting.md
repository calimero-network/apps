# Cell Number & Date Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user format a cell's *display* as Number, Currency, Percent, or Date via a right-click menu, without changing the underlying value or how formulas evaluate.

**Architecture:** A per-cell `format` string stored in the CRDT (syncs to peers) and rendered client-side by a pure `formatValue()` — the formula engine is untouched. A right-click context menu writes the format over the current selection.

**Tech Stack:** Rust (calimero-sdk, Borsh, WASM), TypeScript/React, `Intl.NumberFormat`, vitest, `@calimero-network/abi-codegen`.

## Global Constraints

- Testing is LOCAL only — do NOT push commits, do NOT publish to any registry, do NOT touch Vercel.
- Follow TDD: failing test first, watch it fail, minimal code, watch it pass, commit.
- The wasm is dev-signed with the well-known dev key; contexts are version-locked, so the feature is verified in a **fresh workspace** after reinstall.
- Format encoding is a colon-delimited string; v1 stores only the type keyword (`""`, `number`, `currency`, `percent`, `date`).
- Currency default is USD `$`; Number/Currency use 2 decimals, Percent 0 decimals, Date renders `YYYY-MM-DD`.
- Non-numeric / unparseable / error values (`#REF!`) pass through `formatValue` unchanged.

---

### Task 1: Rust data model — `format` field + `set_cell_format`

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` (`CellData` ~62, `CellData::merge` ~75, `Cell` view ~132, `set_cell` ~379, `set_cell_formula` ~436, `get_cells` ~586, add `set_cell_format`)
- Test: inline `#[cfg(test)] mod tests` in the same file

**Interfaces:**
- Produces (Rust logic methods, surfaced over RPC): `set_cell_format(sheet_id: String, row: u32, col: u32, format: String) -> Result<String>`
- Produces (view type): `Cell { …, format: String }` returned by `get_cells`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module (near the other cell tests):

```rust
    #[test]
    fn set_cell_format_persists_and_preserves_value() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "1234.5".into())).unwrap();
        app.call(|s| s.set_cell_format(sid.clone(), 0, 0, "currency".into())).unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.format, "currency");
        assert_eq!(a1.raw_value, "1234.5", "value preserved when format is set");
    }

    #[test]
    fn setting_value_preserves_existing_format() {
        let mut app = make_app();
        app.call(|s| s.init_project("P".into())).unwrap();
        let sid = app.call(|s| s.create_sheet("S".into())).unwrap();
        // Format an empty cell, then type a value into it.
        app.call(|s| s.set_cell_format(sid.clone(), 0, 0, "percent".into())).unwrap();
        app.call(|s| s.set_cell(sid.clone(), 0, 0, "0.25".into())).unwrap();
        let cells = app.view(|s| s.get_cells(sid.clone())).unwrap();
        let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
        assert_eq!(a1.format, "percent", "format survives a later value edit");
        assert_eq!(a1.computed_value, "0.25");
    }

    #[test]
    fn cell_merge_carries_format_from_winner() {
        let mut a = CellData {
            id: "k".into(), sheet_id: "s".into(), row: 0, col: 0,
            raw_value: "1".into(), computed_value: "1".into(),
            format: String::new(), updated_at: 1,
        };
        let b = CellData {
            id: "k".into(), sheet_id: "s".into(), row: 0, col: 0,
            raw_value: "2".into(), computed_value: "2".into(),
            format: "currency".into(), updated_at: 2,
        };
        a.merge(&b).unwrap();
        assert_eq!(a.raw_value, "2");
        assert_eq!(a.format, "currency", "LWW winner's format is kept");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd logic/crates/spreadsheet && cargo test set_cell_format_persists_and_preserves_value cell_merge_carries_format_from_winner setting_value_preserves_existing_format 2>&1 | tail -20)`
Expected: FAIL to compile — `CellData`/`Cell` have no field `format`, and no method `set_cell_format`.

- [ ] **Step 3: Add the `format` field to both structs**

In `CellData` (struct near line 62), add after `computed_value`:

```rust
    /// Display format for this cell (e.g. "number", "currency", "percent",
    /// "date"; empty = Automatic). Rendered client-side; does not affect
    /// evaluation. Colon-delimited for future options (e.g. "number:2").
    pub format: String,
```

In the `Cell` view struct (near line 132), add after `computed_value`:

```rust
    pub format: String,
```

- [ ] **Step 4: Carry `format` through merge, constructors, and get_cells**

In `CellData::merge` winner branch (after `self.computed_value = other.computed_value.clone();`, ~line 82) add:

```rust
            self.format = other.format.clone();
```

In `set_cell`'s `CellData { … }` literal (~line 379) and `set_cell_formula`'s `CellData { … }` literal (~line 436), add the field (a new cell starts Automatic):

```rust
            format: String::new(),
```

In `get_cells`' `Cell { … }` literal (~line 594), add after `computed_value: d.computed_value.clone(),`:

```rust
                        format: d.format.clone(),
```

- [ ] **Step 5: Add the `set_cell_format` method**

Insert immediately after `set_cell_formula` (after its closing `}`, before `get_cells`):

```rust
    /// Set only the display format of a cell, preserving its value. Creates the
    /// cell (empty value) if it does not exist yet, so you can format ahead of
    /// typing. `format` is a keyword like "number"/"currency"/"percent"/"date"
    /// ("" = Automatic).
    pub fn set_cell_format(
        &mut self,
        sheet_id: String,
        row: u32,
        col: u32,
        format: String,
    ) -> app::Result<String> {
        if self
            .sheets
            .get(&sheet_id)
            .map_err(|e| AppError::msg(format!("sheets.get: {e}")))?
            .is_none()
        {
            return Err(AppError::from(Error::NotFound(sheet_id.clone())));
        }
        let key = Spreadsheet::cell_key(&sheet_id, row, col);
        let now = storage_env::time_now();
        let exists = self
            .cells
            .get(&key)
            .map_err(|e| AppError::msg(format!("cells.get: {e}")))?
            .is_some();
        if exists {
            let mut guard = self
                .cells
                .get_mut(&key)
                .map_err(|e| AppError::msg(format!("cells.get_mut: {e}")))?
                .unwrap();
            guard.format = format;
            guard.updated_at = now;
        } else {
            let data = CellData {
                id: key.clone(),
                sheet_id: sheet_id.clone(),
                row,
                col,
                raw_value: String::new(),
                computed_value: String::new(),
                format,
                updated_at: now,
            };
            self.cells
                .insert(key.clone(), data)
                .map_err(|e| AppError::msg(format!("cells.insert: {e}")))?;
        }
        app::emit!(Event::CellUpdated {
            id: &key,
            sheet_id: &sheet_id,
        });
        Ok(key)
    }
```

- [ ] **Step 6: Run the full Rust suite to verify green**

Run: `(cd logic/crates/spreadsheet && cargo test 2>&1 | tail -6)`
Expected: all tests pass (the 3 new ones included), no warnings about unused fields.

- [ ] **Step 7: Commit**

```bash
git add logic/crates/spreadsheet/src/lib.rs
git commit -m "feat(logic): per-cell format field + set_cell_format

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Rebuild wasm + regenerate the ABI client

**Files:**
- Regenerate: `logic/crates/spreadsheet/res/abi.json`, `logic/res/p2p-sheets-1.0.0.mpk` (via build)
- Regenerate: `app/src/api/spreadsheet/SpreadsheetClient.ts` (via codegen)

**Interfaces:**
- Consumes: the Rust changes from Task 1.
- Produces (generated TS): `Cell { …, format: string }`; `SpreadsheetClient.setCellFormat(params: { sheet_id: string; row: number; col: number; format: string }): Promise<string>`.

- [ ] **Step 1: Rebuild the bundle (regenerates abi.json + .mpk)**

Run: `(cd logic && ./build-bundle.sh 2>&1 | tail -4)`
Expected: `Bundle created: res/p2p-sheets-1.0.0.mpk`.

- [ ] **Step 2: Confirm the ABI now exposes the new surface**

Run: `grep -E "set_cell_format|\"format\"" logic/crates/spreadsheet/res/abi.json | head`
Expected: matches for both `set_cell_format` (method) and `format` (field).

- [ ] **Step 3: Regenerate the TypeScript client**

Run: `(cd app && npm run codegen 2>&1 | tail -5)`
Expected: `[codegen] spreadsheet → SpreadsheetClient` with no error.

- [ ] **Step 4: Verify the generated client picked up both**

Run: `grep -nE "setCellFormat|format: string" app/src/api/spreadsheet/SpreadsheetClient.ts | head`
Expected: a `setCellFormat(params: { … format: string })` method and `format: string` on the `Cell` interface.

- [ ] **Step 5: Typecheck compiles against the regenerated client**

Run: `(cd app && npx tsc --noEmit 2>&1 | head -20)`
Expected: no output (clean).

- [ ] **Step 6: Commit the regenerated artifacts**

The `.mpk` is a gitignored build artifact — do NOT `git add` it (that errors). Commit only the ABI and generated client:

```bash
git add logic/crates/spreadsheet/res/abi.json app/src/api/spreadsheet/SpreadsheetClient.ts
git commit -m "chore: regenerate ABI + client for set_cell_format

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `formatValue` pure module (the TDD core)

**Files:**
- Create: `app/src/spreadsheet/format.ts`
- Test: `app/src/spreadsheet/format.test.ts`

**Interfaces:**
- Produces: `formatValue(computed: string, format: string): string`

- [ ] **Step 1: Write the failing tests**

Create `app/src/spreadsheet/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatValue } from './format';

describe('formatValue', () => {
  it('passes values through unchanged for Automatic (empty) format', () => {
    expect(formatValue('1234.5', '')).toBe('1234.5');
    expect(formatValue('hello', '')).toBe('hello');
  });

  it('formats numbers with 2 decimals and thousands separators', () => {
    expect(formatValue('1234.5', 'number')).toBe('1,234.50');
    expect(formatValue('-1234.5', 'number')).toBe('-1,234.50');
    expect(formatValue('0', 'number')).toBe('0.00');
  });

  it('formats currency with a $ symbol and 2 decimals', () => {
    expect(formatValue('1234.5', 'currency')).toBe('$1,234.50');
    expect(formatValue('-5', 'currency')).toBe('-$5.00');
  });

  it('formats percent by scaling ×100 with no decimals', () => {
    expect(formatValue('0.25', 'percent')).toBe('25%');
    expect(formatValue('-0.1', 'percent')).toBe('-10%');
  });

  it('formats a parseable date as YYYY-MM-DD', () => {
    expect(formatValue('2026-07-08', 'date')).toBe('2026-07-08');
  });

  it('passes non-numeric input through unchanged for numeric formats', () => {
    expect(formatValue('#REF!', 'number')).toBe('#REF!');
    expect(formatValue('', 'currency')).toBe('');
    expect(formatValue('n/a', 'percent')).toBe('n/a');
  });

  it('passes an unparseable date through unchanged', () => {
    expect(formatValue('not a date', 'date')).toBe('not a date');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd app && npx vitest run src/spreadsheet/format.test.ts 2>&1 | tail -15)`
Expected: FAIL — `./format` cannot be resolved.

- [ ] **Step 3: Implement `formatValue`**

Create `app/src/spreadsheet/format.ts`:

```typescript
/**
 * Render a cell's computed value for display according to its format keyword.
 * Pure and DOM-free so it is unit-testable and identical in the grid and CSV
 * export. Display-only: the underlying value and formulas are unaffected.
 *
 * Fallback rule: anything that isn't a finite number (for number/currency/
 * percent) or a parseable date (for date) is returned unchanged — never
 * `NaN`/`Invalid Date`. Error strings like `#REF!` therefore pass through.
 */
export function formatValue(computed: string, format: string): string {
  const fmt = format.trim();
  if (!fmt || fmt === 'general') return computed;

  if (fmt === 'date') {
    const t = Date.parse(computed);
    if (Number.isNaN(t)) return computed;
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Numeric formats: bail out (unchanged) on empty or non-numeric input.
  if (computed.trim() === '') return computed;
  const n = Number(computed);
  if (!Number.isFinite(n)) return computed;

  switch (fmt) {
    case 'number':
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(n);
    case 'percent':
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        maximumFractionDigits: 0,
      }).format(n);
    default:
      return computed;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `(cd app && npx vitest run src/spreadsheet/format.test.ts 2>&1 | tail -8)`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/spreadsheet/format.ts app/src/spreadsheet/format.test.ts
git commit -m "feat(app): pure formatValue() for number/currency/percent/date

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `setCellFormat` wrapper in `useSpreadsheet`

**Files:**
- Modify: `app/src/hooks/useSpreadsheet.ts` (interface ~86, wrappers ~223, return object ~266)

**Interfaces:**
- Consumes: `client.setCellFormat` from Task 2.
- Produces: `setCellFormat(sheetId: string, row: number, col: number, format: string) => Promise<void>` on the hook's return value.

- [ ] **Step 1: Add the method to the return interface**

In the `UseSpreadsheetReturn` interface, right after the `clearCell` line (~87):

```typescript
  setCellFormat: (sheetId: string, row: number, col: number, format: string) => Promise<void>;
```

- [ ] **Step 2: Implement the wrapper**

Immediately after the `clearCell` `useCallback` (~line 227), add:

```typescript
  const setCellFormat = useCallback(
    async (sheetId: string, row: number, col: number, format: string) => {
      if (!client) return;
      await client.setCellFormat({ sheet_id: sheetId, row, col, format });
      await refresh();
    },
    [client, refresh],
  );
```

- [ ] **Step 3: Export it from the hook**

In the returned object, right after `clearCell,` (~line 266):

```typescript
    setCellFormat,
```

- [ ] **Step 4: Typecheck**

Run: `(cd app && npx tsc --noEmit 2>&1 | head)`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useSpreadsheet.ts
git commit -m "feat(app): expose setCellFormat from useSpreadsheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Grid renders `formatValue` and emits a context-menu request

**Files:**
- Modify: `app/src/components/SpreadsheetGrid.tsx` (imports, props interface ~30, `shownValue` ~321, `DataCell` ~329)

**Interfaces:**
- Consumes: `formatValue` (Task 3); `Cell.format` (Task 2).
- Produces (prop): `onCellContextMenu?: (row: number, col: number, x: number, y: number) => void` — fired on right-click with viewport coords.

- [ ] **Step 1: Import `formatValue`**

Near the other imports at the top of `SpreadsheetGrid.tsx`, add:

```typescript
import { formatValue } from '../spreadsheet/format';
```

- [ ] **Step 2: Add the prop to the props interface**

In `interface SpreadsheetGridProps` (~line 30), add:

```typescript
  onCellContextMenu?: (row: number, col: number, x: number, y: number) => void;
```

Add `onCellContextMenu` to the destructured props in the component signature (alongside `cells`, `selectedCell`, … `editingValue`).

- [ ] **Step 3: Render the formatted value**

Replace the `shownValue` assignment (~lines 321-323):

```typescript
                const shownValue = isEditingThis
                  ? editingValue
                  : (cell?.computed_value ?? '');
```

with:

```typescript
                const shownValue = isEditingThis
                  ? editingValue
                  : formatValue(cell?.computed_value ?? '', cell?.format ?? '');
```

- [ ] **Step 4: Fire the context-menu request on right-click**

On the `<DataCell …>` element (~line 329), add this handler prop (right after `role="gridcell"`):

```typescript
                    onContextMenu={(e) => {
                      if (!onCellContextMenu) return;
                      e.preventDefault();
                      onCellContextMenu(row, col, e.clientX, e.clientY);
                    }}
```

- [ ] **Step 5: Typecheck**

Run: `(cd app && npx tsc --noEmit 2>&1 | head)`
Expected: no output (clean). (The grid now consumes `onCellContextMenu`; AppPage supplies it in Task 6 — the prop is optional so this compiles standalone.)

- [ ] **Step 6: Commit**

```bash
git add app/src/components/SpreadsheetGrid.tsx
git commit -m "feat(app): grid renders formatValue + emits context-menu request

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `ContextMenu` component + AppPage wiring (apply format to selection)

**Files:**
- Create: `app/src/components/ContextMenu.tsx`
- Modify: `app/src/pages/app/AppPage.tsx` (state, handlers, `<SpreadsheetGrid>` props, render `<ContextMenu>`)

**Interfaces:**
- Consumes: `ss.setCellFormat` (Task 4); `onCellContextMenu` (Task 5); existing `selectedCell`/`selectionRange`/`activeSheetId`.
- Produces: a `ContextMenu` component with props `{ x: number; y: number; activeFormat: string; onSelect: (format: string) => void; onClose: () => void }`.

- [ ] **Step 1: Create the ContextMenu component**

Create `app/src/components/ContextMenu.tsx`:

```typescript
/**
 * Right-click Format menu. Fixed-positioned at (x, y); dismisses on
 * outside-click, Escape, or scroll. One row per format keyword; the active
 * format is check-marked.
 */
import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { C } from '../theme';

const OPTIONS: { label: string; value: string }[] = [
  { label: 'Automatic', value: '' },
  { label: 'Number', value: 'number' },
  { label: 'Currency', value: 'currency' },
  { label: 'Percent', value: 'percent' },
  { label: 'Date', value: 'date' },
];

interface ContextMenuProps {
  x: number;
  y: number;
  activeFormat: string;
  onSelect: (format: string) => void;
  onClose: () => void;
}

export default function ContextMenu({ x, y, activeFormat, onSelect, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <Menu ref={ref} style={{ left: x, top: y }} role="menu" data-testid="menu-format">
      <MenuLabel>Format</MenuLabel>
      {OPTIONS.map((o) => (
        <MenuItem
          key={o.value}
          role="menuitemradio"
          aria-checked={activeFormat === o.value}
          data-testid={`action-format_${o.value || 'automatic'}`}
          onClick={() => onSelect(o.value)}
        >
          <Check>{activeFormat === o.value ? '✓' : ''}</Check>
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

const Menu = styled.div`
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  padding: 4px;
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
`;

const MenuLabel = styled.div`
  padding: 4px 10px 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: ${C.mutedSoft};
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  color: ${C.ink};
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  &:hover { background: ${C.paper2}; }
`;

const Check = styled.span`
  width: 12px;
  color: ${C.green};
  flex-shrink: 0;
`;
```

- [ ] **Step 2: Import ContextMenu and formatValue helpers in AppPage**

In `app/src/pages/app/AppPage.tsx`, add near the other component imports:

```typescript
import ContextMenu from '../../components/ContextMenu';
```

- [ ] **Step 3: Add context-menu state**

Near the other `useState` hooks in `AppPage` (e.g. after `showHelp`), add:

```typescript
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
```

- [ ] **Step 4: Add the right-click and apply-format handlers**

Add these `useCallback`s alongside the other handlers (e.g. after `handleSelectSheet`):

```typescript
  // Right-click a cell: if it's outside the current selection, select just it;
  // then open the Format menu at the cursor.
  const handleCellContextMenu = useCallback(
    (row: number, col: number, x: number, y: number) => {
      const inSel =
        selectionRange &&
        row >= selectionRange.top && row <= selectionRange.bottom &&
        col >= selectionRange.left && col <= selectionRange.right;
      if (!inSel) {
        setSelectedCell({ row, col });
        setSelectionRange(null);
        setEditing(false);
      }
      setCtxMenu({ x, y });
    },
    [selectionRange],
  );

  // Apply a format keyword to every cell in the current selection (or the
  // single selected cell), then close the menu.
  const applyFormat = useCallback(
    async (format: string) => {
      setCtxMenu(null);
      if (!activeSheetId) return;
      const rect =
        selectionRange ??
        (selectedCell
          ? { top: selectedCell.row, left: selectedCell.col, bottom: selectedCell.row, right: selectedCell.col }
          : null);
      if (!rect) return;
      for (let r = rect.top; r <= rect.bottom; r++) {
        for (let c = rect.left; c <= rect.right; c++) {
          await ss.setCellFormat(activeSheetId, r, c, format);
        }
      }
    },
    [activeSheetId, selectionRange, selectedCell, ss],
  );

  // Format of the anchor cell, to check-mark the active option in the menu.
  const activeCellFormat =
    (selectedCell && activeSheetId
      ? ss.cells.find(
          (c) => c.sheet_id === activeSheetId && c.row === selectedCell.row && c.col === selectedCell.col,
        )?.format
      : '') ?? '';
```

- [ ] **Step 5: Pass the handler to the grid**

On the `<SpreadsheetGrid … />` element, add:

```typescript
        onCellContextMenu={handleCellContextMenu}
```

- [ ] **Step 6: Render the menu**

Just before the closing `</AppShell>` (alongside the other overlays like `showHelp`), add:

```typescript
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          activeFormat={activeCellFormat}
          onSelect={(fmt) => void applyFormat(fmt)}
          onClose={() => setCtxMenu(null)}
        />
      )}
```

- [ ] **Step 7: Typecheck**

Run: `(cd app && npx tsc --noEmit 2>&1 | head)`
Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add app/src/components/ContextMenu.tsx app/src/pages/app/AppPage.tsx
git commit -m "feat(app): right-click Format menu applies to selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: CSV export uses `formatValue`; rebuild, reinstall, verify

**Files:**
- Modify: `app/src/pages/app/AppPage.tsx` (`handleDownload`)

**Interfaces:**
- Consumes: `formatValue` (Task 3); `Cell.format` (Task 2).

- [ ] **Step 1: Import formatValue in AppPage (if not already)**

Ensure this import is present near the top of `AppPage.tsx`:

```typescript
import { formatValue } from '../../spreadsheet/format';
```

- [ ] **Step 2: Format exported cell values**

In `handleDownload`, replace the value line:

```typescript
            const val = cell ? cell.computed_value.replace(/"/g, '""') : '';
```

with:

```typescript
            const val = cell
              ? formatValue(cell.computed_value, cell.format).replace(/"/g, '""')
              : '';
```

- [ ] **Step 3: Typecheck + run all JS tests**

Run: `(cd app && npx tsc --noEmit && npx vitest run 2>&1 | tail -8)`
Expected: clean typecheck; all vitest suites pass (including `format.test.ts`).

- [ ] **Step 4: Rebuild the bundle**

Run: `(cd logic && ./build-bundle.sh 2>&1 | tail -3)`
Expected: `Bundle created: res/p2p-sheets-1.0.0.mpk`.

- [ ] **Step 5: Reinstall on the dev node**

Run:

```bash
TOKEN=$(python3 -c "import tomllib;print(tomllib.load(open('/Users/xilosada/Library/Application Support/calimero/meroctl/nodes.toml','rb'))['nodes']['http://localhost:2461/']['jwt_tokens']['access_token'])")
MPK="/Users/xilosada/dev/calimero-work/workshop-apps/logic/res/p2p-sheets-1.0.0.mpk"
/usr/bin/curl -s -X POST "http://localhost:2461/admin-api/install-dev-application" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"path\":\"$MPK\",\"metadata\":[],\"package\":\"com.calimero.p2p-sheets\",\"version\":\"1.0.0\"}"
```

Expected: `{"data":{"applicationId":"…"}}`. (If the token is expired, refresh it: `/private/tmp/…/scratchpad/meroctl --api http://localhost:2461 app ls` completes a browser sign-in and rewrites `nodes.toml`.)

- [ ] **Step 6: Build the app**

Run: `(cd app && npm run build 2>&1 | tail -4)`
Expected: `built in …`.

- [ ] **Step 7: Manual verification (record the result)**

In the browser (reload `http://localhost:4173`), **create a fresh workspace** (contexts are version-locked), then:
- Type `1234.5` in A1 → right-click → Format → Number → shows `1,234.50`; Currency → `$1,234.50`.
- Type `0.25` in A2 → Format → Percent → `25%`.
- Confirm the formula bar still shows the raw value (`1234.5`) when A1 is selected.
- Confirm a formula cell referencing A1 still computes on the raw number (formatting is display-only).
- Download CSV → formatted values appear.

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/app/AppPage.tsx
git commit -m "feat(app): CSV export uses formatted display values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes / known v1 limitations (from the spec)

- Formatting a wide selection (e.g. a whole column via header-select = up to 50 cells) issues one RPC per cell sequentially. Acceptable for v1; a batch `set_range_format` is a possible fast-follow.
- Adding a Borsh field to `CellData` changes its serialization; existing contexts are **not** migrated — the feature is verified in a fresh workspace (already required by version-locking).
- Fixed default decimals and USD-only currency are intentional v1 scope; the format string is colon-extensible (`number:2`, `currency:EUR`) for later.
