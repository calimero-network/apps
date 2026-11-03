//! Editing one text: a title or one block's body, each a `RichText` (a Fugue
//! sequence plus Peritext-style marks) under its own name.
//!
//! The wire surface is v1's: Quill-style change lists (`retain` / `insert` /
//! `delete`, counted in Unicode scalar values), runs of character ids, anchors
//! and undo tokens. The SDK's `RichText` has no deltas, anchors or undo, so this
//! module builds them from what it does have: `chars` (live characters with
//! their ids), `spans`, `insert_after`, `delete_ids` and `mark_ids`.
//!
//! - **Ids** cross the wire as runs `{replica, counter, len}` of consecutive ids;
//!   `replica` is always `"0"` (one leader mints every id).
//! - **Anchors** are opaque strings: `s` (the start), `e` (the end), `a<id>`
//!   (the gap after character `id`) and `b<id>` (the gap before it). A gap after
//!   a deleted character resolves to where that character was.
//! - **Undo tokens** are the inverse edit as JSON: the ids to remove, the text
//!   (with its formatting) to put back after a given character, and the
//!   formatting to restore. Applying one returns the token of its own inverse,
//!   so a redo token is just the undo of the undo, as in v1.

use std::collections::{BTreeMap, BTreeSet};

use calimero_app_sdk::prelude::*;
use calimero_app_sdk::StorageError;
use serde::{Deserialize, Serialize};

use crate::{invalid, not_found};

/// Every formatting key a document may carry, and whether a mark of it grows
/// when text is typed at its end (v1's `DriveMarks` schema, unchanged).
pub fn expands(key: &str) -> Option<bool> {
    match key {
        "bold" | "italic" | "underline" | "strike" | "textColor" | "backgroundColor" => Some(true),
        "link" | "code" | "comment" => Some(false),
        _ => None,
    }
}

fn check_key(key: &str) -> app::Result<bool> {
    expands(key).ok_or_else(|| invalid(format!("undeclared mark key `{key}`")))
}

/// A formatting set: absent key means not set.
pub type Attrs = BTreeMap<String, String>;

/// A requested formatting change: a `null` value removes the key.
pub type AttrDelta = BTreeMap<String, Option<String>>;

/// One step of a text change, in Quill's delta shape: `{"retain": 6}`,
/// `{"insert": "text"}` or `{"delete": 2}`. A `retain` or `insert` step may
/// carry `attributes`: an object of formatting (a `null` value removes a key),
/// or `null` for none. An insert's `attributes` are its complete set.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Change {
    /// Keeps `retain` characters, optionally changing their formatting.
    Retain {
        retain: u32,
        #[serde(default)]
        attributes: Option<AttrDelta>,
    },
    /// Inserts text at the current position.
    Insert {
        insert: String,
        #[serde(default)]
        attributes: Option<AttrDelta>,
    },
    /// Removes characters at the current position.
    Delete { delete: u32 },
}

/// A run of equally formatted characters.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub text: String,
    pub attributes: Attrs,
}

/// A run of consecutive character ids. `replica` is always `"0"`: one leader
/// mints every id. `counter` is the run's first id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Run {
    pub replica: String,
    pub counter: u32,
    pub len: u32,
}

/// A live character with its id and formatting.
#[derive(Clone, Debug)]
pub struct Char {
    pub id: u64,
    pub ch: char,
    pub attrs: Attrs,
}

/// The `RichText` holding the text called `name`.
pub fn text(name: String) -> RichText {
    RichText::new(name)
}

/// The live characters of `rt`, in order, with their ids and formatting.
pub fn chars(rt: &RichText) -> app::Result<Vec<Char>> {
    let ids = rt.text().chars()?;
    let spans = rt.spans()?;
    let mut out = Vec::with_capacity(ids.len());
    let mut it = ids.into_iter();
    for span in spans {
        for ch in span.text.chars() {
            let Some((id, _)) = it.next() else {
                return Err(invalid("a text's spans and characters disagree"));
            };
            out.push(Char {
                id,
                ch,
                attrs: span.attrs.clone(),
            });
        }
    }
    Ok(out)
}

/// The text as plain characters.
pub fn plain(chars: &[Char]) -> String {
    chars.iter().map(|c| c.ch).collect()
}

/// The text as runs of equally formatted characters.
pub fn spans(chars: &[Char]) -> Vec<Span> {
    let mut out: Vec<Span> = Vec::new();
    for c in chars {
        match out.last_mut() {
            Some(span) if span.attributes == c.attrs => span.text.push(c.ch),
            _ => out.push(Span {
                text: c.ch.to_string(),
                attributes: c.attrs.clone(),
            }),
        }
    }
    out
}

/// The ids of `chars` as runs of consecutive ids.
pub fn runs(chars: &[Char]) -> app::Result<Vec<Run>> {
    let mut out: Vec<Run> = Vec::new();
    for c in chars {
        let id = u32::try_from(c.id).map_err(|_| invalid("character id past u32"))?;
        match out.last_mut() {
            Some(run) if run.counter.checked_add(run.len) == Some(id) => run.len += 1,
            _ => out.push(Run {
                replica: "0".into(),
                counter: id,
                len: 1,
            }),
        }
    }
    Ok(out)
}

// ── anchors ──────────────────────────────────────────────────────────────────

/// The anchor of the gap at `position`: stuck to the character before it
/// (`before == false`, the caret after typed text) or the one after it.
pub fn anchor_at(chars: &[Char], position: u32, before: bool) -> app::Result<String> {
    let pos = position as usize;
    if pos > chars.len() {
        return Err(invalid(format!(
            "position {pos} is past the end ({})",
            chars.len()
        )));
    }
    Ok(if before {
        match chars.get(pos) {
            Some(c) => format!("b{}", c.id),
            None => "e".into(),
        }
    } else {
        match pos.checked_sub(1) {
            Some(i) => format!("a{}", chars[i].id),
            None => "s".into(),
        }
    })
}

/// Where each anchor sits now; `null` for a token this text never minted.
pub fn resolve(rt: &RichText, chars: &[Char], anchors: &[String]) -> app::Result<Vec<Option<u32>>> {
    let live: BTreeMap<u64, usize> = chars.iter().enumerate().map(|(i, c)| (c.id, i)).collect();
    let mut out = Vec::with_capacity(anchors.len());
    for token in anchors {
        let pos = match token.as_str() {
            "s" => Some(0),
            "e" => Some(chars.len()),
            _ => {
                let (side, id) = token.split_at(token.len().min(1));
                match (side, id.parse::<u64>()) {
                    ("a", Ok(id)) => match live.get(&id) {
                        Some(i) => Some(i + 1),
                        None => rt.text().index_of(id)?.map(|i| i as usize),
                    },
                    ("b", Ok(id)) => match live.get(&id) {
                        Some(i) => Some(*i),
                        None => rt.text().index_of(id)?.map(|i| i as usize),
                    },
                    _ => None,
                }
            }
        };
        out.push(pos.map(|p| p as u32));
    }
    Ok(out)
}

// ── edits ────────────────────────────────────────────────────────────────────

/// Text to put back after character `after` (`None`: at the start), with its formatting.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Restore {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
    pub spans: Vec<Span>,
}

/// Set `key` to `value` (`None`: remove it) on the characters `ids`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Format {
    pub ids: Vec<u64>,
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
}

/// An edit as undo tokens carry it.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Edit {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remove: Vec<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub restore: Vec<Restore>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub format: Vec<Format>,
}

impl Edit {
    pub fn token(&self) -> app::Result<String> {
        serde_json::to_string(self).map_err(|e| invalid(e.to_string()))
    }

    pub fn from_token(token: &str) -> app::Result<Self> {
        serde_json::from_str(token).map_err(|_| invalid("not an undo token"))
    }
}

/// How long a text of `current` characters is once `ops` are applied.
pub fn len_after(current: usize, ops: &[Change]) -> usize {
    let (added, removed) = ops.iter().fold((0usize, 0usize), |(a, r), op| match op {
        Change::Insert { insert, .. } => (a + insert.chars().count(), r),
        Change::Delete { delete } => (a, r + *delete as usize),
        Change::Retain { .. } => (a, r),
    });
    (current + added).saturating_sub(removed)
}

/// The gap right after an edit's last change, counted in the text it produces.
pub fn edit_end(ops: &[Change]) -> usize {
    ops.iter()
        .map(|op| match op {
            Change::Retain { retain, .. } => *retain as usize,
            Change::Insert { insert, .. } => insert.chars().count(),
            Change::Delete { .. } => 0,
        })
        .sum()
}

/// Whether an anchored write is an insert right where its anchor sits.
pub fn at_anchor(anchored: bool, anchor_pos: Option<u32>, ops: &[Change]) -> bool {
    if !anchored {
        return true;
    }
    let (start, inserts) = match ops.split_first() {
        Some((
            Change::Retain {
                retain,
                attributes: None,
            },
            rest,
        )) => (*retain, rest),
        _ => (0, ops),
    };
    !inserts.is_empty()
        && inserts.iter().all(|op| matches!(op, Change::Insert { .. }))
        && anchor_pos == Some(start)
}

/// Contiguous runs (by position in `order`) of the ids in `ids`, each as (first, last).
fn ranges(order: &[Char], ids: &BTreeSet<u64>) -> Vec<(u64, u64)> {
    let mut out: Vec<(u64, u64)> = Vec::new();
    let mut open = false;
    for c in order {
        if ids.contains(&c.id) {
            match (open, out.last_mut()) {
                (true, Some(last)) => last.1 = c.id,
                _ => out.push((c.id, c.id)),
            }
            open = true;
        } else {
            open = false;
        }
    }
    out
}

fn write_marks(
    rt: &mut RichText,
    order: &[Char],
    ids: &BTreeSet<u64>,
    key: &str,
    value: Option<&str>,
) -> app::Result<()> {
    let expand = check_key(key)?;
    for (first, last) in ranges(order, ids) {
        let _mark = rt.mark_ids(first, last, key, value, expand)?;
    }
    Ok(())
}

/// Give the characters `ids` exactly the formatting `want`, wherever they differ.
fn settle(rt: &mut RichText, want: &[(u64, Attrs)]) -> app::Result<()> {
    if want.is_empty() {
        return Ok(());
    }
    let now = chars(rt)?;
    let have: BTreeMap<u64, &Attrs> = now.iter().map(|c| (c.id, &c.attrs)).collect();
    // key -> value -> ids that need it
    let mut fixes: BTreeMap<String, BTreeMap<Option<String>, BTreeSet<u64>>> = BTreeMap::new();
    for (id, target) in want {
        let Some(current) = have.get(id) else {
            continue;
        };
        let keys: BTreeSet<&String> = target.keys().chain(current.keys()).collect();
        for key in keys {
            let (t, c) = (target.get(key), current.get(key));
            if t != c {
                let _new = fixes
                    .entry(key.clone())
                    .or_default()
                    .entry(t.cloned())
                    .or_default()
                    .insert(*id);
            }
        }
    }
    for (key, by_value) in fixes {
        for (value, ids) in by_value {
            write_marks(rt, &now, &ids, &key, value.as_deref())?;
        }
    }
    Ok(())
}

/// Previous values of `key` on `ids`, grouped by value, as `Format`s.
fn previous(order: &[Char], ids: &[u64], key: &str) -> Vec<Format> {
    let wanted: BTreeSet<u64> = ids.iter().copied().collect();
    let mut by_value: BTreeMap<Option<String>, Vec<u64>> = BTreeMap::new();
    for c in order.iter().filter(|c| wanted.contains(&c.id)) {
        by_value
            .entry(c.attrs.get(key).cloned())
            .or_default()
            .push(c.id);
    }
    by_value
        .into_iter()
        .map(|(value, ids)| Format {
            ids,
            key: key.to_owned(),
            value,
        })
        .collect()
}

/// The deleted characters `gone` (in order) as `Restore`s, one per contiguous run,
/// each put back after the run's own last character, a tombstone that keeps its place.
fn restores(order: &[Char], gone: &BTreeSet<u64>) -> Vec<Restore> {
    let mut out: Vec<Restore> = Vec::new();
    let mut run: Vec<&Char> = Vec::new();
    let flush = |run: &mut Vec<&Char>, out: &mut Vec<Restore>| {
        if let Some(last) = run.last() {
            let picked: Vec<Char> = run.iter().map(|c| (*c).clone()).collect();
            out.push(Restore {
                after: Some(last.id),
                spans: spans(&picked),
            });
        }
        run.clear();
    };
    for c in order {
        if gone.contains(&c.id) {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// Insert `spans` after `after`, returning the new ids and the formatting each must end with.
fn put_back(
    rt: &mut RichText,
    after: Option<u64>,
    spans: &[Span],
    settle_on: &mut Vec<(u64, Attrs)>,
) -> app::Result<Vec<u64>> {
    let text: String = spans.iter().map(|s| s.text.as_str()).collect();
    let ids = rt
        .text_mut()
        .insert_after(after, &text)
        .map_err(unknown_id)?;
    let mut it = ids.iter();
    for span in spans {
        for _ in span.text.chars() {
            if let Some(id) = it.next() {
                settle_on.push((*id, span.attributes.clone()));
            }
        }
    }
    Ok(ids)
}

fn unknown_id(e: StorageError) -> AppError {
    match e {
        StorageError::UnknownId(id) => not_found("character", &id.to_string()),
        other => other.into(),
    }
}

/// Apply Quill steps to `rt`; returns the undo token of the change.
pub fn apply_delta(rt: &mut RichText, ops: &[Change], plain_only: bool) -> app::Result<String> {
    let order = chars(rt)?;
    let mut inverse = Edit::default();
    let mut pos = 0usize;
    let mut last_insert: Option<u64> = None;
    let mut deletes: BTreeSet<u64> = BTreeSet::new();
    let mut formats: Vec<(Vec<u64>, String, Option<String>)> = Vec::new();
    let mut settle_on: Vec<(u64, Attrs)> = Vec::new();
    for op in ops {
        match op {
            Change::Retain { retain, attributes } => {
                let n = *retain as usize;
                if pos + n > order.len() {
                    return Err(invalid(format!(
                        "retain {n} at {pos} runs past the end ({})",
                        order.len()
                    )));
                }
                if let Some(attrs) = attributes {
                    if plain_only && !attrs.is_empty() {
                        return Err(invalid(
                            "the title carries no formatting: drop `attributes`",
                        ));
                    }
                    let ids: Vec<u64> = order[pos..pos + n].iter().map(|c| c.id).collect();
                    for (key, value) in attrs {
                        let _expand = check_key(key)?;
                        inverse.format.extend(previous(&order, &ids, key));
                        formats.push((ids.clone(), key.clone(), value.clone()));
                    }
                }
                pos += n;
                last_insert = None;
            }
            Change::Delete { delete } => {
                let n = *delete as usize;
                if pos + n > order.len() {
                    return Err(invalid(format!(
                        "delete {n} at {pos} runs past the end ({})",
                        order.len()
                    )));
                }
                deletes.extend(order[pos..pos + n].iter().map(|c| c.id));
                pos += n;
                last_insert = None;
            }
            Change::Insert { insert, attributes } => {
                if insert.is_empty() {
                    continue;
                }
                if plain_only && attributes.as_ref().is_some_and(|a| !a.is_empty()) {
                    return Err(invalid(
                        "the title carries no formatting: drop `attributes`",
                    ));
                }
                let after = last_insert.or_else(|| pos.checked_sub(1).map(|i| order[i].id));
                let ids = rt
                    .text_mut()
                    .insert_after(after, insert)
                    .map_err(unknown_id)?;
                if let Some(attrs) = attributes {
                    let mut full = Attrs::new();
                    for (key, value) in attrs {
                        let _expand = check_key(key)?;
                        if let Some(v) = value {
                            let _old = full.insert(key.clone(), v.clone());
                        }
                    }
                    settle_on.extend(ids.iter().map(|id| (*id, full.clone())));
                }
                last_insert = ids.last().copied();
                inverse.remove.extend(ids);
            }
        }
    }
    if !deletes.is_empty() {
        inverse.restore = restores(&order, &deletes);
        let ids: Vec<u64> = deletes.into_iter().collect();
        let _gone = rt.text_mut().delete_ids(&ids)?;
    }
    if !formats.is_empty() {
        let now = chars(rt)?;
        for (ids, key, value) in formats {
            let set: BTreeSet<u64> = ids.into_iter().collect();
            write_marks(rt, &now, &set, &key, value.as_deref())?;
        }
    }
    settle(rt, &settle_on)?;
    inverse.token()
}

/// Apply an undo token to `rt`; returns the token of its inverse.
pub fn apply_edit(rt: &mut RichText, edit: &Edit) -> app::Result<String> {
    let order = chars(rt)?;
    let mut inverse = Edit::default();
    for format in &edit.format {
        inverse
            .format
            .extend(previous(&order, &format.ids, &format.key));
    }
    if !edit.format.is_empty() {
        for format in &edit.format {
            let ids: BTreeSet<u64> = format.ids.iter().copied().collect();
            write_marks(rt, &order, &ids, &format.key, format.value.as_deref())?;
        }
    }
    let live: BTreeSet<u64> = order.iter().map(|c| c.id).collect();
    let gone: BTreeSet<u64> = edit
        .remove
        .iter()
        .copied()
        .filter(|id| live.contains(id))
        .collect();
    if !gone.is_empty() {
        inverse.restore = restores(&order, &gone);
        let ids: Vec<u64> = gone.into_iter().collect();
        let _gone = rt.text_mut().delete_ids(&ids)?;
    }
    let mut settle_on = Vec::new();
    for restore in &edit.restore {
        for span in &restore.spans {
            for key in span.attributes.keys() {
                let _expand = check_key(key)?;
            }
        }
        let ids = put_back(rt, restore.after, &restore.spans, &mut settle_on)?;
        inverse.remove.extend(ids);
    }
    settle(rt, &settle_on)?;
    inverse.token()
}

/// Append `tail` (characters with formatting) to the end of `rt`.
pub fn append(rt: &mut RichText, tail: &[Char]) -> app::Result<()> {
    if tail.is_empty() {
        return Ok(());
    }
    let after = chars(rt)?.last().map(|c| c.id);
    let mut settle_on = Vec::new();
    let _ids = put_back(rt, after, &spans(tail), &mut settle_on)?;
    settle(rt, &settle_on)
}

/// Format the live characters `[start, end)`; returns the mark's id.
pub fn mark(
    rt: &mut RichText,
    start: u32,
    end: u32,
    key: &str,
    value: Option<&str>,
) -> app::Result<Option<String>> {
    let expand = check_key(key)?;
    if start == end {
        return Ok(None);
    }
    let id = rt
        .mark(u64::from(start), u64::from(end), key, value, expand)
        .map_err(|e| match e {
            StorageError::OutOfBounds { index, len } => {
                invalid(format!("mark range ends at {index}, past the end ({len})"))
            }
            other => other.into(),
        })?;
    Ok(Some(id.to_string()))
}
