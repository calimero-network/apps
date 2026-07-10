# Sheet references by id (+ unique names) — design

**Date:** 2026-07-10
**Status:** Approved in principle (pending spec review)
**Scope:** Change cross-sheet formula references from name-based to id-based, with a frontend id↔name display layer, and enforce unique sheet names. Fixes duplicate-name ambiguity and makes rename O(1).

---

## Problem

Cross-sheet references resolve **by sheet name, first-match-wins** (`logic/crates/spreadsheet/src/lib.rs:618`). Sheet names are not unique (`create_sheet` has no uniqueness guard), and a new workspace can create two `Sheet 1` tabs via a create race. Consequences:

- `=SUM('Sheet 1'!D11,'Sheet 1'!D14)` binds to whichever `Sheet 1` is stored first — not necessarily the one holding the data — silently returning `0`.
- The same formula **displays** identically for refs to either sheet — ambiguous on read, not just on write.
- **Rename is O(all cells) + full recompute**: `rename_sheet` rewrites every formula's name-qualifier (`rewrite_sheet_qualifiers`) and calls `recompute_all()`.

## Solution overview

1. **Canonical references use the stable sheet id, not the name.** The persisted/evaluated formula is id-qualified; the formula bar shows the name. Name becomes pure display metadata.
2. **Unique sheet names**, so the human-facing label space is unambiguous for typing and reading.

These are two halves of one fix: id-refs give correctness and free rename; unique names keep the label space clean.

**No migration / back-compat.** All existing local namespaces are wiped as part of deploy (user-approved), so every stored formula is id-based from day one. The engine resolves **only** id-qualifiers — no name-resolution fallback.

---

## Canonical token format

A cross-sheet reference is stored and evaluated as:

```
[<sheet_id>]!<cell>          e.g.  [sheet-1700000000000-deadbeef]!D11
```

- Square brackets wrap the id. Chosen because (a) they are trivial to scan as an opaque span on both the Rust and TS sides, and (b) Excel already forbids `[` `]` in sheet names, so restricting them here is conventional.
- A **same-sheet** reference stays bare (`D11`), exactly as today.
- A range is qualified **once at its start**: `[id]!A9:F9` (the engine reads one qualifier per range via `split_sheet_qualifier` + `expand_range`).

### Sheet-name character restriction

Add a sheet-name validation rule (in `create_sheet` and `rename_sheet`, not the shared `validate_label`) rejecting names that contain any of: `[` `]` `!` `:` `'` `"` or ASCII control chars. This guarantees a name can never look like a canonical qualifier and keeps typed name-qualifiers parseable. Empty/length rules from `validate_label` still apply. (Mirrors Excel's forbidden set `\ / ? * [ ] :` plus our delimiters.)

---

## Unique names

- **Programmatic create** (the default sheet; the "+" tab's `Sheet N`): **auto-suffix** on collision — `Name`, `Name (2)`, `Name (3)`, … Never blocks. Makes the default-create race harmless (`Sheet 1` + `Sheet 1 (2)` instead of two identical).
- **Explicit rename**: **reject with an error** when the target name is already used by another sheet (`AppError` surfaced to the UI as an inline message). Matches Excel/Sheets. Renaming a sheet to its own current name is a no-op, not an error.
- Uniqueness compares the **trimmed** name, case-sensitively (matches how names are displayed; `Sheet 1` and `sheet 1` are distinct, consistent with the id-based model where only display clarity matters).

The `create_sheet` race in the frontend is *also* fixed (below) so a fresh workspace makes exactly one default sheet — auto-suffix is the safety net, not the primary mechanism.

---

## Logic (Rust / WASM) changes

`logic/crates/spreadsheet/src/lib.rs` (+ `crates/types` for validation):

1. **`create_sheet`**: validate the sheet-name character set; make the name unique by auto-suffixing ` (n)` against existing sheet names before insert. Return the final (possibly suffixed) name in the `SheetCreated` event.
2. **`rename_sheet`**: validate the character set; reject if another sheet already has the target name. **Remove** the `rewrite_sheet_qualifiers` loop and the trailing `recompute_all()` — with id-refs a rename changes no formula and no computed value. Set `name` + `updated_at`, emit `SheetRenamed`. O(1).
3. **Reference resolution** (`recompute_all` closure ~`:615`, and `split_sheet_qualifier`): parse the `[id]!cell` form. Resolve the id directly against the sheet set; **unknown id → `#REF!`** (sheet deleted or bad ref). Drop the name→id map (`:571-577`) and all name matching.
4. **Delete `rewrite_sheet_qualifiers`** and its tests (no longer any name to rewrite).
5. **`delete_sheet`**: unchanged in behavior — refs to the deleted id now fail id-lookup → `#REF!` (previously failed name-lookup → `#REF!`).

`split_sheet_qualifier` becomes an id-qualifier splitter: if the ref starts with `[`, read to the matching `]`, expect `!`, return `(Some(id), rest)`; else `(None, ref)`.

---

## Frontend (TS) changes

The persisted `raw_value` is canonical (id form); `formulaInput` and the formula bar are display (name form). Translation happens at a **small, well-defined boundary** — a raw formula is shown in exactly one place (the formula bar).

### New pure module: `app/src/spreadsheet/sheetref.ts`

- `idsToNames(formula: string, nameOf: (id: string) => string | null): string` — replace each `[id]!` qualifier with `sheetPrefix(name)` (`Name!` or `'Name'!`). Unknown id → render a stable `#REF` sheet marker (e.g. leave `[id]!` untouched so it visibly differs from a valid ref; the value is already `#REF!`).
- `namesToIds(formula: string, idOf: (name: string) => string | null): string` — replace each name-qualifier (`Name!` or `'Name'!`) with `[id]!`. Unknown name → leave as typed (engine will surface `#REF!`).
- Both skip `"…"` string literals and `'…'` quoted-name spans correctly, and treat `[…]` as an opaque qualifier span. Built on the same scanning discipline as `shift.ts`'s `transformRefs`.

### Wiring in `AppPage.tsx`

- **Load (id→name):** where a cell's `raw_value` populates `formulaInput` (~`:165-171` and `handleFormulaCancel` ~`:348-354`), pass it through `idsToNames` using `ss.sheets` for the id→name map.
- **Commit (name→id):** in `commitCell` (~`:186-191`), pass `formulaInput` through `namesToIds` before `setCell`. Uniqueness guarantees an unambiguous name→id map.
- **Point-mode** (`insertRef` ~`:359`): keeps inserting the **display** name into `formulaInput` (via `sheetPrefix`) — unchanged; commit translates it. (Point-mode already targets a specific sheet, so its display name maps back to that exact id.)
- **Cross-sheet copy** (`qualifyFormula`, `shift.ts`): change to qualify bare refs with the source sheet's **id** (`[sourceId]!`) instead of its name — operating in canonical space on the copied `raw_value`. `planPaste`'s `crossSheet` carries `sourceSheetId` (already on the clipboard) instead of `sourceSheetName`.

### Default-sheet create race

Fix so a fresh workspace makes exactly one default sheet: gate the `ensureDefaultSheetRef` safety-net effect (`AppPage:124-136`) to not run for a workspace whose `initProject` path created (or is creating) the default — i.e. skip when `ws.pendingInitName` was set for this context or `initProject` has run. Auto-suffix remains the backstop.

---

## Files touched

| File | Change |
|---|---|
| `logic/crates/types/src/lib.rs` | Add `validate_sheet_name` (char set) — or a helper reused by create/rename. |
| `logic/crates/spreadsheet/src/lib.rs` | id-qualifier resolution; unique-name auto-suffix (create) + reject (rename); O(1) rename (drop rewrite+recompute); delete `rewrite_sheet_qualifiers`; `split_sheet_qualifier` → id form. |
| `logic/crates/spreadsheet/src/…` tests | Update name-qualified cases to id-qualified; add uniqueness + O(1)-rename tests. |
| `app/src/spreadsheet/sheetref.ts` | **New** — `idsToNames` / `namesToIds`. |
| `app/src/spreadsheet/shift.ts` | `qualifyFormula` qualifies with an id (`[id]!`), skips `[…]` spans. |
| `app/src/spreadsheet/paste.ts` | `planPaste` `crossSheet` carries `sourceSheetId`. |
| `app/src/pages/app/AppPage.tsx` | id↔name at load/commit; copy qualifies by id; fix default-create race. |

---

## Testing

- **Logic (Rust):** id-qualifier resolution (valid → value, unknown id → `#REF!`); range with one id-qualifier; auto-suffix on duplicate create; reject on duplicate rename; rename touches no formula and no computed value (regression that rename no longer recomputes); sheet-name character rejection.
- **Frontend (vitest, pure):** `idsToNames`/`namesToIds` round-trip (ranges, absolutes, function names, quoted names, string literals, unknown id/name); `qualifyFormula` emits `[id]!`; `planPaste` cross-sheet uses source id.
- **Regression:** full `app` suite green; `tsc`; `vite build`. Logic `cargo test`.
- **Manual (local, after WASM rebuild + namespace wipe):** create workspace → one default sheet; add sheet with a taken name → `(2)`; rename to a taken name → inline error; cross-sheet `=SUM(...)` via point-mode returns correct value; rename a referenced sheet → formula bar shows the new name instantly, value unchanged, no recompute lag.

---

## Non-goals

- No change to same-sheet formulas, evaluation semantics, clipboard mechanics, or the reskin.
- No general name→id UI for *typed* refs beyond what uniqueness provides (typing a unique name resolves exactly; a typo → `#REF!`).
- No back-compat with name-qualified stored formulas (old namespaces are wiped).
