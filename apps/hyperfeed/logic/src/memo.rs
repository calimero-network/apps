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

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::{lww, now_ms, Event, Hyperfeed, MAX_KEY, MAX_SHORT};

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
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MemoHits {
    pub agent: String,
    pub hits: u64,
}

/// One read as the agent last saw it, kept by its key.
#[app::mergeable(id = "hyperfeed::Memo")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
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
    /// lose each other's counts.
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

impl Mergeable for Memo {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // The later fetch's value wins; the hits of both are kept.
        let hits = merge_hits(&self.hits, &other.hits);
        let last_hit_at = self.last_hit_at.max(other.last_hit_at);
        let updated_at = self.updated_at.max(other.updated_at);
        let at = self.fetched_at;
        lww(self, at, other, other.fetched_at);
        self.hits = hits;
        self.last_hit_at = last_hit_at;
        self.updated_at = updated_at;
        Ok(())
    }
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
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
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
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
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
        return Err(AppError::msg(format!("key {key:?} must be lowercase hex")));
    }
    Ok(())
}

fn check_batch(len: usize) -> app::Result<()> {
    if len > MAX_MEMO_BATCH {
        return Err(AppError::msg(format!(
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
            let prior = self.memos.get(&m.key)?.map(|p| p.clone());
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
            app::emit!(Event::MemosChanged { count: stored });
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
            app::emit!(Event::MemosChanged { count: 0 });
        }
        Ok(dropped)
    }

    pub(crate) fn memo_clear(&mut self) -> app::Result<u32> {
        self.require_owner()?;
        let keys: Vec<String> = self.memos.entries()?.map(|(k, _)| k).collect();
        for key in &keys {
            self.memos.remove(key)?;
        }
        app::emit!(Event::MemosCleared);
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

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;
    use calimero_sdk::AccountId;

    use super::*;

    const STRANGER: [u8; 32] = [0xE0; 32];
    const CLOUD: [u8; 32] = [0xC1; 32];
    const CLOUD_DEVICE: [u8; 32] = [0xC2; 32];
    const ME: &str = "mero-bot@studio";

    fn key(n: u64) -> String {
        format!("{n:064x}")
    }

    fn row(n: u64) -> MemoInput {
        MemoInput {
            key: key(n),
            scope: "chat:ctx".to_owned(),
            tool: "chat_get_messages".to_owned(),
            args: format!("{{\"n\":{n}}}"),
            value: "[]".to_owned(),
            class: "fast".to_owned(),
            ttl_ms: 30_000,
            fetched_at: now_ms(),
            unchanged: 0,
            hits: 1,
            last_hit_at: now_ms(),
            attested: false,
        }
    }

    fn put(app: &mut TestHost<Hyperfeed>, agent: &str, rows: Vec<MemoInput>) -> app::Result<u32> {
        app.call(|s| s.put_memos(agent.to_owned(), rows.clone()))
    }

    fn all(app: &TestHost<Hyperfeed>) -> Vec<MemoView> {
        app.view(|s| s.memos(0)).unwrap()
    }

    #[test]
    fn the_runtime_keeps_a_read_and_reads_it_back() {
        let mut app = TestHost::new(Hyperfeed::init);
        assert_eq!(put(&mut app, ME, vec![row(1)]).unwrap(), 1);
        let rows = all(&app);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].key, key(1));
        assert_eq!(rows[0].agent, ME);
        assert_eq!(
            rows[0].hits,
            vec![MemoHits {
                agent: ME.to_owned(),
                hits: 1
            }]
        );
        // Read after what it has: nothing new.
        assert!(app
            .view(|s| s.memos(rows[0].updated_at))
            .unwrap()
            .is_empty());

        // A refetch replaces the value and keeps the larger count.
        let again = MemoInput {
            value: "[1]".to_owned(),
            hits: 3,
            fetched_at: now_ms() + 1,
            ..row(1)
        };
        put(&mut app, ME, vec![again]).unwrap();
        let rows = all(&app);
        assert_eq!(rows[0].value, "[1]");
        assert_eq!(rows[0].hits[0].hits, 3);
    }

    #[test]
    fn an_older_fetch_counts_its_hits_but_keeps_the_newer_value() {
        let mut app = TestHost::new(Hyperfeed::init);
        app.call(|s| s.add_agent_account(AccountId::from(CLOUD).to_string(), "cloud".to_owned()))
            .unwrap();
        let newer = MemoInput {
            value: "new".to_owned(),
            fetched_at: now_ms() + 1_000,
            ..row(1)
        };
        put(&mut app, ME, vec![newer]).unwrap();
        let older = MemoInput {
            value: "old".to_owned(),
            fetched_at: now_ms() - 60_000,
            hits: 4,
            ..row(1)
        };
        app.call_as_account(CLOUD, CLOUD_DEVICE, |s| {
            s.put_memos("cloud".to_owned(), vec![older])
        })
        .unwrap();
        let rows = all(&app);
        assert_eq!(rows[0].value, "new");
        assert_eq!(rows[0].agent, ME);
        assert_eq!(
            rows[0].hits,
            vec![
                MemoHits {
                    agent: "cloud".to_owned(),
                    hits: 4
                },
                MemoHits {
                    agent: ME.to_owned(),
                    hits: 1
                },
            ]
        );
    }

    #[test]
    fn two_agents_merge_without_losing_hits() {
        let base = |value: &str, at: u64, hits: Vec<MemoHits>| Memo {
            scope: "s".to_owned(),
            tool: "t".to_owned(),
            args: String::new(),
            value: value.to_owned(),
            class: "fast".to_owned(),
            ttl_ms: 1,
            fetched_at: at,
            unchanged: 0,
            hits,
            last_hit_at: at,
            agent: "a".to_owned(),
            attested: false,
            updated_at: at,
        };
        let h = |agent: &str, hits: u64| MemoHits {
            agent: agent.to_owned(),
            hits,
        };
        let mine = base("mine", 10, vec![h("a", 5), h("b", 1)]);
        let theirs = base("theirs", 20, vec![h("b", 7)]);
        let mut left = mine.clone();
        left.merge(&theirs).unwrap();
        let mut right = theirs.clone();
        right.merge(&mine).unwrap();
        for m in [&left, &right] {
            assert_eq!(m.value, "theirs");
            assert_eq!(m.hits, vec![h("a", 5), h("b", 7)]);
            assert_eq!(m.last_hit_at, 20);
        }
    }

    #[test]
    fn the_least_used_rows_make_room() {
        let mut app = TestHost::new(Hyperfeed::init);
        // One hot row, then enough cold ones to pass the limit.
        put(&mut app, ME, vec![MemoInput { hits: 50, ..row(0) }]).unwrap();
        let cold: Vec<MemoInput> = (1..=MAX_MEMOS as u64)
            .map(|n| MemoInput {
                hits: 1,
                last_hit_at: now_ms() - HEAT_HALF_LIFE_MS * 4,
                ..row(n)
            })
            .collect();
        for chunk in cold.chunks(MAX_MEMO_BATCH) {
            put(&mut app, ME, chunk.to_vec()).unwrap();
        }
        let rows = all(&app);
        assert_eq!(rows.len(), MAX_MEMOS);
        assert!(rows.iter().any(|r| r.key == key(0)), "the hot row stays");
    }

    #[test]
    fn rows_stay_within_their_bytes() {
        let mut app = TestHost::new(Hyperfeed::init);
        let big = "x".repeat(MAX_MEMO_VALUE);
        let n = (MAX_MEMO_BYTES / MAX_MEMO_VALUE) as u64 + 5;
        let rows: Vec<MemoInput> = (0..n)
            .map(|i| MemoInput {
                value: big.clone(),
                ..row(i)
            })
            .collect();
        for chunk in rows.chunks(MAX_MEMO_BATCH) {
            put(&mut app, ME, chunk.to_vec()).unwrap();
        }
        let kept: usize = all(&app)
            .iter()
            .map(|r| r.value.len() + r.args.len() + r.scope.len() + r.tool.len())
            .sum();
        assert!(kept <= MAX_MEMO_BYTES);
    }

    #[test]
    fn rows_are_checked() {
        let mut app = TestHost::new(Hyperfeed::init);
        for bad in [
            MemoInput {
                key: "not hex".to_owned(),
                ..row(1)
            },
            MemoInput {
                key: String::new(),
                ..row(1)
            },
            MemoInput {
                scope: String::new(),
                ..row(1)
            },
            MemoInput {
                tool: String::new(),
                ..row(1)
            },
            MemoInput {
                class: "warm".to_owned(),
                ..row(1)
            },
            MemoInput {
                value: "x".repeat(MAX_MEMO_VALUE + 1),
                ..row(1)
            },
        ] {
            assert!(
                put(&mut app, ME, vec![row(2), bad.clone()]).is_err(),
                "{bad:?}"
            );
        }
        assert!(all(&app).is_empty(), "a bad batch writes nothing");
        let too_many: Vec<MemoInput> = (0..=MAX_MEMO_BATCH as u64).map(row).collect();
        assert!(put(&mut app, ME, too_many).is_err());
    }

    #[test]
    fn strangers_and_other_names_are_refused_and_clearing_is_yours() {
        let mut app = TestHost::new(Hyperfeed::init);
        assert!(app
            .call_as_account(STRANGER, STRANGER, |s| s
                .put_memos(ME.to_owned(), vec![row(1)]))
            .is_err());
        app.call(|s| s.add_agent_account(AccountId::from(CLOUD).to_string(), "cloud".to_owned()))
            .unwrap();
        assert!(
            app.call_as_account(CLOUD, CLOUD_DEVICE, |s| s
                .put_memos(ME.to_owned(), vec![row(1)]))
                .is_err(),
            "an added agent writes only as itself"
        );
        app.call_as_account(CLOUD, CLOUD_DEVICE, |s| {
            s.put_memos("cloud".to_owned(), vec![row(1)])
        })
        .unwrap();
        assert!(
            app.call_as_account(CLOUD, CLOUD_DEVICE, |s| s.clear_memos())
                .is_err(),
            "only you clear the cache"
        );

        put(&mut app, ME, vec![row(2), row(3)]).unwrap();
        assert_eq!(
            app.call(|s| s.drop_memos(ME.to_owned(), vec![key(2), key(9)]))
                .unwrap(),
            1
        );
        assert_eq!(all(&app).len(), 2);
        assert_eq!(app.call(|s| s.clear_memos()).unwrap(), 2);
        assert!(all(&app).is_empty());
    }
}
