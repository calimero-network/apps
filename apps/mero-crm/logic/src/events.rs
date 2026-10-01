//! Events emitted by the CRM service. Borrowed `&'a str` fields keep emission
//! allocation-free (the SDK serialises them before the borrow ends).
//!
//! The frontend does not switch on these — it re-reads on any sync event — but
//! they are the audit trail an agent or an integration subscribes to.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A deal was added to the pipeline.
    DealCreated { id: &'a str, stage_id: &'a str },
    /// One of a deal's fields (title, value, contact, owner, …) changed.
    DealUpdated { id: &'a str },
    /// A deal moved to another stage.
    DealMoved { id: &'a str, stage_id: &'a str },
    /// A deal was closed as won, closed as lost, or reopened.
    DealStatusChanged { id: &'a str, status: &'a str },
    /// A deal was deleted, with its activities and notes.
    DealDeleted { id: &'a str },
    /// A person was added, edited or removed.
    ContactChanged { id: &'a str },
    /// An activity was scheduled, completed, rescheduled or deleted.
    ActivityChanged { id: &'a str },
    /// An automation scheduled an activity when a deal entered a stage.
    AutomationFired {
        automation_id: &'a str,
        deal_id: &'a str,
    },
    /// A note was added to or removed from a deal.
    NoteChanged { id: &'a str, deal_id: &'a str },
    /// A stage was added, renamed, re-weighted, reordered or removed.
    StagesChanged {},
    /// An automation rule was added, toggled or removed.
    AutomationsChanged {},
    /// The pipeline's currency or rotting threshold changed.
    SettingsChanged {},
}
