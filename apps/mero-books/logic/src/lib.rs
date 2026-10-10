//! Books service — one organisation's accounts, kept by the team that keeps them.
//!
//! One context is one organisation. It holds a chart of accounts, tax rates,
//! contacts, sales invoices and bills, the payments against them, money spent
//! and received straight from the bank, manual journals, imported bank
//! statements, and an audit trail. Every member of the namespace works the
//! same ledger, live, replicated between their own nodes.
//!
//! Three rules shape the state, and each answers "what could go wrong when a
//! member's node runs code other than this file":
//!
//! - **Posted records are write-once.** An approval (the frozen copy of an
//!   invoice), a payment, a bank transaction, a journal and a void each live in
//!   a `WriteOnce` collection. In accounting a posted entry is never edited,
//!   only reversed, and here that is storage-enforced: no node accepts an edit
//!   or removal of one, and who posted it is the entry's owner stamp.
//! - **Nothing is a stored balance.** The general ledger and every report are
//!   derived on read from the live posted records (`ledger.rs`). An invoice's
//!   number, its status, what is paid on it, a contact's balance and whether a
//!   statement line is reconciled are all derived too.
//! - **Working data is shared.** Accounts, tax rates, contacts, drafts and
//!   statement lines are the team's, writable by every member, with every
//!   mutable field its own `LwwRegister` so concurrent edits to different
//!   fields both survive. Updates write only the fields that changed.
//!
//! Money is `i64` minor units, quantities thousandths, tax rates basis points,
//! dates `YYYY-MM-DD` (see `money.rs`). Named-struct returns only (no tuples),
//! so every view is ABI-expressible.

use std::collections::BTreeMap;

use calimero_sdk::app;
use calimero_sdk::env;
use calimero_sdk::types::Error as AppError;
use calimero_sdk::AccountId;
use calimero_storage::collections::{Authored, IndexedMap, LwwRegister, UnorderedMap, WriteOnce};
use calimero_storage::env as storage_env;
use sha2::{Digest, Sha256};

pub mod events;
pub mod ledger;
pub mod model;
pub mod money;

use events::Event;
use ledger::{elect, Ledger, ACCOUNT_TYPES, CONTROL_ACCOUNTS, SYSTEM_ACCOUNTS};
pub use model::*;
use money::AMOUNT_MODES;

#[cfg(test)]
mod tests;

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

pub const INVOICE_KINDS: [&str; 2] = ["sales", "bill"];
pub const BANK_TXN_KINDS: [&str; 2] = ["spend", "receive"];

/// The chart a new organisation starts with: (id, code, name, type). Fixed
/// ids, because `init` runs once on the creator's node and the rest of the
/// team receives the same entries by replication. Modelled on the default
/// chart small-business ledgers converge on.
const DEFAULT_ACCOUNTS: [(&str, &str, &str, &str); 27] = [
    ("acc-bank", "090", "Business Bank Account", "bank"),
    ("acc-ar", "610", "Accounts Receivable", "current_asset"),
    ("acc-prepayments", "620", "Prepayments", "current_asset"),
    ("acc-equipment", "710", "Office Equipment", "fixed_asset"),
    ("acc-ap", "800", "Accounts Payable", "current_liability"),
    ("acc-tax", "820", "Sales Tax", "current_liability"),
    ("acc-loan", "900", "Loan", "liability"),
    ("acc-retained", "960", "Retained Earnings", "equity"),
    ("acc-owner-funds", "970", "Owner Funds Introduced", "equity"),
    ("acc-sales", "200", "Sales", "revenue"),
    ("acc-other-revenue", "260", "Other Revenue", "revenue"),
    (
        "acc-interest-income",
        "270",
        "Interest Income",
        "other_income",
    ),
    ("acc-cogs", "310", "Cost of Goods Sold", "direct_costs"),
    ("acc-advertising", "400", "Advertising", "expense"),
    ("acc-bank-fees", "404", "Bank Fees", "expense"),
    (
        "acc-consulting",
        "412",
        "Consulting & Accounting",
        "expense",
    ),
    ("acc-entertainment", "420", "Entertainment", "expense"),
    ("acc-general", "429", "General Expenses", "expense"),
    ("acc-insurance", "433", "Insurance", "expense"),
    ("acc-utilities", "445", "Light, Power, Heating", "expense"),
    ("acc-office", "453", "Office Expenses", "expense"),
    ("acc-rent", "469", "Rent", "expense"),
    ("acc-repairs", "473", "Repairs and Maintenance", "expense"),
    ("acc-wages", "477", "Wages and Salaries", "expense"),
    ("acc-subscriptions", "485", "Subscriptions", "expense"),
    ("acc-telephone", "489", "Telephone & Internet", "expense"),
    ("acc-travel", "493", "Travel - National", "expense"),
];

/// (id, name, basis points). Renamed and re-rated to the local regime in
/// Settings; a new organisation needs *something* to code a line to.
const DEFAULT_TAX_RATES: [(&str, &str, u32); 5] = [
    ("tax-none", "No tax", 0),
    ("tax-standard", "Standard rate", 2_000),
    ("tax-reduced", "Reduced rate", 500),
    ("tax-zero", "Zero rated", 0),
    ("tax-exempt", "Exempt", 0),
];

const MAX_LINES: usize = 100;
const MAX_IMPORT: usize = 500;
const MAX_NAME_LEN: usize = 120;
const MAX_TEXT_LEN: usize = 2_000;
const MAX_UNIT_PRICE: i64 = 10_000_000_000_000;
const MAX_QUANTITY: u64 = 1_000_000_000_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct MeroBooks {
    // Working data.
    accounts: UnorderedMap<String, Account>,
    tax_rates: UnorderedMap<String, TaxRate>,
    contacts: UnorderedMap<String, Contact>,
    invoices: IndexedMap<String, Invoice>,
    statement_lines: IndexedMap<String, StatementLine>,
    // Posted records: written once, by the member the stamp names.
    approvals: WriteOnce<UnorderedMap<String, Approval>>,
    payments: WriteOnce<IndexedMap<String, Payment>>,
    bank_transactions: WriteOnce<UnorderedMap<String, BankTransaction>>,
    journals: WriteOnce<UnorderedMap<String, Journal>>,
    voids: WriteOnce<UnorderedMap<String, VoidRecord>>,
    /// Audit trail and notes, per record. Each entry is its author's.
    history: Authored<IndexedMap<String, HistoryEntry>>,
    // Settings.
    organisation_name: LwwRegister<String>,
    currency: LwwRegister<String>,
    fy_end_month: LwwRegister<u32>,
    invoice_prefix: LwwRegister<String>,
    payment_terms_days: LwwRegister<u32>,
    tax_label: LwwRegister<String>,
    tax_number: LwwRegister<String>,
    lock_date: LwwRegister<Option<String>>,
}

/// Mutate an `IndexedMap` entry in place, keeping its indexes in step, or bail
/// with `not found`.
macro_rules! update_or_404 {
    ($map:expr, $id:expr, $what:literal, $f:expr) => {
        $map.update(&$id, $f)
            .map_err(|e| AppError::msg(format!(concat!($what, ".update: {}"), e)))?
            .ok_or_else(|| not_found($what, &$id))?
    };
}

/// Fetch a mutable entry of an `UnorderedMap` or bail with `not found`.
macro_rules! get_mut_or_404 {
    ($map:expr, $id:expr, $what:literal) => {
        $map.get_mut(&$id)
            .map_err(|e| AppError::msg(format!(concat!($what, ".get_mut: {}"), e)))?
            .ok_or_else(|| not_found($what, &$id))?
    };
}

#[app::logic]
impl MeroBooks {
    #[app::init]
    pub fn init() -> MeroBooks {
        let mut accounts = UnorderedMap::new_with_field_name("books:accounts");
        for (id, code, name, account_type) in DEFAULT_ACCOUNTS {
            let default_tax = match account_type {
                "revenue" | "direct_costs" | "expense" => Some("tax-standard".to_string()),
                _ => Some("tax-none".to_string()),
            };
            let _ = accounts.insert(
                id.to_string(),
                Account {
                    id: id.to_string(),
                    code: LwwRegister::new(code.to_string()),
                    name: LwwRegister::new(name.to_string()),
                    account_type: LwwRegister::new(account_type.to_string()),
                    description: LwwRegister::new(String::new()),
                    default_tax_rate_id: LwwRegister::new(default_tax),
                    archived: LwwRegister::new(false),
                    created_at: 0,
                },
            );
        }
        let mut tax_rates = UnorderedMap::new_with_field_name("books:tax_rates");
        for (id, name, rate_bp) in DEFAULT_TAX_RATES {
            let _ = tax_rates.insert(
                id.to_string(),
                TaxRate {
                    id: id.to_string(),
                    name: LwwRegister::new(name.to_string()),
                    rate_bp: LwwRegister::new(rate_bp),
                    archived: LwwRegister::new(false),
                    created_at: 0,
                },
            );
        }
        MeroBooks {
            accounts,
            tax_rates,
            contacts: UnorderedMap::new_with_field_name("books:contacts"),
            invoices: IndexedMap::new_with_field_name("books:invoices"),
            statement_lines: IndexedMap::new_with_field_name("books:statement_lines"),
            approvals: WriteOnce::new_with_field_name("books:approvals"),
            payments: WriteOnce::new_with_field_name("books:payments"),
            bank_transactions: WriteOnce::new_with_field_name("books:bank_transactions"),
            journals: WriteOnce::new_with_field_name("books:journals"),
            voids: WriteOnce::new_with_field_name("books:voids"),
            history: Authored::new_with_field_name("books:history"),
            organisation_name: LwwRegister::new(String::new()),
            currency: LwwRegister::new("USD".to_string()),
            fy_end_month: LwwRegister::new(12),
            invoice_prefix: LwwRegister::new("INV-".to_string()),
            payment_terms_days: LwwRegister::new(30),
            tax_label: LwwRegister::new("Tax".to_string()),
            tax_number: LwwRegister::new(String::new()),
            lock_date: LwwRegister::new(None),
        }
    }

    // ── Settings ────────────────────────────────────────────────────────────

    pub fn get_settings(&self) -> app::Result<Settings> {
        Ok(Settings {
            organisation_name: self.organisation_name.get().clone(),
            currency: self.currency.get().clone(),
            // Clamped on read: any member can write the register directly.
            fy_end_month: (*self.fy_end_month.get()).clamp(1, 12),
            invoice_prefix: self.invoice_prefix.get().clone(),
            payment_terms_days: (*self.payment_terms_days.get()).min(365),
            tax_label: self.tax_label.get().clone(),
            tax_number: self.tax_number.get().clone(),
            lock_date: self.lock_date.get().clone().filter(|d| money::is_date(d)),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_settings(
        &mut self,
        organisation_name: String,
        currency: String,
        fy_end_month: u32,
        invoice_prefix: String,
        payment_terms_days: u32,
        tax_label: String,
        tax_number: String,
    ) -> app::Result<()> {
        validate_optional_name("organisation_name", &organisation_name)?;
        let code = currency.trim().to_ascii_uppercase();
        if code.len() != 3 || !code.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(invalid("currency must be a three-letter code such as USD"));
        }
        if !(1..=12).contains(&fy_end_month) {
            return Err(invalid("fy_end_month must be between 1 and 12"));
        }
        if invoice_prefix.chars().count() > 10 {
            return Err(invalid("invoice_prefix must be at most 10 characters"));
        }
        if payment_terms_days > 365 {
            return Err(invalid("payment_terms_days must be at most 365"));
        }
        validate_name("tax_label", &tax_label)?;
        validate_optional_name("tax_number", &tax_number)?;
        set_if_changed(
            &mut self.organisation_name,
            organisation_name.trim().to_string(),
        );
        set_if_changed(&mut self.currency, code);
        set_if_changed(&mut self.fy_end_month, fy_end_month);
        set_if_changed(&mut self.invoice_prefix, invoice_prefix.trim().to_string());
        set_if_changed(&mut self.payment_terms_days, payment_terms_days);
        set_if_changed(&mut self.tax_label, tax_label.trim().to_string());
        set_if_changed(&mut self.tax_number, tax_number.trim().to_string());
        app::emit!(Event::SettingsChanged {});
        Ok(())
    }

    /// Lock the ledger up to and including a date (a filed tax period, a closed
    /// year), or unlock them with `None`. Honest nodes refuse to post or void
    /// anything dated on or before it.
    pub fn set_lock_date(&mut self, lock_date: Option<String>) -> app::Result<()> {
        let lock_date = normalize_opt(lock_date);
        if let Some(d) = &lock_date {
            validate_date("lock_date", d)?;
        }
        set_if_changed(&mut self.lock_date, lock_date.clone());
        self.log(
            "settings",
            "lock_date",
            &lock_date.map_or("Books unlocked".to_string(), |d| {
                format!("Locked through {d}")
            }),
        )?;
        app::emit!(Event::SettingsChanged {});
        Ok(())
    }

    // ── Chart of accounts ───────────────────────────────────────────────────

    /// The chart, by code, each account with its all-time ledger balance.
    pub fn list_accounts(&self, include_archived: bool) -> app::Result<Vec<AccountView>> {
        let ledger = self.ledger()?;
        let balances = Ledger::balances(&ledger.entries(), |_| true);
        let mut out: Vec<AccountView> = ledger
            .accounts
            .values()
            .filter(|a| include_archived || !*a.archived.get())
            .map(|a| {
                let account_type = a.account_type.get().clone();
                AccountView {
                    id: a.id.clone(),
                    code: a.code.get().clone(),
                    name: a.name.get().clone(),
                    class: ledger::account_class(&account_type).to_string(),
                    account_type,
                    description: a.description.get().clone(),
                    default_tax_rate_id: a.default_tax_rate_id.get().clone(),
                    archived: *a.archived.get(),
                    system: SYSTEM_ACCOUNTS.contains(&a.id.as_str()),
                    balance: balances.get(&a.id).copied().unwrap_or(0),
                }
            })
            .collect();
        out.sort_by(|a, b| (&a.code, &a.name, &a.id).cmp(&(&b.code, &b.name, &b.id)));
        Ok(out)
    }

    pub fn create_account(
        &mut self,
        code: String,
        name: String,
        account_type: String,
        description: String,
        default_tax_rate_id: Option<String>,
    ) -> app::Result<String> {
        let default_tax_rate_id = normalize_opt(default_tax_rate_id);
        self.validate_account(
            None,
            &code,
            &name,
            &account_type,
            &description,
            &default_tax_rate_id,
        )?;
        let now = now_ms();
        let id = new_id("acc", now);
        self.accounts
            .insert(
                id.clone(),
                Account {
                    id: id.clone(),
                    code: LwwRegister::new(code.trim().to_string()),
                    name: LwwRegister::new(name.trim().to_string()),
                    account_type: LwwRegister::new(account_type),
                    description: LwwRegister::new(description.trim().to_string()),
                    default_tax_rate_id: LwwRegister::new(default_tax_rate_id),
                    archived: LwwRegister::new(false),
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("accounts.insert: {e}")))?;
        self.log(
            &id,
            "created",
            &format!("Account {} {}", code.trim(), name.trim()),
        )?;
        app::emit!(Event::AccountsChanged {});
        Ok(id)
    }

    pub fn update_account(
        &mut self,
        account_id: String,
        code: String,
        name: String,
        account_type: String,
        description: String,
        default_tax_rate_id: Option<String>,
    ) -> app::Result<()> {
        let default_tax_rate_id = normalize_opt(default_tax_rate_id);
        self.validate_account(
            Some(&account_id),
            &code,
            &name,
            &account_type,
            &description,
            &default_tax_rate_id,
        )?;
        let system = SYSTEM_ACCOUNTS.contains(&account_id.as_str());
        let mut a = get_mut_or_404!(self.accounts, account_id, "account");
        if system && a.account_type.get() != &account_type {
            return Err(invalid("a system account's type cannot change"));
        }
        set_if_changed(&mut a.code, code.trim().to_string());
        set_if_changed(&mut a.name, name.trim().to_string());
        set_if_changed(&mut a.account_type, account_type);
        set_if_changed(&mut a.description, description.trim().to_string());
        set_if_changed(&mut a.default_tax_rate_id, default_tax_rate_id);
        drop(a);
        app::emit!(Event::AccountsChanged {});
        Ok(())
    }

    /// Archive an account (hide it from pickers, keep its history) or restore it.
    pub fn set_account_archived(&mut self, account_id: String, archived: bool) -> app::Result<()> {
        if archived && SYSTEM_ACCOUNTS.contains(&account_id.as_str()) {
            return Err(invalid("a system account cannot be archived"));
        }
        let mut a = get_mut_or_404!(self.accounts, account_id, "account");
        set_if_changed(&mut a.archived, archived);
        drop(a);
        app::emit!(Event::AccountsChanged {});
        Ok(())
    }

    /// Delete an account nothing has ever been coded to. One with history is
    /// archived instead: the ledger has to keep naming it.
    pub fn delete_account(&mut self, account_id: String) -> app::Result<()> {
        if SYSTEM_ACCOUNTS.contains(&account_id.as_str()) {
            return Err(invalid("a system account cannot be deleted"));
        }
        if !self.accounts.contains(&account_id)? {
            return Err(not_found("account", &account_id));
        }
        let ledger = self.ledger()?;
        let used = ledger.entries().iter().any(|e| e.account_id == account_id)
            || ledger
                .drafts
                .values()
                .any(|d| d.lines.get().iter().any(|l| l.account_id == account_id))
            || ledger
                .statement
                .values()
                .any(|l| l.bank_account_id == account_id);
        if used {
            return Err(invalid("this account has transactions; archive it instead"));
        }
        let _ = self.accounts.remove(&account_id)?;
        app::emit!(Event::AccountsChanged {});
        Ok(())
    }

    // ── Tax rates ───────────────────────────────────────────────────────────

    pub fn list_tax_rates(&self) -> app::Result<Vec<TaxRateView>> {
        let mut out: Vec<TaxRateView> = self
            .tax_rates
            .entries()?
            .map(|(_, r)| TaxRateView {
                id: r.id.clone(),
                name: r.name.get().clone(),
                rate_bp: (*r.rate_bp.get()).min(money::MAX_TAX_BP),
                archived: *r.archived.get(),
            })
            .collect();
        out.sort_by(|a, b| (a.rate_bp, &a.name, &a.id).cmp(&(b.rate_bp, &b.name, &b.id)));
        Ok(out)
    }

    pub fn create_tax_rate(&mut self, name: String, rate_bp: u32) -> app::Result<String> {
        validate_name("name", &name)?;
        validate_rate(rate_bp)?;
        let now = now_ms();
        let id = new_id("tax", now);
        self.tax_rates
            .insert(
                id.clone(),
                TaxRate {
                    id: id.clone(),
                    name: LwwRegister::new(name.trim().to_string()),
                    rate_bp: LwwRegister::new(rate_bp),
                    archived: LwwRegister::new(false),
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("tax_rates.insert: {e}")))?;
        app::emit!(Event::TaxRatesChanged {});
        Ok(id)
    }

    /// Rename or re-rate. Posted documents keep the rate they were saved with.
    pub fn update_tax_rate(
        &mut self,
        tax_rate_id: String,
        name: String,
        rate_bp: u32,
    ) -> app::Result<()> {
        validate_name("name", &name)?;
        validate_rate(rate_bp)?;
        let mut r = get_mut_or_404!(self.tax_rates, tax_rate_id, "tax rate");
        set_if_changed(&mut r.name, name.trim().to_string());
        set_if_changed(&mut r.rate_bp, rate_bp);
        drop(r);
        app::emit!(Event::TaxRatesChanged {});
        Ok(())
    }

    pub fn set_tax_rate_archived(
        &mut self,
        tax_rate_id: String,
        archived: bool,
    ) -> app::Result<()> {
        if archived && tax_rate_id == "tax-none" {
            return Err(invalid("the no-tax rate cannot be archived"));
        }
        let mut r = get_mut_or_404!(self.tax_rates, tax_rate_id, "tax rate");
        set_if_changed(&mut r.archived, archived);
        drop(r);
        app::emit!(Event::TaxRatesChanged {});
        Ok(())
    }

    // ── Contacts ────────────────────────────────────────────────────────────

    /// Everyone in the address book, by name, with what they owe and are owed.
    pub fn list_contacts(&self) -> app::Result<Vec<ContactView>> {
        let ledger = self.ledger()?;
        let mut owed: BTreeMap<String, (i64, i64, u32, u32)> = BTreeMap::new();
        for v in ledger.invoice_views(None) {
            let e = owed.entry(v.contact_id.clone()).or_default();
            if v.kind == "sales" {
                e.0 = e.0.saturating_add(v.amount_due);
                e.2 += 1;
            } else {
                e.1 = e.1.saturating_add(v.amount_due);
                e.3 += 1;
            }
        }
        let mut out: Vec<ContactView> = ledger
            .contacts
            .values()
            .map(|c| {
                let (receivable, payable, invoice_count, bill_count) =
                    owed.get(&c.id).copied().unwrap_or_default();
                contact_view(c, receivable, payable, invoice_count, bill_count)
            })
            .collect();
        out.sort_by(|a, b| (a.name.to_lowercase(), &a.id).cmp(&(b.name.to_lowercase(), &b.id)));
        Ok(out)
    }

    pub fn create_contact(
        &mut self,
        name: String,
        email: String,
        phone: String,
        address: String,
        tax_number: String,
    ) -> app::Result<String> {
        validate_contact(&name, &email, &phone, &address, &tax_number)?;
        let now = now_ms();
        let id = new_id("contact", now);
        self.contacts
            .insert(
                id.clone(),
                Contact {
                    id: id.clone(),
                    name: LwwRegister::new(name.trim().to_string()),
                    email: LwwRegister::new(email.trim().to_string()),
                    phone: LwwRegister::new(phone.trim().to_string()),
                    address: LwwRegister::new(address.trim().to_string()),
                    tax_number: LwwRegister::new(tax_number.trim().to_string()),
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("contacts.insert: {e}")))?;
        self.log(&id, "created", name.trim())?;
        app::emit!(Event::ContactChanged { id: &id });
        Ok(id)
    }

    pub fn update_contact(
        &mut self,
        contact_id: String,
        name: String,
        email: String,
        phone: String,
        address: String,
        tax_number: String,
    ) -> app::Result<()> {
        validate_contact(&name, &email, &phone, &address, &tax_number)?;
        let mut c = get_mut_or_404!(self.contacts, contact_id, "contact");
        set_if_changed(&mut c.name, name.trim().to_string());
        set_if_changed(&mut c.email, email.trim().to_string());
        set_if_changed(&mut c.phone, phone.trim().to_string());
        set_if_changed(&mut c.address, address.trim().to_string());
        set_if_changed(&mut c.tax_number, tax_number.trim().to_string());
        drop(c);
        app::emit!(Event::ContactChanged { id: &contact_id });
        Ok(())
    }

    /// Delete a contact no document names. One with documents stays: the
    /// ledger and the audit trail have to keep naming them.
    pub fn delete_contact(&mut self, contact_id: String) -> app::Result<()> {
        if !self.contacts.contains(&contact_id)? {
            return Err(not_found("contact", &contact_id));
        }
        let ledger = self.ledger()?;
        let used = ledger
            .invoice_views(None)
            .iter()
            .any(|v| v.contact_id == contact_id)
            || ledger
                .bank_txns
                .values()
                .any(|t| t.value.contact_id.as_deref() == Some(contact_id.as_str()));
        if used {
            return Err(invalid("this contact has invoices, bills or transactions"));
        }
        let _ = self.contacts.remove(&contact_id)?;
        app::emit!(Event::ContactChanged { id: &contact_id });
        Ok(())
    }

    // ── Invoices and bills ──────────────────────────────────────────────────

    /// Sales invoices and/or bills (`kind` = `sales` | `bill` | none for both),
    /// newest issue date first.
    pub fn list_invoices(&self, kind: Option<String>) -> app::Result<Vec<InvoiceView>> {
        Ok(self.ledger()?.invoice_views(kind.as_deref()))
    }

    pub fn get_invoice(&self, invoice_id: String) -> app::Result<InvoiceDetail> {
        let ledger = self.ledger()?;
        let invoice = ledger
            .invoice_view(
                &invoice_id,
                &ledger.invoice_numbers(),
                &ledger.paid_by_invoice(None),
            )
            .ok_or_else(|| not_found("invoice", &invoice_id))?;
        let mut payments: Vec<PaymentView> = self
            .payments
            .query("invoice_id")
            .eq(invoice_id.as_str())
            .keys()?
            .into_iter()
            .filter_map(|id| {
                ledger
                    .payments
                    .get(&id)
                    .map(|p| ledger.payment_view(&id, p))
            })
            .collect();
        payments.sort_by(|a, b| (&a.date, a.at, &a.id).cmp(&(&b.date, b.at, &b.id)));
        payments.dedup_by(|a, b| a.id == b.id);
        Ok(InvoiceDetail {
            invoice,
            payments,
            history: self.history_for(&invoice_id)?,
        })
    }

    /// Save a new draft invoice (`kind` = `sales`) or bill (`kind` = `bill`).
    #[allow(clippy::too_many_arguments)]
    pub fn create_invoice(
        &mut self,
        kind: String,
        contact_id: String,
        reference: String,
        issue_date: String,
        due_date: String,
        amounts_are: String,
        lines: Vec<LineInput>,
        notes: String,
    ) -> app::Result<String> {
        if !INVOICE_KINDS.contains(&kind.as_str()) {
            return Err(invalid("kind must be sales or bill"));
        }
        let lines = self.validate_document(
            &contact_id,
            &reference,
            &issue_date,
            &due_date,
            &amounts_are,
            lines,
            &notes,
        )?;
        let now = now_ms();
        let id = new_id(if kind == "sales" { "inv" } else { "bill" }, now);
        self.invoices
            .insert(
                id.clone(),
                Invoice {
                    id: id.clone(),
                    kind: kind.clone(),
                    contact_id: LwwRegister::new(contact_id),
                    reference: LwwRegister::new(reference.trim().to_string()),
                    issue_date: LwwRegister::new(issue_date),
                    due_date: LwwRegister::new(due_date),
                    amounts_are: LwwRegister::new(amounts_are),
                    lines: LwwRegister::new(lines),
                    notes: LwwRegister::new(notes.trim().to_string()),
                    created_at: now,
                },
            )
            .map_err(|e| AppError::msg(format!("invoices.insert: {e}")))?;
        self.log(
            &id,
            "created",
            if kind == "sales" {
                "Draft invoice created"
            } else {
                "Draft bill created"
            },
        )?;
        app::emit!(Event::InvoiceSaved {
            id: &id,
            kind: &kind
        });
        Ok(id)
    }

    /// Edit a draft. Only fields whose value differs are written, so a
    /// teammate's concurrent edit to another field survives. Refused once the
    /// document is approved: from then on it is posted.
    #[allow(clippy::too_many_arguments)]
    pub fn update_invoice(
        &mut self,
        invoice_id: String,
        contact_id: String,
        reference: String,
        issue_date: String,
        due_date: String,
        amounts_are: String,
        lines: Vec<LineInput>,
        notes: String,
    ) -> app::Result<()> {
        self.require_draft(&invoice_id)?;
        let lines = self.validate_document(
            &contact_id,
            &reference,
            &issue_date,
            &due_date,
            &amounts_are,
            lines,
            &notes,
        )?;
        let kind = update_or_404!(self.invoices, invoice_id, "invoice", |d| {
            set_if_changed(&mut d.contact_id, contact_id);
            set_if_changed(&mut d.reference, reference.trim().to_string());
            set_if_changed(&mut d.issue_date, issue_date);
            set_if_changed(&mut d.due_date, due_date);
            set_if_changed(&mut d.amounts_are, amounts_are);
            set_if_changed(&mut d.lines, lines);
            set_if_changed(&mut d.notes, notes.trim().to_string());
            d.kind.clone()
        });
        self.log(&invoice_id, "edited", "Draft edited")?;
        app::emit!(Event::InvoiceSaved {
            id: &invoice_id,
            kind: &kind
        });
        Ok(())
    }

    /// Delete a draft. An approved document is voided instead, never deleted.
    pub fn delete_invoice(&mut self, invoice_id: String) -> app::Result<()> {
        self.require_draft(&invoice_id)?;
        let _ = self.invoices.remove(&invoice_id)?;
        self.log(&invoice_id, "deleted", "Draft deleted")?;
        app::emit!(Event::InvoiceDeleted { id: &invoice_id });
        Ok(())
    }

    /// Approve a draft: freeze it into a write-once approval and post it to the
    /// ledger. A sales invoice gets its number here.
    pub fn approve_invoice(&mut self, invoice_id: String) -> app::Result<()> {
        self.require_draft(&invoice_id)?;
        let d = self
            .invoices
            .get(&invoice_id)?
            .ok_or_else(|| not_found("invoice", &invoice_id))?;
        let lines = d.lines.get().clone();
        if lines.is_empty() {
            return Err(invalid("add at least one line before approving"));
        }
        if money::totals(&lines, d.amounts_are.get()).total <= 0 {
            return Err(invalid("an invoice must total more than zero"));
        }
        if !self.contacts.contains(d.contact_id.get())? {
            return Err(not_found("contact", d.contact_id.get()));
        }
        for l in &lines {
            self.validate_line_account(&l.account_id)?;
        }
        self.check_unlocked(d.issue_date.get())?;
        let now = now_ms();
        self.approvals.insert(
            invoice_id.clone(),
            Approval {
                kind: d.kind.clone(),
                contact_id: d.contact_id.get().clone(),
                reference: d.reference.get().clone(),
                issue_date: d.issue_date.get().clone(),
                due_date: d.due_date.get().clone(),
                amounts_are: d.amounts_are.get().clone(),
                lines,
                notes: d.notes.get().clone(),
                at: now,
            },
        )?;
        self.log(&invoice_id, "approved", "Approved and posted")?;
        app::emit!(Event::InvoiceApproved {
            id: &invoice_id,
            kind: &d.kind
        });
        Ok(())
    }

    // ── Payments ────────────────────────────────────────────────────────────

    /// Record money received against an invoice, or paid against a bill.
    /// Refused beyond the amount due.
    pub fn record_payment(
        &mut self,
        invoice_id: String,
        bank_account_id: String,
        date: String,
        amount: i64,
        reference: String,
    ) -> app::Result<String> {
        validate_date("date", &date)?;
        validate_optional_name("reference", &reference)?;
        self.validate_bank_account(&bank_account_id)?;
        self.check_unlocked(&date)?;
        if amount <= 0 {
            return Err(invalid("amount must be more than zero"));
        }
        let ledger = self.ledger()?;
        let view = ledger
            .invoice_view(
                &invoice_id,
                &ledger.invoice_numbers(),
                &ledger.paid_by_invoice(None),
            )
            .ok_or_else(|| not_found("invoice", &invoice_id))?;
        match view.status.as_str() {
            "draft" => return Err(invalid("approve the invoice before recording a payment")),
            "void" => return Err(invalid("the invoice is void")),
            "paid" => return Err(invalid("the invoice is already paid")),
            _ => {}
        }
        if amount > view.amount_due {
            return Err(invalid("the payment is more than the amount due"));
        }
        let now = now_ms();
        let id = new_id("pay", now);
        self.payments.insert(
            id.clone(),
            Payment {
                invoice_id: invoice_id.clone(),
                bank_account_id,
                date: date.clone(),
                amount,
                reference: reference.trim().to_string(),
                at: now,
            },
        )?;
        self.log(&invoice_id, "payment", &format!("Payment dated {date}"))?;
        app::emit!(Event::PaymentRecorded {
            id: &id,
            invoice_id: &invoice_id
        });
        Ok(id)
    }

    /// Payments, optionally through one bank account, newest first.
    pub fn list_payments(&self, bank_account_id: Option<String>) -> app::Result<Vec<PaymentView>> {
        let ledger = self.ledger()?;
        let mut out: Vec<PaymentView> = ledger
            .payments
            .iter()
            .filter(|(_, p)| {
                bank_account_id
                    .as_ref()
                    .is_none_or(|b| &p.value.bank_account_id == b)
            })
            .map(|(id, p)| ledger.payment_view(id, p))
            .collect();
        out.sort_by(|a, b| (&b.date, b.at, &b.id).cmp(&(&a.date, a.at, &a.id)));
        Ok(out)
    }

    // ── Spend / receive money, transfers ────────────────────────────────────

    /// Spend money (`kind` = `spend`) or receive money (`receive`) straight
    /// through a bank account, coded to accounts with no invoice behind it.
    #[allow(clippy::too_many_arguments)]
    pub fn create_bank_transaction(
        &mut self,
        kind: String,
        bank_account_id: String,
        contact_id: Option<String>,
        date: String,
        reference: String,
        amounts_are: String,
        lines: Vec<LineInput>,
    ) -> app::Result<String> {
        if !BANK_TXN_KINDS.contains(&kind.as_str()) {
            return Err(invalid("kind must be spend or receive"));
        }
        self.validate_bank_account(&bank_account_id)?;
        let contact_id = normalize_opt(contact_id);
        if let Some(c) = &contact_id {
            if !self.contacts.contains(c)? {
                return Err(not_found("contact", c));
            }
        }
        validate_date("date", &date)?;
        validate_optional_name("reference", &reference)?;
        validate_mode(&amounts_are)?;
        self.check_unlocked(&date)?;
        let lines = self.lines_from_input(lines)?;
        if lines.is_empty() {
            return Err(invalid("add at least one line"));
        }
        for l in &lines {
            self.validate_line_account(&l.account_id)?;
            if l.account_id == bank_account_id {
                return Err(invalid(
                    "a line cannot be coded to the bank account it moves through",
                ));
            }
        }
        if money::totals(&lines, &amounts_are).total <= 0 {
            return Err(invalid("the transaction must total more than zero"));
        }
        let now = now_ms();
        let id = new_id(&kind, now);
        self.bank_transactions.insert(
            id.clone(),
            BankTransaction {
                kind: kind.clone(),
                bank_account_id,
                contact_id,
                date,
                reference: reference.trim().to_string(),
                amounts_are,
                lines,
                at: now,
            },
        )?;
        self.log(
            &id,
            "created",
            if kind == "spend" {
                "Spend money"
            } else {
                "Receive money"
            },
        )?;
        app::emit!(Event::BankTransactionRecorded {
            id: &id,
            kind: &kind
        });
        Ok(id)
    }

    pub fn list_bank_transactions(
        &self,
        bank_account_id: Option<String>,
    ) -> app::Result<Vec<BankTransactionView>> {
        let ledger = self.ledger()?;
        let mut out: Vec<BankTransactionView> = ledger
            .bank_txns
            .iter()
            .filter(|(_, t)| {
                bank_account_id
                    .as_ref()
                    .is_none_or(|b| &t.value.bank_account_id == b)
            })
            .map(|(id, t)| ledger.bank_txn_view(id, t))
            .collect();
        out.sort_by(|a, b| (&b.date, b.at, &b.id).cmp(&(&a.date, a.at, &a.id)));
        Ok(out)
    }

    /// Move money between two bank accounts: a two-line journal.
    pub fn record_transfer(
        &mut self,
        from_account_id: String,
        to_account_id: String,
        date: String,
        amount: i64,
        reference: String,
    ) -> app::Result<String> {
        self.validate_bank_account(&from_account_id)?;
        self.validate_bank_account(&to_account_id)?;
        if from_account_id == to_account_id {
            return Err(invalid("choose two different bank accounts"));
        }
        if amount <= 0 {
            return Err(invalid("amount must be more than zero"));
        }
        let narration = if reference.trim().is_empty() {
            "Bank transfer".to_string()
        } else {
            reference.trim().to_string()
        };
        let lines = vec![
            JournalLine {
                account_id: to_account_id,
                description: String::new(),
                debit: amount,
                credit: 0,
            },
            JournalLine {
                account_id: from_account_id,
                description: String::new(),
                debit: 0,
                credit: amount,
            },
        ];
        self.post_journal(date, narration, lines, "transfer")
    }

    // ── Manual journals ─────────────────────────────────────────────────────

    /// Post a manual journal. Its lines must balance — debits equal credits —
    /// and a journal that does not is left out of the ledger even if a patched
    /// node writes one.
    pub fn create_journal(
        &mut self,
        date: String,
        narration: String,
        lines: Vec<JournalLine>,
    ) -> app::Result<String> {
        for l in &lines {
            if CONTROL_ACCOUNTS.contains(&l.account_id.as_str()) {
                return Err(invalid(
                    "receivables and payables move through invoices and bills, not journals",
                ));
            }
        }
        self.post_journal(date, narration, lines, "journal")
    }

    pub fn list_journals(&self) -> app::Result<Vec<JournalView>> {
        let ledger = self.ledger()?;
        let mut out: Vec<JournalView> = ledger
            .journals
            .iter()
            .map(|(id, j)| ledger.journal_view(id, j))
            .collect();
        out.sort_by(|a, b| (&b.date, b.at, &b.id).cmp(&(&a.date, a.at, &a.id)));
        Ok(out)
    }

    // ── Voids ───────────────────────────────────────────────────────────────

    /// Void a posted record: an approved invoice or bill, a payment, a bank
    /// transaction or a journal. Its entries leave the ledger; the record and
    /// its void stay, attributed, for the audit trail. There is no un-void.
    pub fn void_record(&mut self, record_id: String, reason: String) -> app::Result<()> {
        validate_optional_name("reason", &reason)?;
        if !self.voids.entries_at(&record_id)?.is_empty() {
            return Err(invalid("already void"));
        }
        let ledger = self.ledger()?;
        let (date, trail) = if let Some(a) = ledger.approvals.get(&record_id) {
            if ledger
                .paid_by_invoice(None)
                .get(&record_id)
                .copied()
                .unwrap_or(0)
                > 0
            {
                return Err(invalid("void its payments first"));
            }
            (a.value.issue_date.clone(), record_id.clone())
        } else if let Some(p) = ledger.payments.get(&record_id) {
            (p.value.date.clone(), p.value.invoice_id.clone())
        } else if let Some(t) = ledger.bank_txns.get(&record_id) {
            (t.value.date.clone(), record_id.clone())
        } else if let Some(j) = ledger.journals.get(&record_id) {
            (j.value.date.clone(), record_id.clone())
        } else {
            return Err(not_found("posted record", &record_id));
        };
        self.check_unlocked(&date)?;
        self.voids.insert(
            record_id.clone(),
            VoidRecord {
                reason: reason.trim().to_string(),
                at: now_ms(),
            },
        )?;
        let detail = if reason.trim().is_empty() {
            "Voided".to_string()
        } else {
            format!("Voided: {}", reason.trim())
        };
        self.log(&trail, "voided", &detail)?;
        app::emit!(Event::RecordVoided { id: &record_id });
        Ok(())
    }

    // ── Bank statements and reconciliation ──────────────────────────────────

    /// Import statement lines into a bank account. Lines already imported (by
    /// anyone) are skipped, so an overlapping export is safe to import again.
    /// Returns how many lines were new.
    pub fn import_statement_lines(
        &mut self,
        bank_account_id: String,
        lines: Vec<StatementLineInput>,
    ) -> app::Result<u32> {
        self.validate_bank_account(&bank_account_id)?;
        if lines.len() > MAX_IMPORT {
            return Err(invalid("import at most 500 lines at a time"));
        }
        for l in &lines {
            validate_date("date", &l.date)?;
            if l.description.chars().count() > 200 {
                return Err(invalid(
                    "a statement description must be at most 200 characters",
                ));
            }
            if l.amount == 0 || l.amount.unsigned_abs() > MAX_UNIT_PRICE as u64 {
                return Err(invalid("a statement amount must be non-zero and in range"));
            }
        }
        let now = now_ms();
        let mut seen: BTreeMap<(String, i64, String), u32> = BTreeMap::new();
        let mut added = 0u32;
        for l in lines {
            let description = l.description.trim().to_string();
            let n = seen
                .entry((l.date.clone(), l.amount, description.clone()))
                .or_default();
            let id = statement_line_id(&bank_account_id, &l.date, l.amount, &description, *n);
            *n += 1;
            if self.statement_lines.contains(&id)? {
                continue;
            }
            self.statement_lines
                .insert(
                    id.clone(),
                    StatementLine {
                        id,
                        bank_account_id: bank_account_id.clone(),
                        date: l.date,
                        description,
                        amount: l.amount,
                        matched: LwwRegister::new(None),
                        created_at: now,
                    },
                )
                .map_err(|e| AppError::msg(format!("statement_lines.insert: {e}")))?;
            added += 1;
        }
        app::emit!(Event::StatementChanged {
            bank_account_id: &bank_account_id
        });
        Ok(added)
    }

    /// A bank account's statement lines, newest first, each with whether it is
    /// reconciled (derived: its match must be live and move the same amount).
    pub fn list_statement_lines(
        &self,
        bank_account_id: String,
    ) -> app::Result<Vec<StatementLineView>> {
        let ledger = self.ledger()?;
        let mut out: Vec<StatementLineView> = ledger
            .statement
            .values()
            .filter(|l| l.bank_account_id == bank_account_id)
            .map(|l| ledger.statement_view(l))
            .collect();
        out.sort_by(|a, b| (&b.date, &b.id).cmp(&(&a.date, &a.id)));
        Ok(out)
    }

    /// Match a statement line to the payment, bank transaction or transfer it
    /// records. The target must move the same amount through the same account,
    /// and must not already be matched to another line.
    pub fn reconcile_statement_line(
        &mut self,
        statement_line_id: String,
        target_id: String,
    ) -> app::Result<()> {
        let ledger = self.ledger()?;
        let line = ledger
            .statement
            .get(&statement_line_id)
            .ok_or_else(|| not_found("statement line", &statement_line_id))?;
        if !ledger.moves(&target_id, &line.bank_account_id, line.amount) {
            return Err(invalid(
                "that transaction does not move this amount through this account",
            ));
        }
        // Per bank account: a transfer is rightly matched once in each.
        let taken = ledger.statement.values().any(|l| {
            l.id != statement_line_id
                && l.bank_account_id == line.bank_account_id
                && l.matched.get().as_deref() == Some(target_id.as_str())
                && ledger.statement_view(l).reconciled
        });
        if taken {
            return Err(invalid(
                "that transaction is already reconciled to another line",
            ));
        }
        let bank = line.bank_account_id.clone();
        update_or_404!(
            self.statement_lines,
            statement_line_id,
            "statement line",
            |l| { set_if_changed(&mut l.matched, Some(target_id.clone())) }
        );
        app::emit!(Event::StatementChanged {
            bank_account_id: &bank
        });
        Ok(())
    }

    pub fn unreconcile_statement_line(&mut self, statement_line_id: String) -> app::Result<()> {
        let bank = update_or_404!(
            self.statement_lines,
            statement_line_id,
            "statement line",
            |l| {
                set_if_changed(&mut l.matched, None);
                l.bank_account_id.clone()
            }
        );
        app::emit!(Event::StatementChanged {
            bank_account_id: &bank
        });
        Ok(())
    }

    /// Reconcile a line by creating what it records: spend money for money
    /// out, receive money for money in, coded to one account, the statement
    /// amount taken as tax-inclusive. Returns the new transaction's id.
    pub fn code_statement_line(
        &mut self,
        statement_line_id: String,
        contact_id: Option<String>,
        account_id: String,
        tax_rate_id: String,
        description: String,
    ) -> app::Result<String> {
        let line = self
            .statement_lines
            .get(&statement_line_id)?
            .ok_or_else(|| not_found("statement line", &statement_line_id))?;
        let kind = if line.amount > 0 { "receive" } else { "spend" };
        let description = if description.trim().is_empty() {
            line.description.clone()
        } else {
            description
        };
        let txn = self.create_bank_transaction(
            kind.to_string(),
            line.bank_account_id.clone(),
            contact_id,
            line.date.clone(),
            line.description.chars().take(MAX_NAME_LEN).collect(),
            "inclusive".to_string(),
            vec![LineInput {
                description,
                quantity: 1_000,
                unit_price: line.amount.abs(),
                account_id,
                tax_rate_id,
            }],
        )?;
        self.reconcile_statement_line(statement_line_id, txn.clone())?;
        Ok(txn)
    }

    /// Remove an unreconciled statement line (a bad import).
    pub fn delete_statement_line(&mut self, statement_line_id: String) -> app::Result<()> {
        let ledger = self.ledger()?;
        let line = ledger
            .statement
            .get(&statement_line_id)
            .ok_or_else(|| not_found("statement line", &statement_line_id))?;
        if ledger.statement_view(line).reconciled {
            return Err(invalid("unreconcile the line before removing it"));
        }
        let bank = line.bank_account_id.clone();
        let _ = self.statement_lines.remove(&statement_line_id)?;
        app::emit!(Event::StatementChanged {
            bank_account_id: &bank
        });
        Ok(())
    }

    // ── History and notes ───────────────────────────────────────────────────

    pub fn add_note(&mut self, record_id: String, body: String) -> app::Result<String> {
        if body.trim().is_empty() {
            return Err(invalid("note must not be empty"));
        }
        validate_text("note", &body)?;
        let id = self.log(&record_id, "note", body.trim())?;
        app::emit!(Event::NoteAdded {
            record_id: &record_id
        });
        Ok(id)
    }

    /// A record's audit trail and notes, oldest first, each with its author.
    pub fn list_history(&self, record_id: String) -> app::Result<Vec<HistoryView>> {
        self.history_for(&record_id)
    }

    // ── Reports ─────────────────────────────────────────────────────────────

    /// The home screen: bank balances, what is owed each way, six months of
    /// cash in and out, and profit for the year to `today` (`YYYY-MM-DD`,
    /// supplied by the caller so the read is a pure function of state).
    pub fn get_dashboard(&self, today: String) -> app::Result<Dashboard> {
        validate_date("today", &today)?;
        let ledger = self.ledger()?;
        Ok(ledger.dashboard(&ledger.entries(), &today))
    }

    pub fn profit_and_loss(&self, from: String, to: String) -> app::Result<ProfitAndLoss> {
        validate_period(&from, &to)?;
        let ledger = self.ledger()?;
        Ok(ledger.profit_and_loss(&ledger.entries(), &from, &to))
    }

    pub fn balance_sheet(&self, as_at: String) -> app::Result<BalanceSheet> {
        validate_date("as_at", &as_at)?;
        let ledger = self.ledger()?;
        Ok(ledger.balance_sheet(&ledger.entries(), &as_at))
    }

    pub fn trial_balance(&self, as_at: String) -> app::Result<TrialBalance> {
        validate_date("as_at", &as_at)?;
        let ledger = self.ledger()?;
        Ok(ledger.trial_balance(&ledger.entries(), &as_at))
    }

    pub fn aged_receivables(&self, as_at: String) -> app::Result<AgedReport> {
        validate_date("as_at", &as_at)?;
        Ok(self.ledger()?.aged("sales", &as_at))
    }

    pub fn aged_payables(&self, as_at: String) -> app::Result<AgedReport> {
        validate_date("as_at", &as_at)?;
        Ok(self.ledger()?.aged("bill", &as_at))
    }

    pub fn tax_report(&self, from: String, to: String) -> app::Result<TaxReport> {
        validate_period(&from, &to)?;
        Ok(self.ledger()?.tax_report(&from, &to))
    }

    /// One account's general ledger for a period, with opening and closing
    /// balances and a running balance on every row.
    pub fn account_transactions(
        &self,
        account_id: String,
        from: String,
        to: String,
    ) -> app::Result<AccountTransactions> {
        validate_period(&from, &to)?;
        let ledger = self.ledger()?;
        if !ledger.accounts.contains_key(&account_id) {
            return Err(not_found("account", &account_id));
        }
        Ok(ledger.account_transactions(&ledger.entries(), &account_id, &from, &to))
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

impl MeroBooks {
    /// Load everything the derivations read. Write-once collections elect one
    /// entry per id across owners (see `ledger::elect`).
    fn ledger(&self) -> app::Result<Ledger> {
        Ok(Ledger {
            fy_end_month: (*self.fy_end_month.get()).clamp(1, 12),
            invoice_prefix: self.invoice_prefix.get().clone(),
            accounts: self.accounts.entries()?.collect(),
            tax_rates: self.tax_rates.entries()?.collect(),
            contacts: self.contacts.entries()?.collect(),
            drafts: self.invoices.entries()?.collect(),
            approvals: elect(self.approvals.entries_with_owners()?, |a| a.at),
            payments: elect(self.payments.entries_with_owners()?, |p| p.at),
            bank_txns: elect(self.bank_transactions.entries_with_owners()?, |t| t.at),
            journals: elect(self.journals.entries_with_owners()?, |j| j.at),
            voids: elect(self.voids.entries_with_owners()?, |v| v.at),
            statement: self.statement_lines.entries()?.collect(),
        })
    }

    /// Append to a record's audit trail. Returns the entry's id.
    fn log(&mut self, record_id: &str, action: &str, detail: &str) -> app::Result<String> {
        let now = now_ms();
        let id = new_id("hist", now);
        self.history.insert(
            id.clone(),
            HistoryEntry {
                record_id: record_id.to_string(),
                action: action.to_string(),
                detail: detail.chars().take(MAX_TEXT_LEN).collect(),
                at: now,
            },
        )?;
        Ok(id)
    }

    fn history_for(&self, record_id: &str) -> app::Result<Vec<HistoryView>> {
        let ids = self.history.query("record_id").eq(record_id).keys()?;
        let mut out: Vec<HistoryView> = Vec::new();
        for id in ids {
            for (owner, h) in self.history.entries_at(&id)? {
                if h.record_id != record_id {
                    continue;
                }
                out.push(HistoryView {
                    id: id.clone(),
                    record_id: h.record_id,
                    action: h.action,
                    detail: h.detail,
                    author: owner.to_string(),
                    at: h.at,
                });
            }
        }
        out.sort_by(|a, b| (a.at, &a.id, &a.author).cmp(&(b.at, &b.id, &b.author)));
        out.dedup_by(|a, b| a.id == b.id && a.author == b.author);
        Ok(out)
    }

    /// The draft exists and nobody has approved it.
    fn require_draft(&self, invoice_id: &str) -> app::Result<()> {
        if !self
            .approvals
            .entries_at(&invoice_id.to_string())?
            .is_empty()
        {
            return Err(invalid("this document is approved; void it instead"));
        }
        if !self.invoices.contains(invoice_id)? {
            return Err(not_found("invoice", invoice_id));
        }
        Ok(())
    }

    fn check_unlocked(&self, date: &str) -> app::Result<()> {
        if let Some(lock) = self
            .lock_date
            .get()
            .as_deref()
            .filter(|d| money::is_date(d))
        {
            if date <= lock {
                return Err(invalid(&format!("the ledger are locked through {lock}")));
            }
        }
        Ok(())
    }

    fn account(&self, id: &str) -> app::Result<Option<Account>> {
        Ok(self.accounts.get(id)?.map(|a| (*a).clone()))
    }

    fn validate_bank_account(&self, id: &str) -> app::Result<()> {
        match self.account(id)? {
            Some(a) if a.account_type.get() == "bank" && !*a.archived.get() => Ok(()),
            Some(_) => Err(invalid("choose an active bank account")),
            None => Err(not_found("account", id)),
        }
    }

    /// A line may be coded to any active account except the control accounts.
    fn validate_line_account(&self, id: &str) -> app::Result<()> {
        if CONTROL_ACCOUNTS.contains(&id) {
            return Err(invalid("lines cannot be coded to receivables or payables"));
        }
        match self.account(id)? {
            Some(a) if !*a.archived.get() => Ok(()),
            Some(_) => Err(invalid(&format!(
                "account {} is archived",
                a_code(&self.account(id)?)
            ))),
            None => Err(not_found("account", id)),
        }
    }

    fn validate_account(
        &self,
        id: Option<&str>,
        code: &str,
        name: &str,
        account_type: &str,
        description: &str,
        default_tax_rate_id: &Option<String>,
    ) -> app::Result<()> {
        let code = code.trim();
        if code.is_empty()
            || code.chars().count() > 10
            || !code
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        {
            return Err(invalid("code must be 1-10 letters, digits, dots or dashes"));
        }
        validate_name("name", name)?;
        validate_text("description", description)?;
        if !ACCOUNT_TYPES.iter().any(|(t, _)| *t == account_type) {
            return Err(invalid("unknown account type"));
        }
        if let Some(t) = default_tax_rate_id {
            if !self.tax_rates.contains(t)? {
                return Err(not_found("tax rate", t));
            }
        }
        let clash = self
            .accounts
            .entries()?
            .any(|(other, a)| Some(other.as_str()) != id && a.code.get() == code);
        if clash {
            return Err(invalid(&format!("account code {code} is already used")));
        }
        Ok(())
    }

    /// Validate a document form and turn its lines into stored lines.
    #[allow(clippy::too_many_arguments)]
    fn validate_document(
        &self,
        contact_id: &str,
        reference: &str,
        issue_date: &str,
        due_date: &str,
        amounts_are: &str,
        lines: Vec<LineInput>,
        notes: &str,
    ) -> app::Result<Vec<Line>> {
        if !self.contacts.contains(contact_id)? {
            return Err(not_found("contact", contact_id));
        }
        validate_optional_name("reference", reference)?;
        validate_date("issue_date", issue_date)?;
        validate_date("due_date", due_date)?;
        if due_date < issue_date {
            return Err(invalid("the due date must not be before the issue date"));
        }
        validate_mode(amounts_are)?;
        validate_text("notes", notes)?;
        let lines = self.lines_from_input(lines)?;
        for l in &lines {
            self.validate_line_account(&l.account_id)?;
        }
        Ok(lines)
    }

    /// Capture each line's tax rate as it stands now.
    fn lines_from_input(&self, lines: Vec<LineInput>) -> app::Result<Vec<Line>> {
        if lines.len() > MAX_LINES {
            return Err(invalid("a document can have at most 100 lines"));
        }
        let mut out = Vec::with_capacity(lines.len());
        for l in lines {
            validate_optional_name("description", &l.description)?;
            if l.quantity == 0 || l.quantity > MAX_QUANTITY {
                return Err(invalid("quantity must be more than zero and in range"));
            }
            if l.unit_price.unsigned_abs() > MAX_UNIT_PRICE as u64 {
                return Err(invalid("unit price is out of range"));
            }
            let rate = self
                .tax_rates
                .get(&l.tax_rate_id)?
                .ok_or_else(|| not_found("tax rate", &l.tax_rate_id))?;
            out.push(Line {
                description: l.description.trim().to_string(),
                quantity: l.quantity,
                unit_price: l.unit_price,
                account_id: l.account_id,
                tax_rate_id: l.tax_rate_id,
                tax_bp: (*rate.rate_bp.get()).min(money::MAX_TAX_BP),
            });
        }
        Ok(out)
    }

    fn post_journal(
        &mut self,
        date: String,
        narration: String,
        lines: Vec<JournalLine>,
        source: &str,
    ) -> app::Result<String> {
        validate_date("date", &date)?;
        validate_name("narration", &narration)?;
        if lines.len() > MAX_LINES {
            return Err(invalid("a journal can have at most 100 lines"));
        }
        if !ledger::journal_balances(&lines) {
            return Err(invalid(
                "each line is a debit or a credit, and debits must equal credits",
            ));
        }
        for l in &lines {
            validate_optional_name("description", &l.description)?;
            if l.debit.max(l.credit) > MAX_UNIT_PRICE {
                return Err(invalid("amount is out of range"));
            }
            match self.account(&l.account_id)? {
                Some(a) if !*a.archived.get() => {}
                Some(_) => return Err(invalid("a journal line is coded to an archived account")),
                None => return Err(not_found("account", &l.account_id)),
            }
        }
        self.check_unlocked(&date)?;
        let now = now_ms();
        let id = new_id(if source == "transfer" { "xfer" } else { "jnl" }, now);
        let lines: Vec<JournalLine> = lines
            .into_iter()
            .map(|l| JournalLine {
                description: l.description.trim().to_string(),
                ..l
            })
            .collect();
        self.journals.insert(
            id.clone(),
            Journal {
                date,
                narration: narration.trim().to_string(),
                lines,
                source: source.to_string(),
                at: now,
            },
        )?;
        self.log(
            &id,
            "posted",
            if source == "transfer" {
                "Transfer posted"
            } else {
                "Journal posted"
            },
        )?;
        app::emit!(Event::JournalPosted { id: &id });
        Ok(id)
    }
}

fn a_code(a: &Option<Account>) -> String {
    a.as_ref().map(|a| a.code.get().clone()).unwrap_or_default()
}

fn contact_view(
    c: &Contact,
    receivable: i64,
    payable: i64,
    invoice_count: u32,
    bill_count: u32,
) -> ContactView {
    ContactView {
        id: c.id.clone(),
        name: c.name.get().clone(),
        email: c.email.get().clone(),
        phone: c.phone.get().clone(),
        address: c.address.get().clone(),
        tax_number: c.tax_number.get().clone(),
        receivable,
        payable,
        invoice_count,
        bill_count,
        created_at: c.created_at,
    }
}

/// Content-derived, so the same statement line imported twice — by two members
/// at once, or from two overlapping exports — is one row. `n` separates
/// genuinely identical lines within one import (two £3.50 coffees on a day).
pub fn statement_line_id(bank: &str, date: &str, amount: i64, description: &str, n: u32) -> String {
    let mut h = Sha256::new();
    for part in [bank, date, &amount.to_string(), description, &n.to_string()] {
        h.update(part.as_bytes());
        h.update([0u8]);
    }
    format!("stmt-{}", &hex::encode(h.finalize())[..24])
}

/// Write a register only when the value actually changes (see module docs).
fn set_if_changed<T: PartialEq>(reg: &mut LwwRegister<T>, value: T) {
    if reg.get() != &value {
        reg.set(value);
    }
}

fn now_ms() -> u64 {
    storage_env::time_now() / 1_000_000
}

/// `{prefix}-{ms}-{8 hex}` — sortable by creation, collision-safe across peers.
fn new_id(prefix: &str, now: u64) -> String {
    let mut nonce = [0u8; 4];
    env::random_bytes(&mut nonce);
    format!("{prefix}-{now}-{}", hex::encode(nonce))
}

/// `Some("")` / `Some("  ")` mean "none" — the form sends empty strings.
fn normalize_opt(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// The executing ACCOUNT, hex — what attribution fields hold. One person's
/// devices are one author.
pub fn caller() -> String {
    AccountId::from(env::account_id()).to_string()
}

fn not_found(what: &str, id: &str) -> AppError {
    AppError::msg(format!("not found: {what} {id}"))
}

fn invalid(msg: &str) -> AppError {
    AppError::msg(format!("invalid input: {msg}"))
}

fn validate_name(field: &str, v: &str) -> app::Result<()> {
    if v.trim().is_empty() {
        return Err(invalid(&format!("{field} must not be empty")));
    }
    validate_optional_name(field, v)
}

fn validate_optional_name(field: &str, v: &str) -> app::Result<()> {
    if v.trim().chars().count() > MAX_NAME_LEN {
        return Err(invalid(&format!(
            "{field} must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(())
}

fn validate_text(field: &str, v: &str) -> app::Result<()> {
    if v.chars().count() > MAX_TEXT_LEN {
        return Err(invalid(&format!(
            "{field} must be at most {MAX_TEXT_LEN} characters"
        )));
    }
    Ok(())
}

fn validate_date(field: &str, v: &str) -> app::Result<()> {
    if money::is_date(v) {
        Ok(())
    } else {
        Err(invalid(&format!("{field} must be a date like 2024-01-31")))
    }
}

fn validate_period(from: &str, to: &str) -> app::Result<()> {
    validate_date("from", from)?;
    validate_date("to", to)?;
    if to < from {
        return Err(invalid("the period ends before it starts"));
    }
    Ok(())
}

fn validate_mode(mode: &str) -> app::Result<()> {
    if AMOUNT_MODES.contains(&mode) {
        Ok(())
    } else {
        Err(invalid("amounts_are must be exclusive, inclusive or none"))
    }
}

fn validate_rate(rate_bp: u32) -> app::Result<()> {
    if rate_bp > money::MAX_TAX_BP {
        return Err(invalid("a tax rate must be between 0% and 100%"));
    }
    Ok(())
}

fn validate_contact(
    name: &str,
    email: &str,
    phone: &str,
    address: &str,
    tax_number: &str,
) -> app::Result<()> {
    validate_name("name", name)?;
    validate_optional_name("email", email)?;
    validate_optional_name("phone", phone)?;
    validate_text("address", address)?;
    validate_optional_name("tax_number", tax_number)?;
    let email = email.trim();
    if !email.is_empty() && (!email.contains('@') || email.contains(' ')) {
        return Err(invalid("email must look like name@example.com"));
    }
    Ok(())
}
