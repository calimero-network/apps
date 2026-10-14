//! Pull requests as your agent's runtime sees them, for the merge button on a
//! PR card.
//!
//! The browser can't run `gh` and holds no GitHub token: unauthenticated, it
//! reads only public repos, 60 requests an hour. mero-bot's runtime reads
//! GitHub with your own login. So it writes what it sees about the PRs your
//! tasks link to here, one row per PR (`owner/name#number`): open, merged or
//! closed, a draft or not, the base and the default branch, conflicts, the
//! head commit, the checks (green, red or pending, with the failing ones
//! named), and the PR it is stacked on when its base is another PR's branch.
//! The PR card reads it ([`crate::Hyperfeed::prs`]) to decide what its merge
//! control offers.
//!
//! A row is advisory. A merge is a `merge` watch ([`crate::watches`]), and the
//! runtime applies the safe-merge rules against GitHub as it is when the watch
//! fires, not against this row.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::watches::check_repo;
use crate::{lww, now_ms, Event, Hyperfeed, MAX_KEY, MAX_SHORT, MAX_TITLE};

/// PRs kept at once; recording one more drops the one seen longest ago.
pub const MAX_PRS: usize = 200;
/// Failing checks named on one PR.
pub const MAX_FAILING: usize = 10;
/// A commit's sha, hex.
pub const MAX_SHA: usize = 64;
pub const PR_STATES: &[&str] = &["open", "merged", "closed"];
pub const CHECK_STATES: &[&str] = &["green", "red", "pending"];

/// One PR as the runtime last saw it, kept by `owner/name#number`.
#[app::mergeable(id = "hyperfeed::PrSeen")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PrSeen {
    pub chain: String,
    pub repo: String,
    pub pr: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub base: String,
    pub default_branch: String,
    pub conflicts: bool,
    pub head_sha: String,
    pub checks: String,
    pub checks_total: u32,
    pub checks_passed: u32,
    pub checks_pending: u32,
    pub failing: Vec<String>,
    pub stacked_on: u64,
    pub stacked_merged: bool,
    pub seen_at: u64,
}

impl Mergeable for PrSeen {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // The later look wins.
        let at = self.seen_at;
        lww(self, at, other, other.seen_at);
        Ok(())
    }
}

/// What [`crate::Hyperfeed::record_pr`] takes: the PR as GitHub shows it now.
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PrInput {
    /// The chain (task) that links to it; `""` keeps the one already recorded.
    pub chain: String,
    /// `owner/name`.
    pub repo: String,
    pub pr: u64,
    pub title: String,
    /// `open`, `merged` or `closed`.
    pub state: String,
    pub draft: bool,
    /// The branch it merges into.
    pub base: String,
    /// The repository's default branch.
    pub default_branch: String,
    /// GitHub found conflicts with the base.
    pub conflicts: bool,
    /// The head commit the checks are on.
    pub head_sha: String,
    /// `green` (every check passed), `red` (one failed) or `pending`.
    pub checks: String,
    pub checks_total: u32,
    pub checks_passed: u32,
    pub checks_pending: u32,
    /// The failing checks' names, at most [`MAX_FAILING`].
    pub failing: Vec<String>,
    /// When `base` is another PR's branch, that PR's number; 0 otherwise.
    pub stacked_on: u64,
    /// Whether the PR it is stacked on is merged (its branch is dead).
    pub stacked_merged: bool,
}

/// A PR as [`crate::Hyperfeed::prs`] returns it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PrView {
    pub chain: String,
    pub repo: String,
    pub pr: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub base: String,
    pub default_branch: String,
    pub conflicts: bool,
    pub head_sha: String,
    pub checks: String,
    pub checks_total: u32,
    pub checks_passed: u32,
    pub checks_pending: u32,
    pub failing: Vec<String>,
    pub stacked_on: u64,
    pub stacked_merged: bool,
    /// When the runtime looked (ms).
    pub seen_at: u64,
}

impl PrSeen {
    pub fn view(&self) -> PrView {
        PrView {
            chain: self.chain.clone(),
            repo: self.repo.clone(),
            pr: self.pr,
            title: self.title.clone(),
            state: self.state.clone(),
            draft: self.draft,
            base: self.base.clone(),
            default_branch: self.default_branch.clone(),
            conflicts: self.conflicts,
            head_sha: self.head_sha.clone(),
            checks: self.checks.clone(),
            checks_total: self.checks_total,
            checks_passed: self.checks_passed,
            checks_pending: self.checks_pending,
            failing: self.failing.clone(),
            stacked_on: self.stacked_on,
            stacked_merged: self.stacked_merged,
            seen_at: self.seen_at,
        }
    }
}

/// A branch name: one word, required.
fn branch(field: &str, value: &str) -> app::Result<String> {
    let value = value.trim();
    Hyperfeed::check_len(field, value, MAX_KEY, true)?;
    if value.contains(char::is_whitespace) {
        return Err(AppError::msg(format!("{field} {value:?} has spaces")));
    }
    Ok(value.to_owned())
}

impl Hyperfeed {
    pub(crate) fn pr_record(&mut self, input: PrInput) -> app::Result<PrView> {
        self.require_owner()?;
        let repo = input.repo.trim().to_owned();
        check_repo(&repo)?;
        if input.pr == 0 {
            return Err(AppError::msg("pr must be the pull request's number"));
        }
        let key = format!("{repo}#{}", input.pr);
        let chain = input.chain.trim().to_owned();
        Self::check_len("chain", &chain, MAX_KEY, false)?;
        if !chain.is_empty() && !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        let title = input.title.trim().replace(['\n', '\r'], " ");
        Self::check_len("title", &title, MAX_TITLE, false)?;
        Self::check_one_of("state", &input.state, PR_STATES)?;
        Self::check_one_of("checks", &input.checks, CHECK_STATES)?;
        let base = branch("base", &input.base)?;
        let default_branch = branch("default_branch", &input.default_branch)?;
        let head_sha = input.head_sha.trim().to_owned();
        Self::check_len("head_sha", &head_sha, MAX_SHA, false)?;
        if !head_sha.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(AppError::msg("head_sha is a commit's hex sha"));
        }
        if input.failing.len() > MAX_FAILING {
            return Err(AppError::msg(format!(
                "failing names {} checks, limit is {MAX_FAILING}",
                input.failing.len()
            )));
        }
        let mut failing = Vec::with_capacity(input.failing.len());
        for name in &input.failing {
            let name = name.trim().replace(['\n', '\r'], " ");
            Self::check_len("a failing check", &name, MAX_SHORT, true)?;
            failing.push(name);
        }
        if input.checks_passed.saturating_add(input.checks_pending) > input.checks_total {
            return Err(AppError::msg(
                "checks_passed and checks_pending add up to more than checks_total",
            ));
        }
        if (input.checks == "red") != !failing.is_empty() {
            return Err(AppError::msg(
                "checks is red exactly when failing names a check",
            ));
        }
        if input.stacked_on != 0 && base == default_branch {
            return Err(AppError::msg(
                "a PR into the default branch is not stacked: stacked_on must be 0",
            ));
        }

        let prior = self.prs.get(&key)?.map(|p| p.clone());
        let seen_at = now_ms().max(prior.as_ref().map_or(0, |p| p.seen_at + 1));
        let chain = match (&prior, chain.is_empty()) {
            (Some(p), true) => p.chain.clone(),
            _ => chain,
        };
        if prior.is_none() {
            let rows: Vec<(String, u64)> =
                self.prs.entries()?.map(|(k, p)| (k, p.seen_at)).collect();
            if rows.len() >= MAX_PRS {
                if let Some((oldest, _)) = rows.iter().min_by_key(|(k, at)| (*at, k.clone())) {
                    self.prs.remove(oldest)?;
                }
            }
        }
        let row = PrSeen {
            chain,
            repo,
            pr: input.pr,
            title,
            state: input.state,
            draft: input.draft,
            base,
            default_branch,
            conflicts: input.conflicts,
            head_sha,
            checks: input.checks,
            checks_total: input.checks_total,
            checks_passed: input.checks_passed,
            checks_pending: input.checks_pending,
            failing,
            stacked_on: input.stacked_on,
            stacked_merged: input.stacked_on != 0 && input.stacked_merged,
            seen_at,
        };
        let view = row.view();
        self.prs.insert(key.clone(), row)?;
        app::emit!(Event::PrChanged { key: &key });
        Ok(view)
    }

    pub(crate) fn pr_list(&self, chain: &str) -> app::Result<Vec<PrView>> {
        Self::check_len("chain", chain, MAX_KEY, false)?;
        let mut out: Vec<PrView> = self
            .prs
            .entries()?
            .filter(|(_, p)| chain.is_empty() || p.chain == chain)
            .map(|(_, p)| p.view())
            .collect();
        out.sort_by(|a, b| {
            b.seen_at
                .cmp(&a.seen_at)
                .then_with(|| a.repo.cmp(&b.repo))
                .then_with(|| a.pr.cmp(&b.pr))
        });
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    const STRANGER: [u8; 32] = [0xE0; 32];

    fn task(app: &mut TestHost<Hyperfeed>) -> String {
        app.call(|s| s.say(String::new(), "Ship #434".to_owned(), None, None))
            .expect("say")
            .chain
    }

    fn pending_434(chain: &str) -> PrInput {
        PrInput {
            chain: chain.to_owned(),
            repo: "calimero-network/apps".to_owned(),
            pr: 434,
            title: "Safe merge button".to_owned(),
            state: "open".to_owned(),
            draft: false,
            base: "master".to_owned(),
            default_branch: "master".to_owned(),
            conflicts: false,
            head_sha: "abc123".to_owned(),
            checks: "pending".to_owned(),
            checks_total: 5,
            checks_passed: 3,
            checks_pending: 2,
            failing: vec![],
            stacked_on: 0,
            stacked_merged: false,
        }
    }

    fn record(app: &mut TestHost<Hyperfeed>, input: PrInput) -> app::Result<PrView> {
        app.call(|s| s.record_pr(input.clone()))
    }

    #[test]
    fn the_runtime_records_a_pr_and_the_card_reads_it() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        let first = record(&mut app, pending_434(&chain)).unwrap();
        assert_eq!(first.checks, "pending");
        assert!(first.seen_at > 0);

        // Checks went red; recorded without naming the chain, it keeps the one it had.
        let red = record(
            &mut app,
            PrInput {
                chain: String::new(),
                checks: "red".to_owned(),
                checks_pending: 0,
                failing: vec!["e2e".to_owned()],
                ..pending_434(&chain)
            },
        )
        .unwrap();
        assert_eq!(red.chain, chain);
        assert_eq!(red.failing, vec!["e2e".to_owned()]);
        assert!(red.seen_at > first.seen_at);

        let listed = app.view(|s| s.prs(chain.clone())).unwrap();
        assert_eq!(listed, vec![red.clone()]);
        assert_eq!(app.view(|s| s.prs(String::new())).unwrap().len(), 1);
        assert!(app.view(|s| s.prs("other".to_owned())).unwrap().is_empty());

        // A stacked PR: its base is another PR's branch.
        let stacked = record(
            &mut app,
            PrInput {
                pr: 435,
                base: "mero-bot/chain-1".to_owned(),
                stacked_on: 434,
                ..pending_434(&chain)
            },
        )
        .unwrap();
        assert_eq!(stacked.stacked_on, 434);
        assert!(!stacked.stacked_merged);
        assert_eq!(app.view(|s| s.prs(chain.clone())).unwrap().len(), 2);
    }

    #[test]
    fn prs_are_checked_and_owner_only() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        let bad = |f: &dyn Fn(&mut PrInput)| {
            let mut i = pending_434(&chain);
            f(&mut i);
            i
        };
        for input in [
            bad(&|i| i.chain = "nope".to_owned()),
            bad(&|i| i.repo = "apps".to_owned()),
            bad(&|i| i.pr = 0),
            bad(&|i| i.state = "draft".to_owned()),
            bad(&|i| i.checks = "yellow".to_owned()),
            bad(&|i| i.base = String::new()),
            bad(&|i| i.default_branch = "my main".to_owned()),
            bad(&|i| i.head_sha = "not a sha".to_owned()),
            bad(&|i| i.checks_passed = 9),
            // Red names what failed; green names nothing.
            bad(&|i| i.checks = "red".to_owned()),
            bad(&|i| i.failing = vec!["e2e".to_owned()]),
            bad(&|i| {
                i.checks = "red".to_owned();
                i.failing = vec!["x".to_owned(); MAX_FAILING + 1];
            }),
            // Into the default branch is not stacked.
            bad(&|i| i.stacked_on = 433),
        ] {
            assert!(record(&mut app, input.clone()).is_err(), "{input:?}");
        }
        assert!(app
            .call_as_account(STRANGER, STRANGER, |s| s.record_pr(pending_434(&chain)))
            .is_err());
        assert!(app.view(|s| s.prs(String::new())).unwrap().is_empty());
    }

    #[test]
    fn the_oldest_pr_makes_room() {
        let mut app = TestHost::new(Hyperfeed::init);
        let chain = task(&mut app);
        for n in 1..=MAX_PRS as u64 {
            record(
                &mut app,
                PrInput {
                    pr: n,
                    ..pending_434(&chain)
                },
            )
            .unwrap();
        }
        record(
            &mut app,
            PrInput {
                pr: 9_999,
                ..pending_434(&chain)
            },
        )
        .unwrap();
        let all = app.view(|s| s.prs(String::new())).unwrap();
        assert_eq!(all.len(), MAX_PRS);
        assert!(all.iter().any(|p| p.pr == 9_999));
        assert!(!all.iter().any(|p| p.pr == 1));
    }
}
