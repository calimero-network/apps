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
    /// A cell was cleared (removed).
    CellCleared {
        sheet_id: &'a str,
        row: u32,
        col: u32,
    },
    /// A batch of cells was applied via `apply_cell_ops`. ONE event per batch
    /// (not one per cell) so a large batch stays under the runtime's per-commit
    /// event cap (`max_events`); subscribers refresh once for the whole apply.
    CellsChanged { sheet_id: &'a str, count: u32 },
    /// A collaborator moved their cursor.
    CursorMoved { author: &'a str, sheet_id: &'a str },
    /// A collaborator's cursor was removed.
    CursorRemoved { author: &'a str },
}
