//! Row and column order: which id sits at which position.
//!
//! A cell is stored under its sheet, row id and column id, never under a
//! position, so inserting or deleting a row is one write to the row axis
//! instead of a rewrite of every cell below it, and a concurrent edit to a
//! cell lands on that cell wherever its row has moved.
//!
//! **Legacy ids.** Before axes existed, cells were keyed by position. Row `k`
//! of that layout keeps the id `k` (decimal), at the implicit position
//! [`legacy_pos`]`(k)`, so every existing key and every A1 formula stays valid
//! with no migration of cells: an axis with no entries is the old layout.
//! An explicit entry adds a row or column (a new id, starting with a letter,
//! at a generated position) or deletes one (a tombstone on its id).
//!
//! Positions are strings of decimal digits compared lexicographically, so a
//! new position always exists between two others; concurrent inserts at the
//! same spot tie-break on the id.

use std::borrow::Cow;
use std::collections::HashMap;

/// Width of a legacy position's number: room for 10^9 rows.
const LEGACY_WIDTH: usize = 9;

/// The position of legacy row or column `k`: `5` and a zero-padded number.
/// The leading `5` leaves room for new positions before row 0 as well as
/// between any two rows (a position of all zeros would have almost none
/// before it).
pub fn legacy_pos(k: u32) -> String {
    format!("5{k:0LEGACY_WIDTH$}")
}

/// The legacy index an id names, if it is one (`"12"`, never `"012"`).
pub fn legacy_index(id: &str) -> Option<u32> {
    if id.is_empty()
        || (id.len() > 1 && id.starts_with('0'))
        || !id.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    id.parse().ok()
}

/// One explicit axis entry: an added row/column, or a deleted one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AxisEntry {
    pub id: String,
    pub pos: String,
    pub deleted: bool,
}

/// The visible order of one axis, `len` positions long.
#[derive(Clone, Debug)]
pub enum Axis {
    /// No entries: id `k` at position `k`.
    Identity(u32),
    /// Materialised order, with an index for id → position.
    Explicit {
        ids: Vec<String>,
        index: HashMap<String, usize>,
    },
}

impl Axis {
    /// Order the first `len` positions from the axis entries.
    pub fn build(entries: &[AxisEntry], len: u32) -> Axis {
        if entries.is_empty() {
            return Axis::Identity(len);
        }
        let mut overridden: HashMap<u32, bool> = HashMap::new();
        let mut added: Vec<(&str, &str)> = Vec::new();
        for e in entries {
            match legacy_index(&e.id) {
                // A legacy id can only be deleted; its position is fixed.
                Some(k) => {
                    let _ = overridden.insert(k, e.deleted);
                }
                None if !e.deleted => added.push((e.pos.as_str(), e.id.as_str())),
                None => {}
            }
        }
        added.sort_unstable();

        let mut ids = Vec::with_capacity(len as usize);
        let mut next_legacy = 0u32;
        let mut next_added = 0usize;
        while ids.len() < len as usize {
            let legacy = legacy_pos(next_legacy);
            let take_added = added
                .get(next_added)
                .is_some_and(|&(pos, id)| (pos, id) < (legacy.as_str(), ""));
            if take_added {
                ids.push(added[next_added].1.to_string());
                next_added += 1;
            } else {
                if !overridden.get(&next_legacy).copied().unwrap_or(false) {
                    ids.push(next_legacy.to_string());
                }
                next_legacy += 1;
            }
        }
        let index = ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), i))
            .collect();
        Axis::Explicit { ids, index }
    }

    pub fn len(&self) -> usize {
        match self {
            Axis::Identity(n) => *n as usize,
            Axis::Explicit { ids, .. } => ids.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The id at position `i`.
    pub fn id_at(&self, i: usize) -> Option<Cow<'_, str>> {
        match self {
            Axis::Identity(n) => (i < *n as usize).then(|| Cow::Owned(i.to_string())),
            Axis::Explicit { ids, .. } => ids.get(i).map(|s| Cow::Borrowed(s.as_str())),
        }
    }

    /// The position of `id`, or `None` when it is deleted or past the end.
    pub fn index_of(&self, id: &str) -> Option<usize> {
        match self {
            Axis::Identity(n) => legacy_index(id).filter(|k| k < n).map(|k| k as usize),
            Axis::Explicit { index, .. } => index.get(id).copied(),
        }
    }
}

/// One sheet's rows and columns.
#[derive(Clone, Debug)]
pub struct Layout {
    pub rows: Axis,
    pub cols: Axis,
}

impl Layout {
    /// The layout of a sheet with no structural edits.
    pub fn identity(rows: u32, cols: u32) -> Layout {
        Layout {
            rows: Axis::Identity(rows),
            cols: Axis::Identity(cols),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, pos: &str, deleted: bool) -> AxisEntry {
        AxisEntry {
            id: id.into(),
            pos: pos.into(),
            deleted,
        }
    }

    fn ids(a: &Axis) -> Vec<String> {
        (0..a.len())
            .map(|i| a.id_at(i).unwrap().into_owned())
            .collect()
    }

    #[test]
    fn no_entries_is_the_legacy_layout() {
        let a = Axis::build(&[], 4);
        assert_eq!(ids(&a), ["0", "1", "2", "3"]);
        assert_eq!(a.index_of("2"), Some(2));
        assert_eq!(a.index_of("4"), None);
        assert_eq!(a.index_of("02"), None);
    }

    #[test]
    fn an_insert_lands_between_its_neighbours() {
        // A new row between legacy rows 1 and 2.
        let pos = format!("{}5", legacy_pos(1));
        let a = Axis::build(&[entry("nab", &pos, false)], 5);
        assert_eq!(ids(&a), ["0", "1", "nab", "2", "3"]);
        assert_eq!(a.index_of("2"), Some(3));
    }

    #[test]
    fn a_delete_removes_the_row_and_closes_the_gap() {
        let a = Axis::build(&[entry("1", &legacy_pos(1), true)], 3);
        assert_eq!(ids(&a), ["0", "2", "3"]);
        assert_eq!(a.index_of("1"), None);
    }

    #[test]
    fn concurrent_inserts_at_one_spot_order_by_id() {
        let pos = format!("{}5", legacy_pos(0));
        let a = Axis::build(&[entry("nzz", &pos, false), entry("naa", &pos, false)], 4);
        assert_eq!(ids(&a), ["0", "naa", "nzz", "1"]);
    }

    #[test]
    fn a_deleted_insert_is_gone() {
        let pos = format!("{}5", legacy_pos(0));
        let a = Axis::build(&[entry("nab", &pos, true)], 2);
        assert_eq!(ids(&a), ["0", "1"]);
    }

    #[test]
    fn legacy_index_rejects_non_canonical_ids() {
        assert_eq!(legacy_index("0"), Some(0));
        assert_eq!(legacy_index("17"), Some(17));
        assert_eq!(legacy_index("017"), None);
        assert_eq!(legacy_index("n17"), None);
        assert_eq!(legacy_index(""), None);
    }
}
