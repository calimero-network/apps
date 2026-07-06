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
    CellCleared { sheet_id: &'a str, row: u32, col: u32 },
    /// A collaborator moved their cursor.
    CursorMoved { author: &'a str, sheet_id: &'a str },
    /// A collaborator's cursor was removed.
    CursorRemoved { author: &'a str },
}
