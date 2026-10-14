//! Watches: "when X, do Y", kept in the feed so it outlives the agent session
//! that set it.
//!
//! "Merge #434 when it's green" or "watch main and fix it if it goes red" used
//! to live in an agent's background shell, and died with the session. A watch
//! is stored here instead: a **condition** (a PR's checks green or red, a PR
//! merged, a branch's CI green or red), an **action** (merge the PR, start an
//! agent turn with a prompt, or tell you), and the **chain** it reports to.
//!
//! The agent's runtime (mero-bot), not a model turn, polls the conditions. When
//! one is met it first takes the watch with [`crate::Hyperfeed::fire_watch`]:
//! `watching → firing`, refused unless the watch is still watching, so of all
//! the sessions polling it exactly one acts, once, and a session that restarts
//! never fires it again. It then acts and reports the outcome with
//! [`crate::Hyperfeed::finish_watch`] (`done` or `failed`, with a note). You see
//! each watch on its task with where it stands, and can cancel one that is
//! still watching ([`crate::Hyperfeed::cancel_watch`]).
//!
//! The contract keeps the watch and its state machine; it cannot read GitHub.
//! The safe-merge rules (every check passed, the base is the default branch)
//! are applied by the runtime when it fires, against GitHub as it is then.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::{lww, now_ms, Event, Hyperfeed, MAX_KEY, MAX_SHORT, MAX_TITLE, MAX_WHY};

/// What a watch waits for.
pub const WATCH_CONDITIONS: &[&str] = &[
    // a pull request's checks all passed
    "pr_green",
    // one of a pull request's checks failed
    "pr_red",
    // a pull request was merged
    "pr_merged",
    // a branch's CI (the checks on its head commit) all passed
    "branch_green",
    // a branch's CI failed
    "branch_red",
];
/// What a watch does once its condition is met: `merge` the pull request (by
/// the safe-merge rules), start an agent `turn` in the chain with the watch's
/// prompt, or `notify` you in the chain.
pub const WATCH_ACTIONS: &[&str] = &["merge", "turn", "notify"];
pub const WATCH_WATCHING: &str = "watching";
pub const WATCH_FIRING: &str = "firing";
pub const WATCH_DONE: &str = "done";
pub const WATCH_FAILED: &str = "failed";
pub const WATCH_CANCELLED: &str = "cancelled";
/// Watches still waiting at once: each one is polled, so they are few.
pub const MAX_ACTIVE_WATCHES: usize = 50;
/// A turn's prompt, or what a notification says.
pub const MAX_WATCH_TEXT: usize = 2_000;
/// `owner/name`.
pub const MAX_REPO: usize = 140;

/// One watch, kept by id.
#[app::mergeable(id = "hyperfeed::Watch")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Watch {
    pub chain: String,
    pub condition: String,
    pub repo: String,
    pub pr: u64,
    pub branch: String,
    pub action: String,
    pub text: String,
    /// Who set it: "mero-bot@studio", or "" for you.
    pub agent: String,
    /// [`WATCH_WATCHING`], [`WATCH_FIRING`], [`WATCH_DONE`], [`WATCH_FAILED`]
    /// or [`WATCH_CANCELLED`].
    pub status: String,
    /// How the action went, or why it was cancelled.
    pub note: String,
    /// What the runtime last saw, as one line: "3 of 5 checks passed, 2 running".
    pub seen: String,
    pub seen_at: u64,
    /// The session that fired it, and when.
    pub fired_by: String,
    pub fired_at: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

/// How far along a status is: a watch never goes back on any device.
fn rank(status: &str) -> u8 {
    match status {
        WATCH_WATCHING => 0,
        WATCH_FIRING => 1,
        _ => 2,
    }
}

impl Mergeable for Watch {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // The further status wins (fired is never un-fired, cancelled never
        // revived); between equals, the later write.
        match rank(&other.status).cmp(&rank(&self.status)) {
            std::cmp::Ordering::Greater => *self = other.clone(),
            std::cmp::Ordering::Less => {}
            std::cmp::Ordering::Equal => {
                let at = self.updated_at;
                lww(self, at, other, other.updated_at);
            }
        }
        Ok(())
    }
}

/// What [`crate::Hyperfeed::add_watch`] takes. Every field is required; use
/// `""` or `0` where it does not apply.
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct WatchInput {
    /// The chain it reports to: the task it belongs to.
    pub chain: String,
    /// One of [`WATCH_CONDITIONS`].
    pub condition: String,
    /// The GitHub repository, `owner/name`.
    pub repo: String,
    /// The pull request's number, for a `pr_*` condition; 0 otherwise.
    pub pr: u64,
    /// The branch, for a `branch_*` condition; `""` is the repository's
    /// default branch. `""` for a `pr_*` condition.
    pub branch: String,
    /// One of [`WATCH_ACTIONS`]. `merge` goes with `pr_green` only.
    pub action: String,
    /// The prompt for a `turn`, or what a `notify` tells you; may be `""` for
    /// a `merge`.
    pub text: String,
    /// Who sets it: "mero-bot@studio"; `""` for you.
    pub agent: String,
}

/// A watch, as the feed returns it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct WatchView {
    pub id: String,
    pub chain: String,
    pub condition: String,
    pub repo: String,
    pub pr: u64,
    pub branch: String,
    pub action: String,
    pub text: String,
    pub agent: String,
    pub status: String,
    pub note: String,
    pub seen: String,
    pub seen_at: u64,
    pub fired_by: String,
    pub fired_at: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Watch {
    pub fn view(&self, id: &str) -> WatchView {
        WatchView {
            id: id.to_owned(),
            chain: self.chain.clone(),
            condition: self.condition.clone(),
            repo: self.repo.clone(),
            pr: self.pr,
            branch: self.branch.clone(),
            action: self.action.clone(),
            text: self.text.clone(),
            agent: self.agent.clone(),
            status: self.status.clone(),
            note: self.note.clone(),
            seen: self.seen.clone(),
            seen_at: self.seen_at,
            fired_by: self.fired_by.clone(),
            fired_at: self.fired_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }

    fn touch(&mut self) {
        self.updated_at = now_ms().max(self.updated_at + 1);
    }
}

fn one_line(field: &str, value: &str, max: usize) -> app::Result<String> {
    let value = value.trim();
    Hyperfeed::check_len(field, value, max, false)?;
    if value.contains(['\n', '\r']) {
        return Err(AppError::msg(format!("{field} is one line")));
    }
    Ok(value.to_owned())
}

/// `owner/name`, as GitHub spells them.
pub(crate) fn check_repo(repo: &str) -> app::Result<()> {
    Hyperfeed::check_len("repo", repo, MAX_REPO, true)?;
    let ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    match repo.split_once('/') {
        Some((owner, name)) if ok(owner) && ok(name) => Ok(()),
        _ => Err(AppError::msg(format!(
            "repo must be owner/name, got {repo:?}"
        ))),
    }
}

impl Hyperfeed {
    fn get_watch(&self, id: &str) -> app::Result<Watch> {
        self.watches
            .get(id)?
            .map(|w| w.clone())
            .ok_or_else(|| AppError::msg(format!("no watch {id}")))
    }

    fn put_watch(&mut self, id: &str, watch: Watch) -> app::Result<WatchView> {
        let view = watch.view(id);
        self.watches.insert(id.to_owned(), watch)?;
        app::emit!(Event::WatchChanged {
            id,
            chain: &view.chain,
            status: &view.status,
        });
        Ok(view)
    }

    pub(crate) fn watch_add(&mut self, input: WatchInput) -> app::Result<WatchView> {
        // `""` is you, so only you set one with no agent.
        if input.agent.is_empty() {
            self.require_owner()?;
        } else {
            self.require_agent_as(&input.agent)?;
        }
        let chain = input.chain.trim().to_owned();
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        if !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        Self::check_one_of("condition", &input.condition, WATCH_CONDITIONS)?;
        Self::check_one_of("action", &input.action, WATCH_ACTIONS)?;
        let repo = input.repo.trim().to_owned();
        check_repo(&repo)?;
        let on_pr = input.condition.starts_with("pr_");
        let branch = one_line("branch", &input.branch, MAX_KEY)?;
        if on_pr {
            if input.pr == 0 {
                return Err(AppError::msg(format!(
                    "{} needs the pull request's number in pr",
                    input.condition
                )));
            }
            if !branch.is_empty() {
                return Err(AppError::msg(format!(
                    "{} watches a pull request: leave branch empty",
                    input.condition
                )));
            }
        } else {
            if input.pr != 0 {
                return Err(AppError::msg(format!(
                    "{} watches a branch: pr must be 0",
                    input.condition
                )));
            }
            if branch.contains(char::is_whitespace) {
                return Err(AppError::msg(format!("branch {branch:?} has spaces")));
            }
        }
        if input.action == "merge" && input.condition != "pr_green" {
            return Err(AppError::msg(
                "merge goes with pr_green only: a PR merges when every check passed",
            ));
        }
        let text = input.text.trim().to_owned();
        Self::check_len("text", &text, MAX_WATCH_TEXT, input.action != "merge")?;
        let agent = one_line("agent", &input.agent, MAX_SHORT)?;
        let active = self.watches.entries()?.filter(|(_, w)| rank(&w.status) < 2);
        let mut count = 0;
        for (id, w) in active {
            // The same watch twice is kept once.
            if w.chain == chain
                && w.condition == input.condition
                && w.repo == repo
                && w.pr == input.pr
                && w.branch == branch
                && w.action == input.action
                && w.text == text
                && w.status == WATCH_WATCHING
            {
                return Ok(w.view(&id));
            }
            count += 1;
        }
        if count >= MAX_ACTIVE_WATCHES {
            return Err(AppError::msg(format!(
                "{MAX_ACTIVE_WATCHES} watches are already waiting; cancel one first"
            )));
        }
        let now = now_ms();
        let id = Self::fresh_id();
        self.put_watch(
            &id,
            Watch {
                chain,
                condition: input.condition,
                repo,
                pr: input.pr,
                branch,
                action: input.action,
                text,
                agent,
                status: WATCH_WATCHING.to_owned(),
                note: String::new(),
                seen: String::new(),
                seen_at: 0,
                fired_by: String::new(),
                fired_at: 0,
                created_at: now,
                updated_at: now,
            },
        )
    }

    pub(crate) fn watch_cancel(&mut self, id: &str, note: &str) -> app::Result<WatchView> {
        self.require_agent()?;
        let note = one_line("note", note, MAX_WHY)?;
        let mut w = self.get_watch(id)?;
        if w.status == WATCH_CANCELLED {
            return Ok(w.view(id));
        }
        if w.status != WATCH_WATCHING {
            return Err(AppError::msg(format!(
                "watch {id} is {} already: too late to cancel",
                w.status
            )));
        }
        w.status = WATCH_CANCELLED.to_owned();
        w.note = note;
        w.touch();
        self.put_watch(id, w)
    }

    pub(crate) fn watch_fire(&mut self, id: &str, session: &str) -> app::Result<WatchView> {
        self.require_agent()?;
        Self::check_len("session", session, MAX_KEY, true)?;
        let mut w = self.get_watch(id)?;
        if w.status != WATCH_WATCHING {
            return Err(AppError::msg(format!(
                "watch {id} is {}, not watching: it fires once",
                w.status
            )));
        }
        let now = now_ms();
        w.status = WATCH_FIRING.to_owned();
        w.fired_by = session.to_owned();
        w.fired_at = now;
        w.touch();
        self.put_watch(id, w)
    }

    pub(crate) fn watch_finish(
        &mut self,
        id: &str,
        outcome: &str,
        note: &str,
    ) -> app::Result<WatchView> {
        self.require_agent()?;
        Self::check_one_of("outcome", outcome, &[WATCH_DONE, WATCH_FAILED])?;
        let note = Self::trimmed(note, MAX_WHY)?;
        let mut w = self.get_watch(id)?;
        if w.status != WATCH_FIRING {
            return Err(AppError::msg(format!(
                "watch {id} is {}: only a firing watch is finished",
                w.status
            )));
        }
        w.status = outcome.to_owned();
        w.note = note;
        w.touch();
        self.put_watch(id, w)
    }

    pub(crate) fn watch_seen_impl(&mut self, id: &str, seen: &str) -> app::Result<WatchView> {
        self.require_agent()?;
        let seen = one_line("seen", seen, MAX_TITLE)?;
        let mut w = self.get_watch(id)?;
        if w.status != WATCH_WATCHING {
            return Ok(w.view(id));
        }
        if w.seen == seen {
            return Ok(w.view(id));
        }
        w.seen = seen;
        w.seen_at = now_ms();
        w.touch();
        self.put_watch(id, w)
    }

    pub(crate) fn watch_list(&self, chain: &str) -> app::Result<Vec<WatchView>> {
        Self::check_len("chain", chain, MAX_KEY, false)?;
        let mut out: Vec<WatchView> = self
            .watches
            .entries()?
            .filter(|(_, w)| chain.is_empty() || w.chain == chain)
            .map(|(id, w)| w.view(&id))
            .collect();
        out.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(out)
    }

    /// A note: trimmed, kept to `max` bytes. Multi-line is fine (a gh error).
    fn trimmed(value: &str, max: usize) -> app::Result<String> {
        let value = value.trim();
        Self::check_len("note", value, max, false)?;
        Ok(value.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    const STRANGER: [u8; 32] = [0xE0; 32];

    fn task(app: &mut TestHost<Hyperfeed>) -> String {
        app.call(|s| {
            s.say(
                String::new(),
                "Merge #434 when it's green".to_owned(),
                None,
                None,
            )
        })
        .expect("say")
        .chain
    }

    fn merge_434(chain: &str) -> WatchInput {
        WatchInput {
            chain: chain.to_owned(),
            condition: "pr_green".to_owned(),
            repo: "calimero-network/apps".to_owned(),
            pr: 434,
            branch: String::new(),
            action: "merge".to_owned(),
            text: String::new(),
            agent: "mero-bot@studio".to_owned(),
        }
    }

    fn add(app: &mut TestHost<Hyperfeed>, input: WatchInput) -> app::Result<WatchView> {
        app.call(|s| s.add_watch(input.clone()))
    }

    #[test]
    fn a_watch_fires_once_and_reports_how_it_went() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        let w = add(&mut app, merge_434(&chain)).unwrap();
        assert_eq!(w.status, WATCH_WATCHING);
        assert_eq!(w.agent, "mero-bot@studio");

        let seen = app
            .call(|s| s.watch_seen(w.id.clone(), "3 of 5 checks passed, 2 running".to_owned()))
            .unwrap();
        assert_eq!(seen.seen, "3 of 5 checks passed, 2 running");
        assert!(seen.seen_at > 0);

        let fired = app
            .call(|s| s.fire_watch(w.id.clone(), "studio#1".to_owned()))
            .unwrap();
        assert_eq!(fired.status, WATCH_FIRING);
        assert_eq!(fired.fired_by, "studio#1");
        // A second session, or the same one after a restart, is refused.
        let again = app
            .call(|s| s.fire_watch(w.id.clone(), "laptop#1".to_owned()))
            .unwrap_err();
        assert!(format!("{again:?}").contains("fires once"), "{again:?}");
        // Too late to cancel once it fired.
        assert!(app.call(|s| s.cancel_watch(w.id.clone(), None)).is_err());

        let done = app
            .call(|s| s.finish_watch(w.id.clone(), "done".to_owned(), "Merged #434".to_owned()))
            .unwrap();
        assert_eq!(done.status, WATCH_DONE);
        assert_eq!(done.note, "Merged #434");
        assert!(app
            .call(|s| s.finish_watch(w.id.clone(), "failed".to_owned(), String::new()))
            .is_err());
        assert!(app
            .call(|s| s.fire_watch(w.id.clone(), "studio#2".to_owned()))
            .is_err());

        let listed = app.view(|s| s.watches(chain.clone())).unwrap();
        assert_eq!(listed, vec![done]);
    }

    #[test]
    fn a_cancelled_watch_never_fires() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        let w = add(&mut app, merge_434(&chain)).unwrap();
        let cancelled = app
            .call(|s| s.cancel_watch(w.id.clone(), Some("Not needed".to_owned())))
            .unwrap();
        assert_eq!(cancelled.status, WATCH_CANCELLED);
        assert_eq!(cancelled.note, "Not needed");
        assert!(app
            .call(|s| s.fire_watch(w.id.clone(), "studio#1".to_owned()))
            .is_err());
        // Cancelling twice is fine.
        assert!(app.call(|s| s.cancel_watch(w.id.clone(), None)).is_ok());
    }

    #[test]
    fn watches_are_checked() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        let bad = |f: &dyn Fn(&mut WatchInput)| {
            let mut i = merge_434(&chain);
            f(&mut i);
            i
        };
        for input in [
            bad(&|i| i.chain = "nope".to_owned()),
            bad(&|i| i.condition = "pr_yellow".to_owned()),
            bad(&|i| i.action = "deploy".to_owned()),
            bad(&|i| i.repo = "apps".to_owned()),
            bad(&|i| i.repo = "calimero network/apps".to_owned()),
            bad(&|i| i.pr = 0),
            bad(&|i| i.branch = "main".to_owned()),
            // Merging on red, or on a branch, is not a thing.
            bad(&|i| i.condition = "pr_red".to_owned()),
            bad(&|i| {
                i.condition = "branch_green".to_owned();
                i.pr = 0;
            }),
            // A turn needs its prompt.
            bad(&|i| {
                i.condition = "branch_red".to_owned();
                i.pr = 0;
                i.action = "turn".to_owned();
            }),
        ] {
            assert!(add(&mut app, input.clone()).is_err(), "{input:?}");
        }
        // Watch main and fix it if red: a branch, "" for the default one.
        let main = add(
            &mut app,
            WatchInput {
                condition: "branch_red".to_owned(),
                pr: 0,
                action: "turn".to_owned(),
                text: "Main went red: find the failing check and fix it".to_owned(),
                ..merge_434(&chain)
            },
        )
        .unwrap();
        assert_eq!(main.branch, "");
        // The same watch twice is kept once.
        let twice = add(&mut app, merge_434(&chain)).unwrap();
        assert_eq!(add(&mut app, merge_434(&chain)).unwrap().id, twice.id);
        assert_eq!(app.view(|s| s.watches(String::new())).unwrap().len(), 2);
        // Only the owner sets, fires or cancels one.
        assert!(app
            .call_as_account(STRANGER, STRANGER, |s| s.add_watch(merge_434(&chain)))
            .is_err());
        assert!(app
            .call_as_account(STRANGER, STRANGER, |s| s
                .fire_watch(twice.id.clone(), "x".to_owned()))
            .is_err());
        assert!(app
            .call_as_account(STRANGER, STRANGER, |s| s
                .cancel_watch(twice.id.clone(), None))
            .is_err());
    }

    #[test]
    fn watches_list_by_chain() {
        let mut app = TestHost::new(Hyperfeed::init);
        let one = task(&mut app);
        let two = app
            .call(|s| s.say(String::new(), "Watch main".to_owned(), None, None))
            .unwrap()
            .chain;
        add(&mut app, merge_434(&one)).unwrap();
        add(
            &mut app,
            WatchInput {
                condition: "branch_red".to_owned(),
                pr: 0,
                action: "notify".to_owned(),
                text: "Main is red".to_owned(),
                ..merge_434(&two)
            },
        )
        .unwrap();
        assert_eq!(app.view(|s| s.watches(one.clone())).unwrap().len(), 1);
        assert_eq!(
            app.view(|s| s.watches(two.clone())).unwrap()[0].action,
            "notify"
        );
        assert_eq!(app.view(|s| s.watches(String::new())).unwrap().len(), 2);
    }

    #[test]
    fn a_fired_watch_stays_fired_when_devices_merge() {
        let base = Watch {
            chain: "c".to_owned(),
            condition: "pr_green".to_owned(),
            repo: "o/r".to_owned(),
            pr: 1,
            branch: String::new(),
            action: "merge".to_owned(),
            text: String::new(),
            agent: String::new(),
            status: WATCH_WATCHING.to_owned(),
            note: String::new(),
            seen: String::new(),
            seen_at: 0,
            fired_by: String::new(),
            fired_at: 0,
            created_at: 1,
            updated_at: 1,
        };
        // One device saw new checks later; the other fired it earlier.
        let mut seen_later = Watch {
            seen: "1 of 2 checks passed".to_owned(),
            updated_at: 50,
            ..base.clone()
        };
        let fired = Watch {
            status: WATCH_FIRING.to_owned(),
            fired_by: "s".to_owned(),
            updated_at: 10,
            ..base.clone()
        };
        seen_later.merge(&fired).unwrap();
        assert_eq!(seen_later.status, WATCH_FIRING);
        let mut f = fired.clone();
        f.merge(&Watch {
            updated_at: 99,
            ..base
        })
        .unwrap();
        assert_eq!(f.status, WATCH_FIRING);
    }
}
