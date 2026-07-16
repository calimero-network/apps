//! Issue-tracker service — a private, real-time issue board for a small team.
//!
//! One shared Calimero context holding every issue and comment. Demonstrates the
//! core patterns:
//!
//! - `#[app::state]` / `#[app::logic]` / `#[app::init]`
//! - `UnorderedMap<String, Issue>` — the shared issue board (anyone may triage).
//! - `UnorderedMap<String, Comment>` — the discussion threads; authorship is
//!   enforced in-logic (only the immutable `author` may edit/delete).
//! - `UnorderedMap<String, u64>` — a flat label index keyed `issue_id\u{1}label`
//!   so concurrent adds of the same label converge to one entry (no duplicates)
//!   and removes are conflict-free.
//! - `LwwRegister<T>` for every mutable issue/comment field (title, status,
//!   priority, assignee, body, edited_at) so concurrent edits converge LWW.
//! - hand-written `Mergeable` + `RekeyTarget` on the CRDT-nesting `Issue` /
//!   `Comment` map values (#2577 nested-register re-keying).
//! - `app::emit!`, named-struct returns (no tuples — ABI-safe views).

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::env;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::{field_child_id, RekeyTarget};
use calimero_storage::collections::{LwwRegister, Mergeable, UnorderedMap};
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

/// A single issue on the board. `id`, `created_by`, `created_at` are set once at
/// creation; every mutable field is a `LwwRegister` so concurrent edits converge
/// last-writer-wins. Labels live in a separate flat index (see `IssueTracker`).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Issue {
    pub id: String,
    pub title: LwwRegister<String>,
    pub description: LwwRegister<String>,
    pub status: LwwRegister<String>,
    pub priority: LwwRegister<String>,
    pub assignee: LwwRegister<Option<String>>,
    pub created_by: String,
    pub created_at: u64,
}

impl Mergeable for Issue {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Deterministic tie-break for the set-once fields so merge is
        // commutative even if two replicas raced the initial insert.
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.created_by = other.created_by.clone();
            self.created_at = other.created_at;
        }
        // Nested registers merge by HLC last-writer-wins.
        self.title.merge(&other.title);
        self.description.merge(&other.description);
        self.status.merge(&other.status);
        self.priority.merge(&other.priority);
        self.assignee.merge(&other.assignee);
        Ok(())
    }
}

impl RekeyTarget for Issue {
    fn rekey_relative_to(&mut self, parent_id: Id) {
        calimero_storage::rekey_field_if_supported!(
            &mut self.title,
            field_child_id(parent_id, "title")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.description,
            field_child_id(parent_id, "description")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.status,
            field_child_id(parent_id, "status")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.priority,
            field_child_id(parent_id, "priority")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.assignee,
            field_child_id(parent_id, "assignee")
        );
    }
}

/// A discussion entry on an issue. `id`, `issue_id`, `author`, `created_at` are
/// immutable; `body` and `edited_at` are LWW registers. Only the `author` may
/// edit or delete (enforced in-logic against the immutable field).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Comment {
    pub id: String,
    pub issue_id: String,
    pub author: String,
    pub body: LwwRegister<String>,
    pub created_at: u64,
    pub edited_at: LwwRegister<Option<u64>>,
}

impl Mergeable for Comment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.issue_id = other.issue_id.clone();
            self.author = other.author.clone();
            self.created_at = other.created_at;
        }
        self.body.merge(&other.body);
        self.edited_at.merge(&other.edited_at);
        Ok(())
    }
}

impl RekeyTarget for Comment {
    fn rekey_relative_to(&mut self, parent_id: Id) {
        calimero_storage::rekey_field_if_supported!(
            &mut self.body,
            field_child_id(parent_id, "body")
        );
        calimero_storage::rekey_field_if_supported!(
            &mut self.edited_at,
            field_child_id(parent_id, "edited_at")
        );
    }
}

// ---------------------------------------------------------------------------
// Read-shaped views returned to callers (serde-able, ABI-expressible)
// ---------------------------------------------------------------------------

/// An issue as returned to the frontend/scripts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct IssueView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub assignee: Option<String>,
    pub labels: Vec<String>,
    pub created_by: String,
    pub created_at: u64,
}

/// A comment as returned to the frontend/scripts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentView {
    pub id: String,
    pub issue_id: String,
    pub author: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: Option<u64>,
}

/// A full issue plus its comment thread (named struct — never a tuple return).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct IssueDetail {
    pub issue: IssueView,
    pub comments: Vec<CommentView>,
}

/// One board column's live count (named struct — never a `(String, u64)` tuple).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct StatusCount {
    pub status: String,
    pub count: u64,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct IssueTracker {
    /// All issues, keyed by generated id. Shared — any teammate may triage.
    issues: UnorderedMap<String, Issue>,
    /// All comments across all issues, keyed by generated id.
    comments: UnorderedMap<String, Comment>,
    /// Flat label index: key `"{issue_id}\u{1}{label}"` → added-at ms register.
    /// Concurrent adds of the same label collapse to one entry (no duplicates);
    /// removal is a conflict-free key delete. The value is a `LwwRegister` so the
    /// map holds a CRDT value (a bare `u64` is not replicable).
    labels: UnorderedMap<String, LwwRegister<u64>>,
}

#[app::logic]
impl IssueTracker {
    #[app::init]
    pub fn init() -> IssueTracker {
        IssueTracker {
            issues: UnorderedMap::new_with_field_name("issue_tracker:issues"),
            comments: UnorderedMap::new_with_field_name("issue_tracker:comments"),
            labels: UnorderedMap::new_with_field_name("issue_tracker:labels"),
        }
    }

    /// Create an issue. Returns its generated id. Starts in status `Open`.
    pub fn create_issue(
        &mut self,
        title: String,
        description: String,
        priority: String,
        labels: Vec<String>,
    ) -> app::Result<String> {
        validate_label(&title).map_err(AppError::from)?;
        validate_priority(&priority)?;
        for label in &labels {
            validate_user_label(label)?;
        }

        let now = storage_env::time_now() / 1_000_000;
        let mut nonce = [0u8; 4];
        env::random_bytes(&mut nonce);
        let id = generate_id("issue", now, &nonce);
        let created_by = self.caller();

        let issue = Issue {
            id: id.clone(),
            title: LwwRegister::new(title),
            description: LwwRegister::new(description),
            status: LwwRegister::new(STATUSES[0].to_string()),
            priority: LwwRegister::new(priority),
            assignee: LwwRegister::new(None),
            created_by: created_by.clone(),
            created_at: now,
        };
        self.issues
            .insert(id.clone(), issue)
            .map_err(|e| AppError::msg(format!("issues.insert: {e}")))?;

        for label in labels {
            self.labels
                .insert(label_key(&id, &label), LwwRegister::new(now))
                .map_err(|e| AppError::msg(format!("labels.insert: {e}")))?;
        }

        app::emit!(Event::IssueCreated {
            id: &id,
            created_by: &created_by,
        });
        Ok(id)
    }

    /// Change an issue's status. Rejects any value outside the allowed set.
    pub fn set_status(&mut self, issue_id: String, status: String) -> app::Result<()> {
        validate_status(&status)?;
        let mut guard = self
            .issues
            .get_mut(&issue_id)
            .map_err(|e| AppError::msg(format!("issues.get_mut: {e}")))?
            .ok_or_else(|| AppError::from(Error::NotFound(issue_id.clone())))?;
        guard.status.set(status.clone());
        drop(guard);

        app::emit!(Event::IssueStatusChanged {
            id: &issue_id,
            status: &status,
        });
        Ok(())
    }

    /// Change an issue's priority. Rejects any value outside the allowed set.
    pub fn set_priority(&mut self, issue_id: String, priority: String) -> app::Result<()> {
        validate_priority(&priority)?;
        let mut guard = self
            .issues
            .get_mut(&issue_id)
            .map_err(|e| AppError::msg(format!("issues.get_mut: {e}")))?
            .ok_or_else(|| AppError::from(Error::NotFound(issue_id.clone())))?;
        guard.priority.set(priority.clone());
        drop(guard);

        app::emit!(Event::IssuePriorityChanged {
            id: &issue_id,
            priority: &priority,
        });
        Ok(())
    }

    /// Set or clear an issue's assignee.
    pub fn set_assignee(&mut self, issue_id: String, assignee: Option<String>) -> app::Result<()> {
        let mut guard = self
            .issues
            .get_mut(&issue_id)
            .map_err(|e| AppError::msg(format!("issues.get_mut: {e}")))?
            .ok_or_else(|| AppError::from(Error::NotFound(issue_id.clone())))?;
        guard.assignee.set(assignee);
        drop(guard);

        app::emit!(Event::IssueAssigneeChanged { id: &issue_id });
        Ok(())
    }

    /// Add a label to an issue. Idempotent — a duplicate (even concurrent) add
    /// collapses to a single index entry.
    pub fn add_label(&mut self, issue_id: String, label: String) -> app::Result<()> {
        validate_user_label(&label)?;
        if !self.issue_exists(&issue_id)? {
            app::bail!(Error::NotFound(issue_id));
        }
        let now = storage_env::time_now() / 1_000_000;
        self.labels
            .insert(label_key(&issue_id, &label), LwwRegister::new(now))
            .map_err(|e| AppError::msg(format!("labels.insert: {e}")))?;

        app::emit!(Event::IssueLabelsChanged { id: &issue_id });
        Ok(())
    }

    /// Remove a label from an issue. No-op if the label was not present.
    pub fn remove_label(&mut self, issue_id: String, label: String) -> app::Result<()> {
        if !self.issue_exists(&issue_id)? {
            app::bail!(Error::NotFound(issue_id));
        }
        self.labels
            .remove(&label_key(&issue_id, &label))
            .map_err(|e| AppError::msg(format!("labels.remove: {e}")))?;

        app::emit!(Event::IssueLabelsChanged { id: &issue_id });
        Ok(())
    }

    /// List issues, optionally filtered by status, assignee, and/or label.
    /// Results are ordered by creation time then id for stability.
    pub fn list_issues(
        &self,
        status: Option<String>,
        assignee: Option<String>,
        label: Option<String>,
    ) -> app::Result<Vec<IssueView>> {
        let mut out: Vec<IssueView> = self
            .issues
            .entries()
            .map_err(|e| AppError::msg(format!("issues.entries: {e}")))?
            .map(|(id, issue)| self.to_issue_view(id, &issue))
            .collect::<app::Result<_>>()?;

        if let Some(status) = &status {
            out.retain(|i| &i.status == status);
        }
        if let Some(assignee) = &assignee {
            out.retain(|i| i.assignee.as_deref() == Some(assignee.as_str()));
        }
        if let Some(label) = &label {
            out.retain(|i| i.labels.iter().any(|l| l == label));
        }

        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Ok(out)
    }

    /// Read a single issue plus its full comment thread (ordered by created_at).
    pub fn get_issue(&self, issue_id: String) -> app::Result<IssueDetail> {
        let issue = self
            .issues
            .get(&issue_id)
            .map_err(|e| AppError::msg(format!("issues.get: {e}")))?
            .ok_or_else(|| AppError::from(Error::NotFound(issue_id.clone())))?;
        let issue = self.to_issue_view(issue_id.clone(), &issue)?;

        let mut comments: Vec<CommentView> = self
            .comments
            .entries()
            .map_err(|e| AppError::msg(format!("comments.entries: {e}")))?
            .filter(|(_, c)| c.issue_id == issue_id)
            .map(|(_, c)| comment_view(&c))
            .collect();
        comments.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));

        Ok(IssueDetail { issue, comments })
    }

    /// Live count of issues per status column, in fixed column order.
    pub fn get_status_counts(&self) -> app::Result<Vec<StatusCount>> {
        let mut counts = [0u64; STATUSES.len()];
        for (_, issue) in self
            .issues
            .entries()
            .map_err(|e| AppError::msg(format!("issues.entries: {e}")))?
        {
            let status = issue.status.get();
            if let Some(idx) = STATUSES.iter().position(|s| s == status) {
                counts[idx] += 1;
            }
        }
        Ok(STATUSES
            .iter()
            .enumerate()
            .map(|(idx, s)| StatusCount {
                status: (*s).to_string(),
                count: counts[idx],
            })
            .collect())
    }

    /// Post a comment to an issue's thread. Returns the generated comment id.
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
            author: self.caller(),
            body: LwwRegister::new(body),
            created_at: now,
            edited_at: LwwRegister::new(None),
        };
        self.comments
            .insert(id.clone(), comment)
            .map_err(|e| AppError::msg(format!("comments.insert: {e}")))?;

        app::emit!(Event::CommentAdded {
            id: &id,
            issue_id: &issue_id,
        });
        Ok(id)
    }

    /// Edit a comment's body. Only the original author may edit.
    pub fn edit_comment(&mut self, comment_id: String, new_body: String) -> app::Result<()> {
        if new_body.trim().is_empty() {
            app::bail!(Error::Invalid("comment body must not be empty".into()));
        }
        let caller = self.caller();
        let now = storage_env::time_now() / 1_000_000;

        let mut guard = self
            .comments
            .get_mut(&comment_id)
            .map_err(|e| AppError::msg(format!("comments.get_mut: {e}")))?
            .ok_or_else(|| AppError::from(Error::NotFound(comment_id.clone())))?;
        if guard.author != caller {
            app::bail!(Error::Forbidden(
                "only the author may edit this comment".into()
            ));
        }
        guard.body.set(new_body);
        guard.edited_at.set(Some(now));
        drop(guard);

        app::emit!(Event::CommentEdited { id: &comment_id });
        Ok(())
    }

    /// Delete a comment. Only the original author may delete.
    pub fn delete_comment(&mut self, comment_id: String) -> app::Result<()> {
        let caller = self.caller();
        let author = self
            .comments
            .get(&comment_id)
            .map_err(|e| AppError::msg(format!("comments.get: {e}")))?
            .map(|c| c.author.clone())
            .ok_or_else(|| AppError::from(Error::NotFound(comment_id.clone())))?;
        if author != caller {
            app::bail!(Error::Forbidden(
                "only the author may delete this comment".into()
            ));
        }
        self.comments
            .remove(&comment_id)
            .map_err(|e| AppError::msg(format!("comments.remove: {e}")))?;

        app::emit!(Event::CommentDeleted { id: &comment_id });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

impl IssueTracker {
    /// Base58 of the current executor — the public, shareable identity string.
    fn caller(&self) -> String {
        bs58::encode(env::executor_id()).into_string()
    }

    fn issue_exists(&self, issue_id: &str) -> app::Result<bool> {
        self.issues
            .contains(issue_id)
            .map_err(|e| AppError::msg(format!("issues.contains: {e}")))
    }

    /// Collect the labels attached to an issue, sorted for a stable order.
    fn labels_of(&self, issue_id: &str) -> app::Result<Vec<String>> {
        let prefix = format!("{issue_id}{LABEL_SEP}");
        let mut out: Vec<String> = self
            .labels
            .entries()
            .map_err(|e| AppError::msg(format!("labels.entries: {e}")))?
            .filter_map(|(key, _)| key.strip_prefix(prefix.as_str()).map(|l| l.to_string()))
            .collect();
        out.sort();
        Ok(out)
    }

    fn to_issue_view(&self, id: String, issue: &Issue) -> app::Result<IssueView> {
        let labels = self.labels_of(&id)?;
        Ok(IssueView {
            id,
            title: issue.title.get().clone(),
            description: issue.description.get().clone(),
            status: issue.status.get().clone(),
            priority: issue.priority.get().clone(),
            assignee: issue.assignee.get().clone(),
            labels,
            created_by: issue.created_by.clone(),
            created_at: issue.created_at,
        })
    }
}

fn comment_view(c: &Comment) -> CommentView {
    CommentView {
        id: c.id.clone(),
        issue_id: c.issue_id.clone(),
        author: c.author.clone(),
        body: c.body.get().clone(),
        created_at: c.created_at,
        edited_at: *c.edited_at.get(),
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

fn validate_priority(priority: &str) -> app::Result<()> {
    if PRIORITIES.contains(&priority) {
        Ok(())
    } else {
        Err(AppError::from(Error::Invalid(format!(
            "priority must be one of {PRIORITIES:?}"
        ))))
    }
}

/// Validate a user-supplied label: non-empty, length-bounded, and free of the
/// reserved index separator.
fn validate_user_label(label: &str) -> app::Result<()> {
    validate_label(label).map_err(AppError::from)?;
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

    const OTHER: [u8; 32] = [0x22; 32];

    fn new_issue(app: &mut TestHost<IssueTracker>) -> String {
        app.call(|s| {
            s.create_issue(
                "Login broken".into(),
                "Clicking login does nothing".into(),
                "high".into(),
                vec!["bug".into()],
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

        let all = app.view(|s| s.list_issues(None, None, None)).unwrap();
        assert_eq!(all.len(), 1);
        // create_issue emits exactly one event.
        assert_eq!(app.events().len(), 1);
    }

    #[test]
    fn create_issue_rejects_bad_priority() {
        let mut app = TestHost::new(IssueTracker::init);
        assert!(app
            .call(|s| s.create_issue("t".into(), "d".into(), "sky-high".into(), vec![]))
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

        assert!(app.call(|s| s.set_status(id.clone(), "Nope".into())).is_err());
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

        app.call(|s| s.remove_label(id.clone(), "bug".into())).unwrap();
        let labels = app.view(|s| s.get_issue(id.clone())).unwrap().issue.labels;
        assert_eq!(labels, vec!["frontend".to_string()]);
    }

    #[test]
    fn list_issues_filters_by_status_assignee_and_label() {
        let mut app = TestHost::new(IssueTracker::init);
        let a = new_issue(&mut app);
        let b = app
            .call(|s| s.create_issue("Other".into(), "d".into(), "low".into(), vec![]))
            .unwrap();

        app.call(|s| s.set_status(a.clone(), "Done".into())).unwrap();
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
        assert_eq!(app.view(|s| s.list_issues(None, None, None)).unwrap().len(), 2);
        assert!(b != a);
    }

    #[test]
    fn status_counts_match_board() {
        let mut app = TestHost::new(IssueTracker::init);
        let a = new_issue(&mut app);
        let _b = app
            .call(|s| s.create_issue("Other".into(), "d".into(), "low".into(), vec![]))
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

        app.call(|s| s.edit_comment(c.clone(), "edited".into())).unwrap();
        let detail = app.view(|s| s.get_issue(id.clone())).unwrap();
        assert_eq!(detail.comments[0].body, "edited");
        assert!(detail.comments[0].edited_at.is_some());

        app.call(|s| s.delete_comment(c.clone())).unwrap();
        assert!(app.view(|s| s.get_issue(id)).unwrap().comments.is_empty());
    }

    #[test]
    fn non_author_cannot_edit_or_delete_comment() {
        let mut app = TestHost::new(IssueTracker::init);
        let id = new_issue(&mut app);
        let c = app
            .call(|s| s.add_comment(id.clone(), "mine".into()))
            .unwrap();

        // A different executor is not the author — both must be rejected.
        assert!(app
            .call_as(OTHER, |s| s.edit_comment(c.clone(), "hax".into()))
            .is_err());
        assert!(app.call_as(OTHER, |s| s.delete_comment(c.clone())).is_err());
        // The comment survives the rejected attempts.
        assert_eq!(app.view(|s| s.get_issue(id)).unwrap().comments.len(), 1);
    }
}
