//! Pure recalculation engine: workbook inputs -> computed values.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::formula;

/// A raw cell value is a formula when it starts with `=` (leading whitespace
/// tolerated). Shared by the closure walk and the evaluator so the "what counts
/// as a formula" rule lives in exactly one place.
fn is_formula(raw: &str) -> bool {
    raw.trim_start().starts_with('=')
}

/// Absolute cell coordinate (0-based row/col).
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct CellRef {
    pub sheet_id: String,
    pub row: u32,
    pub col: u32,
}

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

/// The set of sheet ids that must be evaluated to compute `requested_sheet`
/// correctly: the requested sheet plus every sheet transitively referenced by a
/// formula reachable from it. Sheet-level (not cell-level) reachability — a
/// touched sheet is included in full, so the result is robust to `precedents()`
/// under-reporting a range/whole-column ref and stays identical to a
/// whole-workbook evaluation. Terminates: `closure` grows monotonically and is
/// bounded by the finite set of sheet ids present in `cells`.
pub fn sheet_closure(
    cells: &BTreeMap<CellRef, String>,
    requested_sheet: &str,
) -> HashSet<String> {
    // Adjacency: sheet -> the set of sheets its formulas reference. Built in one
    // pass over the cells (each formula's precedents parsed exactly once).
    let mut refs: HashMap<String, HashSet<String>> = HashMap::new();
    for (cell, raw) in cells {
        if !is_formula(raw) {
            continue;
        }
        let targets = refs.entry(cell.sheet_id.clone()).or_default();
        for (sid, _row, _col) in formula::precedents(raw, &cell.sheet_id) {
            targets.insert(sid);
        }
    }

    // BFS over the sheet reference graph from the requested sheet. The `closure`
    // set doubles as the visited set, so cross-sheet cycles terminate.
    let mut closure: HashSet<String> = HashSet::new();
    closure.insert(requested_sheet.to_string());
    let mut queue: Vec<String> = vec![requested_sheet.to_string()];
    while let Some(sheet) = queue.pop() {
        if let Some(targets) = refs.get(&sheet) {
            for target in targets {
                if closure.insert(target.clone()) {
                    queue.push(target.clone());
                }
            }
        }
    }
    closure
}

pub struct WorkbookInputs {
    pub cells: BTreeMap<CellRef, String>,
    pub sheet_ids: HashSet<String>,
}

pub fn evaluate(inputs: &WorkbookInputs) -> BTreeMap<CellRef, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn cr(sheet: &str, row: u32, col: u32) -> CellRef {
        CellRef { sheet_id: sheet.into(), row, col }
    }

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
