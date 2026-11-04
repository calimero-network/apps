//! Mero Issue Tracker: a private, real-time issue board for a small engineering
//! team, on core's component SDK (`calimero-sdk`).
//!
//! One app instance is one repository's board: its issues, their labels and
//! comment threads, and the repository URL. The app runs on its cluster's leader,
//! which applies every write in one replicated log, so the state is plain tables
//! and v1's CRDT plumbing (`LwwRegister` fields, hand-written `Mergeable`, the
//! triage row a peer could remove) has nothing left to decide:
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Authored<IndexedMap<String, IssueHeader>>` + `IndexedMap<String, Issue>` | one `issues` table, `createdBy` a field; `byCreated`, `byStatus` and `byAssignee` indexes; a maintained `perStatus` count |
//! | `Authored<IndexedMap<String, Comment>>`, `#[index(thread(issue_id, created_at))]` | `comments` table, `author` a field, `thread` index |
//! | `IndexedMap<String, LabelTag>` keyed `"{issue}\u{1}{label}"` | `labels` table keyed `(issueId, label)`, `byLabel` and `byIssue` indexes |
//! | `LwwRegister<String>` repo URL | `Cell<String>` |
//!
//! # Who may do what
//!
//! The organization decides who reaches the app: its owner, admins, members and
//! guests (in v1 every member of the workspace could do everything a method
//! allowed). Every one of them may read and triage every issue. The two rules v1
//! kept in storage (`Authored`: an entry's owner stamp) are checks here, in the
//! method, against `env::caller()`, before anything is written:
//!
//! - only a comment's `author` may edit or delete it (`editComment`,
//!   `deleteComment`): anyone else gets `Forbidden`;
//! - only an issue's `createdBy` may delete it (`deleteIssue`): anyone else gets
//!   `Forbidden`.
//!
//! Every write goes through a method, so there is no "patched node" to defend
//! against: v1's forged-write tests are the same calls made as another account.
//!
//! Everything a client sees differently from v1 (camelCase names, 64-bit
//! integers as decimal strings, the error shape, list sizes) is in
//! `apps/mero-issue-tracker/README.md`, "What changed in the port".

use calimero_sdk::env::Caller;
use calimero_sdk::prelude::*;
use serde::Serialize;

/// Allowed issue statuses, in board column order.
pub const STATUSES: [&str; 4] = ["Open", "In progress", "Blocked", "Done"];
/// Allowed issue priorities.
pub const PRIORITIES: [&str; 4] = ["low", "medium", "high", "urgent"];
/// The longest title or label, in Unicode scalar values.
pub const MAX_LABEL_LEN: usize = 64;
/// The most rows one read returns: one page of a table.
pub const PAGE: u32 = 1000;

// ── stored records ───────────────────────────────────────────────────────────

/// One issue: what v1 kept in two maps (the filer's owned header and the shared
/// triage row) in one record. Its labels are rows of [`LabelTag`].
#[derive(Record)]
#[table(
    key = "id",
    index(by_created = ["created_at"]),
    index(by_status = ["status", "created_at"]),
    index(by_assignee = ["assignee", "created_at"]),
    count(per_status = ["status"]),
)]
pub struct Issue {
    /// `issue-<ms>-<8 hex>`.
    pub id: String,
    pub title: String,
    pub summary: String,
    pub impact: String,
    pub repro: String,
    pub resolution_criteria: String,
    /// One of [`STATUSES`].
    pub status: String,
    /// One of [`PRIORITIES`].
    pub priority: String,
    /// Free text; `None` when unassigned (indexed under none, which no lookup by
    /// name reaches).
    pub assignee: Option<String>,
    /// The filer's account. Only they may delete the issue.
    pub created_by: String,
    /// Unix milliseconds (the log entry's time).
    pub created_at: u64,
}

/// One comment on one issue. Returned to callers as it is stored.
#[derive(Record)]
#[table(key = "id", index(thread = ["issue_id", "created_at"]))]
pub struct Comment {
    /// `comment-<ms>-<8 hex>`.
    pub id: String,
    pub issue_id: String,
    /// The writer's account. Only they may edit or delete it.
    pub author: String,
    pub body: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Unix milliseconds of the last edit, or `None`.
    pub edited_at: Option<u64>,
}

/// One label on one issue. The key is the pair, so adding a label twice keeps
/// one row.
#[derive(Record)]
#[table(
    key = ["issue_id", "label"],
    index(by_label = ["label", "issue_id"]),
    index(by_issue = ["issue_id", "label"]),
)]
pub struct LabelTag {
    pub issue_id: String,
    pub label: String,
    /// Unix milliseconds.
    pub added_at: u64,
}

// ── results ──────────────────────────────────────────────────────────────────

/// An issue as callers see it, labels included. A plain struct: a `Record`
/// cannot hold a list.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueView {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub impact: String,
    pub repro: String,
    pub resolution_criteria: String,
    pub status: String,
    pub priority: String,
    pub assignee: Option<String>,
    /// Sorted.
    pub labels: Vec<String>,
    pub created_by: String,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
}

/// An issue with its comment thread, oldest comment first.
#[derive(Serialize)]
pub struct IssueDetail {
    pub issue: IssueView,
    pub comments: Vec<Comment>,
}

/// One board column's count.
#[derive(Serialize)]
pub struct StatusCount {
    pub status: String,
    /// A decimal string on the wire.
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub count: u64,
}

/// The repository this board tracks; `repoUrl` is empty until `setRepoUrl`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub repo_url: String,
}

// ── state ────────────────────────────────────────────────────────────────────

/// The board.
#[app::state(version = 1)]
pub struct IssueTracker {
    issues: Table<Issue>,
    comments: Table<Comment>,
    labels: Table<LabelTag>,
    /// Empty (unset) until `setRepoUrl`.
    repo_url: Cell<String>,
}

#[app::logic]
impl IssueTracker {
    /// The empty board. The node runs it once, when the app is created; it takes
    /// no arguments.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// Sets or changes the repository URL this board tracks. Any member may.
    /// `Invalid` when `url` is empty or does not start with `http://` or
    /// `https://`. Emits `RepoUrlChanged`.
    pub fn set_repo_url(&mut self, url: String) -> app::Result<()> {
        validate_repo_url(&url)?;
        self.repo_url.set(&url)?;
        env::emit(Event::RepoUrlChanged { url }, Audience::All)?;
        Ok(())
    }

    /// This board's repository URL, empty until `setRepoUrl`.
    #[app::view]
    pub fn get_repo_info(&self) -> app::Result<RepoInfo> {
        Ok(RepoInfo {
            repo_url: self.repo_url.get()?.unwrap_or_default(),
        })
    }

    /// Files an issue and returns its id, `issue-<ms>-<8 hex>`. It starts
    /// `Open`, filed by the caller. `title` and each label are 1 to 64
    /// characters, the four sections must not be blank, and `priority` is one of
    /// `low`, `medium`, `high`, `urgent`; anything else is `Invalid`. Emits
    /// `IssueCreated`.
    // Each argument is a named field of the ABI; a params struct would change it.
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
        let created_by = account()?;
        validate_label("title", &title)?;
        validate_section("summary", &summary)?;
        validate_section("impact", &impact)?;
        validate_section("repro", &repro)?;
        validate_section("resolution_criteria", &resolution_criteria)?;
        validate_priority(&priority)?;
        let labels = labels.unwrap_or_default();
        for label in &labels {
            validate_label("label", label)?;
        }

        let now = env::time_now();
        let id = new_id("issue", now);
        self.issues.insert(Issue {
            id: id.clone(),
            title,
            summary,
            impact,
            repro,
            resolution_criteria,
            status: STATUSES[0].to_owned(),
            priority,
            assignee: None,
            created_by: created_by.clone(),
            created_at: now,
        })?;
        for label in labels {
            self.put_label(&id, label, now)?;
        }
        env::emit(
            Event::IssueCreated {
                id: id.clone(),
                created_by,
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Moves an issue to another column: `status` is exactly `Open`,
    /// `In progress`, `Blocked` or `Done` (else `Invalid`). `NotFound` for an
    /// unknown issue. Emits `IssueStatusChanged`.
    pub fn set_status(&mut self, issue_id: String, status: String) -> app::Result<()> {
        validate_status(&status)?;
        let next = status.clone();
        self.triage(&issue_id, |i| i.status = next)?;
        env::emit(
            Event::IssueStatusChanged {
                id: issue_id,
                status,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Replaces an issue's summary (not blank). Emits `IssueEdited`.
    pub fn set_summary(&mut self, issue_id: String, summary: String) -> app::Result<()> {
        validate_section("summary", &summary)?;
        self.triage(&issue_id, |i| i.summary = summary)?;
        env::emit(Event::IssueEdited { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// Replaces an issue's impact (not blank). Emits `IssueEdited`.
    pub fn set_impact(&mut self, issue_id: String, impact: String) -> app::Result<()> {
        validate_section("impact", &impact)?;
        self.triage(&issue_id, |i| i.impact = impact)?;
        env::emit(Event::IssueEdited { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// Replaces an issue's reproduction steps (not blank). Emits `IssueEdited`.
    pub fn set_repro(&mut self, issue_id: String, repro: String) -> app::Result<()> {
        validate_section("repro", &repro)?;
        self.triage(&issue_id, |i| i.repro = repro)?;
        env::emit(Event::IssueEdited { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// Replaces an issue's resolution criteria (not blank). Emits `IssueEdited`.
    pub fn set_resolution_criteria(
        &mut self,
        issue_id: String,
        resolution_criteria: String,
    ) -> app::Result<()> {
        validate_section("resolution_criteria", &resolution_criteria)?;
        self.triage(&issue_id, |i| i.resolution_criteria = resolution_criteria)?;
        env::emit(Event::IssueEdited { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// Changes an issue's priority: `low`, `medium`, `high` or `urgent` (else
    /// `Invalid`). Emits `IssuePriorityChanged`.
    pub fn set_priority(&mut self, issue_id: String, priority: String) -> app::Result<()> {
        validate_priority(&priority)?;
        let next = priority.clone();
        self.triage(&issue_id, |i| i.priority = next)?;
        env::emit(
            Event::IssuePriorityChanged {
                id: issue_id,
                priority,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Sets an issue's assignee (free text, conventionally an account id), or
    /// clears it with `null`. Emits `IssueAssigneeChanged`.
    pub fn set_assignee(&mut self, issue_id: String, assignee: Option<String>) -> app::Result<()> {
        self.triage(&issue_id, |i| i.assignee = assignee)?;
        env::emit(Event::IssueAssigneeChanged { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// Adds a label (1 to 64 characters) to an issue; adding it twice keeps one.
    /// Emits `IssueLabelsChanged`.
    pub fn add_label(&mut self, issue_id: String, label: String) -> app::Result<()> {
        validate_label("label", &label)?;
        self.require_issue(&issue_id)?;
        self.put_label(&issue_id, label, env::time_now())?;
        env::emit(Event::IssueLabelsChanged { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// Removes a label from an issue; removing one it lacks succeeds. Emits
    /// `IssueLabelsChanged` either way, as v1 did.
    pub fn remove_label(&mut self, issue_id: String, label: String) -> app::Result<()> {
        self.require_issue(&issue_id)?;
        let _removed = self.labels.remove(&(issue_id.clone(), label))?;
        env::emit(Event::IssueLabelsChanged { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// Issues oldest first, filtered by exact `status`, `assignee` and `label`
    /// (`null` for no filter). At most the first 1,000 matches.
    #[app::view]
    pub fn list_issues(
        &self,
        status: Option<String>,
        assignee: Option<String>,
        label: Option<String>,
    ) -> app::Result<Vec<IssueView>> {
        let keep = |v: &IssueView| {
            status.as_ref().is_none_or(|s| &v.status == s)
                && assignee
                    .as_ref()
                    .is_none_or(|a| v.assignee.as_ref() == Some(a))
                && label.as_ref().is_none_or(|l| v.labels.contains(l))
        };

        // A label filter reads the label's rows: no index of issues holds it.
        if let (Some(wanted), None, None) = (&label, &status, &assignee) {
            let mut issues = Vec::new();
            let mut opts = FindOpts::default().limit(PAGE);
            loop {
                let page = self
                    .labels
                    .find("byLabel", &[KeyPart::Str(wanted.clone())], opts)?;
                for tag in page.items {
                    if let Some(issue) = self.issues.get(&tag.issue_id)? {
                        issues.push(issue);
                    }
                }
                match page.next {
                    Some(next) if issues.len() < PAGE as usize => {
                        opts = FindOpts::default().limit(PAGE).cursor(next);
                    }
                    _ => break,
                }
            }
            issues.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
            issues.truncate(PAGE as usize);
            return issues.into_iter().map(|i| self.view_of(i)).collect();
        }

        // Otherwise the narrowest index, in creation order, filtered as it goes.
        let (index, prefix) = match (&status, &assignee) {
            (Some(s), _) => ("byStatus", vec![KeyPart::Str(s.clone())]),
            (None, Some(a)) => ("byAssignee", vec![KeyPart::Str(a.clone())]),
            (None, None) => ("byCreated", Vec::new()),
        };
        let mut out = Vec::new();
        let mut opts = FindOpts::default().limit(PAGE);
        loop {
            let page = self.issues.find(index, &prefix, opts)?;
            for issue in page.items {
                let view = self.view_of(issue)?;
                if keep(&view) {
                    out.push(view);
                    if out.len() == PAGE as usize {
                        return Ok(out);
                    }
                }
            }
            match page.next {
                Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
                None => return Ok(out),
            }
        }
    }

    /// One issue with its comment thread, oldest comment first (at most the
    /// first 1,000 comments). `NotFound` for an unknown issue.
    #[app::view]
    pub fn get_issue(&self, issue_id: String) -> app::Result<IssueDetail> {
        let issue = self.require_issue(&issue_id)?;
        let comments = self
            .comments
            .find(
                "thread",
                &[KeyPart::Str(issue_id)],
                FindOpts::default().limit(PAGE),
            )?
            .items;
        Ok(IssueDetail {
            issue: self.view_of(issue)?,
            comments,
        })
    }

    /// Issue counts per status, in column order: `Open`, `In progress`,
    /// `Blocked`, `Done`. Maintained counts: no issue is read.
    #[app::view]
    pub fn get_status_counts(&self) -> app::Result<Vec<StatusCount>> {
        let mut out = Vec::with_capacity(STATUSES.len());
        for status in STATUSES {
            out.push(StatusCount {
                status: status.to_owned(),
                count: self
                    .issues
                    .count("perStatus", &[KeyPart::Str(status.to_owned())])?,
            });
        }
        Ok(out)
    }

    /// Posts a comment (not blank) as the caller and returns its id,
    /// `comment-<ms>-<8 hex>`. `NotFound` for an unknown issue. Emits
    /// `CommentAdded`.
    pub fn add_comment(&mut self, issue_id: String, body: String) -> app::Result<String> {
        let author = account()?;
        if body.trim().is_empty() {
            return Err(invalid("comment body must not be empty"));
        }
        self.require_issue(&issue_id)?;
        let now = env::time_now();
        let id = new_id("comment", now);
        self.comments.insert(Comment {
            id: id.clone(),
            issue_id: issue_id.clone(),
            author,
            body,
            created_at: now,
            edited_at: None,
        })?;
        env::emit(
            Event::CommentAdded {
                id: id.clone(),
                issue_id,
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Replaces a comment's text (not blank) and stamps `editedAt`. Only its
    /// author may: anyone else gets `Forbidden`. Emits `CommentEdited`.
    pub fn edit_comment(&mut self, comment_id: String, new_body: String) -> app::Result<()> {
        if new_body.trim().is_empty() {
            return Err(invalid("comment body must not be empty"));
        }
        self.require_comment_author(&comment_id, "edit")?;
        let now = env::time_now();
        let _ = self.comments.update(&comment_id, |c| {
            c.body = new_body;
            c.edited_at = Some(now);
        })?;
        env::emit(Event::CommentEdited { id: comment_id }, Audience::All)?;
        Ok(())
    }

    /// Deletes a comment. Only its author may: anyone else gets `Forbidden`.
    /// Emits `CommentDeleted`.
    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        self.require_comment_author(&comment_id, "delete")?;
        let _ = self.comments.remove(&comment_id)?;
        env::emit(Event::CommentDeleted { id: comment_id }, Audience::All)?;
        Ok(())
    }

    /// Deletes an issue with its labels and its whole comment thread. Only its
    /// creator may: anyone else gets `Forbidden`. `NotFound` for an unknown
    /// issue. Emits `IssueDeleted`.
    pub fn delete_issue(&mut self, issue_id: String) -> app::Result<()> {
        let issue = self.require_issue(&issue_id)?;
        if account()? != issue.created_by {
            return Err(Error::Forbidden {
                message: "only the creator may delete this issue".to_owned(),
            }
            .into());
        }
        // Collect a page, then remove it: never mutate under a cursor.
        loop {
            let page = self.comments.find(
                "thread",
                &[KeyPart::Str(issue_id.clone())],
                FindOpts::default().limit(PAGE),
            )?;
            if page.items.is_empty() {
                break;
            }
            for comment in page.items {
                let _ = self.comments.remove(&comment.id)?;
            }
        }
        loop {
            let page = self.labels.find(
                "byIssue",
                &[KeyPart::Str(issue_id.clone())],
                FindOpts::default().limit(PAGE),
            )?;
            if page.items.is_empty() {
                break;
            }
            for tag in page.items {
                let _ = self.labels.remove(&(tag.issue_id, tag.label))?;
            }
        }
        let _ = self.issues.remove(&issue_id)?;
        env::emit(Event::IssueDeleted { id: issue_id }, Audience::All)?;
        Ok(())
    }

    /// An existing issue, or `NotFound`.
    fn require_issue(&self, issue_id: &str) -> app::Result<Issue> {
        self.issues.get(issue_id)?.ok_or_else(|| {
            Error::NotFound {
                id: issue_id.to_owned(),
            }
            .into()
        })
    }

    /// Applies a triage edit to an existing issue; its indexes and counts follow.
    fn triage(&mut self, issue_id: &str, edit: impl FnOnce(&mut Issue)) -> app::Result<()> {
        if !self.issues.update(issue_id, edit)? {
            return Err(Error::NotFound {
                id: issue_id.to_owned(),
            }
            .into());
        }
        Ok(())
    }

    fn put_label(&mut self, issue_id: &str, label: String, now: u64) -> app::Result<()> {
        if !self
            .labels
            .contains(&(issue_id.to_owned(), label.clone()))?
        {
            self.labels.insert(LabelTag {
                issue_id: issue_id.to_owned(),
                label,
                added_at: now,
            })?;
        }
        Ok(())
    }

    /// `NotFound` for an unknown comment, `Forbidden` for anyone but its author.
    fn require_comment_author(&self, comment_id: &str, action: &str) -> app::Result<()> {
        let Some(comment) = self.comments.get(comment_id)? else {
            return Err(Error::NotFound {
                id: comment_id.to_owned(),
            }
            .into());
        };
        if comment.author != account()? {
            return Err(Error::Forbidden {
                message: format!("only the author may {action} this comment"),
            }
            .into());
        }
        Ok(())
    }

    /// The issue with its labels, sorted.
    fn view_of(&self, issue: Issue) -> app::Result<IssueView> {
        let labels = self
            .labels
            .find(
                "byIssue",
                &[KeyPart::Str(issue.id.clone())],
                FindOpts::default().limit(PAGE),
            )?
            .items
            .into_iter()
            .map(|t| t.label)
            .collect();
        Ok(IssueView {
            id: issue.id,
            title: issue.title,
            summary: issue.summary,
            impact: issue.impact,
            repro: issue.repro,
            resolution_criteria: issue.resolution_criteria,
            status: issue.status,
            priority: issue.priority,
            assignee: issue.assignee,
            labels,
            created_by: issue.created_by,
            created_at: issue.created_at,
        })
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. v1's
/// `{ kind, data }` kinds, with the data string as a named field.
#[app::error]
pub enum Error {
    /// No issue or comment with this id.
    NotFound { id: String },
    /// An argument broke a rule; `message` says which.
    Invalid { message: String },
    /// The caller is not the comment's author or the issue's creator.
    Forbidden { message: String },
}

/// A change to the board, emitted to everyone the app reaches after the write
/// that caused it. v1's events, with camelCase field names.
#[app::event]
pub enum Event {
    /// A new issue was filed.
    IssueCreated { id: String, created_by: String },
    /// One of an issue's four sections changed.
    IssueEdited { id: String },
    /// An issue was deleted, with its labels and comments.
    IssueDeleted { id: String },
    /// An issue moved columns.
    IssueStatusChanged { id: String, status: String },
    /// An issue's priority changed.
    IssuePriorityChanged { id: String, priority: String },
    /// An issue's assignee changed.
    IssueAssigneeChanged { id: String },
    /// A label was added to or removed from an issue.
    IssueLabelsChanged { id: String },
    /// A comment was posted.
    CommentAdded { id: String, issue_id: String },
    /// A comment was edited by its author.
    CommentEdited { id: String },
    /// A comment was deleted by its author.
    CommentDeleted { id: String },
    /// The repository URL was set or changed.
    RepoUrlChanged { url: String },
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The account the caller acts for (a signed-in account, or an API key acting
/// for one): what `createdBy` and `author` record.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// `{prefix}-{ms}-{8 hex}`, as v1 minted it. The random bytes are seeded per
/// logged run, so a replay mints the same id.
fn new_id(prefix: &str, now: u64) -> String {
    let hex: String = env::random_bytes(4)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{prefix}-{now}-{hex}")
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

/// A short, user-supplied label (title, label): not blank, at most 64 characters.
fn validate_label(field: &str, value: &str) -> app::Result<()> {
    if value.trim().is_empty() {
        return Err(invalid(format!("{field} must not be empty")));
    }
    if value.chars().count() > MAX_LABEL_LEN {
        return Err(invalid(format!(
            "{field} must be at most {MAX_LABEL_LEN} characters"
        )));
    }
    Ok(())
}

/// A required issue text section: not blank.
fn validate_section(name: &str, value: &str) -> app::Result<()> {
    if value.trim().is_empty() {
        return Err(invalid(format!("{name} must not be empty")));
    }
    Ok(())
}

fn validate_status(status: &str) -> app::Result<()> {
    if STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(invalid(format!("status must be one of {STATUSES:?}")))
    }
}

fn validate_priority(priority: &str) -> app::Result<()> {
    if PRIORITIES.contains(&priority) {
        Ok(())
    } else {
        Err(invalid(format!("priority must be one of {PRIORITIES:?}")))
    }
}

/// Not blank, and an `http(s)://` URL.
fn validate_repo_url(url: &str) -> app::Result<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(invalid("repo_url must not be empty"));
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(invalid("repo_url must start with http:// or https://"));
    }
    Ok(())
}
