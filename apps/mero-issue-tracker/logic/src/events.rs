//! Events emitted by the issue-tracker service. Borrowed `&'a str` fields keep
//! emission allocation-free (the SDK serialises them before the borrow ends).

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A new issue was created on the board.
    IssueCreated {
        /// The new issue's id.
        id: &'a str,
        /// The filer's account id (hex).
        created_by: &'a str,
    },
    /// One of an issue's text sections changed (summary/impact/repro/resolution).
    IssueEdited {
        /// The issue's id.
        id: &'a str,
    },
    /// An issue was deleted, along with its triage state, its labels and the deleter's comments on it.
    IssueDeleted {
        /// The deleted issue's id.
        id: &'a str,
    },
    /// An issue's status changed (moved columns).
    IssueStatusChanged {
        /// The issue's id.
        id: &'a str,
        /// The new status.
        status: &'a str,
    },
    /// An issue's priority changed.
    IssuePriorityChanged {
        /// The issue's id.
        id: &'a str,
        /// The new priority.
        priority: &'a str,
    },
    /// An issue's assignee changed.
    IssueAssigneeChanged {
        /// The issue's id.
        id: &'a str,
    },
    /// A label was added to or removed from an issue.
    IssueLabelsChanged {
        /// The issue's id.
        id: &'a str,
    },
    /// A comment was posted to an issue's thread.
    CommentAdded {
        /// The new comment's id.
        id: &'a str,
        /// The issue it was posted on.
        issue_id: &'a str,
    },
    /// A comment was edited by its author.
    CommentEdited {
        /// The comment's id.
        id: &'a str,
    },
    /// A comment was deleted by its author.
    CommentDeleted {
        /// The deleted comment's id.
        id: &'a str,
    },
    /// The repository URL this context tracks was set or changed.
    RepoUrlChanged {
        /// The new URL.
        url: &'a str,
    },
}
