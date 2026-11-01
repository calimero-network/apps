//! Your agent's query cache: what it read, so the next turn need not ask again.
//!
//! An agent turn starts cold, so every turn re-reads the same things: the
//! node's contexts and apps, an app's messages or issues, a PR's checks. The
//! agent's runtime keeps what it read in memory and serves repeats from there;
//! it writes here the entries worth keeping, in batches, so they survive a
//! restart and reach your other agents. One row per read, keyed by a hash of
//! where it read, which tool and its arguments.
//!
//! The runtime decides what is fresh: each row carries its freshness class and
//! its current time to live, which the runtime lengthens while refetches find
//! the value unchanged and shortens when they find it changed. The feed keeps
//! the rows within [`MAX_MEMOS`] and [`MAX_MEMO_BYTES`], dropping the least
//! used first: hits that halve in weight every [`HEAT_HALF_LIFE_MS`].
//!
//! A row is a cache, never a record: losing one costs a read, nothing else.

use calimero_app_sdk::prelude::*;

use crate::store::{emit, invalid};
use serde::{Deserialize, Serialize};

use crate::{now_ms, Ev, Hyperfeed, MAX_KEY, MAX_SHORT};

/// Rows kept at once.
pub const MAX_MEMOS: usize = 500;
/// Bytes kept across every row's value, arguments, scope and tool.
pub const MAX_MEMO_BYTES: usize = 2 * 1024 * 1024;
/// One row's value: a larger read is not worth keeping whole.
pub const MAX_MEMO_VALUE: usize = 16 * 1024;
/// One row's arguments, as canonical JSON or a command line.
pub const MAX_MEMO_ARGS: usize = 2_000;
/// A row's key: a hex hash.
pub const MAX_MEMO_KEY: usize = 128;
/// Rows one `put_memos` or `drop_memos` may name.
pub const MAX_MEMO_BATCH: usize = 50;
/// Agents whose hits one row counts.
pub const MAX_MEMO_AGENTS: usize = 16;
/// A hit counts half as much after this long: 6 hours.
pub const HEAT_HALF_LIFE_MS: u64 = 6 * 60 * 60 * 1000;
/// `immutable` never goes stale, `slow` is minutes to hours, `fast` seconds to minutes.
pub const MEMO_CLASSES: &[&str] = &["immutable", "slow", "fast"];
/// A row may claim to be fetched this far ahead of the feed's clock (another
/// machine's clock); further is pulled back to now.
const CLOCK_SKEW_MS: u64 = 5 * 60 * 1000;

/// How often one agent used a row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemoHits {
    pub agent: String,
    pub hits: u64,
}

/// One read as the agent last saw it, kept by its key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memo {
    pub scope: String,
    pub tool: String,
    pub args: String,
    pub value: String,
    pub class: String,
    pub ttl_ms: u64,
    pub fetched_at: u64,
    pub unchanged: u32,
    /// Per agent, each only ever growing: merged by max, so two agents never
    /// lose each other's counts. At most [`MAX_MEMO_AGENTS`] agents, checked in
    /// `putMemos`.
    pub hits: Vec<MemoHits>,
    pub last_hit_at: u64,
    pub agent: String,
    pub attested: bool,
    /// When the feed last took a write to it (the feed's clock): what
    /// [`crate::Hyperfeed::memos`] reads after.
    pub updated_at: u64,
}

/// Each agent's count, the larger of the two, in agent order.
fn merge_hits(a: &[MemoHits], b: &[MemoHits]) -> Vec<MemoHits> {
    let mut out: Vec<MemoHits> = a.to_vec();
    for h in b {
        match out.iter_mut().find(|o| o.agent == h.agent) {
            Some(o) => o.hits = o.hits.max(h.hits),
            None => out.push(h.clone()),
        }
    }
    out.sort_by(|x, y| x.agent.cmp(&y.agent));
    out
}

impl Memo {
    pub fn total_hits(&self) -> u64 {
        self.hits.iter().map(|h| h.hits).sum()
    }

    /// How much it is used now: its hits, halved for every half-life since the last.
    pub fn heat(&self, now: u64) -> f64 {
        let age = now.saturating_sub(self.last_hit_at) as f64;
        self.total_hits() as f64 * (-(age / HEAT_HALF_LIFE_MS as f64)).exp2()
    }

    fn size(&self) -> usize {
        self.value.len() + self.args.len() + self.scope.len() + self.tool.len()
    }

    fn view(&self, key: &str) -> MemoView {
        MemoView {
            key: key.to_owned(),
            scope: self.scope.clone(),
            tool: self.tool.clone(),
            args: self.args.clone(),
            value: self.value.clone(),
            class: self.class.clone(),
            ttl_ms: self.ttl_ms,
            fetched_at: self.fetched_at,
            unchanged: self.unchanged,
            hits: self.hits.clone(),
            last_hit_at: self.last_hit_at,
            agent: self.agent.clone(),
            attested: self.attested,
            updated_at: self.updated_at,
        }
    }
}

/// One row as [`crate::Hyperfeed::put_memos`] takes it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoInput {
    /// A hex hash of scope, tool and arguments: the runtime's key for the read.
    pub key: String,
    /// What the read is about: `<app>:<context>`, `node`, `gh:<owner>/<name>`.
    pub scope: String,
    /// The tool, without its server's prefix: `chat_get_messages`, `gh`.
    pub tool: String,
    /// Its arguments, as canonical JSON or a command line.
    pub args: String,
    /// What it returned, at most [`MAX_MEMO_VALUE`].
    pub value: String,
    /// One of [`MEMO_CLASSES`].
    pub class: String,
    /// How long the value counts as fresh, as the runtime last judged it.
    pub ttl_ms: u64,
    /// When it was read (ms).
    pub fetched_at: u64,
    /// Refetches in a row that found the same value.
    pub unchanged: u32,
    /// This agent's hits on it, in total: the feed keeps the largest it saw.
    pub hits: u64,
    /// When this agent last used it (ms).
    pub last_hit_at: u64,
    /// Read by an agent whose every model is attested: never shown to one that is not.
    pub attested: bool,
}

/// A row as [`crate::Hyperfeed::memos`] returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemoView {
    pub key: String,
    pub scope: String,
    pub tool: String,
    pub args: String,
    pub value: String,
    pub class: String,
    pub ttl_ms: u64,
    pub fetched_at: u64,
    pub unchanged: u32,
    pub hits: Vec<MemoHits>,
    pub last_hit_at: u64,
    pub agent: String,
    pub attested: bool,
    pub updated_at: u64,
}

fn check_key(key: &str) -> app::Result<()> {
    Hyperfeed::check_len("key", key, MAX_MEMO_KEY, true)?;
    if !key
        .chars()
        .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    {
        return Err(invalid(format!("key {key:?} must be lowercase hex")));
    }
    Ok(())
}

fn check_batch(len: usize) -> app::Result<()> {
    if len > MAX_MEMO_BATCH {
        return Err(invalid(format!(
            "{len} rows, limit is {MAX_MEMO_BATCH} a call"
        )));
    }
    Ok(())
}

impl Hyperfeed {
    pub(crate) fn memo_put(&mut self, agent: &str, memos: Vec<MemoInput>) -> app::Result<u32> {
        let agent = agent.trim().to_owned();
        Self::check_len("agent", &agent, MAX_KEY, true)?;
        self.require_agent_as(&agent)?;
        check_batch(memos.len())?;
        let now = now_ms();
        // Every row is checked before any is written: a bad batch writes nothing.
        for m in &memos {
            check_key(&m.key)?;
            Self::check_len("scope", &m.scope, MAX_KEY, true)?;
            Self::check_len("tool", &m.tool, MAX_SHORT, true)?;
            Self::check_len("args", &m.args, MAX_MEMO_ARGS, false)?;
            Self::check_len("value", &m.value, MAX_MEMO_VALUE, false)?;
            Self::check_one_of("class", &m.class, MEMO_CLASSES)?;
        }
        let mut stored = 0u32;
        for m in memos {
            let fetched_at = if m.fetched_at > now + CLOCK_SKEW_MS {
                now
            } else {
                m.fetched_at
            };
            let mine = MemoHits {
                agent: agent.clone(),
                hits: m.hits,
            };
            let prior = self.memos.get(&m.key)?;
            let row = match prior {
                // Seen newer already (another agent refetched it): only this agent's use counts.
                Some(p) if p.fetched_at > fetched_at => {
                    if p.hits.iter().any(|h| h.agent == agent && h.hits >= m.hits) {
                        continue;
                    }
                    if !p.hits.iter().any(|h| h.agent == agent) && p.hits.len() >= MAX_MEMO_AGENTS {
                        continue;
                    }
                    Memo {
                        hits: merge_hits(&p.hits, &[mine]),
                        last_hit_at: p.last_hit_at.max(m.last_hit_at.min(now)),
                        updated_at: now,
                        ..p
                    }
                }
                prior => {
                    let others = prior.as_ref().map(|p| p.hits.as_slice()).unwrap_or(&[]);
                    let mut hits = merge_hits(others, &[mine]);
                    hits.truncate(MAX_MEMO_AGENTS);
                    Memo {
                        scope: m.scope,
                        tool: m.tool,
                        args: m.args,
                        value: m.value,
                        class: m.class,
                        ttl_ms: m.ttl_ms,
                        fetched_at,
                        unchanged: m.unchanged,
                        hits,
                        last_hit_at: prior
                            .as_ref()
                            .map_or(0, |p| p.last_hit_at)
                            .max(m.last_hit_at.min(now)),
                        agent: agent.clone(),
                        attested: m.attested,
                        updated_at: now,
                    }
                }
            };
            self.memos.insert(m.key, row)?;
            stored += 1;
        }
        let evicted = self.memo_evict(now)?;
        if stored > 0 || evicted > 0 {
            emit(Ev::MemosChanged { count: stored })?;
        }
        Ok(stored)
    }

    /// Drop the least used rows until the feed is within its limits.
    fn memo_evict(&mut self, now: u64) -> app::Result<u32> {
        let mut rows: Vec<(String, f64, u64, usize)> = self
            .memos
            .entries()?
            .map(|(k, m)| (k, m.heat(now), m.fetched_at, m.size()))
            .collect();
        let mut bytes: usize = rows.iter().map(|r| r.3).sum();
        if rows.len() <= MAX_MEMOS && bytes <= MAX_MEMO_BYTES {
            return Ok(0);
        }
        // Coldest first; then the oldest fetch; then the key, so every node picks the same.
        rows.sort_by(|a, b| {
            a.1.total_cmp(&b.1)
                .then_with(|| a.2.cmp(&b.2))
                .then_with(|| a.0.cmp(&b.0))
        });
        let mut count = rows.len();
        let mut evicted = 0u32;
        for (key, _, _, size) in rows {
            if count <= MAX_MEMOS && bytes <= MAX_MEMO_BYTES {
                break;
            }
            self.memos.remove(&key)?;
            count -= 1;
            bytes -= size;
            evicted += 1;
        }
        Ok(evicted)
    }

    pub(crate) fn memo_drop(&mut self, agent: &str, keys: Vec<String>) -> app::Result<u32> {
        self.require_agent_as(agent.trim())?;
        check_batch(keys.len())?;
        for key in &keys {
            check_key(key)?;
        }
        let mut dropped = 0u32;
        for key in keys {
            if self.memos.remove(&key)?.is_some() {
                dropped += 1;
            }
        }
        if dropped > 0 {
            emit(Ev::MemosChanged { count: 0 })?;
        }
        Ok(dropped)
    }

    pub(crate) fn memo_clear(&mut self) -> app::Result<u32> {
        self.require_owner()?;
        let keys: Vec<String> = self.memos.entries()?.map(|(k, _)| k).collect();
        for key in &keys {
            self.memos.remove(key)?;
        }
        emit(Ev::MemosCleared)?;
        Ok(keys.len() as u32)
    }

    pub(crate) fn memo_list(&self, since: u64) -> app::Result<Vec<MemoView>> {
        let mut out: Vec<MemoView> = self
            .memos
            .entries()?
            .filter(|(_, m)| m.updated_at > since)
            .map(|(k, m)| m.view(&k))
            .collect();
        out.sort_by(|a, b| {
            a.updated_at
                .cmp(&b.updated_at)
                .then_with(|| a.key.cmp(&b.key))
        });
        Ok(out)
    }
}
