//! Cell notes: formatted text, edited with Quill-shaped deltas.
//!
//! v1 kept each note in a `RichText<DefaultMarks>` CRDT so concurrent edits
//! from several nodes merged character by character. A component's `RichText`
//! is a state field, one per app, so it cannot be a value in a map keyed by
//! cell. A note is now a short list of formatted runs ([`NoteDoc`]), at most
//! [`crate::MAX_NOTE_CHARS`] characters, and a delta is applied to it in log
//! order: two people editing one note at the same moment no longer merge, the
//! later edit's offsets apply to the note as the earlier one left it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The formatting keys a note takes (v1's `DefaultMarks`).
pub const NOTE_MARKS: [&str; 7] = [
    "bold",
    "italic",
    "underline",
    "strike",
    "code",
    "highlight",
    "link",
];

/// A requested attribute set: `null` as a value removes the key.
pub type Attrs = BTreeMap<String, Option<String>>;

/// One step of a note edit, in the Quill delta shape: keep, insert or delete
/// characters, with formatting on kept or inserted text.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NoteChange {
    Retain {
        retain: usize,
        #[serde(default)]
        attributes: Option<Attrs>,
    },
    Insert {
        insert: String,
        #[serde(default)]
        attributes: Option<Attrs>,
    },
    Delete {
        delete: usize,
    },
}

/// A formatted run: `text` with its attributes (left out when there are none).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub text: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub attributes: BTreeMap<String, String>,
}

/// A stored note: its runs, merged so no two neighbours share attributes.
/// Bounded: at most `MAX_NOTE_CHARS` characters in all (`Spreadsheet::edit_note`).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct NoteDoc {
    pub runs: Vec<Span>,
}

impl NoteDoc {
    /// Characters in the note.
    pub fn len(&self) -> usize {
        self.runs.iter().map(|r| r.text.chars().count()).sum()
    }

    /// Whether the note has no text.
    pub fn is_empty(&self) -> bool {
        self.runs.is_empty()
    }

    /// The plain text.
    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }

    /// Apply one editor transaction, walking the note as it was before it.
    /// Every check runs first: a refused delta changes nothing.
    pub fn apply(&mut self, ops: &[NoteChange]) -> Result<(), String> {
        for op in ops {
            let attrs = match op {
                NoteChange::Retain { attributes, .. } | NoteChange::Insert { attributes, .. } => {
                    attributes.as_ref()
                }
                NoteChange::Delete { .. } => None,
            };
            for key in attrs.into_iter().flat_map(|a| a.keys()) {
                if !NOTE_MARKS.contains(&key.as_str()) {
                    return Err(format!("{key:?} is not a note format"));
                }
            }
        }
        let mut chars: Vec<(char, BTreeMap<String, String>)> = self
            .runs
            .iter()
            .flat_map(|r| r.text.chars().map(|c| (c, r.attributes.clone())))
            .collect();
        let mut out: Vec<(char, BTreeMap<String, String>)> = Vec::with_capacity(chars.len());
        let mut at = 0usize;
        for op in ops {
            match op {
                NoteChange::Retain { retain, attributes } => {
                    let end = at
                        .checked_add(*retain)
                        .filter(|&e| e <= chars.len())
                        .ok_or("a retain runs past the end of the note")?;
                    for (c, mut a) in chars[at..end].iter().cloned() {
                        if let Some(set) = attributes {
                            for (k, v) in set {
                                match v {
                                    Some(v) => {
                                        let _ = a.insert(k.clone(), v.clone());
                                    }
                                    None => {
                                        let _ = a.remove(k);
                                    }
                                }
                            }
                        }
                        out.push((c, a));
                    }
                    at = end;
                }
                NoteChange::Insert { insert, attributes } => {
                    let a: BTreeMap<String, String> = attributes
                        .iter()
                        .flatten()
                        .filter_map(|(k, v)| v.clone().map(|v| (k.clone(), v)))
                        .collect();
                    out.extend(insert.chars().map(|c| (c, a.clone())));
                }
                NoteChange::Delete { delete } => {
                    at = at
                        .checked_add(*delete)
                        .filter(|&e| e <= chars.len())
                        .ok_or("a delete runs past the end of the note")?;
                }
            }
        }
        out.extend(chars.drain(at..));
        self.runs = runs_of(out);
        Ok(())
    }
}

fn runs_of(chars: Vec<(char, BTreeMap<String, String>)>) -> Vec<Span> {
    let mut runs: Vec<Span> = Vec::new();
    for (c, a) in chars {
        match runs.last_mut() {
            Some(last) if last.attributes == a => last.text.push(c),
            _ => runs.push(Span {
                text: c.to_string(),
                attributes: a,
            }),
        }
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ins(text: &str, bold: bool) -> NoteChange {
        NoteChange::Insert {
            insert: text.into(),
            attributes: bold.then(|| Attrs::from([("bold".into(), Some("true".into()))])),
        }
    }

    #[test]
    fn insert_retain_format_and_delete() {
        let mut doc = NoteDoc::default();
        doc.apply(&[ins("hello ", false), ins("world", true)])
            .unwrap();
        assert_eq!(doc.text(), "hello world");
        assert_eq!(doc.runs.len(), 2);
        doc.apply(&[
            NoteChange::Retain {
                retain: 6,
                attributes: None,
            },
            NoteChange::Retain {
                retain: 5,
                attributes: Some(Attrs::from([("bold".into(), None)])),
            },
        ])
        .unwrap();
        assert_eq!(doc.runs.len(), 1);
        doc.apply(&[NoteChange::Delete { delete: 6 }]).unwrap();
        assert_eq!(doc.text(), "world");
    }

    #[test]
    fn refused_deltas_change_nothing() {
        let mut doc = NoteDoc::default();
        doc.apply(&[ins("abc", false)]).unwrap();
        assert!(doc.apply(&[NoteChange::Delete { delete: 4 }]).is_err());
        assert!(doc
            .apply(&[NoteChange::Insert {
                insert: "x".into(),
                attributes: Some(Attrs::from([("font".into(), Some("x".into()))])),
            }])
            .is_err());
        assert_eq!(doc.text(), "abc");
    }
}
