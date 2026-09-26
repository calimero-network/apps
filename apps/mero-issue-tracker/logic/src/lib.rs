//! Issue-tracker service — a private, real-time issue board for a small team.
//!
//! One shared Calimero context holding every issue and comment. Demonstrates the
//! core patterns:
//!
//! - `#[app::state]` / `#[app::logic]` / `#[app::init]`
//! - `Authored<IndexedMap<String, IssueHeader>>` — who filed each issue, and its
//!   title. Owned by the filer: only they can delete the issue, and the creator
//!   shown is the owner stamp, which a patched node cannot forge.
//! - `IndexedMap<String, Issue>` — the shared triage state (anyone may triage),
//!   indexed by status and assignee so a board column is a seek.
//! - `Authored<IndexedMap<String, Comment>>` — the discussion threads. Each
//!   comment is owned by its author; the `LwwRegister`s nested in it are owned
//!   by that author too, so only they can edit it, on every node.
//! - `IndexedMap<String, LabelTag>` — one row per (issue, label), keyed
//!   `issue_id\u{1}label` so concurrent adds of the same label converge to one
//!   entry, indexed both ways so "labels of an issue" and "issues with a label"
//!   are seeks.
//! - `LwwRegister<T>` for every mutable issue/comment field so concurrent edits
//!   converge LWW, and hand-written `Mergeable` on the CRDT-nesting `Issue` /
//!   `Comment` map values (#2577 nested-register re-keying).
//! - `app::emit!`, named-struct returns (no tuples — ABI-safe views).
//!
//! # What every node enforces, and what it does not
//!
//! A member can run a patched node that skips every check in these methods. The
//! checks only make a refused write fail early; the storage types above are what
//! hold. Triage state and labels are public ON PURPOSE — any teammate may move,
//! re-prioritise, re-assign or relabel an issue — so a patched node can rewrite
//! or remove them, exactly as an honest teammate could rewrite them. A missing
//! triage row reads, and is re-created, as a fresh `Open` issue: the issue
//! itself lives in its owned header, which only its filer can remove.

use std::collections::BTreeSet;

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::env;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::AccountId;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{Authored, IndexedMap, LwwRegister, Mergeable, StoreError};
use calimero_storage::env as storage_env;
use issue_tracker_types::{generate_id, validate_label, Error};

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

/// Allowed issue statuses (also the fixed column order for the board).
const STATUSES: [&str; 4] = ["Open", "In progress", "Blocked", "Done"];
/// Allowed issue priorities.
const PRIORITIES: [&str; 4] = ["low", "medium", "high", "urgent"];
/// Separator embedded in a label-index key: `"{issue_id}\u{1}{label}"`. Control
/// char so it cannot appear in a normal label (labels are validated to reject
/// it defensively).
const LABEL_SEP: char = '\u{1}';

// ---------------------------------------------------------------------------
// Data models (internal, Borsh-only — they nest CRDTs; callers get *View structs)
// ---------------------------------------------------------------------------

/// Who filed an issue, and what they called it. Set once at creation. The filer
/// is the entry's owner stamp, not a field, so nobody can re-attribute an issue.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct IssueHeader {
    pub title: String,
    #[index]
    pub created_at: u64,
}

/// An issue's shared triage state. Every field is a `LwwRegister` so concurrent
/// edits converge last-writer-wins. Labels live in a separate index (see
/// `IssueTracker`).
#[app::mergeable(id = "mero_issue_tracker::Issue")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Issue {
    pub summary: LwwRegister<String>,
    pub impact: LwwRegister<String>,
    pub repro: LwwRegister<String>,
    pub resolution_criteria: LwwRegister<String>,
    #[index]
    pub status: LwwRegister<String>,
    pub priority: LwwRegister<String>,
    #[index]
    pub assignee: LwwRegister<Option<String>>,
}

impl Issue {
    /// The triage state an issue starts with, and the one a row removed by a
    /// peer reads as.
    fn open(
        summary: String,
        impact: String,
        repro: String,
        resolution_criteria: String,
        priority: String,
    ) -> Self {
        Issue {
            summary: LwwRegister::new(summary),
            impact: LwwRegister::new(impact),
            repro: LwwRegister::new(repro),
            resolution_criteria: LwwRegister::new(resolution_criteria),
            status: LwwRegister::new(STATUSES[0].to_string()),
            priority: LwwRegister::new(priority),
            assignee: LwwRegister::new(None),
        }
    }

    fn missing() -> Self {
        Self::open(
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            PRIORITIES[0].to_string(),
        )
    }
}

impl Mergeable for Issue {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Nested registers merge by HLC last-writer-wins.
        self.summary.merge(&other.summary);
        self.impact.merge(&other.impact);
        self.repro.merge(&other.repro);
        self.resolution_criteria.merge(&other.resolution_criteria);
        self.status.merge(&other.status);
        self.priority.merge(&other.priority);
        self.assignee.merge(&other.assignee);
        Ok(())
    }
}

/// A discussion entry on an issue. `id`, `issue_id`, `created_at` are
/// immutable; `body` and `edited_at` are LWW registers. The author is the
/// entry's owner stamp, and only they may edit or delete it — on every node.
/// `thread` is one issue's comments, oldest first.
#[app::mergeable(id = "mero_issue_tracker::Comment")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
#[index(thread(issue_id, created_at))]
pub struct Comment {
    pub id: String,
    pub issue_id: String,
    pub body: LwwRegister<String>,
    pub created_at: u64,
    pub edited_at: LwwRegister<Option<u64>>,
}

impl Mergeable for Comment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Deterministic tie-break for the set-once fields so merge is
        // commutative even if the author's two devices raced the insert.
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.issue_id = other.issue_id.clone();
            self.created_at = other.created_at;
        }
        self.body.merge(&other.body);
        self.edited_at.merge(&other.edited_at);
        Ok(())
    }
}

/// One label on one issue.
#[derive(Debug, BorshSerialize, BorshDeserialize, AbiType, app::Mergeable, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct LabelTag {
    #[index]
    pub issue_id: LwwRegister<String>,
    #[index]
    pub label: LwwRegister<String>,
    pub added_at: LwwRegister<u64>,
}

// ---------------------------------------------------------------------------
// Read-shaped views returned to callers (serde-able, ABI-expressible)
// ---------------------------------------------------------------------------

/// An issue as returned to the frontend/scripts.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct IssueView {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub impact: String,
    pub repro: String,
    pub resolution_criteria: String,
    /// One of Open, In progress, Blocked, Done.
    pub status: String,
    /// One of low, medium, high, urgent.
    pub priority: String,
    /// Free text; null when unassigned.
    pub assignee: Option<String>,
    /// Sorted.
    pub labels: Vec<String>,
    /// The creator's account id (64 hex).
    pub created_by: String,
    /// Unix milliseconds.
    pub created_at: u64,
}

/// A comment as returned to the frontend/scripts.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentView {
    pub id: String,
    pub issue_id: String,
    /// The writer's account id (64 hex); only this identity may edit or delete.
    pub author: String,
    pub body: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Unix milliseconds of the last edit, or null.
    pub edited_at: Option<u64>,
}

/// A full issue plus its comment thread (named struct — never a tuple return).
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct IssueDetail {
    pub issue: IssueView,
    pub comments: Vec<CommentView>,
}

/// One board column's live count (named struct — never a `(String, u64)` tuple).
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct StatusCount {
    /// One of Open, In progress, Blocked, Done.
    pub status: String,
    pub count: u64,
}

/// This context's repository metadata. `repo_url` is empty until `set_repo_url`.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct RepoInfo {
    pub repo_url: String,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct IssueTracker {
    /// Issue id → header, owned by whoever filed it. An issue exists while its
    /// header does.
    headers: Authored<IndexedMap<String, IssueHeader>>,
    /// Issue id → triage state. Shared — any teammate may triage.
    issues: IndexedMap<String, Issue>,
    /// All comments across all issues, keyed by generated id, each owned by
    /// its author.
    comments: Authored<IndexedMap<String, Comment>>,
    /// Key `"{issue_id}\u{1}{label}"` → the label. Concurrent adds of the same
    /// label collapse to one entry (no duplicates); removal is a conflict-free
    /// key delete.
    labels: IndexedMap<String, LabelTag>,
    /// The GitHub repository URL this context (repo) tracks. Empty until set;
    /// LWW so concurrent edits from teammates converge last-writer-wins.
    repo_url: LwwRegister<String>,
}

/// A storage error, named by the call that raised it.
fn store_err(what: &'static str) -> impl FnOnce(StoreError) -> AppError {
    move |e| AppError::msg(format!("{what}: {e}"))
}

#[app::logic]
impl IssueTracker {
    /// Create an empty issue board for one repository. Runs once, when the repo's
    /// context is created; takes no arguments.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    #[app::init]
    pub fn init() -> IssueTracker {
        IssueTracker {
            headers: Authored::new_with_field_name("issue_tracker:headers"),
            issues: IndexedMap::new_with_field_name("issue_tracker:issues"),
            comments: Authored::new_with_field_name("issue_tracker:comments"),
            labels: IndexedMap::new_with_field_name("issue_tracker:labels"),
            repo_url: LwwRegister::new(String::new()),
        }
    }

    /// Set or change the repository URL this context tracks. Any member may call it.
    ///
    /// # Errors
    /// Fails if `url` is empty or does not start with `http://` or `https://`.
    ///
    /// # Examples
    /// ```json
    /// {"url":"https://github.com/calimero-network/apps"}
    /// ```
    pub fn set_repo_url(&mut self, url: String) -> app::Result<()> {
        validate_repo_url(&url)?;
        self.repo_url.set(url.clone());

        app::emit!(Event::RepoUrlChanged { url: &url });
        Ok(())
    }

    /// This context's repository URL (`repo_url`), empty until `set_repo_url`.
    ///
    /// # Returns
    /// `{"repo_url"}`, empty until set.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_repo_info(&self) -> app::Result<RepoInfo> {
        Ok(RepoInfo {
            repo_url: self.repo_url.get().clone(),
        })
    }

    /// File an issue and return its id (`issue-<ms>-<8 hex>`). New issues start in status `Open`.
    ///
    /// # Arguments
    /// * `title` - 1 to 64 characters.
    /// * `summary` - what is wrong, in a sentence or two; must not be empty.
    /// * `impact` - who or what it affects and how badly; must not be empty.
    /// * `repro` - steps, logs or conditions that trigger it; must not be empty.
    /// * `resolution_criteria` - what "fixed" must satisfy; must not be empty.
    /// * `priority` - `low`, `medium`, `high` or `urgent`.
    /// * `labels` - optional; each 1 to 64 characters.
    ///
    /// # Returns
    /// The new issue's id, `issue-<ms>-<8 hex>`.
    ///
    /// # Errors
    /// Fails if a text field is empty, `title` or a label is longer than 64 characters,
    /// or `priority` is not one of the four values.
    ///
    /// # Examples
    /// ```json
    /// {"title":"Flaky CI","summary":"The e2e job fails intermittently.","impact":"Merges are blocked.","repro":"Re-run the e2e job on main.","resolution_criteria":"Ten consecutive green runs.","priority":"high","labels":["ci"]}
    /// ```
    //
    // Scoped allow, not a refactor. The monorepo gates `clippy -D warnings`
    // where this app's own CI ran plain `clippy`, so 8/7 arguments became an
    // error on the move. Collapsing them into a params struct is the lint's
    // suggestion and it would CHANGE THE ABI: each argument is a named field in
    // the generated client and in every merobox `args:` payload, so the rename
    // would break the committed IssueTrackerClient and every scenario at once.
    // The ABI is the public contract; the lint is a style heuristic.
    #[allow(clippy::too_many_arguments)]
    pub fn create_issue(
        &mut self,
        title: String,
        summary: String,
        impact: String,
        repro: String,
        resolution_criteria: String,
        priority: String,
        labels: Option<Vec<String>>,
    ) -> app::Result<String> {
        validate_label("title", &title).map_err(AppError::from)?;
        validate_section("summary", &summary)?;
        validate_section("impact", &impact)?;
        validate_section("repro", &repro)?;
        validate_section("resolution_criteria", &resolution_criteria)?;
        validate_priority(&priority)?;
        let labels = labels.unwrap_or_default();
        for label in &labels {
            validate_user_label(label)?;
        }

        let now = storage_env::time_now() / 1_000_000;
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let id = generate_id("issue", now, &nonce);
        let created_by = caller();

        self.headers
            .insert(
                id.clone(),
                IssueHeader {
                    title,
                    created_at: now,
                },
            )
            .map_err(store_err("headers.insert"))?;
        let _ = self
            .issues
            .insert(
                id.clone(),
                Issue::open(summary, impact, repro, resolution_criteria, priority),
            )
            .map_err(store_err("issues.insert"))?;

        for label in labels {
            self.put_label(&id, label, now)?;
        }

        app::emit!(Event::IssueCreated {
            id: &id,
            created_by: &created_by,
        });
        Ok(id)
    }

    /// Move an issue to another status column.
    ///
    /// # Arguments
    /// * `status` - exactly `Open`, `In progress`, `Blocked` or `Done`.
    ///
    /// # Errors
    /// Fails if the issue does not exist or `status` is not one of the four values.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","status":"In progress"}
    /// ```
    pub fn set_status(&mut self, issue_id: String, status: String) -> app::Result<()> {
        validate_status(&status)?;
        self.triage(&issue_id, |issue| issue.status.set(status.clone()))?;

        app::emit!(Event::IssueStatusChanged {
            id: &issue_id,
            status: &status,
        });
        Ok(())
    }

    /// Replace an issue's summary.
    ///
    /// # Errors
    /// Fails if the issue does not exist or `summary` is empty.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","summary":"Fails on every third run."}
    /// ```
    pub fn set_summary(&mut self, issue_id: String, summary: String) -> app::Result<()> {
        validate_section("summary", &summary)?;
        self.triage(&issue_id, |issue| issue.summary.set(summary))?;

        app::emit!(Event::IssueEdited { id: &issue_id });
        Ok(())
    }

    /// Replace an issue's impact.
    ///
    /// # Errors
    /// Fails if the issue does not exist or `impact` is empty.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","impact":"Every merge waits for a manual re-run."}
    /// ```
    pub fn set_impact(&mut self, issue_id: String, impact: String) -> app::Result<()> {
        validate_section("impact", &impact)?;
        self.triage(&issue_id, |issue| issue.impact.set(impact))?;

        app::emit!(Event::IssueEdited { id: &issue_id });
        Ok(())
    }

    /// Replace an issue's reproduction steps.
    ///
    /// # Errors
    /// Fails if the issue does not exist or `repro` is empty.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","repro":"Run the e2e job three times on main."}
    /// ```
    pub fn set_repro(&mut self, issue_id: String, repro: String) -> app::Result<()> {
        validate_section("repro", &repro)?;
        self.triage(&issue_id, |issue| issue.repro.set(repro))?;

        app::emit!(Event::IssueEdited { id: &issue_id });
        Ok(())
    }

    /// Replace an issue's resolution criteria.
    ///
    /// # Errors
    /// Fails if the issue does not exist or `resolution_criteria` is empty.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","resolution_criteria":"Twenty consecutive green runs."}
    /// ```
    pub fn set_resolution_criteria(
        &mut self,
        issue_id: String,
        resolution_criteria: String,
    ) -> app::Result<()> {
        validate_section("resolution_criteria", &resolution_criteria)?;
        self.triage(&issue_id, |issue| {
            issue.resolution_criteria.set(resolution_criteria)
        })?;

        app::emit!(Event::IssueEdited { id: &issue_id });
        Ok(())
    }

    /// Change an issue's priority.
    ///
    /// # Arguments
    /// * `priority` - `low`, `medium`, `high` or `urgent`.
    ///
    /// # Errors
    /// Fails if the issue does not exist or `priority` is not one of the four values.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","priority":"urgent"}
    /// ```
    pub fn set_priority(&mut self, issue_id: String, priority: String) -> app::Result<()> {
        validate_priority(&priority)?;
        self.triage(&issue_id, |issue| issue.priority.set(priority.clone()))?;

        app::emit!(Event::IssuePriorityChanged {
            id: &issue_id,
            priority: &priority,
        });
        Ok(())
    }

    /// Set or clear an issue's assignee.
    ///
    /// # Arguments
    /// * `assignee` - free text, conventionally a workspace member's account id; `null` clears it.
    ///
    /// # Errors
    /// Fails if the issue does not exist.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","assignee":"<account id>"}
    /// ```
    pub fn set_assignee(&mut self, issue_id: String, assignee: Option<String>) -> app::Result<()> {
        self.triage(&issue_id, |issue| issue.assignee.set(assignee))?;

        app::emit!(Event::IssueAssigneeChanged { id: &issue_id });
        Ok(())
    }

    /// Add a label to an issue. Adding it twice, even concurrently, keeps one.
    ///
    /// # Arguments
    /// * `label` - 1 to 64 characters.
    ///
    /// # Errors
    /// Fails if the issue does not exist or the label is empty or too long.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","label":"ci"}
    /// ```
    pub fn add_label(&mut self, issue_id: String, label: String) -> app::Result<()> {
        validate_user_label(&label)?;
        if !self.issue_exists(&issue_id)? {
            app::bail!(Error::NotFound(issue_id));
        }
        let now = storage_env::time_now() / 1_000_000;
        self.put_label(&issue_id, label, now)?;

        app::emit!(Event::IssueLabelsChanged { id: &issue_id });
        Ok(())
    }

    /// Remove a label from an issue; removing one it lacks succeeds.
    ///
    /// # Errors
    /// Fails if the issue does not exist.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","label":"ci"}
    /// ```
    pub fn remove_label(&mut self, issue_id: String, label: String) -> app::Result<()> {
        if !self.issue_exists(&issue_id)? {
            app::bail!(Error::NotFound(issue_id));
        }
        let _ = self
            .labels
            .remove(&label_key(&issue_id, &label))
            .map_err(store_err("labels.remove"))?;

        app::emit!(Event::IssueLabelsChanged { id: &issue_id });
        Ok(())
    }

    /// List issues, oldest first, optionally filtered.
    ///
    /// # Arguments
    /// * `status` - keep only this exact status, or `null` for all.
    /// * `assignee` - keep only this exact assignee, or `null` for all.
    /// * `label` - keep only issues with this label, or `null` for all.
    ///
    /// # Returns
    /// The matching issues, oldest first.
    ///
    /// # Examples
    /// ```json
    /// {"status":"Open","assignee":null,"label":null}
    /// ```
    pub fn list_issues(
        &self,
        status: Option<String>,
        assignee: Option<String>,
        label: Option<String>,
    ) -> app::Result<Vec<IssueView>> {
        let ids: BTreeSet<String> = if let Some(status) = &status {
            self.issues
                .query("status")
                .eq(status.as_str())
                .keys()
                .map_err(store_err("issues.query"))?
                .into_iter()
                .collect()
        } else if let Some(assignee) = &assignee {
            self.issues
                .query("assignee")
                .eq(assignee.as_str())
                .keys()
                .map_err(store_err("issues.query"))?
                .into_iter()
                .collect()
        } else if let Some(label) = &label {
            self.labels
                .query("label")
                .eq(label.as_str())
                .entries()
                .map_err(store_err("labels.query"))?
                .into_iter()
                .map(|(_, tag)| tag.issue_id.get().clone())
                .collect()
        } else {
            self.headers
                .entries()
                .map_err(store_err("headers.entries"))?
                .map(|(id, _)| id)
                .collect()
        };

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            // A triage or label row with no header is not an issue.
            let Some(view) = self.issue_view(id)? else {
                continue;
            };
            if status.as_ref().is_some_and(|s| &view.status != s) {
                continue;
            }
            if assignee
                .as_ref()
                .is_some_and(|a| view.assignee.as_deref() != Some(a.as_str()))
            {
                continue;
            }
            if label
                .as_ref()
                .is_some_and(|l| !view.labels.iter().any(|x| x == l))
            {
                continue;
            }
            out.push(view);
        }

        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    /// One issue with its comment thread, oldest comment first.
    ///
    /// # Returns
    /// The issue and its comments, oldest comment first.
    ///
    /// # Errors
    /// Fails if the issue does not exist.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>"}
    /// ```
    pub fn get_issue(&self, issue_id: String) -> app::Result<IssueDetail> {
        let issue = self
            .issue_view(issue_id.clone())?
            .ok_or_else(|| AppError::from(Error::NotFound(issue_id.clone())))?;

        let mut comments = Vec::new();
        for (id, c) in self
            .comments
            .query("thread")
            .eq(&issue_id)
            .entries()
            .map_err(store_err("comments.query"))?
        {
            let author = self
                .comments
                .owner_of(&id)
                .map_err(store_err("comments.owner_of"))?
                .map(|a| a.to_string())
                .unwrap_or_default();
            comments.push(CommentView {
                id,
                issue_id: c.issue_id,
                author,
                body: c.body.get().clone(),
                created_at: c.created_at,
                edited_at: *c.edited_at.get(),
            });
        }
        comments.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));

        Ok(IssueDetail { issue, comments })
    }

    /// Issue counts per status, in board column order: Open, In progress, Blocked, Done.
    ///
    /// # Returns
    /// Four `{"status", "count"}` rows in column order.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_status_counts(&self) -> app::Result<Vec<StatusCount>> {
        let mut out = Vec::with_capacity(STATUSES.len());
        for status in STATUSES {
            let mut count = 0u64;
            for id in self
                .issues
                .query("status")
                .eq(status)
                .keys()
                .map_err(store_err("issues.query"))?
            {
                if self.issue_exists(&id)? {
                    count += 1;
                }
            }
            out.push(StatusCount {
                status: status.to_string(),
                count,
            });
        }
        Ok(out)
    }

    /// Post a comment to an issue's thread and return its id (`comment-<ms>-<8 hex>`).
    ///
    /// # Returns
    /// The new comment's id, `comment-<ms>-<8 hex>`.
    ///
    /// # Errors
    /// Fails if the issue does not exist or `body` is empty.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>","body":"Seen again on main."}
    /// ```
    pub fn add_comment(&mut self, issue_id: String, body: String) -> app::Result<String> {
        if body.trim().is_empty() {
            app::bail!(Error::Invalid("comment body must not be empty".into()));
        }
        if !self.issue_exists(&issue_id)? {
            app::bail!(Error::NotFound(issue_id));
        }

        let now = storage_env::time_now() / 1_000_000;
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let id = generate_id("comment", now, &nonce);

        let comment = Comment {
            id: id.clone(),
            issue_id: issue_id.clone(),
            body: LwwRegister::new(body),
            created_at: now,
            edited_at: LwwRegister::new(None),
        };
        self.comments
            .insert(id.clone(), comment)
            .map_err(store_err("comments.insert"))?;

        app::emit!(Event::CommentAdded {
            id: &id,
            issue_id: &issue_id,
        });
        Ok(id)
    }

    /// Replace a comment's text. Only its author may edit it.
    ///
    /// # Errors
    /// Fails if the comment does not exist, `new_body` is empty, or the caller is not the author.
    ///
    /// # Examples
    /// ```json
    /// {"comment_id":"<comment id>","new_body":"Seen twice on main."}
    /// ```
    pub fn edit_comment(&mut self, comment_id: String, new_body: String) -> app::Result<()> {
        if new_body.trim().is_empty() {
            app::bail!(Error::Invalid("comment body must not be empty".into()));
        }
        self.require_comment_author(&comment_id, "edit")?;
        let now = storage_env::time_now() / 1_000_000;
        self.comments
            .modify(&comment_id, |c| {
                c.body.set(new_body);
                c.edited_at.set(Some(now));
            })
            .map_err(store_err("comments.modify"))?;

        app::emit!(Event::CommentEdited { id: &comment_id });
        Ok(())
    }

    /// Delete a comment. Only its author may delete it.
    ///
    /// # Errors
    /// Fails if the comment does not exist or the caller is not the author.
    ///
    /// # Examples
    /// ```json
    /// {"comment_id":"<comment id>"}
    /// ```
    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        self.require_comment_author(&comment_id, "delete")?;
        let _ = self
            .comments
            .remove(&comment_id)
            .map_err(store_err("comments.remove"))?;

        app::emit!(Event::CommentDeleted { id: &comment_id });
        Ok(())
    }

    /// Delete an issue with its triage state, its labels and the caller's own
    /// comments on it. Only the issue's creator may delete it. Comments left by
    /// other people are not removed, but become unreachable once the issue is
    /// gone.
    ///
    /// # Errors
    /// Fails if the issue does not exist or the caller is not its creator.
    ///
    /// # Examples
    /// ```json
    /// {"issue_id":"<issue id>"}
    /// ```
    pub fn delete_issue(&mut self, issue_id: String) -> app::Result<()> {
        if !self.issue_exists(&issue_id)? {
            app::bail!(Error::NotFound(issue_id));
        }
        if !self
            .headers
            .owned_by_me(&issue_id)
            .map_err(store_err("headers.owned_by_me"))?
        {
            app::bail!(Error::Forbidden(
                "only the creator may delete this issue".into()
            ));
        }

        // Collect matching keys before removing - do not mutate while iterating.
        let mut my_comments = Vec::new();
        for id in self
            .comments
            .query("thread")
            .eq(&issue_id)
            .keys()
            .map_err(store_err("comments.query"))?
        {
            if self
                .comments
                .owned_by_me(&id)
                .map_err(store_err("comments.owned_by_me"))?
            {
                my_comments.push(id);
            }
        }
        let label_keys = self
            .labels
            .query("issue_id")
            .eq(&issue_id)
            .keys()
            .map_err(store_err("labels.query"))?;

        let _ = self
            .headers
            .remove(&issue_id)
            .map_err(store_err("headers.remove"))?;
        let _ = self
            .issues
            .remove(&issue_id)
            .map_err(store_err("issues.remove"))?;
        for id in my_comments {
            let _ = self
                .comments
                .remove(&id)
                .map_err(store_err("comments.remove"))?;
        }
        for key in label_keys {
            let _ = self
                .labels
                .remove(&key)
                .map_err(store_err("labels.remove"))?;
        }

        app::emit!(Event::IssueDeleted { id: &issue_id });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Hex of the calling ACCOUNT — the person, not the device, so the same
/// teammate can edit their comment from a laptop and a phone. It is what an
/// owner stamp names, and what the node's member list is keyed by.
fn caller() -> String {
    AccountId::from(env::account_id()).to_string()
}

impl IssueTracker {
    fn issue_exists(&self, issue_id: &str) -> app::Result<bool> {
        self.headers
            .contains(&issue_id.to_owned())
            .map_err(store_err("headers.contains"))
    }

    /// Apply a triage edit to an existing issue, re-creating its triage row
    /// first if a peer removed it.
    fn triage(&mut self, issue_id: &str, edit: impl FnOnce(&mut Issue)) -> app::Result<()> {
        if !self.issue_exists(issue_id)? {
            app::bail!(Error::NotFound(issue_id.to_owned()));
        }
        if !self
            .issues
            .contains(issue_id)
            .map_err(store_err("issues.contains"))?
        {
            let _ = self
                .issues
                .insert(issue_id.to_owned(), Issue::missing())
                .map_err(store_err("issues.insert"))?;
        }
        let _ = self
            .issues
            .update(issue_id, edit)
            .map_err(store_err("issues.update"))?;
        Ok(())
    }

    fn put_label(&mut self, issue_id: &str, label: String, now: u64) -> app::Result<()> {
        let _ = self
            .labels
            .insert(
                label_key(issue_id, &label),
                LabelTag {
                    issue_id: LwwRegister::new(issue_id.to_owned()),
                    label: LwwRegister::new(label),
                    added_at: LwwRegister::new(now),
                },
            )
            .map_err(store_err("labels.insert"))?;
        Ok(())
    }

    fn require_comment_author(&self, comment_id: &String, action: &str) -> app::Result<()> {
        if !self
            .comments
            .contains(comment_id)
            .map_err(store_err("comments.contains"))?
        {
            app::bail!(Error::NotFound(comment_id.clone()));
        }
        if !self
            .comments
            .owned_by_me(comment_id)
            .map_err(store_err("comments.owned_by_me"))?
        {
            app::bail!(Error::Forbidden(format!(
                "only the author may {action} this comment"
            )));
        }
        Ok(())
    }

    /// The labels attached to an issue, sorted for a stable order. Only rows
    /// whose key is the one `add_label` writes count, so a hand-written row
    /// cannot duplicate a label.
    fn labels_of(&self, issue_id: &str) -> app::Result<Vec<String>> {
        let mut out = BTreeSet::new();
        for (key, tag) in self
            .labels
            .query("issue_id")
            .eq(issue_id)
            .entries()
            .map_err(store_err("labels.query"))?
        {
            let label = tag.label.get();
            if key == label_key(issue_id, label) {
                let _ = out.insert(label.clone());
            }
        }
        Ok(out.into_iter().collect())
    }

    /// The issue `id` as a view, or `None` if it has no header.
    fn issue_view(&self, id: String) -> app::Result<Option<IssueView>> {
        let Some(header) = self.headers.get(&id).map_err(store_err("headers.get"))? else {
            return Ok(None);
        };
        let created_by = self
            .headers
            .owner_of(&id)
            .map_err(store_err("headers.owner_of"))?
            .map(|a| a.to_string())
            .unwrap_or_default();
        let issue = match self.issues.get(&id).map_err(store_err("issues.get"))? {
            Some(issue) => issue.clone(),
            None => Issue::missing(),
        };
        Ok(Some(IssueView {
            labels: self.labels_of(&id)?,
            id,
            title: header.title,
            summary: issue.summary.get().clone(),
            impact: issue.impact.get().clone(),
            repro: issue.repro.get().clone(),
            resolution_criteria: issue.resolution_criteria.get().clone(),
            status: issue.status.get().clone(),
            priority: issue.priority.get().clone(),
            assignee: issue.assignee.get().clone(),
            created_by,
            created_at: header.created_at,
        }))
    }
}

fn label_key(issue_id: &str, label: &str) -> String {
    format!("{issue_id}{LABEL_SEP}{label}")
}

fn validate_status(status: &str) -> app::Result<()> {
    if STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(AppError::from(Error::Invalid(format!(
            "status must be one of {STATUSES:?}"
        ))))
    }
}

/// Validate a required issue text section: non-empty after trim.
fn validate_section(name: &str, value: &str) -> app::Result<()> {
    if value.trim().is_empty() {
        return Err(AppError::from(Error::Invalid(format!(
            "{name} must not be empty"
        ))));
    }
    Ok(())
}

fn validate_priority(priority: &str) -> app::Result<()> {
    if PRIORITIES.contains(&priority) {
        Ok(())
    } else {
        Err(AppError::from(Error::Invalid(format!(
            "priority must be one of {PRIORITIES:?}"
        ))))
    }
}

/// Validate a repository URL: non-empty after trim and an `http(s)://` URL.
fn validate_repo_url(url: &str) -> app::Result<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::from(Error::Invalid(
            "repo_url must not be empty".into(),
        )));
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(AppError::from(Error::Invalid(
            "repo_url must start with http:// or https://".into(),
        )));
    }
    Ok(())
}

/// Validate a user-supplied label: non-empty, length-bounded, and free of the
/// reserved index separator.
fn validate_user_label(label: &str) -> app::Result<()> {
    validate_label("label", label).map_err(AppError::from)?;
    if label.contains(LABEL_SEP) {
        return Err(AppError::from(Error::Invalid(
            "label contains a reserved character".into(),
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// In-process tests — one TestHost roundtrip per mutation.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    // A second PERSON: both axes move. `call_as` alone moves only the device,
    // which is the same person on another machine — and `caller()` is the
    // account, so that is still the author.
    const OTHER: [u8; 32] = [0x22; 32];
    const OTHER_ACCOUNT: [u8; 32] = [0xA2; 32];

    fn new_issue(app: &mut TestHost<IssueTracker>) -> String {
        app.call(|s| {
            s.create_issue(
                "Login broken".into(),
                "Clicking login does nothing".into(),
                "Nobody can sign in".into(),
                "Click the login button on a fresh session".into(),
                "Login succeeds and lands on the board".into(),
                "high".into(),
                Some(vec!["bug".into()]),
            )
        })
        .unwrap()
    }

    #[test]
    fn create_issue_starts_open_and_lists() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);

        let detail = app.view(|s| s.get_issue(id.clone())).unwrap();
        assert_eq!(detail.issue.id, id);
        assert_eq!(detail.issue.status, "Open");
        assert_eq!(detail.issue.priority, "high");
        assert_eq!(detail.issue.labels, vec!["bug".to_string()]);
        assert_eq!(detail.issue.assignee, None);
        // All four structured sections round-trip.
        assert_eq!(detail.issue.summary, "Clicking login does nothing");
        assert_eq!(detail.issue.impact, "Nobody can sign in");
        assert_eq!(
            detail.issue.repro,
            "Click the login button on a fresh session"
        );
        assert_eq!(
            detail.issue.resolution_criteria,
            "Login succeeds and lands on the board"
        );

        let all = app.view(|s| s.list_issues(None, None, None)).unwrap();
        assert_eq!(all.len(), 1);
        // create_issue emits exactly one event.
        assert_eq!(app.events().len(), 1);
    }

    #[test]
    fn create_issue_rejects_bad_priority() {
        let mut app = TestHost::new(IssueTracker::init);
        assert!(app
            .call(|s| s.create_issue(
                "t".into(),
                "s".into(),
                "i".into(),
                "r".into(),
                "rc".into(),
                "sky-high".into(),
                None,
            ))
            .is_err());
    }

    #[test]
    fn create_issue_rejects_each_empty_section() {
        let mut app = TestHost::new(IssueTracker::init);
        // One arg blank per case (whitespace-only also rejected), rest valid.
        let cases = [
            ("t", "", "i", "r", "rc"),   // summary
            ("t", "s", "  ", "r", "rc"), // impact
            ("t", "s", "i", "", "rc"),   // repro
            ("t", "s", "i", "r", "\t"),  // resolution_criteria
        ];
        for (title, summary, impact, repro, rc) in cases {
            assert!(
                app.call(|s| s.create_issue(
                    title.into(),
                    summary.into(),
                    impact.into(),
                    repro.into(),
                    rc.into(),
                    "low".into(),
                    None,
                ))
                .is_err(),
                "expected rejection for case {summary:?}/{impact:?}/{repro:?}/{rc:?}"
            );
        }
    }

    #[test]
    fn section_setters_update_and_reject_empty() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);

        app.call(|s| s.set_summary(id.clone(), "New summary".into()))
            .unwrap();
        app.call(|s| s.set_impact(id.clone(), "New impact".into()))
            .unwrap();
        app.call(|s| s.set_repro(id.clone(), "New repro".into()))
            .unwrap();
        app.call(|s| s.set_resolution_criteria(id.clone(), "New criteria".into()))
            .unwrap();

        let detail = app.view(|s| s.get_issue(id.clone())).unwrap();
        assert_eq!(detail.issue.summary, "New summary");
        assert_eq!(detail.issue.impact, "New impact");
        assert_eq!(detail.issue.repro, "New repro");
        assert_eq!(detail.issue.resolution_criteria, "New criteria");

        // Each setter rejects a blank value.
        assert!(app
            .call(|s| s.set_summary(id.clone(), "  ".into()))
            .is_err());
        assert!(app.call(|s| s.set_impact(id.clone(), "".into())).is_err());
        assert!(app.call(|s| s.set_repro(id.clone(), "\n".into())).is_err());
        assert!(app
            .call(|s| s.set_resolution_criteria(id.clone(), "".into()))
            .is_err());
    }

    #[test]
    fn set_status_moves_column_and_rejects_bad_value() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);

        app.call(|s| s.set_status(id.clone(), "In progress".into()))
            .unwrap();
        let detail = app.view(|s| s.get_issue(id.clone())).unwrap();
        assert_eq!(detail.issue.status, "In progress");

        assert!(app
            .call(|s| s.set_status(id.clone(), "Nope".into()))
            .is_err());
    }

    #[test]
    fn set_priority_and_assignee() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);

        app.call(|s| s.set_priority(id.clone(), "urgent".into()))
            .unwrap();
        app.call(|s| s.set_assignee(id.clone(), Some("alice".into())))
            .unwrap();
        let detail = app.view(|s| s.get_issue(id.clone())).unwrap();
        assert_eq!(detail.issue.priority, "urgent");
        assert_eq!(detail.issue.assignee, Some("alice".to_string()));

        assert!(app.call(|s| s.set_priority(id, "meh".into())).is_err());
    }

    #[test]
    fn labels_add_remove_and_no_duplicates() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);

        app.call(|s| s.add_label(id.clone(), "frontend".into()))
            .unwrap();
        // Adding the same label twice must not duplicate it.
        app.call(|s| s.add_label(id.clone(), "frontend".into()))
            .unwrap();
        let labels = app.view(|s| s.get_issue(id.clone())).unwrap().issue.labels;
        assert_eq!(labels, vec!["bug".to_string(), "frontend".to_string()]);

        app.call(|s| s.remove_label(id.clone(), "bug".into()))
            .unwrap();
        let labels = app.view(|s| s.get_issue(id.clone())).unwrap().issue.labels;
        assert_eq!(labels, vec!["frontend".to_string()]);
    }

    #[test]
    fn list_issues_filters_by_status_assignee_and_label() {
        let mut app = TestHost::new(IssueTracker::init);
        let a = new_issue(&mut app);
        let b = app
            .call(|s| {
                s.create_issue(
                    "Other".into(),
                    "s".into(),
                    "i".into(),
                    "r".into(),
                    "rc".into(),
                    "low".into(),
                    None,
                )
            })
            .unwrap();

        app.call(|s| s.set_status(a.clone(), "Done".into()))
            .unwrap();
        app.call(|s| s.set_assignee(a.clone(), Some("alice".into())))
            .unwrap();

        let done = app
            .view(|s| s.list_issues(Some("Done".into()), None, None))
            .unwrap();
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].id, a);

        let alice = app
            .view(|s| s.list_issues(None, Some("alice".into()), None))
            .unwrap();
        assert_eq!(alice.len(), 1);
        assert_eq!(alice[0].id, a);

        let bug = app
            .view(|s| s.list_issues(None, None, Some("bug".into())))
            .unwrap();
        assert_eq!(bug.len(), 1);
        assert_eq!(bug[0].id, a);

        // `b` has no filters matching the above, so the unfiltered list has both.
        assert_eq!(
            app.view(|s| s.list_issues(None, None, None)).unwrap().len(),
            2
        );
        assert!(b != a);
    }

    #[test]
    fn status_counts_match_board() {
        let mut app = TestHost::new(IssueTracker::init);
        let a = new_issue(&mut app);
        let _b = app
            .call(|s| {
                s.create_issue(
                    "Other".into(),
                    "s".into(),
                    "i".into(),
                    "r".into(),
                    "rc".into(),
                    "low".into(),
                    None,
                )
            })
            .unwrap();
        app.call(|s| s.set_status(a, "Done".into())).unwrap();

        let counts = app.view(|s| s.get_status_counts()).unwrap();
        let get = |name: &str| counts.iter().find(|c| c.status == name).unwrap().count;
        assert_eq!(get("Open"), 1);
        assert_eq!(get("Done"), 1);
        assert_eq!(get("Blocked"), 0);
    }

    #[test]
    fn comment_roundtrip_and_thread_order() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);

        let c1 = app
            .call(|s| s.add_comment(id.clone(), "I can reproduce".into()))
            .unwrap();
        let detail = app.view(|s| s.get_issue(id.clone())).unwrap();
        assert_eq!(detail.comments.len(), 1);
        assert_eq!(detail.comments[0].id, c1);
        assert_eq!(detail.comments[0].body, "I can reproduce");
        assert_eq!(detail.comments[0].edited_at, None);
    }

    #[test]
    fn author_can_edit_and_delete_own_comment() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        let c = app
            .call(|s| s.add_comment(id.clone(), "first".into()))
            .unwrap();

        app.call(|s| s.edit_comment(c.clone(), "edited".into()))
            .unwrap();
        let detail = app.view(|s| s.get_issue(id.clone())).unwrap();
        assert_eq!(detail.comments[0].body, "edited");
        assert!(detail.comments[0].edited_at.is_some());

        app.call(|s| s.delete_comment(c.clone())).unwrap();
        assert!(app.view(|s| s.get_issue(id)).unwrap().comments.is_empty());
    }

    #[test]
    fn repo_url_starts_empty_sets_and_rejects_bad_values() {
        let mut app = TestHost::new(IssueTracker::init);

        // Empty until set.
        assert_eq!(app.view(|s| s.get_repo_info()).unwrap().repo_url, "");

        app.call(|s| s.set_repo_url("https://github.com/acme/tracker".into()))
            .unwrap();
        assert_eq!(
            app.view(|s| s.get_repo_info()).unwrap().repo_url,
            "https://github.com/acme/tracker"
        );
        // set_repo_url emits exactly one event.
        assert_eq!(app.events().len(), 1);

        // http:// is also accepted; last write wins.
        app.call(|s| s.set_repo_url("http://example.com/repo".into()))
            .unwrap();
        assert_eq!(
            app.view(|s| s.get_repo_info()).unwrap().repo_url,
            "http://example.com/repo"
        );

        // Empty and non-http values are rejected, leaving the value intact.
        assert!(app.call(|s| s.set_repo_url("".into())).is_err());
        assert!(app.call(|s| s.set_repo_url("  ".into())).is_err());
        assert!(app
            .call(|s| s.set_repo_url("github.com/acme/tracker".into()))
            .is_err());
        assert!(app
            .call(|s| s.set_repo_url("ftp://example.com/repo".into()))
            .is_err());
        assert_eq!(
            app.view(|s| s.get_repo_info()).unwrap().repo_url,
            "http://example.com/repo"
        );
    }

    #[test]
    fn non_author_cannot_edit_or_delete_comment() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        let c = app
            .call(|s| s.add_comment(id.clone(), "mine".into()))
            .unwrap();

        // A different person is not the author - both must be rejected.
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s
                .edit_comment(c.clone(), "hax".into()))
            .is_err());
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.delete_comment(c.clone()))
            .is_err());
        // The comment survives the rejected attempts.
        assert_eq!(app.view(|s| s.get_issue(id)).unwrap().comments.len(), 1);
    }

    #[test]
    fn creator_deletes_issue_and_cascades_comments_and_labels() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app); // has label "bug"
        app.call(|s| s.add_label(id.clone(), "frontend".into()))
            .unwrap();
        let c = app
            .call(|s| s.add_comment(id.clone(), "repro confirmed".into()))
            .unwrap();

        app.call(|s| s.delete_issue(id.clone())).unwrap();

        // Gone from every read path.
        assert!(app.view(|s| s.get_issue(id.clone())).is_err());
        assert!(app
            .view(|s| s.list_issues(None, None, None))
            .unwrap()
            .is_empty());
        let counts = app.view(|s| s.get_status_counts()).unwrap();
        assert!(counts.iter().all(|c| c.count == 0));

        // Cascade: comment and both label-index entries removed.
        assert!(!app.view(|s| s.comments.contains(&c).unwrap()));
        assert!(!app.view(|s| s.labels.contains(&label_key(&id, "bug")).unwrap()));
        assert!(!app.view(|s| s.labels.contains(&label_key(&id, "frontend")).unwrap()));
    }

    #[test]
    fn non_creator_cannot_delete_issue() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);

        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.delete_issue(id.clone()))
            .is_err());
        // Issue survives the rejected attempt.
        assert_eq!(app.view(|s| s.get_issue(id)).unwrap().issue.status, "Open");
    }

    #[test]
    fn delete_missing_issue_errors() {
        let mut app = TestHost::new(IssueTracker::init);
        assert!(app.call(|s| s.delete_issue("issue-nope".into())).is_err());
    }

    /// Authorship is the ACCOUNT: the author's second device may edit.
    #[test]
    fn the_authors_other_device_can_edit_their_comment() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        let c = app
            .call(|s| s.add_comment(id.clone(), "mine".into()))
            .unwrap();
        app.call_as(OTHER, |s| s.edit_comment(c.clone(), "from my phone".into()))
            .unwrap();
        let detail = app.view(|s| s.get_issue(id)).unwrap();
        assert_eq!(detail.comments[0].body, "from my phone");
        assert_eq!(detail.comments[0].author, app.view(|_| caller()));
    }

    // ── what every node enforces ─────────────────────────────────────────────
    //
    // These write straight into the collections, the way a patched node that
    // skips every method check would, and assert that storage still refuses.

    #[test]
    fn another_account_cannot_rewrite_or_remove_a_comment_in_storage() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        let c = app
            .call(|s| s.add_comment(id.clone(), "mine".into()))
            .unwrap();
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| {
                s.comments.modify(&c, |c| c.body.set("hax".into()))
            })
            .is_err());
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.comments.remove(&c))
            .is_err());
        assert_eq!(
            app.view(|s| s.get_issue(id)).unwrap().comments[0].body,
            "mine"
        );
    }

    #[test]
    fn nobody_else_can_remove_or_reattribute_an_issue_in_storage() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        let me = app.view(|_| caller());

        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.headers.remove(&id))
            .is_err());
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| {
                s.headers.modify(&id, |h| h.title = "Renamed".into())
            })
            .is_err());
        // Taking the key over by inserting is refused too: it is occupied.
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.headers.insert(
                id.clone(),
                IssueHeader {
                    title: "Mine now".into(),
                    created_at: 0,
                }
            ))
            .is_err());

        let issue = app.view(|s| s.get_issue(id)).unwrap().issue;
        assert_eq!(issue.title, "Login broken");
        assert_eq!(issue.created_by, me, "created_by is the owner stamp");
    }

    /// Triage is public on purpose, so a peer CAN remove a triage row. The
    /// issue survives it: it reads as a fresh Open issue, and triaging it again
    /// re-creates the row.
    #[test]
    fn an_issue_outlives_its_triage_row() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.issues.remove(&id))
            .unwrap();

        let issue = app.view(|s| s.get_issue(id.clone())).unwrap().issue;
        assert_eq!(issue.status, "Open");
        assert_eq!(issue.title, "Login broken");
        assert_eq!(
            app.view(|s| s.list_issues(None, None, None)).unwrap().len(),
            1
        );

        app.call(|s| s.set_status(id.clone(), "Blocked".into()))
            .unwrap();
        assert_eq!(
            app.view(|s| s.get_issue(id)).unwrap().issue.status,
            "Blocked"
        );
    }

    /// A triage row with no header — what a patched node inventing issues
    /// would write — is neither listed nor counted.
    #[test]
    fn a_triage_row_without_a_header_is_not_an_issue() {
        let mut app = TestHost::new(IssueTracker::init);
        let _ = new_issue(&mut app);
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.issues.insert("issue-forged".into(), Issue::missing())
        })
        .unwrap();

        assert_eq!(
            app.view(|s| s.list_issues(Some("Open".into()), None, None))
                .unwrap()
                .len(),
            1
        );
        let counts = app.view(|s| s.get_status_counts()).unwrap();
        assert_eq!(counts.iter().find(|c| c.status == "Open").unwrap().count, 1);
        assert!(app.view(|s| s.get_issue("issue-forged".into())).is_err());
    }

    #[test]
    fn other_peoples_comments_survive_an_issue_delete_but_are_not_shown() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        let theirs = app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| {
                s.add_comment(id.clone(), "+1".into())
            })
            .unwrap();
        app.call(|s| s.delete_issue(id.clone())).unwrap();
        // Only its author may remove it, so it stays — unreachable, since
        // every read goes through the issue.
        assert!(app.view(|s| s.comments.contains(&theirs).unwrap()));
        assert!(app.view(|s| s.get_issue(id)).is_err());
    }
}
