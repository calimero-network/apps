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
