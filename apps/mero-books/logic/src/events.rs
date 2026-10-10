//! Events emitted by the books service. Borrowed `&'a str` fields keep emission
//! allocation-free (the SDK serialises them before the borrow ends).
//!
//! The frontend does not switch on these — it re-reads on any sync event — but
//! they are the audit trail an agent or an integration subscribes to.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    /// A draft invoice or bill was created or edited.
    InvoiceSaved { id: &'a str, kind: &'a str },
    /// A draft was deleted.
    InvoiceDeleted { id: &'a str },
    /// An invoice or bill was approved and posted to the ledger.
    InvoiceApproved { id: &'a str, kind: &'a str },
    /// A payment was recorded against an invoice or bill.
    PaymentRecorded { id: &'a str, invoice_id: &'a str },
    /// Spend money or receive money was recorded.
    BankTransactionRecorded { id: &'a str, kind: &'a str },
    /// A manual journal or a transfer was posted.
    JournalPosted { id: &'a str },
    /// A posted record was voided.
    RecordVoided { id: &'a str },
    /// Statement lines were imported, reconciled, unreconciled or removed.
    StatementChanged { bank_account_id: &'a str },
    /// The chart of accounts changed.
    AccountsChanged {},
    /// The tax rates changed.
    TaxRatesChanged {},
    /// A contact was added, edited or removed.
    ContactChanged { id: &'a str },
    /// A note was added to a record.
    NoteAdded { record_id: &'a str },
    /// Organisation settings or the lock date changed.
    SettingsChanged {},
}
