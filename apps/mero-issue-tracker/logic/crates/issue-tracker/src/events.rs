//! Events emitted by the issue-tracker service. Borrowed `&'a str` fields keep
//! emission allocation-free (the SDK serialises them before the borrow ends).

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A new issue was created on the board.
    IssueCreated { id: &'a str, created_by: &'a str },
    /// An issue's status changed (moved columns).
    IssueStatusChanged { id: &'a str, status: &'a str },
    /// An issue's priority changed.
    IssuePriorityChanged { id: &'a str, priority: &'a str },
    /// An issue's assignee changed.
    IssueAssigneeChanged { id: &'a str },
    /// A label was added to or removed from an issue.
    IssueLabelsChanged { id: &'a str },
    /// A comment was posted to an issue's thread.
    CommentAdded { id: &'a str, issue_id: &'a str },
    /// A comment was edited by its author.
    CommentEdited { id: &'a str },
    /// A comment was deleted by its author.
    CommentDeleted { id: &'a str },
}
