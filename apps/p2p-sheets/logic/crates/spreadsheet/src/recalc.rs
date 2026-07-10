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
