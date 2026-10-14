//! Mero Standup — async standups and a decision log for a small team.
//!
//! A context is one team. Its members post a short daily update (what they
//! did, what is next, what blocks them) and record the decisions the team
//! makes, with the reasoning, so nobody has to reconstruct either from a chat
//! scroll-back. Everything replicates between the members' own nodes.
//!
//! It is deliberately small, and meant to be read as a second app after
//! kv-store: three collections, each picked from the storage tiers in
//! `apps/mero-chess/docs/trust-model.md` for what it has to hold.
//!
//! # Who may write what — enforced by every node, not by these methods
//!
//! A receiving node does not run this contract; it checks the delta's
//! signature and the entry's storage stamp, then applies it. The `if`s below
//! only make a refused write fail early. What holds is the tier:
//!
//! * `updates` is `Authored<SortedMap<day, Update>>`. Keys are per owner, so
//!   each account has its OWN entry at each day: posting is "write my entry
//!   for today", editing is updating it, and nobody can touch anyone else's.
//!   The author shown is the owner stamp, never a field in the value.
//! * `decisions` is `WriteOnce<SortedMap<id, Decision>>`: owned AND immutable.
//!   A logged decision is a record of what was decided, so not even its author
//!   can rewrite it afterwards. Changing your mind is a NEW decision that
//!   supersedes the old one, and "superseded" is derived on read, never
//!   stored, so no row can mark someone else's decision as overturned.
//! * `profiles` is `UserStorage`: one display name per account, written only
//!   by that account.
//!
//! # What a patched node can still do, and why it does not matter much
//!
//! It can write junk under its OWN stamp: an update at a key that is not a
//! date, a decision that supersedes an id that does not exist, a timestamp in
//! the future. Every read filters those (`parse_day`, `superseded_by`), so the
//! junk is inert. It cannot write as anyone else.

use std::collections::BTreeMap;
use std::str::FromStr;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    Authored, Mergeable, SortedMap, StoreError, UserStorage, WriteOnce,
};

#[cfg(test)]
mod tests;

/// Longest one standup field may be. An update is replicated to every member,
/// so an unbounded field is an unbounded broadcast.
pub const MAX_FIELD: usize = 2_000;
/// Longest a decision title may be.
pub const MAX_TITLE: usize = 200;
/// Longest a decision's text or rationale may be.
pub const MAX_BODY: usize = 5_000;
/// A display name, not a bio.
pub const MAX_NAME: usize = 64;
/// Largest page any list returns, whatever is asked for.
pub const MAX_PAGE: usize = 100;
/// Page size used when the caller asks for 0.
pub const DEFAULT_PAGE: usize = 20;

// ── Stored records ───────────────────────────────────────────────────────────

/// One member's standup for one day.
///
/// No author and no day field: the author is the entry's owner stamp and the
/// day is its key. A field could say anything; those two cannot be forged.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Update {
    /// What got done since the last update.
    pub done: String,
    /// What is next.
    pub next: String,
    /// What is in the way. Empty means nothing is.
    pub blockers: String,
    pub created_at: u64,
    pub edited_at: u64,
    /// Withdrawn by its author. A flag rather than a removal, so the entry
    /// stays the author's and posting again for the same day is an update.
    pub cleared: bool,
}

/// One logged decision. Immutable once written.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Decision {
    /// A short name for the decision, the line people will scan.
    pub title: String,
    /// What was decided.
    pub decision: String,
    /// Why: the context and the alternatives, for whoever asks in six months.
    pub rationale: String,
    /// The decision this one replaces, if any. A claim, checked on read.
    pub supersedes: Option<String>,
    pub created_at: u64,
}

/// The display name one account chose for itself.
///
/// In the contract rather than only in the browser because everyone ELSE has
/// to see it. A claim, not an identity: names are not unique, and nothing is
/// authorised by one.
#[app::mergeable(id = "mero_standup::Profile")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Profile {
    pub name: String,
    pub updated_at: u64,
}

impl Mergeable for Profile {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // One owner, so the only conflict is renaming from two devices at
        // once. The name breaks a timestamp tie so both replicas pick the same.
        if (other.updated_at, &other.name) > (self.updated_at, &self.name) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Views (what the RPC surface returns) ─────────────────────────────────────

#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UpdateView {
    pub day: String,
    pub author: String,
    /// The author's chosen name, or "" when they have not set one.
    pub author_name: String,
    pub done: String,
    pub next: String,
    pub blockers: String,
    pub created_at: u64,
    pub edited_at: u64,
}

/// Everyone's standup for one day.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DayView {
    pub day: String,
    /// Ordered by author, so every node lists them the same way.
    pub updates: Vec<UpdateView>,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DaySummary {
    pub day: String,
    /// How many members posted that day.
    pub updates: u32,
    /// How many of those named a blocker.
    pub blocked: u32,
}

/// Days with at least one update, newest first.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DayPage {
    pub days: Vec<DaySummary>,
    /// Pass back as `before` for the next page; `None` at the end.
    pub next_cursor: Option<String>,
}

/// Someone who has taken part: posted an update or named themselves.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MemberView {
    pub account: String,
    pub name: String,
    /// The latest day they posted for, or "" if they never have.
    pub last_day: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DecisionView {
    pub id: String,
    pub author: String,
    pub author_name: String,
    pub title: String,
    pub decision: String,
    pub rationale: String,
    /// The decision this one replaces, or "" — only when that claim holds.
    pub supersedes: String,
    /// The decision that replaced this one, or "" while it stands.
    pub superseded_by: String,
    pub created_at: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DecisionPage {
    pub items: Vec<DecisionView>,
    /// Pass back as `cursor` for the next page; `None` at the end.
    pub next_cursor: Option<String>,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(emits = for<'a> Event<'a>)]
pub struct MeroStandup {
    /// Day (`YYYY-MM-DD`) → update, one entry per account per day.
    updates: Authored<SortedMap<String, Update>>,
    /// Decision id → decision. Write-once: a record, not a document.
    decisions: WriteOnce<SortedMap<String, Decision>>,
    /// The display name each account chose, in that account's own slot.
    profiles: UserStorage<Profile>,
}

#[app::event]
pub enum Event<'a> {
    UpdatePosted { day: &'a str, account: &'a str },
    UpdateCleared { day: &'a str, account: &'a str },
    DecisionLogged { id: &'a str },
    ProfileSet { account: &'a str },
}

/// Every decision by id, with the account holding it.
type Decisions = BTreeMap<String, (AccountId, Decision)>;

/// A storage error, named by the call that raised it.
fn store_err(what: &'static str) -> impl FnOnce(StoreError) -> AppError {
    move |e| AppError::msg(format!("{what} failed: {e}"))
}

/// `Some(day)` if `day` is a real calendar date written `YYYY-MM-DD`.
///
/// The day is the key, and a key is a string anyone can choose, so every read
/// filters through this as well as every write. A strict shape also makes the
/// keys sort chronologically, which `list_days` relies on.
pub fn parse_day(day: &str) -> Option<(u32, u32, u32)> {
    let b = day.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        b[r].iter().try_fold(0u32, |n, c| {
            c.is_ascii_digit().then(|| n * 10 + u32::from(c - b'0'))
        })
    };
    let (y, m, d) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days_in_month = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    (y >= 2000 && (1..=days_in_month).contains(&d)).then_some((y, m, d))
}

fn check_len(field: &str, value: &str, max: usize) -> app::Result<()> {
    if value.len() > max {
        return Err(AppError::msg(format!(
            "{field} is {} bytes, limit is {max}",
            value.len()
        )));
    }
    Ok(())
}

fn check_required(field: &str, value: &str, max: usize) -> app::Result<()> {
    if value.trim().is_empty() {
        return Err(AppError::msg(format!("{field} must not be empty")));
    }
    check_len(field, value, max)
}

fn page_size(limit: u32) -> usize {
    match limit as usize {
        0 => DEFAULT_PAGE,
        n => n.min(MAX_PAGE),
    }
}

// ── Logic ────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroStandup {
    #[app::init]
    pub fn init() -> MeroStandup {
        MeroStandup {
            updates: Authored::new(),
            decisions: WriteOnce::new(),
            profiles: UserStorage::new(),
        }
    }

    /// The caller, as an ACCOUNT rather than a device: one person posting from
    /// a laptop and a phone is one member with one update per day.
    fn me() -> AccountId {
        AccountId::from(env::account_id())
    }

    /// The calling account, as the views render it. The frontend uses it to
    /// find "my" update in a day without a second identity lookup.
    pub fn whoami(&self) -> app::Result<String> {
        Ok(Self::me().to_string())
    }

    // ── standups ────────────────────────────────────────────────────────────

    /// Post, or rewrite, the caller's standup for `day` (`YYYY-MM-DD`).
    ///
    /// The day comes from the client because "today" is the member's local
    /// date, which the contract cannot know. At least one field must say
    /// something; `blockers` may stay empty, and usually does.
    pub fn post_update(
        &mut self,
        day: String,
        done: String,
        next: String,
        blockers: String,
    ) -> app::Result<()> {
        if parse_day(&day).is_none() {
            return Err(AppError::msg(format!("not a date (YYYY-MM-DD): {day}")));
        }
        check_len("done", &done, MAX_FIELD)?;
        check_len("next", &next, MAX_FIELD)?;
        check_len("blockers", &blockers, MAX_FIELD)?;
        if done.trim().is_empty() && next.trim().is_empty() && blockers.trim().is_empty() {
            return Err(AppError::msg("an update needs at least one field"));
        }

        let now = env::time_now();
        // Keys are per owner, so this is the caller's own entry or nothing:
        // another member's update for the same day is a separate entry.
        let created_at = self
            .updates
            .get(&day)
            .map_err(store_err("updates.get"))?
            .filter(|u| !u.cleared)
            .map_or(now, |u| u.created_at);
        let update = Update {
            done: done.trim().to_owned(),
            next: next.trim().to_owned(),
            blockers: blockers.trim().to_owned(),
            created_at,
            edited_at: now,
            cleared: false,
        };
        if self
            .updates
            .contains(&day)
            .map_err(store_err("updates.contains"))?
        {
            self.updates
                .update(&day, update)
                .map_err(store_err("updates.update"))?;
        } else {
            self.updates
                .insert(day.clone(), update)
                .map_err(store_err("updates.insert"))?;
        }

        let account = Self::me().to_string();
        app::emit!(Event::UpdatePosted {
            day: &day,
            account: &account
        });
        Ok(())
    }

    /// Withdraw the caller's standup for `day`.
    pub fn clear_update(&mut self, day: String) -> app::Result<()> {
        // The caller's own entry only: keys are per owner.
        let live = self
            .updates
            .get(&day)
            .map_err(store_err("updates.get"))?
            .is_some_and(|u| !u.cleared);
        if !live {
            return Err(AppError::msg(format!("you have no update for {day}")));
        }
        let now = env::time_now();
        self.updates
            .modify(&day, |u| {
                u.cleared = true;
                u.edited_at = now;
            })
            .map_err(store_err("updates.modify"))?;
        let account = Self::me().to_string();
        app::emit!(Event::UpdateCleared {
            day: &day,
            account: &account
        });
        Ok(())
    }

    /// Everyone's standup for one day, ordered by author.
    pub fn get_day(&self, day: String) -> app::Result<DayView> {
        if parse_day(&day).is_none() {
            return Err(AppError::msg(format!("not a date (YYYY-MM-DD): {day}")));
        }
        let mut updates = Vec::new();
        for (author, update) in self
            .updates
            .entries_at(&day)
            .map_err(store_err("updates.entries_at"))?
        {
            if !update.cleared {
                updates.push(self.update_view(&day, &author, update));
            }
        }
        updates.sort_by(|a, b| a.author.cmp(&b.author));
        Ok(DayView { day, updates })
    }

    /// Days with at least one live update, newest first, strictly before
    /// `before` when it is given (the previous page's `next_cursor`).
    pub fn list_days(&self, before: Option<String>, limit: u32) -> app::Result<DayPage> {
        let limit = page_size(limit);
        let mut days: BTreeMap<String, DaySummary> = BTreeMap::new();
        for (_, day, update) in self.live_updates()? {
            let row = days.entry(day.clone()).or_insert_with(|| DaySummary {
                day,
                updates: 0,
                blocked: 0,
            });
            row.updates += 1;
            if !update.blockers.is_empty() {
                row.blocked += 1;
            }
        }
        let mut older = days
            .into_values()
            .rev()
            .filter(|d| before.as_deref().is_none_or(|b| d.day.as_str() < b))
            .take(limit + 1)
            .collect::<Vec<_>>();
        let next_cursor = if older.len() > limit {
            older.truncate(limit);
            older.last().map(|d| d.day.clone())
        } else {
            None
        };
        Ok(DayPage {
            days: older,
            next_cursor,
        })
    }

    /// What is blocking the team right now: each member's LATEST update, if
    /// it names a blocker. An old blocker someone has since posted past is
    /// not current, so only the newest update per member counts.
    pub fn current_blockers(&self) -> app::Result<Vec<UpdateView>> {
        let mut out: Vec<UpdateView> = self
            .latest_per_member()?
            .into_iter()
            .filter(|(_, (_, u))| !u.blockers.is_empty())
            .map(|(author, (day, u))| self.update_view(&day, &author, u))
            .collect();
        out.sort_by(|a, b| b.day.cmp(&a.day).then_with(|| a.author.cmp(&b.author)));
        Ok(out)
    }

    /// Everyone who has posted an update or chosen a name, with the latest day
    /// they posted for. The UI uses it for "still to post today".
    ///
    /// Not the context's membership: a member who never touched the app is
    /// not in here, and the contract has no way to list them.
    pub fn members(&self) -> app::Result<Vec<MemberView>> {
        let mut last: BTreeMap<AccountId, String> = self
            .latest_per_member()?
            .into_iter()
            .map(|(a, (day, _))| (a, day))
            .collect();
        for (account, _) in self
            .profiles
            .entries()
            .map_err(store_err("profiles.entries"))?
        {
            let _ = last.entry(account).or_default();
        }
        Ok(last
            .into_iter()
            .map(|(account, last_day)| MemberView {
                name: self.name_of(&account),
                account: account.to_string(),
                last_day,
            })
            .collect())
    }

    // ── decisions ───────────────────────────────────────────────────────────

    /// Record a decision. Returns its id.
    ///
    /// `supersedes` names the decision this one replaces. It must exist and
    /// still stand when this is written; on read the link only counts if the
    /// replaced decision is older (see `superseded_by`).
    pub fn log_decision(
        &mut self,
        title: String,
        decision: String,
        rationale: String,
        supersedes: Option<String>,
    ) -> app::Result<String> {
        check_required("title", &title, MAX_TITLE)?;
        check_required("decision", &decision, MAX_BODY)?;
        check_len("rationale", &rationale, MAX_BODY)?;
        let supersedes = supersedes.filter(|s| !s.trim().is_empty());
        if let Some(old) = &supersedes {
            let view = self.get_decision(old.clone())?;
            if !view.superseded_by.is_empty() {
                return Err(AppError::msg(format!(
                    "decision {old} was already superseded by {}",
                    view.superseded_by
                )));
            }
        }

        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        let id = hex::encode(buffer);
        self.decisions
            .insert(
                id.clone(),
                Decision {
                    title: title.trim().to_owned(),
                    decision: decision.trim().to_owned(),
                    rationale: rationale.trim().to_owned(),
                    supersedes,
                    created_at: env::time_now(),
                },
            )
            .map_err(store_err("decisions.insert"))?;

        app::emit!(Event::DecisionLogged { id: &id });
        Ok(id)
    }

    /// One decision by id.
    pub fn get_decision(&self, id: String) -> app::Result<DecisionView> {
        let all = self.all_decisions()?;
        let (author, decision) = all
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::msg(format!("no such decision: {id}")))?;
        let replaced = Self::replacements(&all);
        Ok(self.decision_view(&all, &replaced, id, &author, decision))
    }

    /// The log, newest first. `search` keeps decisions whose title, text or
    /// rationale contains it (case-insensitive); `standing_only` drops the
    /// superseded ones. `cursor` is the previous page's `next_cursor`.
    pub fn list_decisions(
        &self,
        search: Option<String>,
        standing_only: bool,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<DecisionPage> {
        let limit = page_size(limit);
        let needle = search
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());
        let all = self.all_decisions()?;
        let replaced = Self::replacements(&all);
        let mut views: Vec<DecisionView> = all
            .iter()
            .map(|(id, (author, d))| {
                self.decision_view(&all, &replaced, id.clone(), author, d.clone())
            })
            .filter(|v| !standing_only || v.superseded_by.is_empty())
            .filter(|v| {
                needle.as_deref().is_none_or(|n| {
                    [&v.title, &v.decision, &v.rationale]
                        .iter()
                        .any(|f| f.to_lowercase().contains(n))
                })
            })
            .collect();
        // Newest first, with the id last so the order is TOTAL: two decisions
        // logged the same millisecond must still order the same on every node,
        // or a cursor would mean different things per replica.
        views.sort_by(|a, b| (b.created_at, &b.id).cmp(&(a.created_at, &a.id)));

        let start = match cursor {
            None => 0,
            Some(c) => views.iter().position(|v| v.id == c).map_or(0, |i| i + 1),
        };
        let has_more = start + limit < views.len();
        let items: Vec<DecisionView> = views.into_iter().skip(start).take(limit).collect();
        let next_cursor = if has_more {
            items.last().map(|v| v.id.clone())
        } else {
            None
        };
        Ok(DecisionPage { items, next_cursor })
    }

    // ── names ───────────────────────────────────────────────────────────────

    /// Claim a display name for the calling account. An empty name clears it.
    ///
    /// No `account` argument: you can only name yourself, and `UserStorage`
    /// holds every node to that, not just this one.
    pub fn set_name(&mut self, name: String) -> app::Result<()> {
        let account = Self::me().to_string();
        let trimmed = name.trim();
        if trimmed.is_empty() {
            let _ = self
                .profiles
                .remove()
                .map_err(store_err("profiles.remove"))?;
        } else {
            check_len("name", trimmed, MAX_NAME)?;
            let _ = self
                .profiles
                .insert(Profile {
                    name: trimmed.to_owned(),
                    updated_at: env::time_now(),
                })
                .map_err(store_err("profiles.insert"))?;
        }
        app::emit!(Event::ProfileSet { account: &account });
        Ok(())
    }

    /// The name `account` chose, or "".
    pub fn get_name(&self, account: String) -> app::Result<String> {
        Ok(AccountId::from_str(&account)
            .map(|a| self.name_of(&a))
            .unwrap_or_default())
    }

    // ── internal ────────────────────────────────────────────────────────────

    fn name_of(&self, account: &AccountId) -> String {
        self.profiles
            .get_for_user(account)
            .ok()
            .flatten()
            .map(|p| p.name)
            .unwrap_or_default()
    }

    fn update_view(&self, day: &str, author: &AccountId, u: Update) -> UpdateView {
        UpdateView {
            day: day.to_owned(),
            author: author.to_string(),
            author_name: self.name_of(author),
            done: u.done,
            next: u.next,
            blockers: u.blockers,
            created_at: u.created_at,
            edited_at: u.edited_at,
        }
    }

    /// Every live update whose key is a real date, with its owner.
    fn live_updates(&self) -> app::Result<Vec<(AccountId, String, Update)>> {
        Ok(self
            .updates
            .entries_with_owners()
            .map_err(store_err("updates.entries_with_owners"))?
            .into_iter()
            .filter(|(_, day, u)| !u.cleared && parse_day(day).is_some())
            .collect())
    }

    /// Each member's newest live update, as `(day, update)`.
    fn latest_per_member(&self) -> app::Result<BTreeMap<AccountId, (String, Update)>> {
        let mut latest: BTreeMap<AccountId, (String, Update)> = BTreeMap::new();
        for (author, day, update) in self.live_updates()? {
            match latest.get(&author) {
                Some((seen, _)) if *seen >= day => {}
                _ => {
                    let _ = latest.insert(author, (day, update));
                }
            }
        }
        Ok(latest)
    }

    /// Every decision by id, with its author.
    ///
    /// Keys are per owner, so one id could have several holders — only if a
    /// patched node copied someone's id, since ids are 16 random bytes. The
    /// LOWEST account holding an id wins, the same pick on every node.
    fn all_decisions(&self) -> app::Result<Decisions> {
        let mut all: Decisions = BTreeMap::new();
        for (author, id, decision) in self
            .decisions
            .entries_with_owners()
            .map_err(store_err("decisions.entries_with_owners"))?
        {
            match all.get(&id) {
                Some((holder, _)) if *holder <= author => {}
                _ => {
                    let _ = all.insert(id, (author, decision));
                }
            }
        }
        Ok(all)
    }

    /// Whether `d`'s claim to supersede holds: the target exists, is a
    /// different decision, and is OLDER. Requiring "older" is what keeps the
    /// links acyclic whatever a patched node writes, so "the decision that
    /// replaced this one" always has an answer.
    fn supersedes_validly(all: &Decisions, id: &str, d: &Decision) -> Option<String> {
        let target = d.supersedes.as_deref()?;
        let (_, old) = all.get(target)?;
        ((old.created_at, target) < (d.created_at, id)).then(|| target.to_owned())
    }

    /// Decision id -> the decision that replaced it, for every decision that
    /// has been replaced. The EARLIEST valid replacement wins, because two
    /// members superseding one decision concurrently is a real event and every
    /// node has to name the same one.
    fn replacements(all: &Decisions) -> BTreeMap<String, String> {
        let mut first: BTreeMap<String, (u64, String)> = BTreeMap::new();
        for (id, (_, d)) in all {
            let Some(target) = Self::supersedes_validly(all, id, d) else {
                continue;
            };
            let candidate = (d.created_at, id.clone());
            match first.get(&target) {
                Some(seen) if *seen <= candidate => {}
                _ => {
                    let _ = first.insert(target, candidate);
                }
            }
        }
        first
            .into_iter()
            .map(|(old, (_, new))| (old, new))
            .collect()
    }

    fn decision_view(
        &self,
        all: &Decisions,
        replaced: &BTreeMap<String, String>,
        id: String,
        author: &AccountId,
        d: Decision,
    ) -> DecisionView {
        DecisionView {
            supersedes: Self::supersedes_validly(all, &id, &d).unwrap_or_default(),
            superseded_by: replaced.get(&id).cloned().unwrap_or_default(),
            author: author.to_string(),
            author_name: self.name_of(author),
            id,
            title: d.title,
            decision: d.decision,
            rationale: d.rationale,
            created_at: d.created_at,
        }
    }
}
