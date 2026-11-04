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

use calimero_sdk::prelude::*;

use crate::store::{emit, invalid};
use serde::{Deserialize, Serialize};

use crate::watches::check_repo;
use crate::{now_ms, Ev, Hyperfeed, MAX_KEY, MAX_SHORT, MAX_TITLE};

/// PRs kept at once; recording one more drops the one seen longest ago.
pub const MAX_PRS: usize = 200;
/// Failing checks named on one PR.
pub const MAX_FAILING: usize = 10;
/// A commit's sha, hex.
pub const MAX_SHA: usize = 64;
pub const PR_STATES: &[&str] = &["open", "merged", "closed"];
pub const CHECK_STATES: &[&str] = &["green", "red", "pending"];

/// One PR as the runtime last saw it, kept by `owner/name#number`.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// At most [`MAX_FAILING`], checked in `recordPr`.
    pub failing: Vec<String>,
    pub stacked_on: u64,
    pub stacked_merged: bool,
    pub seen_at: u64,
}

/// What [`crate::Hyperfeed::record_pr`] takes: the PR as GitHub shows it now.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
        return Err(invalid(format!("{field} {value:?} has spaces")));
    }
    Ok(value.to_owned())
}

impl Hyperfeed {
    pub(crate) fn pr_record(&mut self, input: PrInput) -> app::Result<PrView> {
        self.require_agent()?;
        let repo = input.repo.trim().to_owned();
        check_repo(&repo)?;
        if input.pr == 0 {
            return Err(invalid("pr must be the pull request's number"));
        }
        let key = format!("{repo}#{}", input.pr);
        let chain = input.chain.trim().to_owned();
        Self::check_len("chain", &chain, MAX_KEY, false)?;
        if !chain.is_empty() && !self.chain_exists(&chain)? {
            return Err(invalid(format!("no chain {chain}")));
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
            return Err(invalid("head_sha is a commit's hex sha"));
        }
        if input.failing.len() > MAX_FAILING {
            return Err(invalid(format!(
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
            return Err(invalid(
                "checks_passed and checks_pending add up to more than checks_total",
            ));
        }
        if (input.checks == "red") != !failing.is_empty() {
            return Err(invalid("checks is red exactly when failing names a check"));
        }
        if input.stacked_on != 0 && base == default_branch {
            return Err(invalid(
                "a PR into the default branch is not stacked: stacked_on must be 0",
            ));
        }

        let prior = self.prs.get(&key)?;
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
        emit(Ev::PrChanged { key: &key })?;
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
