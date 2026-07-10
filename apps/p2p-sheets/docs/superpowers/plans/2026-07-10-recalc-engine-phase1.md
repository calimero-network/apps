# Recalc Engine Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make computed values a deterministic, derive-on-read function of an inputs-only CRDT, evaluated by a pure dependency-graph engine, and collapse range operations into a single batch mutation.

**Architecture:** A pure `recalc` module builds a dependency graph from workbook inputs, orders it with an iterative topological sort (exact cycle detection), and evaluates each cell once via the existing `formula` module. The replicated `CellData` drops `computed_value`; writes store raw input only (no recompute); `get_cells` derives values on read. A `apply_cell_ops` batch mutation applies a whole range op in one commit.

**Tech Stack:** Rust (Calimero SDK, `wasmer` WASM runtime, `borsh`), `TestHost` unit tests; React 19 + TypeScript + vitest (node env — pure-logic tests only) on the client.

## Global Constraints

- Determinism: identical inputs must produce identical outputs regardless of map/insertion order. Topological ordering MUST process ready nodes in sorted (`CellRef` `Ord`) order.
- Termination: evaluation MUST be a single pass over a DAG. No fixed-point loop, no `max_iter`. The runtime has **no fuel meter** — a non-terminating read would hang the node.
- Iterative topological sort only (Kahn's algorithm). No recursive DFS over the cell graph (WASM stack limit).
- Cycle semantics: a formula cell that is in — or transitively downstream of — a dependency cycle resolves to the literal string `#CYCLE!`.
- Error tokens preserved exactly: `#REF! #VALUE! #DIV/0! #NAME? #NUM! #NULL! #N/A #CYCLE!`.
- Cross-sheet references use the canonical id form `[<sheet_id>]!A1`; an unknown sheet id resolves to `#REF!`.
- `clear_cell` keeps soft-clear semantics (blank in place; never tombstone the key).
- The stored, replicated `CellData` holds inputs only — `id, sheet_id, row, col, raw_value, format, updated_at`. **No `computed_value` field.** The view type `Cell` keeps `computed_value`, filled at read time.
- State is wiped at deploy (standing "nuke the namespaces" decision); no in-place borsh migration is written.
- Do NOT push commits. Local commits only.

**Deferred to Phase 1.5 (NOT in this plan):** node-side read scoping (reverse-reachability from the requested sheet) and the paired client `refresh()` scoping (spec §6.3–§6.4). Phase 1 evaluates the full workbook on each `get_cells` and the client keeps its all-sheet refresh. See spec §9.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `logic/crates/spreadsheet/src/lib.rs` — `mod formula` | Add `pub(crate) fn precedents`; make `mod formula` `pub(crate)` and `evaluate` `pub(crate)`. | Modify |
| `logic/crates/spreadsheet/src/recalc.rs` | New pure module: `CellRef`, `WorkbookInputs`, `order` (topo + cycle detection), `evaluate`. | Create |
| `logic/crates/spreadsheet/src/lib.rs` — state & methods | Drop `computed_value` from `CellData` + `Mergeable`; writes store raw only; delete `recompute_all`; `get_cells` derives via `recalc`; add `apply_cell_ops`. | Modify |
| `app/src/api/spreadsheet/SpreadsheetClient.ts` | Add `applyCellOps` RPC binding + `CellOp` type. | Modify |
| `app/src/spreadsheet/ops.ts` | New pure helper: build `CellOp[]` from a range op. | Create |
| `app/src/pages/app/AppPage.tsx` | Range handlers build one `CellOp[]` and call `applyCellOps` once, refresh once. | Modify |
| `app/src/hooks/useSpreadsheet.ts` | Add `applyCellOps` mutation wrapper. | Modify |

---

## Task 1: `formula::precedents` — structural precedent extraction

Extract every cell reference a formula *syntactically* contains (both branches of `IF`, all function args, ranges expanded to member cells), resolved to absolute `(sheet_id, row, col)` targets. Over-approximation is intentional and correct: a conservative graph yields a valid topological order regardless of which branch runs, and matches Excel's structural circular-reference detection.

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` — inside `mod formula` (after `expand_range`, ~line 1301); change `mod formula` → `pub(crate) mod formula` (~line 879) and `pub fn evaluate` → `pub(crate) fn evaluate` (~line 887).
- Test: `logic/crates/spreadsheet/src/lib.rs` — `mod tests` (reuse the existing `#[cfg(test)] mod tests`; these are pure `formula::` tests needing no `TestHost`).

**Interfaces:**
- Consumes: existing `formula` helpers `expand_range`, `parse_cell_ref`, `parse_col_only`, `parse_row_only` (all already in `mod formula`).
- Produces: `pub(crate) fn precedents(formula: &str, home_sheet: &str) -> Vec<(String, u32, u32)>` — absolute targets; `home_sheet` substituted for bare (un-qualified) refs. Empty vec for a non-formula string (not starting with `=`). May contain duplicates (callers dedupe).

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `lib.rs`:

```rust
#[test]
fn precedents_single_and_range() {
    // A range expands to every member cell; a lone ref is one cell.
    let mut p = formula::precedents("=A1+B2", "s1");
    p.sort();
    assert_eq!(p, vec![("s1".into(), 0, 0), ("s1".into(), 1, 1)]);

    let mut r = formula::precedents("=SUM(A1:A3)", "s1");
    r.sort();
    assert_eq!(
        r,
        vec![("s1".into(), 0, 0), ("s1".into(), 1, 0), ("s1".into(), 2, 0)]
    );
}

#[test]
fn precedents_ignores_function_names_and_strings() {
    // SUM/IF are names, not refs; "A1" inside a string literal is text.
    let mut p = formula::precedents("=IF(A1, \"B2\", C3)", "s1");
    p.sort();
    assert_eq!(p, vec![("s1".into(), 0, 0), ("s1".into(), 2, 2)]); // A1 and C3 only
}

#[test]
fn precedents_cross_sheet_and_absolute() {
    // [id]! qualifies the sheet; $ anchors are irrelevant to dependency.
    let mut p = formula::precedents("=[data]!A1 + $B$2", "s1");
    p.sort();
    assert_eq!(p, vec![("data".into(), 0, 0), ("s1".into(), 1, 1)]);
}

#[test]
fn precedents_non_formula_is_empty() {
    assert!(formula::precedents("42", "s1").is_empty());
    assert!(formula::precedents("hello", "s1").is_empty());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd logic && cargo test -p spreadsheet precedents_`
Expected: FAIL — `no function or associated item named 'precedents'`.

- [ ] **Step 3: Implement `precedents`**

Insert into `mod formula` (after `expand_range`). It strips a leading `=` and any `$`, walks the characters, skips `"…"` literals, reads `[id]!` qualified refs/ranges, treats an uppercase-letter run followed by `(` as a function name (skipped), and otherwise reads a ref-or-range unit and expands it with `expand_range`:

```rust
/// Every cell reference a formula syntactically contains, as absolute
/// `(sheet_id, row, col)` targets (`home_sheet` for un-qualified refs). Ranges
/// are expanded to member cells; string literals and function names are ignored.
/// Over-approximates (captures all branches) — this is what makes the dependency
/// graph conservative and the topological order valid for any runtime branch.
pub(crate) fn precedents(formula: &str, home_sheet: &str) -> Vec<(String, u32, u32)> {
    let trimmed = formula.trim();
    if !trimmed.starts_with('=') {
        return Vec::new();
    }
    // Drop '=' and all '$' anchors outside string literals (they never change
    // which cell is referenced).
    let body = &trimmed[1..];
    let chars: Vec<char> = body.chars().collect();
    let mut out: Vec<(String, u32, u32)> = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        // String literal — copy through the closing quote, capturing nothing.
        if ch == '"' {
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
            continue;
        }
        // Cross-sheet qualifier [id]! followed by a ref or range.
        if ch == '[' {
            if let Some(end) = chars[i + 1..].iter().position(|&c| c == ']') {
                let id: String = chars[i + 1..i + 1 + end].iter().collect();
                let mut j = i + 1 + end + 1; // past ']'
                if chars.get(j) == Some(&'!') {
                    j += 1;
                    let (unit, next) = read_ref_unit(&chars, j);
                    for (r, c) in expand_range(&unit) {
                        out.push((id.clone(), r, c));
                    }
                    i = next.max(j);
                    continue;
                }
            }
            i += 1;
            continue;
        }
        // A letter run followed immediately by '(' is a function name — skip the
        // name only; its arguments are scanned by the outer loop.
        if ch.is_ascii_uppercase() || ch.is_ascii_lowercase() {
            let mut k = i;
            while k < chars.len() && chars[k].is_ascii_alphabetic() {
                k += 1;
            }
            if chars.get(k) == Some(&'(') {
                i = k; // leave '(' for the loop; args scanned next
                continue;
            }
            // Otherwise read a ref-or-range unit starting at i.
            if ch.is_ascii_uppercase() {
                let (unit, next) = read_ref_unit(&chars, i);
                if next > i {
                    for (r, c) in expand_range(&unit) {
                        out.push((home_sheet.to_string(), r, c));
                    }
                    i = next;
                    continue;
                }
            }
            i += 1;
            continue;
        }
        // A digit run may open a whole-row range (`1:1`); a lone number is a
        // literal and captures nothing.
        if ch.is_ascii_digit() {
            let (unit, next) = read_ref_unit(&chars, i);
            if unit.contains(':') {
                for (r, c) in expand_range(&unit) {
                    out.push((home_sheet.to_string(), r, c));
                }
            }
            i = next.max(i + 1);
            continue;
        }
        i += 1;
    }
    out
}

/// Read a ref-or-range token starting at `start`: a run of uppercase letters
/// and/or digits, optionally `':'` and a second such run. Returns the token
/// string (e.g. `"A1"`, `"A1:B3"`, `"A:A"`, `"1:1"`) and the index just past it.
fn read_ref_unit(chars: &[char], start: usize) -> (String, usize) {
    let read_atom = |mut p: usize| -> usize {
        while p < chars.len() && chars[p].is_ascii_uppercase() {
            p += 1;
        }
        while p < chars.len() && chars[p].is_ascii_digit() {
            p += 1;
        }
        p
    };
    let mut end = read_atom(start);
    if chars.get(end) == Some(&':') {
        end = read_atom(end + 1);
    }
    (chars[start..end].iter().collect(), end)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd logic && cargo test -p spreadsheet precedents_`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add logic/crates/spreadsheet/src/lib.rs
git commit -m "feat(recalc): structural precedent extraction in formula module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `recalc::order` — topological sort with exact cycle detection

Given the set of formula cells and a function returning each cell's precedents, produce a deterministic topological order of the acyclic cells and the set of cells that are in — or downstream of — a cycle.

**Files:**
- Create: `logic/crates/spreadsheet/src/recalc.rs`
- Modify: `logic/crates/spreadsheet/src/lib.rs` — add `mod recalc;` near the other `mod` declarations (e.g. after `mod formula { … }`’s closing brace, before `mod tests`).
- Test: `logic/crates/spreadsheet/src/recalc.rs` — `#[cfg(test)] mod tests`.

**Interfaces:**
- Produces:
  - `pub struct CellRef { pub sheet_id: String, pub row: u32, pub col: u32 }` deriving `Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug`.
  - `pub(crate) fn order(nodes: &BTreeSet<CellRef>, precedents_of: &impl Fn(&CellRef) -> Vec<CellRef>) -> (Vec<CellRef>, BTreeSet<CellRef>)` — returns `(acyclic_topo_order, cyclic_or_downstream)`. `precedents_of` may return cells outside `nodes`; those are ignored (they are always-available sources). Ready nodes are processed in ascending `CellRef` order for determinism.

- [ ] **Step 1: Write the failing tests**

Create `recalc.rs` with the type, a stub `order`, and tests:

```rust
//! Pure recalculation engine: workbook inputs -> computed values.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use crate::formula;

/// Absolute cell coordinate (0-based row/col).
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct CellRef {
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
}

pub(crate) fn order(
    _nodes: &BTreeSet<CellRef>,
    _precedents_of: &impl Fn(&CellRef) -> Vec<CellRef>,
) -> (Vec<CellRef>, BTreeSet<CellRef>) {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cr(sheet: &str, row: u32, col: u32) -> CellRef {
        CellRef { sheet_id: sheet.into(), row, col }
    }

    #[test]
    fn chain_orders_precedents_first() {
        // C depends on B depends on A. Order must be A, B, C.
        let a = cr("s", 0, 0);
        let b = cr("s", 1, 0);
        let c = cr("s", 2, 0);
        let nodes: BTreeSet<CellRef> = [a.clone(), b.clone(), c.clone()].into();
        let prec = |n: &CellRef| -> Vec<CellRef> {
            if *n == c { vec![b.clone()] }
            else if *n == b { vec![a.clone()] }
            else { vec![] }
        };
        let (ordered, cyclic) = order(&nodes, &prec);
        assert!(cyclic.is_empty());
        assert_eq!(ordered, vec![a.clone(), b.clone(), c.clone()]);
    }

    #[test]
    fn self_cycle_and_downstream_are_cyclic() {
        // A references itself; B references A. Both are cyclic/downstream.
        let a = cr("s", 0, 0);
        let b = cr("s", 1, 0);
        let nodes: BTreeSet<CellRef> = [a.clone(), b.clone()].into();
        let prec = |n: &CellRef| -> Vec<CellRef> {
            if *n == a { vec![a.clone()] }
            else if *n == b { vec![a.clone()] }
            else { vec![] }
        };
        let (ordered, cyclic) = order(&nodes, &prec);
        assert!(ordered.is_empty());
        assert_eq!(cyclic, [a, b].into());
    }

    #[test]
    fn ignores_precedents_outside_nodes() {
        // A's precedent is a literal cell (not a formula node) — A is a source.
        let a = cr("s", 0, 0);
        let lit = cr("s", 9, 9);
        let nodes: BTreeSet<CellRef> = [a.clone()].into();
        let prec = |_n: &CellRef| vec![lit.clone()];
        let (ordered, cyclic) = order(&nodes, &prec);
        assert!(cyclic.is_empty());
        assert_eq!(ordered, vec![a]);
    }

    #[test]
    fn ready_nodes_processed_in_sorted_order() {
        // Two independent nodes: deterministic ascending order.
        let a = cr("s", 0, 0);
        let b = cr("s", 0, 1);
        let nodes: BTreeSet<CellRef> = [b.clone(), a.clone()].into();
        let prec = |_n: &CellRef| vec![];
        let (ordered, _) = order(&nodes, &prec);
        assert_eq!(ordered, vec![a, b]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd logic && cargo test -p spreadsheet --lib recalc::`
Expected: FAIL — `order` panics with `not yet implemented` (or the test binary panics on `todo!()`).

- [ ] **Step 3: Implement `order` (iterative Kahn, sorted ready set)**

Replace the `order` stub:

```rust
pub(crate) fn order(
    nodes: &BTreeSet<CellRef>,
    precedents_of: &impl Fn(&CellRef) -> Vec<CellRef>,
) -> (Vec<CellRef>, BTreeSet<CellRef>) {
    // in_degree[n] = number of n's precedents that are themselves formula nodes.
    // dependents[p] = formula nodes that reference p.
    let mut in_degree: BTreeMap<CellRef, usize> = nodes.iter().map(|n| (n.clone(), 0)).collect();
    let mut dependents: BTreeMap<CellRef, Vec<CellRef>> = BTreeMap::new();
    for n in nodes {
        for p in precedents_of(n) {
            if nodes.contains(&p) {
                *in_degree.get_mut(n).unwrap() += 1;
                dependents.entry(p).or_default().push(n.clone());
            }
        }
    }

    // Kahn's algorithm. `ready` is a BTreeSet so we always pop the smallest
    // CellRef — deterministic order independent of input iteration order.
    let mut ready: BTreeSet<CellRef> =
        in_degree.iter().filter(|(_, d)| **d == 0).map(|(n, _)| n.clone()).collect();
    let mut ordered: Vec<CellRef> = Vec::with_capacity(nodes.len());
    while let Some(n) = ready.iter().next().cloned() {
        ready.remove(&n);
        ordered.push(n.clone());
        if let Some(deps) = dependents.get(&n) {
            for d in deps {
                let e = in_degree.get_mut(d).unwrap();
                *e -= 1;
                if *e == 0 {
                    ready.insert(d.clone());
                }
            }
        }
    }

    // Anything not ordered never reached in-degree 0 → in or downstream of a cycle.
    let ordered_set: BTreeSet<CellRef> = ordered.iter().cloned().collect();
    let cyclic: BTreeSet<CellRef> = nodes.difference(&ordered_set).cloned().collect();
    (ordered, cyclic)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd logic && cargo test -p spreadsheet --lib recalc::`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add logic/crates/spreadsheet/src/recalc.rs logic/crates/spreadsheet/src/lib.rs
git commit -m "feat(recalc): topological order with exact cycle detection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `recalc::evaluate` — derive every cell value

Tie precedent extraction, ordering, and the `formula` evaluator into a single pure function: workbook inputs → computed value per cell. This replaces `recompute_all`'s fixed-point algorithm.

**Files:**
- Modify: `logic/crates/spreadsheet/src/recalc.rs`
- Test: `logic/crates/spreadsheet/src/recalc.rs` — `mod tests`.

**Interfaces:**
- Consumes: `formula::precedents` (Task 1), `formula::evaluate` (Task 1), `order` (Task 2).
- Produces:
  - `pub struct WorkbookInputs { pub cells: BTreeMap<CellRef, String>, pub sheet_ids: HashSet<String> }`
  - `pub fn evaluate(inputs: &WorkbookInputs) -> BTreeMap<CellRef, String>` — computed display value per input cell. A non-formula cell maps to its raw value; a formula cell to its evaluated result; a cyclic/downstream formula cell to `"#CYCLE!"`. Cross-sheet ref to an id not in `sheet_ids` → `"#REF!"`.

- [ ] **Step 1: Write the failing tests**

Add to `recalc.rs`. Extend the top-of-file `use` to include `WorkbookInputs`’s deps (already imported). Add:

```rust
pub struct WorkbookInputs {
    pub cells: BTreeMap<CellRef, String>,
    pub sheet_ids: HashSet<String>,
}

pub fn evaluate(_inputs: &WorkbookInputs) -> BTreeMap<CellRef, String> {
    todo!()
}
```

And tests:

```rust
#[cfg(test)]
mod eval_tests {
    use super::*;

    fn inputs(sheets: &[&str], cells: &[(&str, u32, u32, &str)]) -> WorkbookInputs {
        WorkbookInputs {
            cells: cells
                .iter()
                .map(|(s, r, c, v)| (CellRef { sheet_id: (*s).into(), row: *r, col: *c }, (*v).into()))
                .collect(),
            sheet_ids: sheets.iter().map(|s| (*s).to_string()).collect(),
        }
    }
    fn get(out: &BTreeMap<CellRef, String>, s: &str, r: u32, c: u32) -> String {
        out.get(&CellRef { sheet_id: s.into(), row: r, col: c }).cloned().unwrap_or_default()
    }

    #[test]
    fn literal_and_chain() {
        // A1=1, A2=A1+4, A3=SUM(A1,A2). Single pass in dependency order.
        let inp = inputs(&["s"], &[("s", 0, 0, "1"), ("s", 1, 0, "=A1+4"), ("s", 2, 0, "=SUM(A1,A2)")]);
        let out = evaluate(&inp);
        assert_eq!(get(&out, "s", 0, 0), "1");
        assert_eq!(get(&out, "s", 1, 0), "5");
        assert_eq!(get(&out, "s", 2, 0), "6");
    }

    #[test]
    fn cross_sheet_and_unknown_sheet() {
        let inp = inputs(
            &["s", "data"],
            &[("data", 0, 0, "10"), ("s", 0, 0, "=[data]!A1*2"), ("s", 1, 0, "=[gone]!A1")],
        );
        let out = evaluate(&inp);
        assert_eq!(get(&out, "s", 0, 0), "20");
        assert_eq!(get(&out, "s", 1, 0), "#REF!");
    }

    #[test]
    fn cycle_and_downstream_are_cycle_error() {
        // B1 references itself; C1 references B1 → both #CYCLE!.
        let inp = inputs(&["s"], &[("s", 0, 1, "=SUM(A1,B1)"), ("s", 0, 2, "=B1+1")]);
        let out = evaluate(&inp);
        assert_eq!(get(&out, "s", 0, 1), "#CYCLE!");
        assert_eq!(get(&out, "s", 0, 2), "#CYCLE!");
    }

    #[test]
    fn deterministic_regardless_of_insertion_order() {
        let a = inputs(&["s"], &[("s", 0, 0, "1"), ("s", 1, 0, "=A1+1"), ("s", 2, 0, "=A2+1")]);
        let b = inputs(&["s"], &[("s", 2, 0, "=A2+1"), ("s", 1, 0, "=A1+1"), ("s", 0, 0, "1")]);
        assert_eq!(evaluate(&a), evaluate(&b));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd logic && cargo test -p spreadsheet --lib recalc::eval_tests`
Expected: FAIL — `evaluate` hits `todo!()`.

- [ ] **Step 3: Implement `evaluate`**

Replace the `evaluate` stub. Non-formula cells seed `results` with their raw value; formula nodes are ordered, cyclic ones stamped `#CYCLE!`, the rest evaluated once in topological order through `formula::evaluate` with a closure that reads already-computed `results` and flags unknown sheet ids as `#REF!`:

```rust
pub fn evaluate(inputs: &WorkbookInputs) -> BTreeMap<CellRef, String> {
    let is_formula = |raw: &str| raw.trim_start().starts_with('=');

    // Seed: every cell's value defaults to its raw input (literals are final;
    // formula cells are overwritten below). Empty/absent cells stay absent.
    let mut results: BTreeMap<CellRef, String> = inputs.cells.clone();

    // Formula cells are the graph nodes.
    let nodes: BTreeSet<CellRef> = inputs
        .cells
        .iter()
        .filter(|(_, raw)| is_formula(raw))
        .map(|(k, _)| k.clone())
        .collect();

    let precedents_of = |n: &CellRef| -> Vec<CellRef> {
        let raw = inputs.cells.get(n).map(String::as_str).unwrap_or("");
        formula::precedents(raw, &n.sheet_id)
            .into_iter()
            .map(|(sheet_id, row, col)| CellRef { sheet_id, row, col })
            .collect()
    };

    let (ordered, cyclic) = order(&nodes, &precedents_of);

    // Cyclic / downstream cells resolve to #CYCLE! and are not evaluated.
    for n in &cyclic {
        results.insert(n.clone(), "#CYCLE!".to_string());
    }

    // Evaluate acyclic formula cells once, precedents-first.
    for n in &ordered {
        let raw = match inputs.cells.get(n) {
            Some(r) => r.clone(),
            None => continue,
        };
        let home = n.sheet_id.clone();
        let bad_sheet = core::cell::Cell::new(false);
        let value = formula::evaluate(&raw, |sheet, r, c| {
            let sid = match sheet {
                Some(id) => {
                    if inputs.sheet_ids.contains(id) {
                        id.to_string()
                    } else {
                        bad_sheet.set(true);
                        return None;
                    }
                }
                None => home.clone(),
            };
            results.get(&CellRef { sheet_id: sid, row: r, col: c }).cloned()
        });
        let value = if bad_sheet.get() { "#REF!".to_string() } else { value };
        results.insert(n.clone(), value);
    }

    results
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd logic && cargo test -p spreadsheet --lib recalc::`
Expected: PASS (all `recalc` tests — Task 2 + Task 3).

- [ ] **Step 5: Commit**

```bash
git add logic/crates/spreadsheet/src/recalc.rs
git commit -m "feat(recalc): pure derive-on-read evaluate over the dependency graph

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Inputs-only CRDT — drop `computed_value`, derive on read

Remove `computed_value` from the replicated `CellData` and its merge, make writes store raw input only, delete `recompute_all`, and derive values in `get_cells` via `recalc::evaluate`.

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` — `CellData` (~62), `Mergeable for CellData` (~79), `set_cell` (~380), `set_cell_formula` (~438), `set_cell_format` (~510), `clear_cell` (~544), `recompute_all` (delete, ~565–680), `get_cells` (~682).
- Test: `logic/crates/spreadsheet/src/lib.rs` — `mod tests` (existing integration tests; several assertions update because values are now derived on read, not stored).

**Interfaces:**
- Consumes: `recalc::{CellRef, WorkbookInputs, evaluate}` (Task 3).
- Produces: `CellData` without `computed_value`; `get_cells` returns `Cell` views with `computed_value` filled by derivation.

- [ ] **Step 1: Write/adjust the failing test**

Add a test proving derivation-on-read and that no computed value is stored:

```rust
#[test]
fn get_cells_derives_dependent_values_on_read() {
    let mut app = make_app();
    let sid = app.create_sheet("Sheet 1".into()).unwrap();
    // Store inputs only — set_cell must NOT recompute.
    app.set_cell(sid.clone(), 0, 0, "2".into()).unwrap();
    app.set_cell_formula(sid.clone(), 1, 0, "=A1*10".into()).unwrap();
    let cells = app.get_cells(sid.clone()).unwrap();
    let b = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
    assert_eq!(b.computed_value, "20", "dependent derived on read");
    // Change the precedent; the dependent re-derives with no extra write to B1.
    app.set_cell(sid.clone(), 0, 0, "3".into()).unwrap();
    let cells = app.get_cells(sid).unwrap();
    let b = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
    assert_eq!(b.computed_value, "30");
}
```

Run: `cd logic && cargo test -p spreadsheet get_cells_derives`
Expected: FAIL to compile — `CellData` still has `computed_value` and `get_cells` returns stored values (test may pass by accident today; it will fail after Step 3’s field removal if `get_cells` is not yet wired, so treat Step 3 as the driver and re-run in Step 4).

- [ ] **Step 2: Remove `computed_value` from `CellData` and its merge**

`CellData` (~62) — delete the `computed_value` field and its doc line. `Mergeable for CellData` (~79) — delete the `self.computed_value = other.computed_value.clone();` line inside the LWW branch. Leave `raw_value`, `format`, `updated_at` merge as-is.

- [ ] **Step 3: Make writes store raw only; delete `recompute_all`; derive in `get_cells`**

In `set_cell` (~380): remove `computed_value: raw_value` from the `CellData` construction and the `guard.computed_value = data.computed_value;` update; keep `raw_value`. Remove the trailing `self.recompute_all()?;` (keep `app::emit!` + `Ok(key)`).

In `set_cell_formula` (~438): same — construct `CellData` without `computed_value`, drop the `guard.computed_value` update, remove `self.recompute_all()?;`.

In `set_cell_format` (~510): remove `computed_value: String::new()` from the `CellData` construction (the format-only insert branch).

In `clear_cell` (~544): remove `guard.computed_value = String::new();` and remove the trailing `self.recompute_all()?;`.

Delete the entire `recompute_all` method (~559–680).

Rewrite `get_cells` (~682) to derive:

```rust
pub fn get_cells(&self, sheet_id: String) -> app::Result<Vec<Cell>> {
    // Build inputs from ALL cells (cross-sheet refs need other sheets) and the
    // set of valid sheet ids, then derive every value once. Phase 1 evaluates
    // the whole workbook per read; node-side scoping is deferred (spec §9).
    let sheet_ids: std::collections::HashSet<String> = self
        .sheets
        .entries()
        .map_err(|e| AppError::msg(format!("sheets.entries: {e}")))?
        .map(|(id, _)| id)
        .collect();
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

    let prefix = format!("{sheet_id}|");
    let mut out: Vec<Cell> = stored
        .into_iter()
        .filter_map(|(k, d)| {
            if k.starts_with(&prefix) && !(d.raw_value.is_empty() && d.format.is_empty()) {
                let cv = computed
                    .get(&recalc::CellRef { sheet_id: d.sheet_id.clone(), row: d.row, col: d.col })
                    .cloned()
                    .unwrap_or_else(|| d.raw_value.clone());
                Some(Cell {
                    id: d.id.clone(),
                    sheet_id: d.sheet_id.clone(),
                    row: d.row,
                    col: d.col,
                    raw_value: d.raw_value.clone(),
                    computed_value: cv,
                    format: d.format.clone(),
                    updated_at: d.updated_at,
                })
            } else {
                None
            }
        })
        .collect();
    out.sort_by_key(|c| (c.row, c.col));
    Ok(out)
}
```

- [ ] **Step 4: Update existing tests + run the suite**

Existing tests that constructed `CellData { computed_value: … }` literals (e.g. around lines 1461–1466) must drop that field. Tests that asserted values via `get_cells` still pass (derivation yields the same numbers). Run:

Run: `cd logic && cargo test -p spreadsheet`
Expected: PASS. The `#CYCLE!` tests (`self_referential_formula_is_cycle_error`, `mutual_divergent_cycle_is_cycle_error`, `long_acyclic_chain_still_converges`) now pass through `recalc` rather than the fixed-point path; `get_cells_derives_dependent_values_on_read` passes. Fix any test that still references `computed_value` on `CellData` (view-type `Cell.computed_value` remains valid).

- [ ] **Step 5: Commit**

```bash
git add logic/crates/spreadsheet/src/lib.rs
git commit -m "feat(recalc): inputs-only CRDT with derive-on-read get_cells

Drop computed_value from replicated CellData; writes store raw input only;
delete recompute_all; get_cells derives every value via recalc::evaluate.
Fixes stale/divergent computed values under p2p merge.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `apply_cell_ops` — batch mutation

Apply a whole range operation (many set/format/clear ops on one sheet) in a single mutation and single CRDT commit.

**Files:**
- Modify: `logic/crates/spreadsheet/src/lib.rs` — add `CellOp` type near the view types (~after `Cell`, ~146) and `apply_cell_ops` near `clear_cell` (~557).
- Test: `logic/crates/spreadsheet/src/lib.rs` — `mod tests`.

**Interfaces:**
- Produces:
  - `pub enum CellOp { Set { row: u32, col: u32, raw_value: String }, Format { row: u32, col: u32, format: String }, Clear { row: u32, col: u32 } }` deriving `Serialize, Deserialize` (`#[serde(crate = "calimero_sdk::serde")]`, and `#[serde(tag = "kind")]` for a stable JSON shape).
  - `pub fn apply_cell_ops(&mut self, sheet_id: String, ops: Vec<CellOp>) -> app::Result<()>` — applies every op in order, emits one event per op, no recompute (derive-on-read).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn apply_cell_ops_applies_mixed_batch() {
    let mut app = make_app();
    let sid = app.create_sheet("Sheet 1".into()).unwrap();
    app.set_cell(sid.clone(), 5, 5, "old".into()).unwrap();
    app.apply_cell_ops(
        sid.clone(),
        vec![
            CellOp::Set { row: 0, col: 0, raw_value: "7".into() },
            CellOp::Set { row: 1, col: 0, raw_value: "=A1*2".into() },
            CellOp::Format { row: 0, col: 0, format: "number".into() },
            CellOp::Clear { row: 5, col: 5 },
        ],
    )
    .unwrap();
    let cells = app.get_cells(sid).unwrap();
    let a1 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
    let a2 = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
    assert_eq!(a1.computed_value, "7");
    assert_eq!(a1.format, "number");
    assert_eq!(a2.computed_value, "14"); // derived on read
    assert!(cells.iter().all(|c| !(c.row == 5 && c.col == 5)), "cleared cell hidden");
}
```

Run: `cd logic && cargo test -p spreadsheet apply_cell_ops_applies_mixed_batch`
Expected: FAIL — `CellOp` / `apply_cell_ops` undefined.

- [ ] **Step 2: Implement `CellOp` and `apply_cell_ops`**

Add the enum near the view types:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind")]
pub enum CellOp {
    Set { row: u32, col: u32, raw_value: String },
    Format { row: u32, col: u32, format: String },
    Clear { row: u32, col: u32 },
}
```

Add the method (delegates to the existing single-cell methods, which already store raw only and no longer recompute after Task 4):

```rust
/// Apply a batch of cell operations to one sheet in a single mutation. One
/// CRDT commit for the whole range op; values are derived on read.
pub fn apply_cell_ops(&mut self, sheet_id: String, ops: Vec<CellOp>) -> app::Result<()> {
    if self
        .sheets
        .get(&sheet_id)
        .map_err(|e| AppError::msg(format!("sheets.get: {e}")))?
        .is_none()
    {
        return Err(AppError::from(Error::NotFound(sheet_id.clone())));
    }
    for op in ops {
        match op {
            CellOp::Set { row, col, raw_value } => {
                if raw_value.trim_start().starts_with('=') {
                    self.set_cell_formula(sheet_id.clone(), row, col, raw_value)?;
                } else {
                    self.set_cell(sheet_id.clone(), row, col, raw_value)?;
                }
            }
            CellOp::Format { row, col, format } => {
                self.set_cell_format(sheet_id.clone(), row, col, format)?;
            }
            CellOp::Clear { row, col } => {
                self.clear_cell(sheet_id.clone(), row, col)?;
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd logic && cargo test -p spreadsheet apply_cell_ops_applies_mixed_batch`
Expected: PASS.

- [ ] **Step 4: Run the full logic suite + build the bundle check**

Run: `cd logic && cargo test -p spreadsheet && cargo build -p spreadsheet --target wasm32-unknown-unknown`
Expected: PASS / build succeeds (the method is exported through `#[app::logic]`).

- [ ] **Step 5: Commit**

```bash
git add logic/crates/spreadsheet/src/lib.rs
git commit -m "feat(recalc): apply_cell_ops batch mutation (one commit per range op)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Client — one batch call per range op

Add the `applyCellOps` binding and a pure `CellOp[]` builder, and rewire the range handlers (paste, fill, delete, format) to issue one batch mutation + one refresh instead of a per-cell loop.

**Files:**
- Modify: `app/src/api/spreadsheet/SpreadsheetClient.ts` — add `CellOp` type + `applyCellOps` method.
- Create: `app/src/spreadsheet/ops.ts` — pure `CellOp[]` builders.
- Test: `app/src/spreadsheet/ops.test.ts` (vitest, node env — pure logic only).
- Modify: `app/src/hooks/useSpreadsheet.ts` — add `applyCellOps` wrapper (one `enqueue` + one `refresh`).
- Modify: `app/src/pages/app/AppPage.tsx` — `handlePaste`, `handleFill`, `handleDelete`, `applyFormat` build one `CellOp[]` and call `ss.applyCellOps` once.

**Interfaces:**
- Consumes: node `apply_cell_ops(sheet_id, ops)` and `CellOp` JSON shape `{ kind: "Set"|"Format"|"Clear", row, col, raw_value?, format? }` (Task 5).
- Produces:
  - `SpreadsheetClient.applyCellOps({ sheet_id: string; ops: CellOp[] }): Promise<void>`.
  - `ops.ts`: `setOp(row, col, raw)`, `formatOp(row, col, format)`, `clearOp(row, col)` returning `CellOp`; `opsFromWrites(writes: { row: number; col: number; raw: string; format: string }[]): CellOp[]` (one `Set` per write, plus a `Format` when `format` is non-empty).
  - `useSpreadsheet` return adds `applyCellOps: (sheetId: string, ops: CellOp[]) => Promise<void>`.

- [ ] **Step 1: Write the failing pure-logic test**

Create `app/src/spreadsheet/ops.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { setOp, formatOp, clearOp, opsFromWrites, type CellOp } from './ops';

describe('ops builders', () => {
  it('builds discriminated CellOps', () => {
    expect(setOp(0, 1, '=A1')).toEqual({ kind: 'Set', row: 0, col: 1, raw_value: '=A1' });
    expect(formatOp(2, 3, 'number')).toEqual({ kind: 'Format', row: 2, col: 3, format: 'number' });
    expect(clearOp(4, 5)).toEqual({ kind: 'Clear', row: 4, col: 5 });
  });

  it('opsFromWrites emits a Set per write and a Format when present', () => {
    const ops: CellOp[] = opsFromWrites([
      { row: 0, col: 0, raw: '1', format: '' },
      { row: 0, col: 1, raw: '=A1', format: 'number' },
    ]);
    expect(ops).toEqual([
      { kind: 'Set', row: 0, col: 0, raw_value: '1' },
      { kind: 'Set', row: 0, col: 1, raw_value: '=A1' },
      { kind: 'Format', row: 0, col: 1, format: 'number' },
    ]);
  });
});
```

Run: `cd app && npx vitest run src/spreadsheet/ops.test.ts`
Expected: FAIL — module `./ops` not found.

- [ ] **Step 2: Implement `ops.ts`**

Create `app/src/spreadsheet/ops.ts`:

```ts
/**
 * Pure builders for batch cell operations. A range op (paste/fill/delete/format)
 * is expressed as one CellOp[] and applied by the node in a single commit.
 * The JSON shape mirrors the Rust `CellOp` enum (`#[serde(tag = "kind")]`).
 */
export type CellOp =
  | { kind: 'Set'; row: number; col: number; raw_value: string }
  | { kind: 'Format'; row: number; col: number; format: string }
  | { kind: 'Clear'; row: number; col: number };

export const setOp = (row: number, col: number, raw_value: string): CellOp => ({
  kind: 'Set', row, col, raw_value,
});
export const formatOp = (row: number, col: number, format: string): CellOp => ({
  kind: 'Format', row, col, format,
});
export const clearOp = (row: number, col: number): CellOp => ({ kind: 'Clear', row, col });

/** One Set per write, plus a Format op when the write carries a non-empty format. */
export function opsFromWrites(
  writes: { row: number; col: number; raw: string; format: string }[],
): CellOp[] {
  const ops: CellOp[] = [];
  for (const w of writes) {
    ops.push(setOp(w.row, w.col, w.raw));
    if (w.format) ops.push(formatOp(w.row, w.col, w.format));
  }
  return ops;
}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd app && npx vitest run src/spreadsheet/ops.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the client binding**

In `app/src/api/spreadsheet/SpreadsheetClient.ts`, add near the other type exports:

```ts
export type CellOp =
  | { kind: 'Set'; row: number; col: number; raw_value: string }
  | { kind: 'Format'; row: number; col: number; format: string }
  | { kind: 'Clear'; row: number; col: number };
```

and add a method mirroring the existing `setCell` binding shape (match the file’s existing `rpc.execute` pattern exactly):

```ts
async applyCellOps(args: { sheet_id: string; ops: CellOp[] }): Promise<void> {
  await this._mero.rpc.execute({
    contextId: this._contextId,
    method: 'apply_cell_ops',
    argsJson: { sheet_id: args.sheet_id, ops: args.ops },
    executorPublicKey: this._executorPublicKey,
  });
}
```

(Use the same field names/shape the sibling methods in this file already use for `rpc.execute` — copy their structure; the snippet above is illustrative of the argument mapping, not a second calling convention.)

- [ ] **Step 5: Add the hook wrapper**

In `app/src/hooks/useSpreadsheet.ts`: import `CellOp` from the client; add to `UseSpreadsheetReturn` the field `applyCellOps: (sheetId: string, ops: CellOp[]) => Promise<void>;`; implement it beside `setCell`:

```ts
const applyCellOps = useCallback(
  async (sheetId: string, ops: CellOp[]) => {
    if (!client || ops.length === 0) return;
    await enqueue(() => client.applyCellOps({ sheet_id: sheetId, ops }));
    await refresh();
  },
  [client, refresh, enqueue],
);
```

and add `applyCellOps` to the returned object.

- [ ] **Step 6: Rewire the range handlers in `AppPage.tsx`**

For each of `handlePaste`, `handleFill`, `handleDelete`, `applyFormat`: replace the per-cell `await ss.setCell/clearCell/setCellFormat` loop with a single `CellOp[]` built via `ops.ts` and one `await ss.applyCellOps(activeSheetId, ops)`. Concretely:
- `handleDelete`: `const ops = [...rectCells(region)].map(({ row, col }) => clearOp(row, col)); await ss.applyCellOps(sid, ops);`
- `applyFormat`: map the selected rect cells to `formatOp(row, col, fmt)`.
- `handlePaste`: `const ops = [...cutSourceClears, ...opsFromWrites(writes)];` (cut-source clears first, then the pasted writes) `await ss.applyCellOps(sid, ops);`
- `handleFill`: `opsFromWrites(writes)` from the fill plan.

Import from `../../spreadsheet/ops`. Remove the now-dead per-cell loops. Keep single-cell edits (typing one cell, one delete) on the existing `setCell`/`clearCell` paths — do not route those through the batch API.

- [ ] **Step 7: Typecheck, test, build**

Run: `cd app && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean; all vitest pass (existing + `ops.test.ts`); build succeeds.

- [ ] **Step 8: Commit**

```bash
git add app/src/spreadsheet/ops.ts app/src/spreadsheet/ops.test.ts app/src/api/spreadsheet/SpreadsheetClient.ts app/src/hooks/useSpreadsheet.ts app/src/pages/app/AppPage.tsx
git commit -m "feat(recalc): batch range ops through apply_cell_ops (one commit + refresh)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 principle (inputs-only, derive-on-read) → Tasks 3–4. ✅
- §5 pure evaluator (precedents, iterative Kahn topo, single-pass eval, exact cycles, error propagation, cross-sheet `#REF!`) → Tasks 1–3. ✅
- §6.1 data model (drop `computed_value` from `CellData` + merge; keep on view `Cell`) → Task 4. ✅
- §6.2 write path (store raw, no recompute, delete `recompute_all`) → Task 4. ✅
- §6.3 read path (`get_cells` derives) → Task 4; node-side scoping explicitly deferred to Phase 1.5. ⚠️ (deferred, flagged)
- §6.4 client refresh scoping → deferred to Phase 1.5 with node scoping (cross-cutting: status-bar counts, subscription closure). ⚠️ (deferred, flagged)
- §7 batch API (`apply_cell_ops` + client wiring) → Tasks 5–6. ✅
- §10 testing (precedent/topo/eval/determinism/cross-sheet/cycle/error unit tests; integration derive-on-read; batch; pure client ops) → Tasks 1–6. ✅
- §8 Phase 2 — out of scope by design. ✅

**Deferred-with-reason (not silent drops):** node + client read scoping (§6.3–§6.4). Raise at execution handoff; both are read-cost optimizations, not correctness, and pair naturally into one Phase 1.5.

**Placeholder scan:** none — every code step carries complete code; the one illustrative note (client `rpc.execute` shape) points the implementer to copy the file’s existing sibling-method structure rather than inventing a call shape.

**Type consistency:** `CellRef` / `WorkbookInputs` / `evaluate` / `order` signatures match across Tasks 2–4; `CellOp` JSON shape (`{ kind, row, col, raw_value?, format? }`) matches between Rust (`#[serde(tag = "kind")]`, Task 5) and TS (`ops.ts` + client, Task 6); `precedents` returns `Vec<(String,u32,u32)>` consumed as `CellRef` in Task 3.
