//! Events emitted by the spreadsheet service.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A new spreadsheet project was initialized.
    ProjectInitialized { id: &'a str, name: &'a str },
    /// A new sheet tab was created.
    SheetCreated { id: &'a str, name: &'a str },
    /// A sheet was renamed.
    SheetRenamed { id: &'a str, name: &'a str },
    /// A sheet (and all its cells) was deleted.
    SheetDeleted { id: &'a str },
    /// A cell's value was set or updated.
    CellUpdated { id: &'a str, sheet_id: &'a str },
    /// A cell was cleared.
    CellCleared {
        sheet_id: &'a str,
        row_id: &'a str,
        col_id: &'a str,
    },
    /// A batch of cells was applied via `apply_cell_ops`. ONE event per batch
    /// (not one per cell) so a large batch stays under the runtime's per-commit
    /// event cap (`max_events`); subscribers refresh once for the whole apply.
    CellsChanged { sheet_id: &'a str, count: u32 },
    /// Rows or columns were inserted or deleted via `apply_axis_ops`.
    AxesChanged { sheet_id: &'a str, count: u32 },
    /// A named range was defined, redefined or deleted.
    NamedRangesChanged { name: &'a str },
    /// A comment or reply was added; `mentions` are the member ids it names.
    CommentAdded {
        id: &'a str,
        sheet_id: &'a str,
        author: &'a str,
        mentions: &'a [String],
    },
    /// A comment was edited, resolved, reopened or deleted.
    CommentChanged { id: &'a str, sheet_id: &'a str },
    /// A member's workbook role changed.
    RolesChanged { member_id: &'a str },
    /// A protected range was added, changed or removed.
    ProtectionsChanged { sheet_id: &'a str },
    /// A link from this workbook was made or stopped.
    PublicationsChanged { sheet_id: &'a str },
    /// A linked sheet (pushed from another workbook) arrived, changed or went.
    LinkedChanged { sheet_id: &'a str },
    /// Cells in an alert rule's range started meeting its condition.
    AlertTriggered {
        rule_id: &'a str,
        sheet_id: &'a str,
        recipients: &'a [String],
        message: &'a str,
    },
    /// A file was attached to a cell, or removed.
    AttachmentsChanged { sheet_id: &'a str },
    /// A chart was added, changed or removed.
    ChartsChanged { sheet_id: &'a str },
    /// Cells' styles changed.
    StylesChanged { sheet_id: &'a str },
    /// A conditional format, colour scale or validation changed.
    RulesChanged { sheet_id: &'a str },
    /// A sheet's frozen panes or row and column sizes changed.
    SheetViewChanged { sheet_id: &'a str },
    /// A cell's note was edited.
    NoteChanged {
        sheet_id: &'a str,
        row_id: &'a str,
        col_id: &'a str,
    },
    /// The state was migrated to a new schema.
    Migrated {
        from_version: &'a str,
        to_version: &'a str,
    },
    /// A device announced itself under a nickname for the first time.
    MemberJoined { id: &'a str, nickname: &'a str },
    /// A member changed the nickname they are shown under.
    MemberRenamed { id: &'a str, nickname: &'a str },
}
