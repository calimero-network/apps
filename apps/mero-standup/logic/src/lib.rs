//! Mero Standup: async standups and a decision log for a small team, on core's
//! component SDK (`calimero-sdk`).
//!
//! An app instance is one team; the organization it lives in decides who
//! reaches it. Members post a short daily update (what they did, what is next,
//! what blocks them), offer help on each other's blockers, and record the
//! decisions the team makes, with the reasoning.
//!
//! # Who may write what
//!
//! v1 held these rules in storage tiers that every node checked when it applied
//! a peer's delta (`Authored`, `WriteOnce`, `UserStorage`). A component app runs
//! on its cluster's leader, which applies every write in one log, so each rule
//! is a check in the method, against `env::caller()`, before anything is
//! written. Every record carries its author as a field the method fills from
//! the caller, never from an argument:
//!
//! | v1 tier | here |
//! |---|---|
//! | `updates: Authored<SortedMap<day, Update>>` | `updates: Table<Update>` keyed `(day, author)`: `postUpdate` / `clearUpdate` only ever touch `(day, caller)` |
//! | `decisions: WriteOnce<SortedMap<id, Decision>>` | `decisions: Table<Decision>`: inserted once by `logDecision`; no method changes or removes one |
//! | `decision_notes: WriteOnce<..>` (read by `get_by(author)`) | fields of the decision itself, written in the same call |
//! | "superseded by", derived on read so nobody could forge it | `replacedBy: UnorderedMap<old, new>`, written only by `logDecision`, which refuses to supersede a decision twice |
//! | `profiles: UserStorage<Profile>` | `profiles: PerUser<Profile>`: the caller's own slot |
//! | `helps: Authored<SortedMap<"day\|author", Help>>` | `helps: Table<Help>` keyed `(day, author, helper)`: `withdrawHelp` only removes `(.., caller)` |
//! | `team: LwwRegister<String>` | `team: Cell<String>`: any member may rename the team, as in v1 |
//!
//! Day keys are the member's **local** `YYYY-MM-DD`: the contract cannot know a
//! time zone, so the client says what "today" is. Every day is checked on write,
//! so no key that is not a real date is ever stored.

use calimero_sdk::prelude::*;
use serde::Serialize;

/// Longest one standup field may be.
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
/// The team's display name.
pub const MAX_TEAM_NAME: usize = 80;
/// An "I can help" note.
pub const MAX_HELP: usize = 500;
/// Tags on one decision, and the length of each.
pub const MAX_TAGS: usize = 8;
pub const MAX_TAG: usize = 32;
/// People named as involved in one decision, and the length of each account.
pub const MAX_WITH: usize = 20;
pub const MAX_ACCOUNT: usize = 256;
/// Rows one storage read returns: a page of a table or collection.
const ROWS: u32 = 1_000;

// ── Stored records ───────────────────────────────────────────────────────────

/// One member's standup for one day, keyed by both. `author` is the caller
/// that wrote it; no argument names it.
#[derive(Record)]
#[table(
    key = ["day", "author"],
    index(by_day = ["day"], by_author = ["author", "day"]),
    count(per_day = ["day"], blocked = ["day", "is_blocked"])
)]
pub struct Update {
    pub day: String,
    pub author: String,
    /// What got done since the last update.
    pub done: String,
    /// What is next.
    pub next: String,
    /// What is in the way. Empty means nothing is.
    pub blockers: String,
    /// `!blockers.is_empty()`, kept as a field so a count can be kept of it.
    pub is_blocked: bool,
    pub created_at: u64,
    pub edited_at: u64,
}

/// One logged decision, written once by `logDecision` and never changed.
#[derive(Record)]
#[table(key = "id", index(feed = ["created_at"], by_day = ["from_day", "created_at"]))]
pub struct Decision {
    pub id: String,
    /// The account that logged it.
    pub author: String,
    /// A short name for the decision, the line people will scan.
    pub title: String,
    /// What was decided.
    pub decision: String,
    /// Why: the context and the alternatives, for whoever asks in six months.
    pub rationale: String,
    /// The decision this one replaces, if any. Checked when it is written.
    pub supersedes: Option<String>,
    pub created_at: u64,
    /// The standup day the decision came out of, if it was logged from one.
    pub from_day: Option<String>,
}

/// A decision's lists, beside it in `decisionNotes` (a record's fields are
/// key parts, which a list is not). Written in the same call, never changed.
#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct DecisionNotes {
    /// Lower-case, de-duplicated, sorted.
    pub tags: Vec<String>,
    /// Accounts the author names as part of the decision. A claim by the
    /// author, shown as such: it does not mean those people signed anything.
    pub with: Vec<String>,
}

/// One tag of one decision: what the tag filter and the tag counts read.
#[derive(Record)]
#[table(
    key = ["tag", "decision"],
    index(tag_feed = ["tag", "created_at"]),
    count(per_tag = ["tag"])
)]
pub struct DecisionTag {
    pub tag: String,
    pub decision: String,
    pub created_at: u64,
}

/// One member's offer to help with someone's blocker. `helper` is the caller
/// that wrote it.
#[derive(Record)]
#[table(key = ["day", "author", "helper"], index(on_update = ["day", "author"]))]
pub struct Help {
    /// The blocked update's day and author.
    pub day: String,
    pub author: String,
    pub helper: String,
    /// Optional: how they can help. Empty means just "I can help".
    pub note: String,
    pub at: u64,
}

/// The display name one account chose for itself. A claim, not an identity:
/// names are not unique, and nothing is authorised by one.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Profile {
    pub name: String,
    pub updated_at: u64,
}

// ── Views (what methods return) ──────────────────────────────────────────────

/// Someone named in a view, with the name they chose ("" if none).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonView {
    pub account: String,
    pub name: String,
}

/// An offer to help with a blocker.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpView {
    pub account: String,
    pub name: String,
    pub note: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub at: u64,
}

/// A tag and how many decisions carry it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateView {
    pub day: String,
    pub author: String,
    /// The author's chosen name, or "" when they have not set one.
    pub author_name: String,
    pub done: String,
    pub next: String,
    pub blockers: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub edited_at: u64,
    /// Teammates who offered to help with the blocker, oldest offer first.
    /// Empty when there is no blocker.
    pub helpers: Vec<HelpView>,
}

/// Everyone's standup for one day.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
    pub day: String,
    /// Ordered by author.
    pub updates: Vec<UpdateView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySummary {
    pub day: String,
    /// How many members posted that day.
    pub updates: u32,
    /// How many of those named a blocker.
    pub blocked: u32,
}

/// Days with at least one update, newest first.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayPage {
    pub days: Vec<DaySummary>,
    /// Pass back as `before` for the next page; `null` at the end.
    pub next_cursor: Option<String>,
}

/// Someone who has taken part: posted an update or named themselves.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberView {
    pub account: String,
    pub name: String,
    /// The latest day they posted for, or "" if they never have.
    pub last_day: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionView {
    pub id: String,
    pub author: String,
    pub author_name: String,
    pub title: String,
    pub decision: String,
    pub rationale: String,
    /// The decision this one replaces, or "".
    pub supersedes: String,
    /// The decision that replaced this one, or "" while it stands.
    pub superseded_by: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    pub tags: Vec<String>,
    pub with: Vec<PersonView>,
    /// The standup day it came out of, or "".
    pub from_day: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionPage {
    pub items: Vec<DecisionView>,
    /// Pass back as `cursor` for the next page; `null` at the end.
    pub next_cursor: Option<String>,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct MeroStandup {
    /// One entry per account per day.
    updates: Table<Update>,
    /// Every day with at least one update, for `listDays`.
    days: Set<String>,
    /// Everyone who posted an update or named themselves, for `members`.
    people: Set<String>,
    /// Write-once decisions.
    decisions: Table<Decision>,
    /// Decision id -> its tags and the people named in it.
    decision_notes: UnorderedMap<String, DecisionNotes>,
    /// Decision id -> the decision that replaced it.
    replaced_by: UnorderedMap<String, String>,
    /// One row per tag per decision.
    decision_tags: Table<DecisionTag>,
    /// Every tag any decision carries, for `tags`.
    tag_names: Set<String>,
    /// Offers to help with blockers.
    helps: Table<Help>,
    /// The display name each account chose, in that account's own slot.
    profiles: PerUser<Profile>,
    /// The team's display name; unset until someone names it.
    team: Cell<String>,
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/// `Some(day)` if `day` is a real calendar date written `YYYY-MM-DD`. A strict
/// shape also makes day keys sort chronologically, which `listDays` relies on.
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

/// The calendar day after `(y, m, d)`, which must be a real date.
fn next_day((y, m, d): (u32, u32, u32)) -> (u32, u32, u32) {
    let candidate = format!("{y:04}-{m:02}-{:02}", d + 1);
    if parse_day(&candidate).is_some() {
        (y, m, d + 1)
    } else if m < 12 {
        (y, m + 1, 1)
    } else {
        (y + 1, 1, 1)
    }
}

fn page_size(limit: u32) -> usize {
    match limit as usize {
        0 => DEFAULT_PAGE,
        n => n.min(MAX_PAGE),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn count32(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Every row `fetch` pages through, in its order, until `keep` says stop.
fn each_row<T>(
    fetch: impl Fn(FindOpts) -> Result<Page<T>, calimero_sdk::StorageError>,
    mut keep: impl FnMut(T) -> app::Result<bool>,
) -> app::Result<()> {
    let mut opts = FindOpts::default().limit(ROWS);
    loop {
        let page = fetch(opts.clone())?;
        for row in page.items {
            if !keep(row)? {
                return Ok(());
            }
        }
        match page.next {
            Some(next) => opts = opts.cursor(next),
            None => return Ok(()),
        }
    }
}

// ── Logic ────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroStandup {
    /// The empty team. The node runs it once, when the app is created.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// The calling account, as the views render it. The frontend uses it to
    /// find "my" update in a day without a second identity lookup.
    #[app::view]
    pub fn whoami(&self) -> app::Result<String> {
        me()
    }

    // ── standups ────────────────────────────────────────────────────────────

    /// Post, or rewrite, the caller's standup for `day` (`YYYY-MM-DD`).
    ///
    /// The day comes from the client because "today" is the member's local
    /// date, which the contract cannot know. At least one field must say
    /// something; `blockers` may stay empty, and usually does. Only ever
    /// writes the caller's own entry. Emits `UpdatePosted`.
    pub fn post_update(
        &mut self,
        day: String,
        done: String,
        next: String,
        blockers: String,
    ) -> app::Result<()> {
        check_day(&day)?;
        check_len("done", &done, MAX_FIELD)?;
        check_len("next", &next, MAX_FIELD)?;
        check_len("blockers", &blockers, MAX_FIELD)?;
        if done.trim().is_empty() && next.trim().is_empty() && blockers.trim().is_empty() {
            return Err(Error::Empty {
                field: "update".into(),
            }
            .into());
        }
        let author = me()?;
        let now = env::time_now();
        let key = (day.clone(), author.clone());
        let created_at = self.updates.get(&key)?.map_or(now, |u| u.created_at);
        let blockers = blockers.trim().to_owned();
        self.updates.upsert(Update {
            day: day.clone(),
            author: author.clone(),
            done: done.trim().to_owned(),
            next: next.trim().to_owned(),
            is_blocked: !blockers.is_empty(),
            blockers,
            created_at,
            edited_at: now,
        })?;
        let _ = self.days.insert(&day)?;
        let _ = self.people.insert(&author)?;
        env::emit(
            Event::UpdatePosted {
                day,
                account: author,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Withdraw the caller's standup for `day`; `NoUpdate` when the caller has
    /// none. Never touches anyone else's. Emits `UpdateCleared`.
    pub fn clear_update(&mut self, day: String) -> app::Result<()> {
        let author = me()?;
        if !self.updates.remove(&(day.clone(), author.clone()))? {
            return Err(Error::NoUpdate { day }.into());
        }
        if self.updates.count("perDay", &[day.to_key_part()])? == 0 {
            let _ = self.days.remove(&day)?;
        }
        env::emit(
            Event::UpdateCleared {
                day,
                account: author,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Everyone's standup for one day, ordered by author.
    #[app::view]
    pub fn get_day(&self, day: String) -> app::Result<DayView> {
        check_day(&day)?;
        let mut updates = Vec::new();
        each_row(
            |o| self.updates.find("byDay", &[day.to_key_part()], o),
            |u| {
                updates.push(self.update_view(u)?);
                Ok(true)
            },
        )?;
        Ok(DayView { day, updates })
    }

    /// Days with at least one update, newest first, strictly before `before`
    /// when it is given (the previous page's `nextCursor`).
    #[app::view]
    pub fn list_days(&self, before: Option<String>, limit: u32) -> app::Result<DayPage> {
        let limit = page_size(limit);
        let mut opts = FindOpts::default().reverse().limit(limit as u32 + 1);
        if let Some(before) = before.filter(|b| !b.is_empty()) {
            opts = opts.to(vec![before.to_key_part()]);
        }
        let mut days = Vec::new();
        for day in self.days.page(opts)?.items {
            let key = day.to_key_part();
            days.push(DaySummary {
                updates: count32(self.updates.count("perDay", std::slice::from_ref(&key))?),
                blocked: count32(self.updates.count("blocked", &[key, true.to_key_part()])?),
                day,
            });
        }
        let next_cursor = if days.len() > limit {
            days.truncate(limit);
            days.last().map(|d| d.day.clone())
        } else {
            None
        };
        Ok(DayPage { days, next_cursor })
    }

    /// What is blocking the team right now: each member's LATEST update, if
    /// it names a blocker. An old blocker someone has since posted past is
    /// not current. Newest day first, then by author.
    #[app::view]
    pub fn current_blockers(&self) -> app::Result<Vec<UpdateView>> {
        let mut out = Vec::new();
        for account in self.all_people()? {
            if let Some(u) = self.latest_of(&account)? {
                if u.is_blocked {
                    out.push(self.update_view(u)?);
                }
            }
        }
        out.sort_by(|a, b| b.day.cmp(&a.day).then_with(|| a.author.cmp(&b.author)));
        Ok(out)
    }

    /// Everyone who has an update or a chosen name, with the latest day they
    /// posted for, ordered by account. The UI uses it for "still to post today".
    ///
    /// Not the org's membership: a member who never touched the app is not in
    /// here (the org lists them: `client.listMembers`).
    #[app::view]
    pub fn members(&self) -> app::Result<Vec<MemberView>> {
        let mut out = Vec::new();
        for account in self.all_people()? {
            let last_day = self.latest_of(&account)?.map(|u| u.day).unwrap_or_default();
            let name = self.name_of(&account)?;
            if !last_day.is_empty() || !name.is_empty() {
                out.push(MemberView {
                    account,
                    name,
                    last_day,
                });
            }
        }
        Ok(out)
    }

    // ── decisions ───────────────────────────────────────────────────────────

    /// Record a decision as the caller and return its id (32 hex characters).
    ///
    /// `supersedes` names the decision this one replaces: it must exist and
    /// still stand (`NoSuchDecision`, `AlreadySuperseded`). `tags`, `with`
    /// (accounts involved) and `fromDay` (the standup day it came out of) are
    /// written with it. A decision is never changed afterwards: changing course
    /// is a new decision. Emits `DecisionLogged`.
    #[allow(clippy::too_many_arguments)]
    pub fn log_decision(
        &mut self,
        title: String,
        decision: String,
        rationale: String,
        supersedes: Option<String>,
        tags: Vec<String>,
        with: Vec<String>,
        from_day: Option<String>,
    ) -> app::Result<String> {
        check_required("title", &title, MAX_TITLE)?;
        check_required("decision", &decision, MAX_BODY)?;
        check_len("rationale", &rationale, MAX_BODY)?;
        let tags = normalize_tags(tags)?;
        let with = normalize_with(with)?;
        let from_day = from_day.filter(|d| !d.trim().is_empty());
        if let Some(day) = &from_day {
            check_day(day)?;
        }
        let supersedes = supersedes.filter(|s| !s.trim().is_empty());
        if let Some(old) = &supersedes {
            if !self.decisions.contains(old)? {
                return Err(Error::NoSuchDecision { id: old.clone() }.into());
            }
            if let Some(by) = self.replaced_by.get(old)? {
                return Err(Error::AlreadySuperseded {
                    id: old.clone(),
                    by,
                }
                .into());
            }
        }

        let id = hex(&env::random_bytes(16));
        let created_at = env::time_now();
        for tag in &tags {
            self.decision_tags.insert(DecisionTag {
                tag: tag.clone(),
                decision: id.clone(),
                created_at,
            })?;
            let _ = self.tag_names.insert(tag)?;
        }
        if let Some(old) = &supersedes {
            let _ = self.replaced_by.insert(old, &id)?;
        }
        if !tags.is_empty() || !with.is_empty() {
            let _ = self
                .decision_notes
                .insert(&id, &DecisionNotes { tags, with })?;
        }
        self.decisions.insert(Decision {
            id: id.clone(),
            author: me()?,
            title: title.trim().to_owned(),
            decision: decision.trim().to_owned(),
            rationale: rationale.trim().to_owned(),
            supersedes,
            created_at,
            from_day,
        })?;
        env::emit(Event::DecisionLogged { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// One decision by id; `NoSuchDecision` when there is none.
    #[app::view]
    pub fn get_decision(&self, id: String) -> app::Result<DecisionView> {
        match self.decisions.get(&id)? {
            Some(d) => self.decision_view(d),
            None => Err(Error::NoSuchDecision { id }.into()),
        }
    }

    /// The log, newest first. `search` keeps decisions whose title, text,
    /// rationale or tags contain it (case-insensitive); `tag` keeps those
    /// carrying exactly that tag; `fromDay` those logged from that standup
    /// day; `standingOnly` drops the superseded ones. `cursor` is the previous
    /// page's `nextCursor`. A tag or day filter reads only that slice of the
    /// log; `search` and `standingOnly` read through the rest.
    #[app::view]
    #[allow(clippy::too_many_arguments)]
    pub fn list_decisions(
        &self,
        search: Option<String>,
        tag: Option<String>,
        from_day: Option<String>,
        standing_only: bool,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<DecisionPage> {
        let tag = tag
            .map(|t| t.trim().to_lowercase())
            .filter(|t| !t.is_empty());
        let from_day = from_day.filter(|d| !d.trim().is_empty());
        let needle = search
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());
        let cursor = cursor.filter(|c| !c.is_empty());
        let limit = page_size(limit);

        let mut past_cursor = cursor.is_none();
        let mut items: Vec<DecisionView> = Vec::new();
        let mut keep = |d: Decision| -> app::Result<bool> {
            if !past_cursor {
                past_cursor = cursor.as_deref() == Some(d.id.as_str());
                return Ok(true);
            }
            if from_day
                .as_ref()
                .is_some_and(|day| d.from_day.as_ref() != Some(day))
            {
                return Ok(true);
            }
            let view = self.decision_view(d)?;
            let matches = tag.as_ref().is_none_or(|t| view.tags.contains(t))
                && needle.as_deref().is_none_or(|n| {
                    [&view.title, &view.decision, &view.rationale]
                        .iter()
                        .any(|f| f.to_lowercase().contains(n))
                        || view.tags.iter().any(|t| t.contains(n))
                })
                && !(standing_only && !view.superseded_by.is_empty());
            if !matches {
                return Ok(true);
            }
            items.push(view);
            Ok(items.len() <= limit)
        };
        if let Some(t) = &tag {
            each_row(
                |o| {
                    self.decision_tags
                        .find("tagFeed", &[t.to_key_part()], o.reverse())
                },
                |row| match self.decisions.get(&row.decision)? {
                    Some(d) => keep(d),
                    None => Ok(true),
                },
            )?;
        } else if let Some(day) = &from_day {
            each_row(
                |o| {
                    self.decisions
                        .find("byDay", &[Some(day).to_key_part()], o.reverse())
                },
                &mut keep,
            )?;
        } else {
            each_row(|o| self.decisions.find("feed", &[], o.reverse()), &mut keep)?;
        }
        let next_cursor = if items.len() > limit {
            items.truncate(limit);
            items.last().map(|v| v.id.clone())
        } else {
            None
        };
        Ok(DecisionPage { items, next_cursor })
    }

    /// Every tag in the log with how many decisions carry it, most used first.
    #[app::view]
    pub fn tags(&self) -> app::Result<Vec<TagCount>> {
        let mut out = Vec::new();
        each_row(
            |o| self.tag_names.page(o),
            |tag| {
                let count = count32(self.decision_tags.count("perTag", &[tag.to_key_part()])?);
                out.push(TagCount { tag, count });
                Ok(true)
            },
        )?;
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
        Ok(out)
    }

    // ── helping with blockers ───────────────────────────────────────────────

    /// Offer to help with `author`'s blocker on `day`, or change your note.
    /// The update has to exist (`NoSuchUpdate`) and name a blocker
    /// (`NoBlocker`), and you cannot offer yourself help (`OwnBlocker`). The
    /// offer is the caller's own row. Emits `HelpOffered`.
    pub fn offer_help(&mut self, day: String, author: String, note: String) -> app::Result<()> {
        check_len("note", &note, MAX_HELP)?;
        let helper = me()?;
        if author == helper {
            return Err(Error::OwnBlocker.into());
        }
        match self.updates.get(&(day.clone(), author.clone()))? {
            Some(u) if u.is_blocked => {}
            Some(_) => return Err(Error::NoBlocker { day, author }.into()),
            None => return Err(Error::NoSuchUpdate { day, author }.into()),
        }
        self.helps.upsert(Help {
            day: day.clone(),
            author: author.clone(),
            helper,
            note: note.trim().to_owned(),
            at: env::time_now(),
        })?;
        env::emit(Event::HelpOffered { day, author }, Audience::All)?;
        Ok(())
    }

    /// Take back the caller's own offer on `author`'s update for `day`;
    /// `NoHelp` when the caller has made none there. Emits `HelpWithdrawn`.
    pub fn withdraw_help(&mut self, day: String, author: String) -> app::Result<()> {
        let helper = me()?;
        if !self.helps.remove(&(day.clone(), author.clone(), helper))? {
            return Err(Error::NoHelp { day, author }.into());
        }
        env::emit(Event::HelpWithdrawn { day, author }, Audience::All)?;
        Ok(())
    }

    // ── the week ────────────────────────────────────────────────────────────

    /// Seven days of standups starting at `start`, oldest first: the weekly
    /// digest in one call instead of seven.
    #[app::view]
    pub fn get_week(&self, start: String) -> app::Result<Vec<DayView>> {
        let mut day = parse_day(&start).ok_or_else(|| AppError::from(not_a_date(&start)))?;
        let mut days = Vec::with_capacity(7);
        for _ in 0..7 {
            days.push(self.get_day(format!("{:04}-{:02}-{:02}", day.0, day.1, day.2))?);
            day = next_day(day);
        }
        Ok(days)
    }

    // ── the team ────────────────────────────────────────────────────────────

    /// Name the team. Any member may; an empty name clears it. Emits
    /// `TeamRenamed`.
    pub fn set_team_name(&mut self, name: String) -> app::Result<()> {
        let name = name.trim().to_owned();
        check_len("teamName", &name, MAX_TEAM_NAME)?;
        if name.is_empty() {
            self.team.clear()?;
        } else {
            self.team.set(&name)?;
        }
        env::emit(Event::TeamRenamed { name }, Audience::All)?;
        Ok(())
    }

    /// The team's name, or "" if nobody has named it.
    #[app::view]
    pub fn team_name(&self) -> app::Result<String> {
        Ok(self.team.get()?.unwrap_or_default())
    }

    // ── names ───────────────────────────────────────────────────────────────

    /// Claim a display name for the calling account; an empty name clears it.
    /// No `account` argument: you can only name yourself. Emits `ProfileSet`.
    pub fn set_name(&mut self, name: String) -> app::Result<()> {
        let trimmed = name.trim();
        let account = if trimmed.is_empty() {
            let _ = self.profiles.remove()?;
            me()?
        } else {
            check_len("name", trimmed, MAX_NAME)?;
            let account = self.profiles.set(&Profile {
                name: trimmed.to_owned(),
                updated_at: env::time_now(),
            })?;
            let _ = self.people.insert(&account)?;
            account
        };
        env::emit(Event::ProfileSet { account }, Audience::All)?;
        Ok(())
    }

    /// The name `account` chose, or "".
    #[app::view]
    pub fn get_name(&self, account: String) -> app::Result<String> {
        self.name_of(&account)
    }

    // ── internal ────────────────────────────────────────────────────────────

    fn name_of(&self, account: &str) -> app::Result<String> {
        Ok(self
            .profiles
            .get_for(account)?
            .map(|p| p.name)
            .unwrap_or_default())
    }

    fn all_people(&self) -> app::Result<Vec<String>> {
        let mut out = Vec::new();
        each_row(
            |o| self.people.page(o),
            |a| {
                out.push(a);
                Ok(true)
            },
        )?;
        Ok(out)
    }

    /// `account`'s newest update.
    fn latest_of(&self, account: &str) -> app::Result<Option<Update>> {
        Ok(self
            .updates
            .find(
                "byAuthor",
                &[account.to_key_part()],
                FindOpts::default().reverse().limit(1),
            )?
            .items
            .pop())
    }

    /// Everyone who offered help on `author`'s update for `day`, oldest offer
    /// first.
    fn helpers_of(&self, day: &str, author: &str) -> app::Result<Vec<HelpView>> {
        let mut out = Vec::new();
        each_row(
            |o| {
                self.helps
                    .find("onUpdate", &[day.to_key_part(), author.to_key_part()], o)
            },
            |h| {
                out.push(HelpView {
                    name: self.name_of(&h.helper)?,
                    account: h.helper,
                    note: h.note,
                    at: h.at,
                });
                Ok(true)
            },
        )?;
        out.sort_by(|a, b| (a.at, &a.account).cmp(&(b.at, &b.account)));
        Ok(out)
    }

    fn update_view(&self, u: Update) -> app::Result<UpdateView> {
        let helpers = if u.is_blocked {
            self.helpers_of(&u.day, &u.author)?
        } else {
            Vec::new()
        };
        Ok(UpdateView {
            helpers,
            author_name: self.name_of(&u.author)?,
            day: u.day,
            author: u.author,
            done: u.done,
            next: u.next,
            blockers: u.blockers,
            created_at: u.created_at,
            edited_at: u.edited_at,
        })
    }

    fn decision_view(&self, d: Decision) -> app::Result<DecisionView> {
        let notes = self.decision_notes.get(&d.id)?.unwrap_or_default();
        let mut with = Vec::with_capacity(notes.with.len());
        for account in notes.with {
            with.push(PersonView {
                name: self.name_of(&account)?,
                account,
            });
        }
        Ok(DecisionView {
            superseded_by: self.replaced_by.get(&d.id)?.unwrap_or_default(),
            author_name: self.name_of(&d.author)?,
            supersedes: d.supersedes.unwrap_or_default(),
            from_day: d.from_day.unwrap_or_default(),
            id: d.id,
            author: d.author,
            title: d.title,
            decision: d.decision,
            rationale: d.rationale,
            created_at: d.created_at,
            tags: notes.tags,
            with,
        })
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// `day` is not a real date written `YYYY-MM-DD`.
    NotADate {
        day: String,
    },
    /// `field` is longer than `limit` bytes.
    TooLong {
        field: String,
        limit: u32,
    },
    /// `field` must say something (`"update"`: at least one of its fields).
    Empty {
        field: String,
    },
    /// More than `limit` entries in `field`.
    TooMany {
        field: String,
        limit: u32,
    },
    /// The caller has no update for `day` (`clearUpdate`).
    NoUpdate {
        day: String,
    },
    /// `author` has no update for `day` (`offerHelp`).
    NoSuchUpdate {
        day: String,
        author: String,
    },
    /// That update names no blocker.
    NoBlocker {
        day: String,
        author: String,
    },
    /// Nobody offers help on their own blocker.
    OwnBlocker,
    /// The caller has not offered help on that update.
    NoHelp {
        day: String,
        author: String,
    },
    NoSuchDecision {
        id: String,
    },
    /// Decision `id` was already superseded by `by`.
    AlreadySuperseded {
        id: String,
        by: String,
    },
}

/// A change to the team, emitted after the write that caused it, to everyone
/// the app reaches.
#[app::event]
pub enum Event {
    UpdatePosted { day: String, account: String },
    UpdateCleared { day: String, account: String },
    DecisionLogged { id: String },
    ProfileSet { account: String },
    TeamRenamed { name: String },
    HelpOffered { day: String, author: String },
    HelpWithdrawn { day: String, author: String },
}

/// The caller's account; `LoginRequired` for anything that is not an account.
fn me() -> app::Result<String> {
    match env::caller() {
        Caller::Account(a) | Caller::ApiKey { account: a, .. } => Ok(a),
        _ => Err(AppError::login_required()),
    }
}

fn not_a_date(day: &str) -> Error {
    Error::NotADate {
        day: day.to_owned(),
    }
}

fn check_day(day: &str) -> app::Result<()> {
    match parse_day(day) {
        Some(_) => Ok(()),
        None => Err(not_a_date(day).into()),
    }
}

fn check_len(field: &str, value: &str, max: usize) -> app::Result<()> {
    if value.len() > max {
        return Err(Error::TooLong {
            field: field.to_owned(),
            limit: max as u32,
        }
        .into());
    }
    Ok(())
}

fn check_required(field: &str, value: &str, max: usize) -> app::Result<()> {
    if value.trim().is_empty() {
        return Err(Error::Empty {
            field: field.to_owned(),
        }
        .into());
    }
    check_len(field, value, max)
}

/// Tags as stored: trimmed, lower-case, inner whitespace collapsed to `-`,
/// de-duplicated and sorted, so `"Infra"` and `" infra "` are one tag.
fn normalize_tags(tags: Vec<String>) -> app::Result<Vec<String>> {
    let mut out: Vec<String> = tags
        .iter()
        .map(|t| {
            t.split_whitespace()
                .collect::<Vec<_>>()
                .join("-")
                .to_lowercase()
        })
        .filter(|t| !t.is_empty())
        .collect();
    out.sort();
    out.dedup();
    if out.len() > MAX_TAGS {
        return Err(Error::TooMany {
            field: "tags".into(),
            limit: MAX_TAGS as u32,
        }
        .into());
    }
    for t in &out {
        check_len("tag", t, MAX_TAG)?;
    }
    Ok(out)
}

/// Accounts named in a decision: trimmed, blanks dropped, de-duplicated, sorted.
fn normalize_with(with: Vec<String>) -> app::Result<Vec<String>> {
    if with.len() > MAX_WITH {
        return Err(Error::TooMany {
            field: "with".into(),
            limit: MAX_WITH as u32,
        }
        .into());
    }
    let mut out = Vec::with_capacity(with.len());
    for account in with {
        let account = account.trim().to_owned();
        if account.is_empty() {
            continue;
        }
        check_len("with", &account, MAX_ACCOUNT)?;
        out.push(account);
    }
    out.sort();
    out.dedup();
    Ok(out)
}
