//! Checkpoints: where a task stands, so a new agent session can pick it up.
//!
//! An agent session that ends mid-task takes its plan with it. So at each
//! milestone, and before a turn ends with work outstanding, the agent writes a
//! short checkpoint on the task's chain: what is done, the next step, the
//! branches, worktrees and PRs it touches, and what it still needs to ask. One
//! per chain; each write replaces the last. The next session reads it with
//! [`crate::Hyperfeed::checkpoint`] before it acts there, and the app shows it
//! behind "where it stands" on the task.

use calimero_sdk::prelude::*;

use crate::store::invalid;
use serde::{Deserialize, Serialize};

/// What was done, or the next step: a few sentences, not a log.
pub const MAX_CHECKPOINT_TEXT: usize = 1_000;
/// Entries per list (branches, worktrees, PRs, questions).
pub const MAX_CHECKPOINT_ENTRIES: usize = 10;
/// One entry: a branch, a path, a PR link, a question.
pub const MAX_CHECKPOINT_ENTRY: usize = 300;
/// Who wrote it: "mero-bot@studio".
pub const MAX_CHECKPOINT_AUTHOR: usize = 120;

/// The latest checkpoint on one chain, kept by chain id. A new one replaces
/// it whole: last writer wins.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub done: String,
    pub next: String,
    /// This and the three lists below: at most [`MAX_CHECKPOINT_ENTRIES`]
    /// each, checked in `setCheckpoint`, which replaces the whole checkpoint.
    pub branches: Vec<String>,
    pub worktrees: Vec<String>,
    pub prs: Vec<String>,
    pub questions: Vec<String>,
    pub author: String,
    pub updated_at: u64,
}

/// What the agent writes: [`crate::Hyperfeed::set_checkpoint`]'s `input`.
/// `done` and `next` are prose; the lists may be empty.
#[derive(Debug, Clone, Default, Serialize, Deserialize, AbiType)]
pub struct CheckpointInput {
    /// What is done so far.
    pub done: String,
    /// The next step, as the session that picks it up should take it.
    pub next: String,
    /// Git branches the task works on.
    pub branches: Vec<String>,
    /// Worktrees (absolute paths) the task works in.
    pub worktrees: Vec<String>,
    /// Pull requests: links, or `repo#number`.
    pub prs: Vec<String>,
    /// What is still open: questions for the user, or doubts to settle.
    pub questions: Vec<String>,
    /// Who writes it: "mero-bot@studio".
    pub author: String,
}

/// A chain's latest checkpoint, as [`crate::Hyperfeed::checkpoint`] returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckpointView {
    pub chain: String,
    pub done: String,
    pub next: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<String>,
    pub prs: Vec<String>,
    pub questions: Vec<String>,
    pub author: String,
    /// When it was written (ms).
    pub updated_at: u64,
}

fn text(field: &str, value: &str, max: usize) -> app::Result<String> {
    let value = value.trim();
    if value.len() > max {
        return Err(invalid(format!(
            "{field} is {} bytes, limit is {max}",
            value.len()
        )));
    }
    Ok(value.to_owned())
}

fn list(field: &str, values: &[String]) -> app::Result<Vec<String>> {
    let values: Vec<String> = values
        .iter()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .collect();
    if values.len() > MAX_CHECKPOINT_ENTRIES {
        return Err(invalid(format!(
            "{field} has {} entries, limit is {MAX_CHECKPOINT_ENTRIES}",
            values.len()
        )));
    }
    for v in &values {
        if v.len() > MAX_CHECKPOINT_ENTRY {
            return Err(invalid(format!(
                "an entry in {field} is {} bytes, limit is {MAX_CHECKPOINT_ENTRY}",
                v.len()
            )));
        }
        if v.contains(['\n', '\r']) {
            return Err(invalid(format!("each entry in {field} is one line")));
        }
    }
    Ok(values)
}

impl Checkpoint {
    /// The input, trimmed and checked against the limits. A checkpoint says at
    /// least what is done or what is next.
    pub fn from_input(input: CheckpointInput, updated_at: u64) -> app::Result<Checkpoint> {
        let done = text("done", &input.done, MAX_CHECKPOINT_TEXT)?;
        let next = text("next", &input.next, MAX_CHECKPOINT_TEXT)?;
        if done.is_empty() && next.is_empty() {
            return Err(invalid("a checkpoint says what is done or what is next"));
        }
        let author = text("author", &input.author, MAX_CHECKPOINT_AUTHOR)?;
        if author.contains(['\n', '\r']) {
            return Err(invalid("author is one line"));
        }
        Ok(Checkpoint {
            done,
            next,
            branches: list("branches", &input.branches)?,
            worktrees: list("worktrees", &input.worktrees)?,
            prs: list("prs", &input.prs)?,
            questions: list("questions", &input.questions)?,
            author,
            updated_at,
        })
    }

    pub fn view(&self, chain: &str) -> CheckpointView {
        CheckpointView {
            chain: chain.to_owned(),
            done: self.done.clone(),
            next: self.next.clone(),
            branches: self.branches.clone(),
            worktrees: self.worktrees.clone(),
            prs: self.prs.clone(),
            questions: self.questions.clone(),
            author: self.author.clone(),
            updated_at: self.updated_at,
        }
    }
}
