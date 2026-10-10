//! Stored records (Borsh, internal) and the views callers receive (serde, ABI).
//!
//! Two kinds of record, matching the two kinds of thing in a set of books:
//!
//! - **Working data** the team edits together — the chart of accounts, tax
//!   rates, contacts, draft invoices, imported statement lines. Every mutable
//!   field is its own `LwwRegister`, so two people editing different fields of
//!   one record both keep their edit. Merges are hand-written (#2577 re-keying).
//! - **Posted records** — an invoice's approval, a payment, a spend or receive
//!   money transaction, a manual journal, a void. These are what the ledger is
//!   made of, and in accounting a posted record is never edited, only reversed.
//!   They live in `WriteOnce` collections: nobody, the poster included, can
//!   change or remove one on any node, and the poster is the entry's owner
//!   stamp rather than a field anyone could write. Their merge keeps a
//!   deterministic winner of a (theoretical) id race, and never mixes two.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable};

pub use crate::money::Line;

// ---------------------------------------------------------------------------
// Working data
// ---------------------------------------------------------------------------

/// One account in the chart of accounts.
#[app::mergeable(id = "mero_books::Account")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Account {
    pub id: String,
    pub code: LwwRegister<String>,
    pub name: LwwRegister<String>,
    /// One of `ACCOUNT_TYPES`.
    pub account_type: LwwRegister<String>,
    pub description: LwwRegister<String>,
    /// The tax rate a new line coded to this account starts with.
    pub default_tax_rate_id: LwwRegister<Option<String>>,
    pub archived: LwwRegister<bool>,
    pub created_at: u64,
}

impl Mergeable for Account {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.created_at = other.created_at;
        }
        self.code.merge(&other.code);
        self.name.merge(&other.name);
        self.account_type.merge(&other.account_type);
        self.description.merge(&other.description);
        self.default_tax_rate_id.merge(&other.default_tax_rate_id);
        self.archived.merge(&other.archived);
        Ok(())
    }
}

#[app::mergeable(id = "mero_books::TaxRate")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct TaxRate {
    pub id: String,
    pub name: LwwRegister<String>,
    /// Basis points: 2000 is 20%.
    pub rate_bp: LwwRegister<u32>,
    pub archived: LwwRegister<bool>,
    pub created_at: u64,
}

impl Mergeable for TaxRate {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.created_at = other.created_at;
        }
        self.name.merge(&other.name);
        self.rate_bp.merge(&other.rate_bp);
        self.archived.merge(&other.archived);
        Ok(())
    }
}

/// A customer, a supplier, or both — which one is derived from the documents.
#[app::mergeable(id = "mero_books::Contact")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Contact {
    pub id: String,
    pub name: LwwRegister<String>,
    pub email: LwwRegister<String>,
    pub phone: LwwRegister<String>,
    pub address: LwwRegister<String>,
    pub tax_number: LwwRegister<String>,
    pub created_at: u64,
}

impl Mergeable for Contact {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.created_at = other.created_at;
        }
        self.name.merge(&other.name);
        self.email.merge(&other.email);
        self.phone.merge(&other.phone);
        self.address.merge(&other.address);
        self.tax_number.merge(&other.tax_number);
        Ok(())
    }
}

/// A sales invoice or a bill while it is a DRAFT. Approving it freezes a copy
/// into `approvals`, and from then on the ledger reads that copy, never this
/// row — so an edit to these registers after approval (which honest nodes
/// refuse, and a patched node could still write) changes nothing posted.
#[app::mergeable(id = "mero_books::Invoice")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Invoice {
    pub id: String,
    /// `sales` or `bill`. Fixed at creation.
    #[index]
    pub kind: String,
    #[index]
    pub contact_id: LwwRegister<String>,
    pub reference: LwwRegister<String>,
    pub issue_date: LwwRegister<String>,
    pub due_date: LwwRegister<String>,
    pub amounts_are: LwwRegister<String>,
    /// The lines as one value: a draft is edited as a whole form, and two
    /// people re-ordering one invoice's lines should not interleave them.
    pub lines: LwwRegister<Vec<Line>>,
    /// Terms or a note printed on the invoice.
    pub notes: LwwRegister<String>,
    pub created_at: u64,
}

impl Mergeable for Invoice {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.kind = other.kind.clone();
            self.created_at = other.created_at;
        }
        self.contact_id.merge(&other.contact_id);
        self.reference.merge(&other.reference);
        self.issue_date.merge(&other.issue_date);
        self.due_date.merge(&other.due_date);
        self.amounts_are.merge(&other.amounts_are);
        self.lines.merge(&other.lines);
        self.notes.merge(&other.notes);
        Ok(())
    }
}

/// One line of a bank statement, imported from the bank's CSV.
///
/// The id is a hash of the line's content (see `statement_line_id`), so two
/// members importing the same file produce the same rows rather than two
/// copies, and re-importing an overlapping file adds only the new lines.
#[app::mergeable(id = "mero_books::StatementLine")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct StatementLine {
    pub id: String,
    #[index]
    pub bank_account_id: String,
    pub date: String,
    pub description: String,
    /// Signed: money in is positive, money out negative.
    pub amount: i64,
    /// The payment or bank transaction it is reconciled against. Whether the
    /// line counts as reconciled is derived on read: the target must exist,
    /// be live, sit in the same bank account and move the same amount.
    pub matched: LwwRegister<Option<String>>,
    pub created_at: u64,
}

impl Mergeable for StatementLine {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.bank_account_id = other.bank_account_id.clone();
            self.date = other.date.clone();
            self.description = other.description.clone();
            self.amount = other.amount;
            self.created_at = other.created_at;
        }
        self.matched.merge(&other.matched);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Posted records (WriteOnce)
// ---------------------------------------------------------------------------

/// Keep the deterministic winner of an id race between two immutable records.
macro_rules! immutable_merge {
    ($ty:ty) => {
        impl Mergeable for $ty {
            fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
                let mine = calimero_sdk::borsh::to_vec(&*self).unwrap_or_default();
                let theirs = calimero_sdk::borsh::to_vec(other).unwrap_or_default();
                if (other.at, &theirs) < (self.at, &mine) {
                    *self = other.clone();
                }
                Ok(())
            }
        }
    };
}

/// An approved invoice or bill, frozen at the moment of approval.
#[app::mergeable(id = "mero_books::Approval")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Approval {
    pub kind: String,
    pub contact_id: String,
    pub reference: String,
    pub issue_date: String,
    pub due_date: String,
    pub amounts_are: String,
    pub lines: Vec<Line>,
    pub notes: String,
    pub at: u64,
}
immutable_merge!(Approval);

/// Money received against an invoice, or paid against a bill.
#[app::mergeable(id = "mero_books::Payment")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Payment {
    #[index]
    pub invoice_id: String,
    pub bank_account_id: String,
    pub date: String,
    /// Always positive; the direction comes from the invoice's kind.
    pub amount: i64,
    pub reference: String,
    pub at: u64,
}
immutable_merge!(Payment);

/// Spend money or receive money: a bank movement coded straight to accounts,
/// with no invoice behind it (bank fees, a card purchase, interest received).
#[app::mergeable(id = "mero_books::BankTransaction")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BankTransaction {
    /// `spend` or `receive`.
    pub kind: String,
    pub bank_account_id: String,
    pub contact_id: Option<String>,
    pub date: String,
    pub reference: String,
    pub amounts_are: String,
    pub lines: Vec<Line>,
    pub at: u64,
}
immutable_merge!(BankTransaction);

#[derive(
    Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct JournalLine {
    pub account_id: String,
    pub description: String,
    pub debit: i64,
    pub credit: i64,
}

/// A manual journal — and a bank transfer, which is a two-line journal.
#[app::mergeable(id = "mero_books::Journal")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Journal {
    pub date: String,
    pub narration: String,
    pub lines: Vec<JournalLine>,
    /// `journal` or `transfer`.
    pub source: String,
    pub at: u64,
}
immutable_merge!(Journal);

/// A void: the reversal of a posted record. Any member's void voids it; there
/// is no un-void, exactly as on paper.
#[app::mergeable(id = "mero_books::VoidRecord")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct VoidRecord {
    pub reason: String,
    pub at: u64,
}
immutable_merge!(VoidRecord);

/// One entry in a record's audit trail, or a note on it. `Authored`: the author
/// is the owner stamp, and nobody else can rewrite or remove it.
#[app::mergeable(id = "mero_books::HistoryEntry")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct HistoryEntry {
    #[index]
    pub record_id: String,
    pub action: String,
    pub detail: String,
    pub at: u64,
}
immutable_merge!(HistoryEntry);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// A document line as the form sends it. The tax rate is captured from
/// `tax_rate_id` on save.
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LineInput {
    pub description: String,
    pub quantity: u64,
    pub unit_price: i64,
    pub account_id: String,
    pub tax_rate_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct StatementLineInput {
    pub date: String,
    pub description: String,
    pub amount: i64,
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Settings {
    pub organisation_name: String,
    pub currency: String,
    /// The month the financial year ends in, 1..=12.
    pub fy_end_month: u32,
    pub invoice_prefix: String,
    pub payment_terms_days: u32,
    /// What tax is called here: Tax, VAT, GST, Sales Tax.
    pub tax_label: String,
    pub tax_number: String,
    /// Nothing dated on or before it can be posted or voided.
    pub lock_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AccountView {
    pub id: String,
    pub code: String,
    pub name: String,
    pub account_type: String,
    /// asset, liability, equity, revenue or expense — derived from the type.
    pub class: String,
    pub description: String,
    pub default_tax_rate_id: Option<String>,
    pub archived: bool,
    /// AR, AP, sales tax and retained earnings: the ledger needs them.
    pub system: bool,
    /// All-time ledger balance, debit positive.
    pub balance: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TaxRateView {
    pub id: String,
    pub name: String,
    pub rate_bp: u32,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ContactView {
    pub id: String,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub address: String,
    pub tax_number: String,
    /// Outstanding on approved sales invoices: what they owe you.
    pub receivable: i64,
    /// Outstanding on approved bills: what you owe them.
    pub payable: i64,
    pub invoice_count: u32,
    pub bill_count: u32,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LineView {
    pub description: String,
    pub quantity: u64,
    pub unit_price: i64,
    pub account_id: String,
    pub tax_rate_id: String,
    pub tax_bp: u32,
    pub net: i64,
    pub tax: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct InvoiceView {
    pub id: String,
    pub kind: String,
    /// `INV-0007` for an approved sales invoice: its position among approved
    /// sales invoices, derived on read. Empty for drafts and bills (a bill's
    /// number is the supplier's, in `reference`).
    pub number: String,
    /// draft, awaiting_payment, paid or void. Overdue is the reader's call:
    /// it depends on today.
    pub status: String,
    pub contact_id: String,
    pub contact_name: String,
    pub reference: String,
    pub issue_date: String,
    pub due_date: String,
    pub amounts_are: String,
    pub lines: Vec<LineView>,
    pub notes: String,
    pub subtotal: i64,
    pub tax_total: i64,
    pub total: i64,
    pub paid: i64,
    pub amount_due: i64,
    pub approved_at: Option<u64>,
    pub approved_by: String,
    pub void_reason: String,
    /// More than one member filed an approval for this invoice. Only possible
    /// from a patched node; the earliest is used and the UI says so.
    pub conflicted: bool,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PaymentView {
    pub id: String,
    pub invoice_id: String,
    pub invoice_kind: String,
    pub bank_account_id: String,
    pub date: String,
    pub amount: i64,
    pub reference: String,
    pub recorded_by: String,
    pub voided: bool,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct BankTransactionView {
    pub id: String,
    pub kind: String,
    pub bank_account_id: String,
    pub contact_id: Option<String>,
    pub contact_name: String,
    pub date: String,
    pub reference: String,
    pub amounts_are: String,
    pub lines: Vec<LineView>,
    pub subtotal: i64,
    pub tax_total: i64,
    pub total: i64,
    pub recorded_by: String,
    pub voided: bool,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct JournalView {
    pub id: String,
    pub date: String,
    pub narration: String,
    pub source: String,
    pub lines: Vec<JournalLine>,
    pub total: i64,
    /// False for a journal that does not balance — only a patched node can
    /// write one. It is left out of the ledger and shown so someone voids it.
    pub balanced: bool,
    pub posted_by: String,
    pub voided: bool,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct StatementLineView {
    pub id: String,
    pub bank_account_id: String,
    pub date: String,
    pub description: String,
    pub amount: i64,
    pub matched: Option<String>,
    pub reconciled: bool,
    /// What it is matched to, for the reconcile screen ("INV-0003 · Acme").
    pub match_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct HistoryView {
    pub id: String,
    pub record_id: String,
    pub action: String,
    pub detail: String,
    pub author: String,
    pub at: u64,
}

/// An invoice with its payments and audit trail (named struct, never a tuple).
#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct InvoiceDetail {
    pub invoice: InvoiceView,
    pub payments: Vec<PaymentView>,
    pub history: Vec<HistoryView>,
}

// ── Reports ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ReportRow {
    pub account_id: String,
    pub code: String,
    pub name: String,
    pub amount: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ReportSection {
    pub title: String,
    pub rows: Vec<ReportRow>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ProfitAndLoss {
    pub from: String,
    pub to: String,
    pub income: ReportSection,
    pub cost_of_sales: ReportSection,
    pub gross_profit: i64,
    pub other_income: ReportSection,
    pub expenses: ReportSection,
    pub net_profit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct BalanceSheet {
    pub as_at: String,
    pub assets: Vec<ReportSection>,
    pub total_assets: i64,
    pub liabilities: Vec<ReportSection>,
    pub total_liabilities: i64,
    pub net_assets: i64,
    pub equity: ReportSection,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TrialBalanceRow {
    pub account_id: String,
    pub code: String,
    pub name: String,
    pub account_type: String,
    pub debit: i64,
    pub credit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TrialBalance {
    pub as_at: String,
    pub rows: Vec<TrialBalanceRow>,
    pub total_debit: i64,
    pub total_credit: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AgedRow {
    pub contact_id: String,
    pub contact_name: String,
    /// Not yet due.
    pub current: i64,
    pub days_1_30: i64,
    pub days_31_60: i64,
    pub days_61_90: i64,
    pub over_90: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AgedReport {
    /// `sales` (aged receivables) or `bill` (aged payables).
    pub kind: String,
    pub as_at: String,
    pub rows: Vec<AgedRow>,
    pub totals: AgedRow,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TaxRow {
    pub tax_rate_id: String,
    pub name: String,
    pub rate_bp: u32,
    pub sales_net: i64,
    pub sales_tax: i64,
    pub purchases_net: i64,
    pub purchases_tax: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TaxReport {
    pub from: String,
    pub to: String,
    pub rows: Vec<TaxRow>,
    pub sales_tax: i64,
    pub purchases_tax: i64,
    /// Positive: owed to the tax authority. Negative: a refund is due.
    pub net_tax: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LedgerRow {
    pub date: String,
    pub source_kind: String,
    pub source_id: String,
    pub reference: String,
    pub contact_name: String,
    pub description: String,
    pub debit: i64,
    pub credit: i64,
    /// Running balance, debit positive.
    pub balance: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AccountTransactions {
    pub account_id: String,
    pub from: String,
    pub to: String,
    pub opening_balance: i64,
    pub rows: Vec<LedgerRow>,
    pub closing_balance: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct BankAccountSummary {
    pub account_id: String,
    pub code: String,
    pub name: String,
    /// The ledger's balance for the account.
    pub balance: i64,
    /// The sum of every imported statement line.
    pub statement_balance: i64,
    pub unreconciled: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DocumentTotals {
    pub draft_count: u32,
    pub draft_total: i64,
    pub awaiting_count: u32,
    pub awaiting_total: i64,
    pub overdue_count: u32,
    pub overdue_total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MonthFlow {
    /// `YYYY-MM`.
    pub month: String,
    pub money_in: i64,
    pub money_out: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Dashboard {
    pub today: String,
    pub bank_accounts: Vec<BankAccountSummary>,
    pub receivables: DocumentTotals,
    pub payables: DocumentTotals,
    pub cash_flow: Vec<MonthFlow>,
    /// Net profit for the financial year to `today`.
    pub profit_ytd: i64,
    pub income_ytd: i64,
    pub expenses_ytd: i64,
}
