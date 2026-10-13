//! Checkpoints: where a task stands, so a new agent session can pick it up.
//!
//! An agent session that ends mid-task takes its plan with it. So at each
//! milestone, and before a turn ends with work outstanding, the agent writes a
//! short checkpoint on the task's chain: what is done, the next step, the
//! branches, worktrees and PRs it touches, and what it still needs to ask. One
//! per chain; each write replaces the last. The next session reads it with
//! [`crate::Hyperfeed::checkpoint`] before it acts there, and the app shows it
//! behind "where it stands" on the task.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::lww;

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
#[app::mergeable(id = "hyperfeed::Checkpoint")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Checkpoint {
    pub done: String,
    pub next: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<String>,
    pub prs: Vec<String>,
    pub questions: Vec<String>,
    pub author: String,
    pub updated_at: u64,
}

impl Mergeable for Checkpoint {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// What the agent writes: [`crate::Hyperfeed::set_checkpoint`]'s `input`.
/// `done` and `next` are prose; the lists may be empty.
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
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
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
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
        return Err(AppError::msg(format!(
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
        return Err(AppError::msg(format!(
            "{field} has {} entries, limit is {MAX_CHECKPOINT_ENTRIES}",
            values.len()
        )));
    }
    for v in &values {
        if v.len() > MAX_CHECKPOINT_ENTRY {
            return Err(AppError::msg(format!(
                "an entry in {field} is {} bytes, limit is {MAX_CHECKPOINT_ENTRY}",
                v.len()
            )));
        }
        if v.contains(['\n', '\r']) {
            return Err(AppError::msg(format!("each entry in {field} is one line")));
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
            return Err(AppError::msg(
                "a checkpoint says what is done or what is next",
            ));
        }
        let author = text("author", &input.author, MAX_CHECKPOINT_AUTHOR)?;
        if author.contains(['\n', '\r']) {
            return Err(AppError::msg("author is one line"));
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

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;
    use crate::Hyperfeed;

    const STRANGER: [u8; 32] = [0xE0; 32];

    fn task(app: &mut TestHost<Hyperfeed>) -> String {
        app.call(|s| s.say(String::new(), "Fix the digest card".to_owned(), None, None))
            .expect("say")
            .chain
    }

    fn input(done: &str, next: &str) -> CheckpointInput {
        CheckpointInput {
            done: done.to_owned(),
            next: next.to_owned(),
            branches: vec!["mero-bot/chain-1".to_owned()],
            worktrees: vec!["/w/apps-chain-1".to_owned()],
            prs: vec!["calimero-network/apps#12".to_owned()],
            questions: vec![],
            author: "mero-bot@studio".to_owned(),
        }
    }

    #[test]
    fn a_checkpoint_is_kept_with_its_chain_and_the_next_one_replaces_it() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        assert_eq!(app.view(|s| s.checkpoint(chain.clone())).unwrap(), None);

        let first = app
            .call(|s| s.set_checkpoint(chain.clone(), input("Found the bug", "Write the fix")))
            .unwrap();
        assert_eq!(first.chain, chain);
        assert_eq!(first.author, "mero-bot@studio");
        assert_eq!(first.branches, vec!["mero-bot/chain-1"]);
        assert!(first.updated_at > 0);
        assert_eq!(
            app.view(|s| s.checkpoint(chain.clone())).unwrap(),
            Some(first.clone())
        );

        let mut later = input("  Fixed it; PR open  ", "Merge once CI is green");
        later.questions = vec!["Squash or merge?".to_owned(), "  ".to_owned()];
        let second = app
            .call(|s| s.set_checkpoint(chain.clone(), later))
            .unwrap();
        assert_eq!(second.done, "Fixed it; PR open", "trimmed");
        assert_eq!(
            second.questions,
            vec!["Squash or merge?"],
            "blank entries dropped"
        );
        assert!(second.updated_at > first.updated_at);
        assert_eq!(
            app.view(|s| s.checkpoint(chain.clone())).unwrap(),
            Some(second),
            "the latest replaces the last"
        );

        let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
        assert_eq!(
            kinds.iter().filter(|k| *k == "CheckpointChanged").count(),
            2
        );
    }

    #[test]
    fn checkpoints_are_checked_and_owner_only() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        let set = |app: &mut TestHost<Hyperfeed>, chain: &str, i: CheckpointInput| {
            app.call(|s| s.set_checkpoint(chain.to_owned(), i))
        };
        assert!(set(&mut app, "", input("a", "b")).is_err(), "a chain");
        assert!(
            set(&mut app, "no-chain", input("a", "b")).is_err(),
            "an existing chain"
        );
        assert!(
            set(&mut app, &chain, input(" ", "")).is_err(),
            "says something"
        );
        let long = "x".repeat(MAX_CHECKPOINT_TEXT + 1);
        assert!(set(&mut app, &chain, input(&long, "")).is_err());
        assert!(set(&mut app, &chain, input("", &long)).is_err());
        let mut many = input("a", "b");
        many.prs = (0..=MAX_CHECKPOINT_ENTRIES)
            .map(|n| format!("#{n}"))
            .collect();
        assert!(set(&mut app, &chain, many).is_err());
        let mut wide = input("a", "b");
        wide.branches = vec!["b".repeat(MAX_CHECKPOINT_ENTRY + 1)];
        assert!(set(&mut app, &chain, wide).is_err());
        let mut lines = input("a", "b");
        lines.questions = vec!["one\ntwo".to_owned()];
        assert!(set(&mut app, &chain, lines).is_err());
        let mut author = input("a", "b");
        author.author = "a".repeat(MAX_CHECKPOINT_AUTHOR + 1);
        assert!(set(&mut app, &chain, author).is_err());
        assert!(app
            .call_as_account(STRANGER, STRANGER, |s| s
                .set_checkpoint(chain.clone(), input("a", "b")))
            .is_err());
        assert_eq!(app.view(|s| s.checkpoint(chain.clone())).unwrap(), None);
        // Only `next` is enough; the lists may be empty.
        let bare = CheckpointInput {
            next: "Start".to_owned(),
            ..CheckpointInput::default()
        };
        assert!(set(&mut app, &chain, bare).is_ok());
    }
}
