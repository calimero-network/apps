//! The general ledger, derived on read.
//!
//! Nothing in state is a balance. Every number a report shows is the sum of
//! ledger entries, and every ledger entry is derived here from a posted record
//! (an approval, a payment, a bank transaction, a journal) that is not voided.
//! So there is no balance to drift out of step with its transactions, no
//! running total two replicas could merge differently, and nothing a member
//! could write directly to move a report.
//!
//! Posting rules (debit positive):
//!
//! | Record | Entries |
//! | --- | --- |
//! | Approved sales invoice | Dr AR total · Cr each line's account net · Cr sales tax |
//! | Approved bill | Dr each line's account net · Dr sales tax · Cr AP total |
//! | Payment on an invoice | Dr bank · Cr AR |
//! | Payment on a bill | Dr AP · Cr bank |
//! | Receive money | Dr bank total · Cr each line net · Cr sales tax |
//! | Spend money | Dr each line net · Dr sales tax · Cr bank total |
//! | Manual journal / transfer | its lines, if and only if they balance |
//!
//! Each rule debits exactly what it credits, so the trial balance balances by
//! construction — `tests::the_ledger_always_balances` holds that.

use std::collections::BTreeMap;

use calimero_sdk::AccountId;

use crate::model::*;
use crate::money::{self, totals, Totals};

pub const ACC_AR: &str = "acc-ar";
pub const ACC_AP: &str = "acc-ap";
pub const ACC_TAX: &str = "acc-tax";
pub const ACC_RETAINED: &str = "acc-retained";
/// The accounts the posting rules need. They cannot be archived, deleted or
/// re-typed, and AR/AP cannot be coded to directly.
pub const SYSTEM_ACCOUNTS: [&str; 4] = [ACC_AR, ACC_AP, ACC_TAX, ACC_RETAINED];
/// Control accounts: only the invoice and payment rules post to them.
pub const CONTROL_ACCOUNTS: [&str; 2] = [ACC_AR, ACC_AP];

/// The chart's account types, each mapped to its class.
pub const ACCOUNT_TYPES: [(&str, &str); 10] = [
    ("bank", "asset"),
    ("current_asset", "asset"),
    ("fixed_asset", "asset"),
    ("current_liability", "liability"),
    ("liability", "liability"),
    ("equity", "equity"),
    ("revenue", "revenue"),
    ("other_income", "revenue"),
    ("direct_costs", "expense"),
    ("expense", "expense"),
];

pub fn account_class(account_type: &str) -> &'static str {
    ACCOUNT_TYPES
        .iter()
        .find(|(t, _)| *t == account_type)
        .map(|(_, c)| *c)
        // An unknown type (a patched node) is reported as an asset rather than
        // dropped: every entry still lands somewhere, so the books balance.
        .unwrap_or("asset")
}

/// One record's value as one account wrote it, chosen deterministically when
/// several accounts filed an entry at the same id (only a patched node can).
#[derive(Debug, Clone)]
pub struct Claim<T> {
    pub value: T,
    pub owner: String,
    pub conflicted: bool,
}

/// Group a write-once collection's entries by key and elect one per key: the
/// earliest `at`, then the lowest owner. The election runs over every entry,
/// so a later or invalid entry can never displace an earlier one.
pub fn elect<T: Clone>(
    entries: Vec<(AccountId, String, T)>,
    at: impl Fn(&T) -> u64,
) -> BTreeMap<String, Claim<T>> {
    let mut out: BTreeMap<String, Claim<T>> = BTreeMap::new();
    for (owner, key, value) in entries {
        let owner = owner.to_string();
        match out.get_mut(&key) {
            None => {
                let _ = out.insert(
                    key,
                    Claim {
                        value,
                        owner,
                        conflicted: false,
                    },
                );
            }
            Some(held) => {
                held.conflicted = true;
                if (at(&value), &owner) < (at(&held.value), &held.owner) {
                    held.value = value;
                    held.owner = owner;
                }
            }
        }
    }
    out
}

/// A single ledger posting.
#[derive(Debug, Clone)]
pub struct Entry {
    pub date: String,
    pub account_id: String,
    /// Debit positive, credit negative.
    pub amount: i64,
    pub source_kind: &'static str,
    pub source_id: String,
    pub reference: String,
    pub contact_id: Option<String>,
    pub description: String,
}

/// Everything the derivations read, loaded once per call.
pub struct Ledger {
    pub fy_end_month: u32,
    pub invoice_prefix: String,
    pub accounts: BTreeMap<String, Account>,
    pub tax_rates: BTreeMap<String, TaxRate>,
    pub contacts: BTreeMap<String, Contact>,
    pub drafts: BTreeMap<String, Invoice>,
    pub approvals: BTreeMap<String, Claim<Approval>>,
    pub payments: BTreeMap<String, Claim<Payment>>,
    pub bank_txns: BTreeMap<String, Claim<BankTransaction>>,
    pub journals: BTreeMap<String, Claim<Journal>>,
    pub voids: BTreeMap<String, Claim<VoidRecord>>,
    pub statement: BTreeMap<String, StatementLine>,
}

pub fn journal_balances(lines: &[JournalLine]) -> bool {
    let well_formed = lines.len() >= 2
        && lines
            .iter()
            .all(|l| l.debit >= 0 && l.credit >= 0 && (l.debit == 0) != (l.credit == 0));
    if !well_formed {
        return false;
    }
    let (dr, cr) = lines.iter().fold((0i128, 0i128), |(d, c), l| {
        (d + i128::from(l.debit), c + i128::from(l.credit))
    });
    dr == cr && dr > 0
}

fn line_view(l: &Line, mode: &str) -> LineView {
    let a = money::line_amounts(l, mode);
    LineView {
        description: l.description.clone(),
        quantity: l.quantity,
        unit_price: l.unit_price,
        account_id: l.account_id.clone(),
        tax_rate_id: l.tax_rate_id.clone(),
        tax_bp: l.tax_bp,
        net: a.net,
        tax: a.tax,
    }
}

impl Ledger {
    pub fn is_void(&self, id: &str) -> bool {
        self.voids.contains_key(id)
    }

    pub fn contact_name(&self, id: &str) -> String {
        self.contacts
            .get(id)
            .map(|c| c.name.get().clone())
            .unwrap_or_default()
    }

    pub fn account_type(&self, id: &str) -> String {
        self.accounts
            .get(id)
            .map(|a| a.account_type.get().clone())
            .unwrap_or_default()
    }

    /// `INV-0001`, `INV-0002`, … by order of approval. Derived, never stored:
    /// a stored counter is a value two members bump concurrently. A voided
    /// invoice keeps its number, as it must for the audit trail.
    pub fn invoice_numbers(&self) -> BTreeMap<String, String> {
        let mut sales: Vec<(&String, u64)> = self
            .approvals
            .iter()
            .filter(|(_, c)| c.value.kind == "sales")
            .map(|(id, c)| (id, c.value.at))
            .collect();
        sales.sort_by(|a, b| (a.1, a.0).cmp(&(b.1, b.0)));
        sales
            .into_iter()
            .enumerate()
            .map(|(i, (id, _))| (id.clone(), format!("{}{:04}", self.invoice_prefix, i + 1)))
            .collect()
    }

    /// Live payments per invoice id. A payment against a voided invoice still
    /// counts: the money moved, and it shows as the contact's credit.
    pub fn paid_by_invoice(&self, as_at: Option<&str>) -> BTreeMap<String, i64> {
        let mut out: BTreeMap<String, i64> = BTreeMap::new();
        for (id, p) in &self.payments {
            if self.is_void(id) || p.value.amount <= 0 {
                continue;
            }
            if as_at.is_some_and(|d| p.value.date.as_str() > d) {
                continue;
            }
            let e = out.entry(p.value.invoice_id.clone()).or_default();
            *e = e.saturating_add(p.value.amount);
        }
        out
    }

    // ── documents ──────────────────────────────────────────────────────────

    pub fn invoice_view(
        &self,
        id: &str,
        numbers: &BTreeMap<String, String>,
        paid: &BTreeMap<String, i64>,
    ) -> Option<InvoiceView> {
        let approval = self.approvals.get(id);
        let draft = self.drafts.get(id);
        let (kind, contact_id, reference, issue, due, mode, lines, notes) = match (approval, draft)
        {
            (Some(c), _) => {
                let a = &c.value;
                (
                    a.kind.clone(),
                    a.contact_id.clone(),
                    a.reference.clone(),
                    a.issue_date.clone(),
                    a.due_date.clone(),
                    a.amounts_are.clone(),
                    a.lines.clone(),
                    a.notes.clone(),
                )
            }
            (None, Some(d)) => (
                d.kind.clone(),
                d.contact_id.get().clone(),
                d.reference.get().clone(),
                d.issue_date.get().clone(),
                d.due_date.get().clone(),
                d.amounts_are.get().clone(),
                d.lines.get().clone(),
                d.notes.get().clone(),
            ),
            (None, None) => return None,
        };
        let t = totals(&lines, &mode);
        let paid_amount = if approval.is_some() {
            paid.get(id).copied().unwrap_or(0)
        } else {
            0
        };
        let voided = self.voids.get(id);
        let amount_due = if approval.is_some() && voided.is_none() {
            t.total.saturating_sub(paid_amount).max(0)
        } else {
            0
        };
        let status = match (approval, voided) {
            (None, _) => "draft",
            (Some(_), Some(_)) => "void",
            (Some(_), None) if amount_due == 0 => "paid",
            _ => "awaiting_payment",
        };
        Some(InvoiceView {
            id: id.to_string(),
            number: numbers.get(id).cloned().unwrap_or_default(),
            status: status.to_string(),
            contact_name: self.contact_name(&contact_id),
            lines: lines.iter().map(|l| line_view(l, &mode)).collect(),
            kind,
            contact_id,
            reference,
            issue_date: issue,
            due_date: due,
            amounts_are: mode,
            notes,
            subtotal: t.subtotal,
            tax_total: t.tax,
            total: t.total,
            paid: paid_amount,
            amount_due,
            approved_at: approval.map(|c| c.value.at),
            approved_by: approval.map(|c| c.owner.clone()).unwrap_or_default(),
            void_reason: voided.map(|v| v.value.reason.clone()).unwrap_or_default(),
            conflicted: approval.is_some_and(|c| c.conflicted),
            created_at: draft
                .map(|d| d.created_at)
                .unwrap_or_else(|| approval.map(|c| c.value.at).unwrap_or_default()),
        })
    }

    /// Every invoice and bill, drafts and approved, newest issue date first.
    pub fn invoice_views(&self, kind: Option<&str>) -> Vec<InvoiceView> {
        let numbers = self.invoice_numbers();
        let paid = self.paid_by_invoice(None);
        let mut ids: Vec<&String> = self.drafts.keys().chain(self.approvals.keys()).collect();
        ids.sort();
        ids.dedup();
        let mut out: Vec<InvoiceView> = ids
            .into_iter()
            .filter_map(|id| self.invoice_view(id, &numbers, &paid))
            .filter(|v| kind.is_none_or(|k| v.kind == k))
            .collect();
        out.sort_by(|a, b| {
            (&b.issue_date, b.created_at, &b.id).cmp(&(&a.issue_date, a.created_at, &a.id))
        });
        out
    }

    pub fn payment_view(&self, id: &str, p: &Claim<Payment>) -> PaymentView {
        PaymentView {
            id: id.to_string(),
            invoice_id: p.value.invoice_id.clone(),
            invoice_kind: self
                .approvals
                .get(&p.value.invoice_id)
                .map(|a| a.value.kind.clone())
                .unwrap_or_default(),
            bank_account_id: p.value.bank_account_id.clone(),
            date: p.value.date.clone(),
            amount: p.value.amount,
            reference: p.value.reference.clone(),
            recorded_by: p.owner.clone(),
            voided: self.is_void(id),
            at: p.value.at,
        }
    }

    pub fn bank_txn_view(&self, id: &str, t: &Claim<BankTransaction>) -> BankTransactionView {
        let v = &t.value;
        let tt = totals(&v.lines, &v.amounts_are);
        BankTransactionView {
            id: id.to_string(),
            kind: v.kind.clone(),
            bank_account_id: v.bank_account_id.clone(),
            contact_name: v
                .contact_id
                .as_deref()
                .map(|c| self.contact_name(c))
                .unwrap_or_default(),
            contact_id: v.contact_id.clone(),
            date: v.date.clone(),
            reference: v.reference.clone(),
            amounts_are: v.amounts_are.clone(),
            lines: v
                .lines
                .iter()
                .map(|l| line_view(l, &v.amounts_are))
                .collect(),
            subtotal: tt.subtotal,
            tax_total: tt.tax,
            total: tt.total,
            recorded_by: t.owner.clone(),
            voided: self.is_void(id),
            at: v.at,
        }
    }

    pub fn journal_view(&self, id: &str, j: &Claim<Journal>) -> JournalView {
        let v = &j.value;
        JournalView {
            id: id.to_string(),
            date: v.date.clone(),
            narration: v.narration.clone(),
            source: v.source.clone(),
            lines: v.lines.clone(),
            total: v
                .lines
                .iter()
                .fold(0i64, |s, l| s.saturating_add(l.debit.max(0))),
            balanced: journal_balances(&v.lines),
            posted_by: j.owner.clone(),
            voided: self.is_void(id),
            at: v.at,
        }
    }

    // ── the ledger ─────────────────────────────────────────────────────────

    pub fn entries(&self) -> Vec<Entry> {
        let mut out = Vec::new();
        let numbers = self.invoice_numbers();
        let mut push = |date: &str,
                        account_id: &str,
                        amount: i64,
                        source_kind: &'static str,
                        source_id: &str,
                        reference: &str,
                        contact_id: Option<&str>,
                        description: &str| {
            if amount != 0 {
                out.push(Entry {
                    date: date.to_string(),
                    account_id: account_id.to_string(),
                    amount,
                    source_kind,
                    source_id: source_id.to_string(),
                    reference: reference.to_string(),
                    contact_id: contact_id.map(str::to_string),
                    description: description.to_string(),
                });
            }
        };

        for (id, c) in &self.approvals {
            if self.is_void(id) {
                continue;
            }
            let a = &c.value;
            // Sales debit AR and credit income; a bill is the mirror image.
            let (control, sign, kind) = match a.kind.as_str() {
                "sales" => (ACC_AR, 1i64, "invoice"),
                "bill" => (ACC_AP, -1i64, "bill"),
                _ => continue,
            };
            let reference = numbers
                .get(id)
                .cloned()
                .unwrap_or_else(|| a.reference.clone());
            let t = totals(&a.lines, &a.amounts_are);
            let contact = Some(a.contact_id.as_str());
            push(
                &a.issue_date,
                control,
                sign * t.total,
                kind,
                id,
                &reference,
                contact,
                "",
            );
            for l in &a.lines {
                let amt = money::line_amounts(l, &a.amounts_are);
                push(
                    &a.issue_date,
                    &l.account_id,
                    -sign * amt.net,
                    kind,
                    id,
                    &reference,
                    contact,
                    &l.description,
                );
                push(
                    &a.issue_date,
                    ACC_TAX,
                    -sign * amt.tax,
                    kind,
                    id,
                    &reference,
                    contact,
                    &l.description,
                );
            }
        }

        for (id, p) in &self.payments {
            let p = &p.value;
            if self.is_void(id) || p.amount <= 0 {
                continue;
            }
            let Some(inv) = self.approvals.get(&p.invoice_id) else {
                continue;
            };
            let contact = Some(inv.value.contact_id.as_str());
            let reference = numbers
                .get(&p.invoice_id)
                .cloned()
                .unwrap_or_else(|| inv.value.reference.clone());
            let desc = if p.reference.is_empty() {
                "Payment"
            } else {
                p.reference.as_str()
            };
            match inv.value.kind.as_str() {
                "sales" => {
                    push(
                        &p.date,
                        &p.bank_account_id,
                        p.amount,
                        "payment",
                        id,
                        &reference,
                        contact,
                        desc,
                    );
                    push(
                        &p.date, ACC_AR, -p.amount, "payment", id, &reference, contact, desc,
                    );
                }
                "bill" => {
                    push(
                        &p.date, ACC_AP, p.amount, "payment", id, &reference, contact, desc,
                    );
                    push(
                        &p.date,
                        &p.bank_account_id,
                        -p.amount,
                        "payment",
                        id,
                        &reference,
                        contact,
                        desc,
                    );
                }
                _ => {}
            }
        }

        for (id, t) in &self.bank_txns {
            let t = &t.value;
            if self.is_void(id) {
                continue;
            }
            let (sign, kind) = match t.kind.as_str() {
                "receive" => (1i64, "receive"),
                "spend" => (-1i64, "spend"),
                _ => continue,
            };
            let tt: Totals = totals(&t.lines, &t.amounts_are);
            let contact = t.contact_id.as_deref();
            push(
                &t.date,
                &t.bank_account_id,
                sign * tt.total,
                kind,
                id,
                &t.reference,
                contact,
                "",
            );
            for l in &t.lines {
                let amt = money::line_amounts(l, &t.amounts_are);
                push(
                    &t.date,
                    &l.account_id,
                    -sign * amt.net,
                    kind,
                    id,
                    &t.reference,
                    contact,
                    &l.description,
                );
                push(
                    &t.date,
                    ACC_TAX,
                    -sign * amt.tax,
                    kind,
                    id,
                    &t.reference,
                    contact,
                    &l.description,
                );
            }
        }

        for (id, j) in &self.journals {
            let j = &j.value;
            if self.is_void(id) || !journal_balances(&j.lines) {
                continue;
            }
            let kind = if j.source == "transfer" {
                "transfer"
            } else {
                "journal"
            };
            for l in &j.lines {
                let desc = if l.description.is_empty() {
                    &j.narration
                } else {
                    &l.description
                };
                push(
                    &j.date,
                    &l.account_id,
                    l.debit - l.credit,
                    kind,
                    id,
                    &j.narration,
                    None,
                    desc,
                );
            }
        }
        out
    }

    /// Debit-positive balance per account over the entries `keep` admits.
    pub fn balances(entries: &[Entry], keep: impl Fn(&Entry) -> bool) -> BTreeMap<String, i64> {
        let mut out: BTreeMap<String, i64> = BTreeMap::new();
        for e in entries.iter().filter(|e| keep(e)) {
            let b = out.entry(e.account_id.clone()).or_default();
            *b = b.saturating_add(e.amount);
        }
        out
    }

    fn row(&self, account_id: &str, amount: i64) -> ReportRow {
        let (code, name) = self
            .accounts
            .get(account_id)
            .map(|a| (a.code.get().clone(), a.name.get().clone()))
            .unwrap_or_else(|| (String::new(), format!("Unknown account ({account_id})")));
        ReportRow {
            account_id: account_id.to_string(),
            code,
            name,
            amount,
        }
    }

    /// A report section over accounts of the given types, with the sign
    /// flipped for credit-natured classes so every row reads positive when
    /// normal.
    fn section(
        &self,
        title: &str,
        balances: &BTreeMap<String, i64>,
        types: &[&str],
        credit_natured: bool,
    ) -> ReportSection {
        let mut rows: Vec<ReportRow> = balances
            .iter()
            .filter(|(id, amt)| **amt != 0 && types.contains(&self.account_type(id).as_str()))
            .map(|(id, amt)| self.row(id, if credit_natured { -amt } else { *amt }))
            .collect();
        rows.sort_by(|a, b| (&a.code, &a.name).cmp(&(&b.code, &b.name)));
        let total = rows.iter().fold(0i64, |s, r| s.saturating_add(r.amount));
        ReportSection {
            title: title.to_string(),
            rows,
            total,
        }
    }

    pub fn profit_and_loss(&self, entries: &[Entry], from: &str, to: &str) -> ProfitAndLoss {
        let b = Self::balances(entries, |e| {
            e.date.as_str() >= from && e.date.as_str() <= to
        });
        let income = self.section("Income", &b, &["revenue"], true);
        let cost_of_sales = self.section("Cost of sales", &b, &["direct_costs"], false);
        let other_income = self.section("Other income", &b, &["other_income"], true);
        let expenses = self.section("Operating expenses", &b, &["expense"], false);
        let gross_profit = income.total.saturating_sub(cost_of_sales.total);
        let net_profit = gross_profit
            .saturating_add(other_income.total)
            .saturating_sub(expenses.total);
        ProfitAndLoss {
            from: from.to_string(),
            to: to.to_string(),
            income,
            cost_of_sales,
            gross_profit,
            other_income,
            expenses,
            net_profit,
        }
    }

    pub fn balance_sheet(&self, entries: &[Entry], as_at: &str) -> BalanceSheet {
        let b = Self::balances(entries, |e| e.date.as_str() <= as_at);
        let assets = vec![
            self.section("Bank", &b, &["bank"], false),
            self.section("Current assets", &b, &["current_asset"], false),
            self.section("Fixed assets", &b, &["fixed_asset"], false),
        ];
        let liabilities = vec![
            self.section("Current liabilities", &b, &["current_liability"], true),
            self.section("Non-current liabilities", &b, &["liability"], true),
        ];
        let total_assets = assets.iter().fold(0i64, |s, x| s.saturating_add(x.total));
        let total_liabilities = liabilities
            .iter()
            .fold(0i64, |s, x| s.saturating_add(x.total));

        // Profit is equity: this year's is shown as Current Year Earnings, and
        // every earlier year's has been rolled into Retained Earnings.
        let start = money::fy_start(as_at, self.fy_end_month);
        let pnl_types = ["revenue", "other_income", "direct_costs", "expense"];
        let is_pnl = |e: &Entry| pnl_types.contains(&self.account_type(&e.account_id).as_str());
        let earnings = |keep: &dyn Fn(&Entry) -> bool| -> i64 {
            -entries
                .iter()
                .filter(|e| is_pnl(e) && keep(e))
                .fold(0i64, |s, e| s.saturating_add(e.amount))
        };
        let current_year =
            earnings(&|e| e.date.as_str() >= start.as_str() && e.date.as_str() <= as_at);
        let prior_years = earnings(&|e| e.date.as_str() < start.as_str());

        let mut equity = self.section("Equity", &b, &["equity"], true);
        if prior_years != 0 {
            if let Some(r) = equity
                .rows
                .iter_mut()
                .find(|r| r.account_id == ACC_RETAINED)
            {
                r.amount = r.amount.saturating_add(prior_years);
            } else {
                equity.rows.push(self.row(ACC_RETAINED, prior_years));
            }
        }
        if current_year != 0 {
            equity.rows.push(ReportRow {
                account_id: String::new(),
                code: String::new(),
                name: "Current Year Earnings".to_string(),
                amount: current_year,
            });
        }
        equity.total = equity
            .rows
            .iter()
            .fold(0i64, |s, r| s.saturating_add(r.amount));
        BalanceSheet {
            as_at: as_at.to_string(),
            assets,
            total_assets,
            liabilities,
            total_liabilities,
            net_assets: total_assets.saturating_sub(total_liabilities),
            equity,
        }
    }

    pub fn trial_balance(&self, entries: &[Entry], as_at: &str) -> TrialBalance {
        let b = Self::balances(entries, |e| e.date.as_str() <= as_at);
        let mut rows: Vec<TrialBalanceRow> = b
            .iter()
            .filter(|(_, amt)| **amt != 0)
            .map(|(id, amt)| {
                let r = self.row(id, *amt);
                TrialBalanceRow {
                    account_id: r.account_id,
                    code: r.code,
                    name: r.name,
                    account_type: self.account_type(id),
                    debit: (*amt).max(0),
                    credit: (-*amt).max(0),
                }
            })
            .collect();
        rows.sort_by(|a, b| (&a.code, &a.name).cmp(&(&b.code, &b.name)));
        let total_debit = rows.iter().fold(0i64, |s, r| s.saturating_add(r.debit));
        let total_credit = rows.iter().fold(0i64, |s, r| s.saturating_add(r.credit));
        TrialBalance {
            as_at: as_at.to_string(),
            rows,
            total_debit,
            total_credit,
        }
    }

    /// Outstanding approved documents of one kind as at a date, bucketed by
    /// how far past due each is.
    pub fn aged(&self, kind: &str, as_at: &str) -> AgedReport {
        let paid = self.paid_by_invoice(Some(as_at));
        let mut by_contact: BTreeMap<String, AgedRow> = BTreeMap::new();
        for (id, c) in &self.approvals {
            let a = &c.value;
            if a.kind != kind || self.is_void(id) || a.issue_date.as_str() > as_at {
                continue;
            }
            let total = totals(&a.lines, &a.amounts_are).total;
            let due = total.saturating_sub(paid.get(id).copied().unwrap_or(0));
            if due == 0 {
                continue;
            }
            let row = by_contact
                .entry(a.contact_id.clone())
                .or_insert_with(|| AgedRow {
                    contact_id: a.contact_id.clone(),
                    contact_name: self.contact_name(&a.contact_id),
                    ..AgedRow::default()
                });
            let late = money::days_between(&a.due_date, as_at);
            let bucket = match late {
                i64::MIN..=0 => &mut row.current,
                1..=30 => &mut row.days_1_30,
                31..=60 => &mut row.days_31_60,
                61..=90 => &mut row.days_61_90,
                _ => &mut row.over_90,
            };
            *bucket = bucket.saturating_add(due);
            row.total = row.total.saturating_add(due);
        }
        let mut rows: Vec<AgedRow> = by_contact.into_values().collect();
        rows.sort_by(|a, b| {
            (a.contact_name.to_lowercase(), &a.contact_id)
                .cmp(&(b.contact_name.to_lowercase(), &b.contact_id))
        });
        let mut totals_row = AgedRow::default();
        for r in &rows {
            totals_row.current = totals_row.current.saturating_add(r.current);
            totals_row.days_1_30 = totals_row.days_1_30.saturating_add(r.days_1_30);
            totals_row.days_31_60 = totals_row.days_31_60.saturating_add(r.days_31_60);
            totals_row.days_61_90 = totals_row.days_61_90.saturating_add(r.days_61_90);
            totals_row.over_90 = totals_row.over_90.saturating_add(r.over_90);
            totals_row.total = totals_row.total.saturating_add(r.total);
        }
        AgedReport {
            kind: kind.to_string(),
            as_at: as_at.to_string(),
            rows,
            totals: totals_row,
        }
    }

    /// Tax collected on sales and paid on purchases in a period, by rate.
    pub fn tax_report(&self, from: &str, to: &str) -> TaxReport {
        let mut rows: BTreeMap<String, TaxRow> = BTreeMap::new();
        let mut add = |lines: &[Line], mode: &str, sales: bool| {
            for l in lines {
                let a = money::line_amounts(l, mode);
                let row = rows.entry(l.tax_rate_id.clone()).or_insert_with(|| {
                    let rate = self.tax_rates.get(&l.tax_rate_id);
                    TaxRow {
                        tax_rate_id: l.tax_rate_id.clone(),
                        name: rate.map(|r| r.name.get().clone()).unwrap_or_else(|| {
                            if l.tax_rate_id.is_empty() {
                                "No tax".into()
                            } else {
                                l.tax_rate_id.clone()
                            }
                        }),
                        rate_bp: l.tax_bp,
                        sales_net: 0,
                        sales_tax: 0,
                        purchases_net: 0,
                        purchases_tax: 0,
                    }
                });
                if sales {
                    row.sales_net = row.sales_net.saturating_add(a.net);
                    row.sales_tax = row.sales_tax.saturating_add(a.tax);
                } else {
                    row.purchases_net = row.purchases_net.saturating_add(a.net);
                    row.purchases_tax = row.purchases_tax.saturating_add(a.tax);
                }
            }
        };
        let in_period = |d: &str| d >= from && d <= to;
        for (id, c) in &self.approvals {
            let a = &c.value;
            if !self.is_void(id) && in_period(&a.issue_date) {
                add(&a.lines, &a.amounts_are, a.kind == "sales");
            }
        }
        for (id, c) in &self.bank_txns {
            let t = &c.value;
            if !self.is_void(id) && in_period(&t.date) && (t.kind == "receive" || t.kind == "spend")
            {
                add(&t.lines, &t.amounts_are, t.kind == "receive");
            }
        }
        let rows: Vec<TaxRow> = rows.into_values().collect();
        let sales_tax = rows.iter().fold(0i64, |s, r| s.saturating_add(r.sales_tax));
        let purchases_tax = rows
            .iter()
            .fold(0i64, |s, r| s.saturating_add(r.purchases_tax));
        TaxReport {
            from: from.to_string(),
            to: to.to_string(),
            rows,
            sales_tax,
            purchases_tax,
            net_tax: sales_tax.saturating_sub(purchases_tax),
        }
    }

    pub fn account_transactions(
        &self,
        entries: &[Entry],
        account_id: &str,
        from: &str,
        to: &str,
    ) -> AccountTransactions {
        let mut mine: Vec<&Entry> = entries
            .iter()
            .filter(|e| e.account_id == account_id)
            .collect();
        mine.sort_by(|a, b| (&a.date, &a.source_id).cmp(&(&b.date, &b.source_id)));
        let opening = mine
            .iter()
            .filter(|e| e.date.as_str() < from)
            .fold(0i64, |s, e| s.saturating_add(e.amount));
        let mut balance = opening;
        let rows: Vec<LedgerRow> = mine
            .into_iter()
            .filter(|e| e.date.as_str() >= from && e.date.as_str() <= to)
            .map(|e| {
                balance = balance.saturating_add(e.amount);
                LedgerRow {
                    date: e.date.clone(),
                    source_kind: e.source_kind.to_string(),
                    source_id: e.source_id.clone(),
                    reference: e.reference.clone(),
                    contact_name: e
                        .contact_id
                        .as_deref()
                        .map(|c| self.contact_name(c))
                        .unwrap_or_default(),
                    description: e.description.clone(),
                    debit: e.amount.max(0),
                    credit: (-e.amount).max(0),
                    balance,
                }
            })
            .collect();
        AccountTransactions {
            account_id: account_id.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            opening_balance: opening,
            rows,
            closing_balance: balance,
        }
    }

    // ── bank reconciliation ────────────────────────────────────────────────

    /// The bank account and signed amount a payment or bank transaction moved,
    /// if it is live. What a statement line must equal to reconcile with it.
    pub fn bank_movement(&self, id: &str) -> Option<(String, i64)> {
        if self.is_void(id) {
            return None;
        }
        if let Some(p) = self.payments.get(id) {
            let kind = self.approvals.get(&p.value.invoice_id)?.value.kind.as_str();
            let sign = if kind == "sales" { 1 } else { -1 };
            return Some((p.value.bank_account_id.clone(), sign * p.value.amount));
        }
        if let Some(t) = self.bank_txns.get(id) {
            let total = totals(&t.value.lines, &t.value.amounts_are).total;
            let sign = if t.value.kind == "receive" { 1 } else { -1 };
            return Some((t.value.bank_account_id.clone(), sign * total));
        }
        if let Some(j) = self.journals.get(id) {
            if !journal_balances(&j.value.lines) {
                return None;
            }
            // A transfer touches two bank accounts; the caller picks one.
            return j
                .value
                .lines
                .first()
                .map(|l| (l.account_id.clone(), l.debit - l.credit));
        }
        None
    }

    /// Whether `target` moved exactly `amount` through `bank_account_id`.
    pub fn moves(&self, target: &str, bank_account_id: &str, amount: i64) -> bool {
        if self.is_void(target) {
            return false;
        }
        if let Some(j) = self.journals.get(target) {
            return journal_balances(&j.value.lines)
                && j.value
                    .lines
                    .iter()
                    .any(|l| l.account_id == bank_account_id && l.debit - l.credit == amount);
        }
        self.bank_movement(target)
            .is_some_and(|(acc, amt)| acc == bank_account_id && amt == amount)
    }

    pub fn match_label(&self, target: &str) -> String {
        let numbers = self.invoice_numbers();
        if let Some(p) = self.payments.get(target) {
            let inv = &p.value.invoice_id;
            let name = self
                .approvals
                .get(inv)
                .map(|a| self.contact_name(&a.value.contact_id))
                .unwrap_or_default();
            let doc = numbers.get(inv).cloned().unwrap_or_else(|| {
                self.approvals
                    .get(inv)
                    .map(|a| a.value.reference.clone())
                    .unwrap_or_default()
            });
            return format!("Payment · {doc} · {name}");
        }
        if let Some(t) = self.bank_txns.get(target) {
            let who = t
                .value
                .contact_id
                .as_deref()
                .map(|c| self.contact_name(c))
                .unwrap_or_default();
            let what = if t.value.kind == "receive" {
                "Receive money"
            } else {
                "Spend money"
            };
            return format!("{what} · {who} {}", t.value.reference)
                .trim()
                .to_string();
        }
        if let Some(j) = self.journals.get(target) {
            return format!("Transfer · {}", j.value.narration);
        }
        String::new()
    }

    pub fn statement_view(&self, l: &StatementLine) -> StatementLineView {
        let matched = l.matched.get().clone();
        let reconciled = matched
            .as_deref()
            .is_some_and(|t| self.moves(t, &l.bank_account_id, l.amount));
        StatementLineView {
            id: l.id.clone(),
            bank_account_id: l.bank_account_id.clone(),
            date: l.date.clone(),
            description: l.description.clone(),
            amount: l.amount,
            match_label: matched
                .as_deref()
                .map(|t| self.match_label(t))
                .unwrap_or_default(),
            matched,
            reconciled,
        }
    }

    // ── dashboard ──────────────────────────────────────────────────────────

    pub fn dashboard(&self, entries: &[Entry], today: &str) -> Dashboard {
        let balances = Self::balances(entries, |_| true);
        let mut statement_sum: BTreeMap<&str, (i64, u32)> = BTreeMap::new();
        for l in self.statement.values() {
            let v = self.statement_view(l);
            let e = statement_sum.entry(l.bank_account_id.as_str()).or_default();
            e.0 = e.0.saturating_add(l.amount);
            if !v.reconciled {
                e.1 += 1;
            }
        }
        let mut bank_accounts: Vec<BankAccountSummary> = self
            .accounts
            .values()
            .filter(|a| a.account_type.get() == "bank" && !*a.archived.get())
            .map(|a| {
                let (statement_balance, unreconciled) = statement_sum
                    .get(a.id.as_str())
                    .copied()
                    .unwrap_or_default();
                BankAccountSummary {
                    account_id: a.id.clone(),
                    code: a.code.get().clone(),
                    name: a.name.get().clone(),
                    balance: balances.get(&a.id).copied().unwrap_or(0),
                    statement_balance,
                    unreconciled,
                }
            })
            .collect();
        bank_accounts.sort_by(|a, b| (&a.code, &a.name).cmp(&(&b.code, &b.name)));

        let mut receivables = DocumentTotals::default();
        let mut payables = DocumentTotals::default();
        for v in self.invoice_views(None) {
            let t = if v.kind == "sales" {
                &mut receivables
            } else {
                &mut payables
            };
            match v.status.as_str() {
                "draft" => {
                    t.draft_count += 1;
                    t.draft_total = t.draft_total.saturating_add(v.total);
                }
                "awaiting_payment" => {
                    t.awaiting_count += 1;
                    t.awaiting_total = t.awaiting_total.saturating_add(v.amount_due);
                    if v.due_date.as_str() < today {
                        t.overdue_count += 1;
                        t.overdue_total = t.overdue_total.saturating_add(v.amount_due);
                    }
                }
                _ => {}
            }
        }

        let months = money::trailing_months(today, 6);
        let mut cash_flow: Vec<MonthFlow> = months
            .iter()
            .map(|m| MonthFlow {
                month: m.clone(),
                money_in: 0,
                money_out: 0,
            })
            .collect();
        for e in entries {
            if self.account_type(&e.account_id) != "bank" || e.source_kind == "transfer" {
                continue;
            }
            let month = e.date.get(0..7).unwrap_or("");
            if let Some(f) = cash_flow.iter_mut().find(|f| f.month == month) {
                if e.amount > 0 {
                    f.money_in = f.money_in.saturating_add(e.amount);
                } else {
                    f.money_out = f.money_out.saturating_add(-e.amount);
                }
            }
        }

        let start = money::fy_start(today, self.fy_end_month);
        let pnl = self.profit_and_loss(entries, &start, today);
        Dashboard {
            today: today.to_string(),
            bank_accounts,
            receivables,
            payables,
            cash_flow,
            profit_ytd: pnl.net_profit,
            income_ytd: pnl.income.total.saturating_add(pnl.other_income.total),
            expenses_ytd: pnl.cost_of_sales.total.saturating_add(pnl.expenses.total),
        }
    }
}
