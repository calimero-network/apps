//! What the brief reads from your agent beyond the rows: situations and defaults.
//!
//! A **situation** is a task told as one card. Your agent reads what a chain
//! is about (its rows, the chats and issues it links to, what teammates said
//! there) and writes it as a person would brief you: a headline, what is going
//! on, what it recommends, why it ranks where it does, and when it is due. One
//! per chain; each write replaces the last. The rows stay the evidence.
//!
//! A **default** is a proposal that goes ahead at a set time unless you stop
//! it ("sending at 17:00"). Your agent may set one only where nothing would be
//! lost by it: a proposal it could undo, behind no guard, in an app where it
//! may write, while it is not paused. When the time comes, its runtime fires
//! it, and the contract checks all of that again: anything changed since, and
//! the proposal waits for you as before. Your stop always wins: a stopped
//! default never fires, whichever device saw what first.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::lww;

/// The card's headline: one line.
pub const MAX_SITUATION_HEADLINE: usize = 140;
/// What is going on: a few sentences.
pub const MAX_SITUATION_SUMMARY: usize = 1_000;
/// What your agent recommends.
pub const MAX_SITUATION_RECOMMEND: usize = 400;
/// Why it ranks where it does: "Ronit needs your yes before the memo at 16:00".
pub const MAX_SITUATION_REASON: usize = 240;
/// Who wrote it: "mero-bot@studio".
pub const MAX_SITUATION_AUTHOR: usize = 120;
/// The agent's urgency, 0 (whenever) to 100 (now).
pub const MAX_SITUATION_SCORE: u32 = 100;
/// How many chains keep a situation; one more drops the one written longest ago.
pub const MAX_SITUATIONS: usize = 200;
/// How far ahead a default may be set.
pub const MAX_AUTORUN_AHEAD_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// One chain's situation, kept by chain id. A new one replaces it whole: last
/// writer wins.
#[app::mergeable(id = "hyperfeed::Situation")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Situation {
    pub headline: String,
    pub summary: String,
    pub recommend: String,
    pub reason: String,
    pub score: u32,
    pub due_at: u64,
    pub sources: u32,
    pub apps: u32,
    pub author: String,
    pub updated_at: u64,
}

impl Mergeable for Situation {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// What the agent writes: [`crate::Hyperfeed::set_situation`]'s `input`.
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct SituationInput {
    /// The card's headline, as you would say it: "Launch date: the team
    /// settled on Thursday, and your calendar clashes".
    pub headline: String,
    /// What is going on, in a few sentences.
    pub summary: String,
    /// What your agent recommends you do; may be empty.
    pub recommend: String,
    /// Why it ranks where it does; may be empty.
    pub reason: String,
    /// How pressing your agent judges it, 0 (whenever) to 100 (now).
    pub score: u32,
    /// When it is due (ms), or 0.
    pub due_at: u64,
    /// How many things it read to write this, and in how many apps: "from 7
    /// things in 3 apps". 0 when it does not say.
    pub sources: u32,
    pub apps: u32,
    /// Who writes it: "mero-bot@studio".
    pub author: String,
}

/// A chain's situation, as [`crate::Hyperfeed::situations`] returns it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct SituationView {
    pub chain: String,
    pub headline: String,
    pub summary: String,
    pub recommend: String,
    pub reason: String,
    pub score: u32,
    pub due_at: u64,
    pub sources: u32,
    pub apps: u32,
    pub author: String,
    /// When it was written (ms).
    pub updated_at: u64,
}

fn text(field: &str, value: &str, max: usize, one_line: bool) -> app::Result<String> {
    let value = value.trim();
    if value.len() > max {
        return Err(AppError::msg(format!(
            "{field} is {} bytes, limit is {max}",
            value.len()
        )));
    }
    if one_line && value.contains(['\n', '\r']) {
        return Err(AppError::msg(format!("{field} is one line")));
    }
    Ok(value.to_owned())
}

impl Situation {
    /// The input, trimmed and checked against the limits. A situation has a
    /// headline and says what is going on.
    pub fn from_input(input: SituationInput, updated_at: u64) -> app::Result<Situation> {
        let headline = text("headline", &input.headline, MAX_SITUATION_HEADLINE, true)?;
        let summary = text("summary", &input.summary, MAX_SITUATION_SUMMARY, false)?;
        if headline.is_empty() || summary.is_empty() {
            return Err(AppError::msg(
                "a situation has a headline and says what is going on",
            ));
        }
        if input.score > MAX_SITUATION_SCORE {
            return Err(AppError::msg(format!(
                "score is {}, limit is {MAX_SITUATION_SCORE}",
                input.score
            )));
        }
        if input.apps > input.sources {
            return Err(AppError::msg("apps cannot be more than sources"));
        }
        Ok(Situation {
            headline,
            summary,
            recommend: text(
                "recommend",
                &input.recommend,
                MAX_SITUATION_RECOMMEND,
                false,
            )?,
            reason: text("reason", &input.reason, MAX_SITUATION_REASON, true)?,
            score: input.score,
            due_at: input.due_at,
            sources: input.sources,
            apps: input.apps,
            author: text("author", &input.author, MAX_SITUATION_AUTHOR, true)?,
            updated_at,
        })
    }

    pub fn view(&self, chain: &str) -> SituationView {
        SituationView {
            chain: chain.to_owned(),
            headline: self.headline.clone(),
            summary: self.summary.clone(),
            recommend: self.recommend.clone(),
            reason: self.reason.clone(),
            score: self.score,
            due_at: self.due_at,
            sources: self.sources,
            apps: self.apps,
            author: self.author.clone(),
            updated_at: self.updated_at,
        }
    }
}

/// A default waiting to go ahead.
pub const AUTORUN_WAITING: &str = "waiting";
/// You stopped it: it waits for you as any proposal does.
pub const AUTORUN_STOPPED: &str = "stopped";
/// It went ahead at its time.
pub const AUTORUN_FIRED: &str = "fired";
/// You decided on the proposal yourself first (approved, declined), so the
/// default has nothing left to do.
pub const AUTORUN_SETTLED: &str = "settled";

/// One proposal's default, kept by the action's id. The time is last-writer-
/// wins by when it was set; stopping and firing only ever turn on, and a stop
/// outranks a fire, so a merge never makes a stopped default go ahead.
#[app::mergeable(id = "hyperfeed::Autorun")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Autorun {
    pub chain: String,
    pub at: u64,
    pub set_at: u64,
    pub stopped_at: u64,
    pub fired_at: u64,
}

impl Mergeable for Autorun {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let (stopped, fired) = (
            self.stopped_at.max(other.stopped_at),
            self.fired_at.max(other.fired_at),
        );
        let at = self.set_at;
        lww(self, at, other, other.set_at);
        self.stopped_at = stopped;
        self.fired_at = fired;
        Ok(())
    }
}

/// A proposal's default, as [`crate::Hyperfeed::autoruns`] returns it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AutorunView {
    /// The proposal's action id.
    pub id: String,
    pub chain: String,
    /// When it goes ahead (ms).
    pub at: u64,
    pub set_at: u64,
    /// One of [`AUTORUN_WAITING`], [`AUTORUN_STOPPED`], [`AUTORUN_FIRED`],
    /// [`AUTORUN_SETTLED`].
    pub status: String,
    pub stopped_at: u64,
    pub fired_at: u64,
}

impl Autorun {
    /// Where it stands, given whether its proposal still waits for you.
    pub fn status(&self, pending: bool) -> &'static str {
        if self.stopped_at > 0 {
            AUTORUN_STOPPED
        } else if self.fired_at > 0 {
            AUTORUN_FIRED
        } else if pending {
            AUTORUN_WAITING
        } else {
            AUTORUN_SETTLED
        }
    }

    pub fn view(&self, id: &str, pending: bool) -> AutorunView {
        AutorunView {
            id: id.to_owned(),
            chain: self.chain.clone(),
            at: self.at,
            set_at: self.set_at,
            status: self.status(pending).to_owned(),
            stopped_at: self.stopped_at,
            fired_at: self.fired_at,
        }
    }
}
