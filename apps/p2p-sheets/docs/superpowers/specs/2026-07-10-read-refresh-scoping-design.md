# Read/Refresh Scoping (Recalc Phase 1.5) — Design

**Status:** Approved design, pending implementation plan.
**Predecessor:** `docs/superpowers/specs/2026-07-10-recalc-engine-architecture-design.md` (§6.3, §6.4, §9).
**Scope:** Two independent deliverables — node-side read scoping (§6.3) and client active-sheet-only refresh (§6.4).

---

## 1. Problem

Phase 1 relocated computation from write time to read time (derive-on-read). It deliberately left two read-cost levers unscoped:

- **Node (§6.3):** `get_cells(sheet)` evaluates the **whole workbook** on every read. Correct, but read cost scales with total workbook size, not with what is displayed.
- **Client (§6.4):** `refresh()` (`app/src/hooks/useSpreadsheet.ts:152`) fetches **every** sheet's cells (`fetchedSheets.map(getCells)`, line 166) on every refresh. On a book with N sheets that is N node reads per refresh, each a whole-workbook eval — an N×whole-book cost for a single-sheet view.

Neither is a correctness bug; both are cost. This phase bounds read cost to what is on screen on both sides of the wire, without changing any computed value or the evaluator seam.

## 2. Principle (unchanged)

The node remains the compute authority. Derive-on-read stays. Both changes only **feed the evaluator less** (node) and **fetch fewer sheets** (client). `recalc::evaluate`'s interface does not change — scoping is a caller-side choice of which inputs to hand it.

Cross-sheet dependencies are resolved **on the node during evaluation**, never by the client assembling other sheets' data. When the client calls `get_cells(A)`, the node evaluates A's cells against its full stored state — including cells on referenced sheets — and returns A's cells with `computed_value` already filled. Verified: a formula `=[SheetB]!A1+100` returns `105` from `get_cells` on the referencing sheet. The client displays; it never computes.

## 3. Component map

| File | Change | Kind |
|---|---|---|
| `logic/crates/spreadsheet/src/recalc.rs` | Add pure `sheet_closure` helper (sheet-level reverse-reachability). | **Modify** |
| `logic/crates/spreadsheet/src/lib.rs` | `get_cells` builds a closure-scoped `WorkbookInputs` instead of the full workbook. | **Modify** |
| `app/src/hooks/useSpreadsheet.ts` | `refresh()` fetches the active sheet only; hook takes the active sheet id as input. | **Modify** |
| `app/src/pages/app/AppPage.tsx` | Pass `activeSheetId` into `useSpreadsheet`; `handleDownload` fetches all sheets on demand. | **Modify** |

---

## 4. §6.3 — Node: sheet-level read scoping

### 4.1 Granularity decision: sheet-level, not cell-level

`get_cells(A)` evaluates the **requested sheet plus every sheet it transitively references, each in full** — rather than the requested sheet's cells plus only their transitive precedent *cells*.

**Why sheet-level over cell-level.** Scoping is sound only if the evaluated subset contains every cell the evaluator might *read* while computing A. That depends on `precedents()` enumerating every reference a formula reads. Ranges expand correctly today, but a future whole-column/row reference (`A:A`, deferred in §9) could under-report. Cell-level scoping would then silently under-include and produce values that differ from whole-workbook eval. Sheet-level over-includes within any touched sheet, so it stays **provably identical to whole-workbook eval** regardless of `precedents()` completeness. It still bounds cost to sheets actually touched: a book of 10 independent sheets where the active sheet references one other evaluates 2 sheets, not 10.

### 4.2 The closure algorithm (pure helper in `recalc`)

```
fn sheet_closure(
    cells: &[stored cells],
    requested_sheet: &str,
) -> HashSet<String>            // set of sheet ids to evaluate
```

1. `closure = { requested_sheet }`.
2. Repeat to fixpoint: for every formula cell (`raw` starts with `=`) whose `sheet_id ∈ closure`, run `precedents(raw, sheet_id)` and add each precedent's `sheet_id` to `closure`.
3. Return `closure`.

Termination: `closure` is monotonically growing and bounded by the finite set of existing sheet ids. Reuses the existing `precedents()` (same function that builds the evaluator's edges), so the closure is exactly the evaluator's sheet-level dependency reachability from A.

### 4.3 `get_cells` rewire

`get_cells(sheet_id)` becomes:

1. `closure = sheet_closure(all_cells, sheet_id)`.
2. Build `WorkbookInputs` from **cells whose `sheet_id ∈ closure`**, and pass **all existing sheet ids** as `sheet_ids` (cheap — ids only, no cells).
3. `recalc::evaluate(&inputs)`.
4. Return the requested sheet's cells as `Cell` views with `computed_value` filled from the result (same blank-hide filter + sort as today).

**Why all sheet ids, not just closure ids.** `sheet_ids` drives the evaluator's "referenced sheet exists (→ blank/0) vs does not exist (→ `#REF!`)" distinction. Any *existing* sheet that A references is in the closure by construction, so passing all existing ids can never misclassify a real reference; it only preserves exact `#REF!` semantics for references to non-existent sheets. Passing all ids is the provably-safe choice and costs nothing (no cell data).

### 4.4 Correctness

Sheets outside the closure are, by the definition of the dependency graph, unreachable from A's cells and cannot affect any value on A. Evaluating the closure and returning A's cells therefore yields values identical to whole-workbook eval. `#CYCLE!` (cycle members are reachable, so included), `#REF!` (unknown-sheet via full sheet-id set), and cross-sheet reads are all preserved.

`export_all` (`lib.rs`) returns only sheet metadata today and is unchanged. A future full-data export would derive the same way (feed all sheets to `evaluate`).

---

## 5. §6.4 — Client: active-sheet-only refresh

### 5.1 Hook takes the active sheet id

`useSpreadsheet` currently owns `cells`/`sheets`/`refresh` but does not know which sheet is active (`activeSheetId` lives in `AppPage`). The hook gains the active sheet id as an input so `refresh` can scope its fetch. `AppPage` passes `activeSheetId` in; when it changes (tab switch), `refresh` re-runs for the new sheet.

### 5.2 `refresh()` fetches the active sheet only

`refresh()` fetches `listSheets` + `getCells(activeSheetId)` + `getCursors` + `getFunctions` — one `getCells`, not N. `cells` holds **only the active sheet's cells**.

### 5.3 Consumers

Every existing `ss.cells` consumer in `AppPage` already filters by `sheet_id === activeSheetId` (cell lookups, format, fill, clipboard, grid render, status-bar count), so active-only resident state is transparent to them. The sole exception:

- **`handleDownload` (`AppPage.tsx:661`)** iterates all sheets' cells to build the CSV. It changes to fetch every sheet on demand at export time (`Promise.all(sheets.map((s) => client.getCells({ sheet_id: s.id })))`) rather than reading resident state. Download is an explicit, infrequent action, so an on-demand full fetch is appropriate.

### 5.4 Freshness trigger stays broad

The existing `useSubscription` fires `refresh` on **any** CRDT sync event for the context. This is retained deliberately: it is what keeps the active sheet A correct when a *referenced* sheet B changes. A change to B fires a context sync → client refetches **A** (not B) → the node recomputes A with B's new value → A displays the update. Narrowing the trigger to "only when A's own cells change" would miss cross-sheet updates, so it is explicitly not narrowed.

```
A has =SheetB!X1 ; SheetB!X1 edited
  -> context sync event
  -> refetch active sheet A         (node recomputes A incl. cross-sheet ref)
  -> A shows updated value
```

### 5.5 Bootstrap

The first-run bootstrap in `AppPage` (`ss.cells.length === 0` gate, ~line 153, which triggers `initProject`) continues to work: on a fresh context the active sheet is empty, so `cells.length === 0` holds until the first sheet has content, unchanged in meaning under active-only state.

---

## 6. Testing strategy

### Node (`recalc.rs`, `lib.rs` tests)
- `sheet_closure`: independent sheets excluded; direct reference `A→B` includes B; transitive `A→B→C` includes C; self-only (no formulas) returns `{A}`; cross-sheet cycle `A↔B` includes both.
- Scoped `get_cells` returns values **byte-identical** to a full-workbook baseline on a multi-sheet fixture (the anti-regression guarantee).
- Edge cases preserved: `#CYCLE!` on a cross-sheet cycle; `#REF!` on a reference to a non-existent sheet; blank-hide + sort unchanged.

### Client (`useSpreadsheet`, `AppPage` handlers)
- `refresh` issues exactly **one** `getCells` (for the active sheet), not one per sheet.
- Changing the active sheet id re-runs `refresh` against the new sheet.
- A simulated context sync event triggers a refetch of the active sheet.
- A cross-sheet-dependent cell reflects the updated value after the referenced sheet changes (end-to-end freshness).
- `handleDownload` still emits every sheet's data (fetches all on demand).

---

## 7. Non-goals

- Cell-level node scoping (rejected in §4.1 for soundness/complexity; sheet-level captures the practical win).
- Per-sheet client cache (rejected in favor of single-source active-only state; no staleness to reconcile).
- Viewport/region scoping within a sheet (Phase 2, §8 of the predecessor spec).
- Any change to `recalc::evaluate`'s interface, the CRDT data model, or the batch mutation API.
