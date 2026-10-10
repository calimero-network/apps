//! In-process tests — one TestHost roundtrip per mutation.
//!
//! The accounting rules first (a sale, a bill, payments, voids, journals,
//! reconciliation, the lock date, every report), then the storage-enforced
//! guarantees, written as a patched node would attack them.

use calimero_sdk::testing::TestHost;

use super::*;

/// Another PERSON: an account and a device of their own.
const OTHER: [u8; 32] = [0x22; 32];

type App = TestHost<MeroBooks>;

fn new_app() -> App {
    TestHost::new(MeroBooks::init)
}

fn contact(app: &mut App, name: &str) -> String {
    app.call(|s| {
        s.create_contact(
            name.into(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        )
    })
    .unwrap()
}

fn line(desc: &str, quantity: u64, unit_price: i64, account: &str, tax: &str) -> LineInput {
    LineInput {
        description: desc.into(),
        quantity,
        unit_price,
        account_id: account.into(),
        tax_rate_id: tax.into(),
    }
}

/// A draft sales invoice: 2 × 500.00 consulting at 20%, total 1,200.00.
fn draft_invoice(app: &mut App, contact_id: &str, date: &str) -> String {
    app.call(|s| {
        s.create_invoice(
            "sales".into(),
            contact_id.into(),
            "PO-1".into(),
            date.into(),
            date.into(),
            "exclusive".into(),
            vec![line(
                "Consulting",
                2_000,
                50_000,
                "acc-sales",
                "tax-standard",
            )],
            String::new(),
        )
    })
    .unwrap()
}

fn approved_invoice(app: &mut App, contact_id: &str, date: &str) -> String {
    let id = draft_invoice(app, contact_id, date);
    app.call(|s| s.approve_invoice(id.clone())).unwrap();
    id
}

fn invoice(app: &App, id: &str) -> InvoiceView {
    app.view(|s| s.get_invoice(id.into())).unwrap().invoice
}

fn assert_balanced(app: &App, as_at: &str) {
    let tb = app.view(|s| s.trial_balance(as_at.into())).unwrap();
    assert_eq!(tb.total_debit, tb.total_credit, "trial balance: {tb:?}");
    let bs = app.view(|s| s.balance_sheet(as_at.into())).unwrap();
    assert_eq!(bs.net_assets, bs.equity.total, "balance sheet: {bs:?}");
}

fn row(rows: &[TrialBalanceRow], account: &str) -> (i64, i64) {
    rows.iter()
        .find(|r| r.account_id == account)
        .map(|r| (r.debit, r.credit))
        .unwrap_or((0, 0))
}

// ── Setup ───────────────────────────────────────────────────────────────────

#[test]
fn init_seeds_a_chart_tax_rates_and_settings() {
    let app = new_app();
    let accounts = app.view(|s| s.list_accounts(false)).unwrap();
    assert_eq!(accounts.len(), DEFAULT_ACCOUNTS.len());
    assert!(accounts.windows(2).all(|w| w[0].code <= w[1].code));
    let ar = accounts.iter().find(|a| a.id == "acc-ar").unwrap();
    assert!(ar.system);
    assert_eq!(ar.class, "asset");
    let rates = app.view(|s| s.list_tax_rates()).unwrap();
    assert!(rates
        .iter()
        .any(|r| r.id == "tax-standard" && r.rate_bp == 2_000));
    let settings = app.view(|s| s.get_settings()).unwrap();
    assert_eq!(settings.currency, "USD");
    assert_eq!(settings.fy_end_month, 12);
    assert_eq!(settings.invoice_prefix, "INV-");
    assert_eq!(settings.lock_date, None);
}

#[test]
fn settings_validate_and_save() {
    let mut app = new_app();
    let save = |app: &mut App, cur: &str, month: u32| {
        app.call(|s| {
            s.update_settings(
                "Acme Ltd".into(),
                cur.into(),
                month,
                "AC-".into(),
                14,
                "VAT".into(),
                "GB123".into(),
            )
        })
    };
    assert!(save(&mut app, "EURO", 6).is_err());
    assert!(save(&mut app, "eur", 13).is_err());
    save(&mut app, "eur", 6).unwrap();
    let s = app.view(|s| s.get_settings()).unwrap();
    assert_eq!(
        (s.currency.as_str(), s.fy_end_month, s.tax_label.as_str()),
        ("EUR", 6, "VAT")
    );
    assert_eq!(s.organisation_name, "Acme Ltd");
}

// ── Sales ───────────────────────────────────────────────────────────────────

#[test]
fn a_sale_posts_receivable_income_and_tax() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = draft_invoice(&mut app, &c, "2024-03-01");
    let v = invoice(&app, &id);
    assert_eq!((v.status.as_str(), v.number.as_str()), ("draft", ""));
    assert_eq!(
        (v.subtotal, v.tax_total, v.total),
        (100_000, 20_000, 120_000)
    );
    // A draft posts nothing.
    assert!(app
        .view(|s| s.trial_balance("2024-12-31".into()))
        .unwrap()
        .rows
        .is_empty());

    app.call(|s| s.approve_invoice(id.clone())).unwrap();
    let v = invoice(&app, &id);
    assert_eq!(
        (v.status.as_str(), v.number.as_str()),
        ("awaiting_payment", "INV-0001")
    );
    assert_eq!(v.amount_due, 120_000);
    assert_eq!(v.approved_by, AccountId::from(app.account_id()).to_string());

    let tb = app.view(|s| s.trial_balance("2024-12-31".into())).unwrap();
    assert_eq!(row(&tb.rows, "acc-ar"), (120_000, 0));
    assert_eq!(row(&tb.rows, "acc-sales"), (0, 100_000));
    assert_eq!(row(&tb.rows, "acc-tax"), (0, 20_000));
    assert_balanced(&app, "2024-12-31");

    let pnl = app
        .view(|s| s.profit_and_loss("2024-01-01".into(), "2024-12-31".into()))
        .unwrap();
    assert_eq!((pnl.income.total, pnl.net_profit), (100_000, 100_000));
    // Outside the period, nothing.
    let pnl = app
        .view(|s| s.profit_and_loss("2023-01-01".into(), "2023-12-31".into()))
        .unwrap();
    assert_eq!(pnl.net_profit, 0);
}

#[test]
fn invoice_numbers_follow_the_order_of_approval_and_survive_a_void() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let a = draft_invoice(&mut app, &c, "2024-03-01");
    let b = draft_invoice(&mut app, &c, "2024-02-01");
    app.call(|s| s.approve_invoice(b.clone())).unwrap();
    app.call(|s| s.approve_invoice(a.clone())).unwrap();
    assert_eq!(invoice(&app, &b).number, "INV-0001");
    assert_eq!(invoice(&app, &a).number, "INV-0002");
    app.call(|s| s.void_record(b.clone(), "Duplicate".into()))
        .unwrap();
    assert_eq!(invoice(&app, &b).number, "INV-0001");
    assert_eq!(invoice(&app, &a).number, "INV-0002");
    // Bills are numbered by the supplier, not by us.
    let bill = app
        .call(|s| {
            s.create_invoice(
                "bill".into(),
                c.clone(),
                "SUP-77".into(),
                "2024-03-02".into(),
                "2024-03-30".into(),
                "exclusive".into(),
                vec![line("Rent", 1_000, 1_000, "acc-rent", "tax-none")],
                String::new(),
            )
        })
        .unwrap();
    app.call(|s| s.approve_invoice(bill.clone())).unwrap();
    assert_eq!(invoice(&app, &bill).number, "");
}

#[test]
fn an_approved_invoice_is_never_edited_or_deleted_only_voided() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-03-01");
    assert!(app
        .call(|s| s.update_invoice(
            id.clone(),
            c.clone(),
            "x".into(),
            "2024-03-01".into(),
            "2024-03-01".into(),
            "exclusive".into(),
            vec![],
            String::new()
        ))
        .is_err());
    assert!(app.call(|s| s.delete_invoice(id.clone())).is_err());
    assert!(app.call(|s| s.approve_invoice(id.clone())).is_err());
    app.call(|s| s.void_record(id.clone(), "Wrong customer".into()))
        .unwrap();
    let v = invoice(&app, &id);
    assert_eq!(
        (v.status.as_str(), v.void_reason.as_str(), v.amount_due),
        ("void", "Wrong customer", 0)
    );
    assert!(app
        .call(|s| s.void_record(id.clone(), String::new()))
        .is_err());
    assert!(app
        .view(|s| s.trial_balance("2024-12-31".into()))
        .unwrap()
        .rows
        .is_empty());
}

#[test]
fn drafts_validate_and_can_be_deleted() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let bad = |app: &mut App, contact: &str, due: &str, l: LineInput| {
        app.call(|s| {
            s.create_invoice(
                "sales".into(),
                contact.into(),
                String::new(),
                "2024-03-01".into(),
                due.into(),
                "exclusive".into(),
                vec![l],
                String::new(),
            )
        })
        .is_err()
    };
    let ok = line("x", 1_000, 100, "acc-sales", "tax-none");
    assert!(bad(&mut app, "contact-nope", "2024-03-01", ok.clone()));
    assert!(
        bad(&mut app, &c, "2024-02-01", ok.clone()),
        "due before issue"
    );
    assert!(bad(&mut app, &c, "2024-02-30", ok));
    assert!(
        bad(
            &mut app,
            &c,
            "2024-03-01",
            line("x", 1_000, 100, "acc-ar", "tax-none")
        ),
        "control account"
    );
    assert!(bad(
        &mut app,
        &c,
        "2024-03-01",
        line("x", 1_000, 100, "acc-nope", "tax-none")
    ));
    assert!(bad(
        &mut app,
        &c,
        "2024-03-01",
        line("x", 1_000, 100, "acc-sales", "tax-nope")
    ));
    assert!(bad(
        &mut app,
        &c,
        "2024-03-01",
        line("x", 0, 100, "acc-sales", "tax-none")
    ));

    // An empty draft saves, but cannot be approved.
    let empty = app
        .call(|s| {
            s.create_invoice(
                "sales".into(),
                c.clone(),
                String::new(),
                "2024-03-01".into(),
                "2024-03-31".into(),
                "exclusive".into(),
                vec![],
                String::new(),
            )
        })
        .unwrap();
    assert!(app.call(|s| s.approve_invoice(empty.clone())).is_err());
    app.call(|s| s.delete_invoice(empty.clone())).unwrap();
    assert!(app.view(|s| s.get_invoice(empty.clone())).is_err());
}

#[test]
fn a_tax_rate_change_does_not_rewrite_a_saved_line() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-03-01");
    app.call(|s| s.update_tax_rate("tax-standard".into(), "Standard rate".into(), 2_500))
        .unwrap();
    assert_eq!(invoice(&app, &id).tax_total, 20_000);
}

// ── Payments ────────────────────────────────────────────────────────────────

#[test]
fn payments_settle_an_invoice_and_move_money_into_the_bank() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-03-01");
    let pay = |app: &mut App, amount: i64| {
        app.call(|s| {
            s.record_payment(
                id.clone(),
                "acc-bank".into(),
                "2024-03-10".into(),
                amount,
                "Ref".into(),
            )
        })
    };
    assert!(pay(&mut app, 0).is_err());
    assert!(pay(&mut app, 120_001).is_err(), "overpayment");
    pay(&mut app, 20_000).unwrap();
    let v = invoice(&app, &id);
    assert_eq!(
        (v.status.as_str(), v.paid, v.amount_due),
        ("awaiting_payment", 20_000, 100_000)
    );
    pay(&mut app, 100_000).unwrap();
    let detail = app.view(|s| s.get_invoice(id.clone())).unwrap();
    assert_eq!(detail.invoice.status, "paid");
    assert_eq!(detail.payments.len(), 2);
    assert!(pay(&mut app, 1).is_err());

    let tb = app.view(|s| s.trial_balance("2024-12-31".into())).unwrap();
    assert_eq!(row(&tb.rows, "acc-bank"), (120_000, 0));
    assert_eq!(row(&tb.rows, "acc-ar"), (0, 0));
    assert_balanced(&app, "2024-12-31");
    // Paying into a non-bank account is refused.
    let other = approved_invoice(&mut app, &c, "2024-03-01");
    assert!(app
        .call(|s| s.record_payment(
            other.clone(),
            "acc-sales".into(),
            "2024-03-10".into(),
            1,
            String::new()
        ))
        .is_err());
    // Not before approval.
    let draft = draft_invoice(&mut app, &c, "2024-03-01");
    assert!(app
        .call(|s| s.record_payment(
            draft.clone(),
            "acc-bank".into(),
            "2024-03-10".into(),
            1,
            String::new()
        ))
        .is_err());
}

#[test]
fn voiding_an_invoice_needs_its_payments_voided_first() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-03-01");
    let p = app
        .call(|s| {
            s.record_payment(
                id.clone(),
                "acc-bank".into(),
                "2024-03-10".into(),
                120_000,
                String::new(),
            )
        })
        .unwrap();
    assert!(app
        .call(|s| s.void_record(id.clone(), String::new()))
        .is_err());
    app.call(|s| s.void_record(p.clone(), "Bounced".into()))
        .unwrap();
    assert_eq!(invoice(&app, &id).status, "awaiting_payment");
    app.call(|s| s.void_record(id.clone(), String::new()))
        .unwrap();
    assert!(app
        .view(|s| s.trial_balance("2024-12-31".into()))
        .unwrap()
        .rows
        .is_empty());
    let history = app.view(|s| s.list_history(id.clone())).unwrap();
    let actions: Vec<&str> = history.iter().map(|h| h.action.as_str()).collect();
    assert_eq!(
        actions,
        ["created", "approved", "payment", "voided", "voided"]
    );
}

// ── Purchases and bank ──────────────────────────────────────────────────────

#[test]
fn bills_and_spend_money_post_expenses_and_reclaimable_tax() {
    let mut app = new_app();
    let c = contact(&mut app, "Office Co");
    // 240.00 inclusive of 20%: 200.00 + 40.00 tax.
    let bill = app
        .call(|s| {
            s.create_invoice(
                "bill".into(),
                c.clone(),
                "B-1".into(),
                "2024-04-01".into(),
                "2024-04-30".into(),
                "inclusive".into(),
                vec![line("Chairs", 1_000, 24_000, "acc-office", "tax-standard")],
                String::new(),
            )
        })
        .unwrap();
    app.call(|s| s.approve_invoice(bill.clone())).unwrap();
    let spend = app
        .call(|s| {
            s.create_bank_transaction(
                "spend".into(),
                "acc-bank".into(),
                None,
                "2024-04-02".into(),
                "Fee".into(),
                "none".into(),
                vec![line(
                    "Monthly fee",
                    1_000,
                    1_500,
                    "acc-bank-fees",
                    "tax-none",
                )],
            )
        })
        .unwrap();
    let tb = app.view(|s| s.trial_balance("2024-12-31".into())).unwrap();
    assert_eq!(row(&tb.rows, "acc-office"), (20_000, 0));
    assert_eq!(row(&tb.rows, "acc-tax"), (4_000, 0));
    assert_eq!(row(&tb.rows, "acc-ap"), (0, 24_000));
    assert_eq!(row(&tb.rows, "acc-bank"), (0, 1_500));
    assert_balanced(&app, "2024-12-31");

    let pnl = app
        .view(|s| s.profit_and_loss("2024-01-01".into(), "2024-12-31".into()))
        .unwrap();
    assert_eq!((pnl.expenses.total, pnl.net_profit), (21_500, -21_500));

    let txns = app
        .view(|s| s.list_bank_transactions(Some("acc-bank".into())))
        .unwrap();
    assert_eq!(txns.len(), 1);
    assert_eq!(
        (txns[0].id.as_str(), txns[0].total),
        (spend.as_str(), 1_500)
    );

    // A line cannot be coded to the bank it moves through.
    assert!(app
        .call(|s| s.create_bank_transaction(
            "spend".into(),
            "acc-bank".into(),
            None,
            "2024-04-02".into(),
            String::new(),
            "none".into(),
            vec![line("x", 1_000, 1, "acc-bank", "tax-none")]
        ))
        .is_err());
}

#[test]
fn the_tax_report_nets_sales_tax_against_purchase_tax() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    approved_invoice(&mut app, &c, "2024-03-01"); // 20,000 tax collected
    app.call(|s| {
        s.create_bank_transaction(
            "spend".into(),
            "acc-bank".into(),
            Some(c.clone()),
            "2024-03-05".into(),
            String::new(),
            "exclusive".into(),
            vec![line(
                "Ads",
                1_000,
                10_000,
                "acc-advertising",
                "tax-standard",
            )],
        )
    })
    .unwrap(); // 2,000 tax paid
    let r = app
        .view(|s| s.tax_report("2024-03-01".into(), "2024-03-31".into()))
        .unwrap();
    assert_eq!(
        (r.sales_tax, r.purchases_tax, r.net_tax),
        (20_000, 2_000, 18_000)
    );
    let std = r
        .rows
        .iter()
        .find(|r| r.tax_rate_id == "tax-standard")
        .unwrap();
    assert_eq!((std.sales_net, std.purchases_net), (100_000, 10_000));
    let r = app
        .view(|s| s.tax_report("2024-04-01".into(), "2024-04-30".into()))
        .unwrap();
    assert_eq!(r.net_tax, 0);
}

// ── Journals ────────────────────────────────────────────────────────────────

fn jl(account: &str, debit: i64, credit: i64) -> JournalLine {
    JournalLine {
        account_id: account.into(),
        description: String::new(),
        debit,
        credit,
    }
}

#[test]
fn journals_must_balance_and_avoid_control_accounts() {
    let mut app = new_app();
    let post = |app: &mut App, lines: Vec<JournalLine>| {
        app.call(|s| s.create_journal("2024-01-01".into(), "Opening balances".into(), lines))
    };
    assert!(post(
        &mut app,
        vec![jl("acc-bank", 100, 0), jl("acc-owner-funds", 0, 90)]
    )
    .is_err());
    assert!(post(
        &mut app,
        vec![jl("acc-bank", 100, 100), jl("acc-owner-funds", 0, 0)]
    )
    .is_err());
    assert!(post(&mut app, vec![jl("acc-bank", 100, 0)]).is_err());
    assert!(post(
        &mut app,
        vec![jl("acc-ar", 100, 0), jl("acc-sales", 0, 100)]
    )
    .is_err());
    let id = post(
        &mut app,
        vec![
            jl("acc-bank", 500_000, 0),
            jl("acc-owner-funds", 0, 500_000),
        ],
    )
    .unwrap();
    let journals = app.view(|s| s.list_journals()).unwrap();
    assert_eq!(
        (
            journals[0].id.as_str(),
            journals[0].total,
            journals[0].balanced
        ),
        (id.as_str(), 500_000, true)
    );
    let tb = app.view(|s| s.trial_balance("2024-01-01".into())).unwrap();
    assert_eq!(row(&tb.rows, "acc-owner-funds"), (0, 500_000));
    assert_balanced(&app, "2024-01-01");
}

#[test]
fn a_transfer_moves_money_between_bank_accounts() {
    let mut app = new_app();
    let savings = app
        .call(|s| {
            s.create_account(
                "091".into(),
                "Savings".into(),
                "bank".into(),
                String::new(),
                None,
            )
        })
        .unwrap();
    app.call(|s| {
        s.create_journal(
            "2024-01-01".into(),
            "Capital".into(),
            vec![
                jl("acc-bank", 100_000, 0),
                jl("acc-owner-funds", 0, 100_000),
            ],
        )
    })
    .unwrap();
    assert!(app
        .call(|s| s.record_transfer(
            "acc-bank".into(),
            "acc-bank".into(),
            "2024-01-02".into(),
            1,
            String::new()
        ))
        .is_err());
    assert!(app
        .call(|s| s.record_transfer(
            "acc-bank".into(),
            "acc-sales".into(),
            "2024-01-02".into(),
            1,
            String::new()
        ))
        .is_err());
    app.call(|s| {
        s.record_transfer(
            "acc-bank".into(),
            savings.clone(),
            "2024-01-02".into(),
            40_000,
            String::new(),
        )
    })
    .unwrap();
    let accounts = app.view(|s| s.list_accounts(false)).unwrap();
    let bal = |id: &str| accounts.iter().find(|a| a.id == id).unwrap().balance;
    assert_eq!((bal("acc-bank"), bal(&savings)), (60_000, 40_000));
    // A transfer is not money in or out of the business.
    let d = app.view(|s| s.get_dashboard("2024-01-31".into())).unwrap();
    let jan = d.cash_flow.iter().find(|m| m.month == "2024-01").unwrap();
    assert_eq!((jan.money_in, jan.money_out), (100_000, 0));
}

// ── Reports ─────────────────────────────────────────────────────────────────

#[test]
fn last_years_profit_rolls_into_retained_earnings() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    approved_invoice(&mut app, &c, "2023-08-01"); // 100,000 income last calendar year
    let id = approved_invoice(&mut app, &c, "2024-02-01"); // and this year
    app.call(|s| {
        s.record_payment(
            id.clone(),
            "acc-bank".into(),
            "2024-02-10".into(),
            120_000,
            String::new(),
        )
    })
    .unwrap();
    let bs = app.view(|s| s.balance_sheet("2024-06-30".into())).unwrap();
    let eq = |name: &str| {
        bs.equity
            .rows
            .iter()
            .find(|r| r.name == name)
            .map(|r| r.amount)
    };
    assert_eq!(eq("Retained Earnings"), Some(100_000));
    assert_eq!(eq("Current Year Earnings"), Some(100_000));
    assert_eq!(bs.total_assets, 240_000);
    assert_eq!(bs.total_liabilities, 40_000);
    assert_balanced(&app, "2024-06-30");
    // With a July–June year, both invoices fall in FY2023/24.
    app.call(|s| {
        s.update_settings(
            String::new(),
            "USD".into(),
            6,
            "INV-".into(),
            30,
            "Tax".into(),
            String::new(),
        )
    })
    .unwrap();
    let bs = app.view(|s| s.balance_sheet("2024-06-30".into())).unwrap();
    let eq = |name: &str| {
        bs.equity
            .rows
            .iter()
            .find(|r| r.name == name)
            .map(|r| r.amount)
    };
    assert_eq!(
        (eq("Retained Earnings"), eq("Current Year Earnings")),
        (None, Some(200_000))
    );
}

#[test]
fn aged_receivables_bucket_by_days_overdue() {
    let mut app = new_app();
    let acme = contact(&mut app, "Acme");
    let beta = contact(&mut app, "Beta");
    approved_invoice(&mut app, &acme, "2024-06-25"); // due 06-25: current on 06-30? no, 5 days late
    approved_invoice(&mut app, &acme, "2024-03-01"); // 121 days late
    let b = approved_invoice(&mut app, &beta, "2024-07-15"); // issued after as_at: left out
    let r = app
        .view(|s| s.aged_receivables("2024-06-30".into()))
        .unwrap();
    assert_eq!(r.rows.len(), 1);
    assert_eq!(
        (r.rows[0].days_1_30, r.rows[0].over_90, r.rows[0].total),
        (120_000, 120_000, 240_000)
    );
    assert_eq!(r.totals.total, 240_000);
    // Part-paid before the date counts what is left.
    app.call(|s| {
        s.record_payment(
            b.clone(),
            "acc-bank".into(),
            "2024-07-20".into(),
            20_000,
            String::new(),
        )
    })
    .unwrap();
    let r = app
        .view(|s| s.aged_receivables("2024-07-31".into()))
        .unwrap();
    let beta_row = r.rows.iter().find(|r| r.contact_name == "Beta").unwrap();
    assert_eq!((beta_row.days_1_30, beta_row.total), (100_000, 100_000));
    assert!(app
        .view(|s| s.aged_payables("2024-07-31".into()))
        .unwrap()
        .rows
        .is_empty());
}

#[test]
fn account_transactions_carry_a_running_balance() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-01-15");
    app.call(|s| {
        s.record_payment(
            id.clone(),
            "acc-bank".into(),
            "2024-02-01".into(),
            20_000,
            String::new(),
        )
    })
    .unwrap();
    app.call(|s| {
        s.record_payment(
            id.clone(),
            "acc-bank".into(),
            "2024-03-01".into(),
            30_000,
            String::new(),
        )
    })
    .unwrap();
    let t = app
        .view(|s| {
            s.account_transactions("acc-bank".into(), "2024-02-15".into(), "2024-12-31".into())
        })
        .unwrap();
    assert_eq!(t.opening_balance, 20_000);
    assert_eq!(t.rows.len(), 1);
    assert_eq!(
        (
            t.rows[0].debit,
            t.rows[0].balance,
            t.rows[0].contact_name.as_str()
        ),
        (30_000, 50_000, "Acme")
    );
    assert_eq!(t.rows[0].reference, "INV-0001");
    assert_eq!(t.closing_balance, 50_000);
}

#[test]
fn the_dashboard_counts_whats_owed_each_way() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    draft_invoice(&mut app, &c, "2024-05-01");
    approved_invoice(&mut app, &c, "2024-05-01"); // due 05-01: overdue on 05-20
    approved_invoice(&mut app, &c, "2024-05-30"); // not yet due
    let d = app.view(|s| s.get_dashboard("2024-05-20".into())).unwrap();
    assert_eq!(
        (
            d.receivables.draft_count,
            d.receivables.awaiting_count,
            d.receivables.overdue_count
        ),
        (1, 2, 1)
    );
    assert_eq!(d.receivables.overdue_total, 120_000);
    assert_eq!(d.cash_flow.len(), 6);
    assert_eq!(d.cash_flow.last().unwrap().month, "2024-05");
    // The invoice dated after today is not yet this year's profit.
    assert_eq!(d.profit_ytd, 100_000);
    assert_eq!(d.bank_accounts[0].account_id, "acc-bank");
}

#[test]
fn the_ledger_always_balances() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let inv = approved_invoice(&mut app, &c, "2024-01-10");
    app.call(|s| {
        s.record_payment(
            inv.clone(),
            "acc-bank".into(),
            "2024-01-20".into(),
            50_000,
            String::new(),
        )
    })
    .unwrap();
    let bill = app
        .call(|s| {
            s.create_invoice(
                "bill".into(),
                c.clone(),
                "S1".into(),
                "2024-01-11".into(),
                "2024-02-11".into(),
                "inclusive".into(),
                vec![
                    line("Stock", 3_333, 1_001, "acc-cogs", "tax-reduced"),
                    line("Disc", 1_000, -99, "acc-cogs", "tax-reduced"),
                ],
                String::new(),
            )
        })
        .unwrap();
    app.call(|s| s.approve_invoice(bill.clone())).unwrap();
    app.call(|s| {
        s.record_payment(
            bill.clone(),
            "acc-bank".into(),
            "2024-01-25".into(),
            1_000,
            String::new(),
        )
    })
    .unwrap();
    app.call(|s| {
        s.create_bank_transaction(
            "receive".into(),
            "acc-bank".into(),
            None,
            "2024-01-26".into(),
            String::new(),
            "exclusive".into(),
            vec![line(
                "Interest",
                1_000,
                333,
                "acc-interest-income",
                "tax-reduced",
            )],
        )
    })
    .unwrap();
    app.call(|s| {
        s.create_journal(
            "2024-01-31".into(),
            "Depreciation".into(),
            vec![jl("acc-general", 777, 0), jl("acc-equipment", 0, 777)],
        )
    })
    .unwrap();
    for as_at in ["2024-01-15", "2024-01-31", "2025-12-31"] {
        assert_balanced(&app, as_at);
    }
}

// ── Reconciliation ──────────────────────────────────────────────────────────

fn stmt(date: &str, desc: &str, amount: i64) -> StatementLineInput {
    StatementLineInput {
        date: date.into(),
        description: desc.into(),
        amount,
    }
}

#[test]
fn statement_imports_are_idempotent() {
    let mut app = new_app();
    let lines = vec![
        stmt("2024-03-01", "Coffee", -350),
        stmt("2024-03-01", "Coffee", -350),
        stmt("2024-03-02", "Acme", 120_000),
    ];
    assert_eq!(
        app.call(|s| s.import_statement_lines("acc-bank".into(), lines.clone()))
            .unwrap(),
        3
    );
    // The same export again adds nothing; an overlapping one adds only what is new.
    assert_eq!(
        app.call(|s| s.import_statement_lines("acc-bank".into(), lines.clone()))
            .unwrap(),
        0
    );
    let mut more = lines;
    more.push(stmt("2024-03-03", "Fee", -1_500));
    assert_eq!(
        app.call(|s| s.import_statement_lines("acc-bank".into(), more))
            .unwrap(),
        1
    );
    assert_eq!(
        app.view(|s| s.list_statement_lines("acc-bank".into()))
            .unwrap()
            .len(),
        4
    );
    assert!(app
        .call(|s| s.import_statement_lines("acc-sales".into(), vec![stmt("2024-03-01", "x", 1)]))
        .is_err());
    assert!(app
        .call(|s| s.import_statement_lines("acc-bank".into(), vec![stmt("2024-03-01", "x", 0)]))
        .is_err());
}

#[test]
fn reconciling_matches_a_payment_or_codes_a_new_transaction() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let inv = approved_invoice(&mut app, &c, "2024-03-01");
    let pay = app
        .call(|s| {
            s.record_payment(
                inv.clone(),
                "acc-bank".into(),
                "2024-03-02".into(),
                120_000,
                String::new(),
            )
        })
        .unwrap();
    app.call(|s| {
        s.import_statement_lines(
            "acc-bank".into(),
            vec![
                stmt("2024-03-02", "ACME LTD", 120_000),
                stmt("2024-03-03", "BANK FEE", -1_500),
                stmt("2024-03-04", "ACME AGAIN", 119_999),
            ],
        )
    })
    .unwrap();
    let lines = app
        .view(|s| s.list_statement_lines("acc-bank".into()))
        .unwrap();
    let id_of = |desc: &str| {
        lines
            .iter()
            .find(|l| l.description == desc)
            .unwrap()
            .id
            .clone()
    };
    let (acme, fee, wrong) = (id_of("ACME LTD"), id_of("BANK FEE"), id_of("ACME AGAIN"));

    assert!(
        app.call(|s| s.reconcile_statement_line(wrong.clone(), pay.clone()))
            .is_err(),
        "amount differs"
    );
    app.call(|s| s.reconcile_statement_line(acme.clone(), pay.clone()))
        .unwrap();
    // One payment, one line.
    app.call(|s| s.delete_statement_line(wrong.clone()))
        .unwrap();
    app.call(|s| {
        s.import_statement_lines("acc-bank".into(), vec![stmt("2024-03-05", "DUP", 120_000)])
    })
    .unwrap();
    let dup = app
        .view(|s| s.list_statement_lines("acc-bank".into()))
        .unwrap()
        .into_iter()
        .find(|l| l.description == "DUP")
        .unwrap()
        .id;
    assert!(app
        .call(|s| s.reconcile_statement_line(dup.clone(), pay.clone()))
        .is_err());

    let spend = app
        .call(|s| {
            s.code_statement_line(
                fee.clone(),
                None,
                "acc-bank-fees".into(),
                "tax-none".into(),
                String::new(),
            )
        })
        .unwrap();
    let lines = app
        .view(|s| s.list_statement_lines("acc-bank".into()))
        .unwrap();
    let get = |id: &str| lines.iter().find(|l| l.id == id).unwrap().clone();
    assert!(get(&acme).reconciled);
    assert!(get(&acme).match_label.contains("INV-0001"));
    assert!(get(&fee).reconciled);
    assert_eq!(get(&fee).matched.as_deref(), Some(spend.as_str()));
    assert!(app.call(|s| s.delete_statement_line(acme.clone())).is_err());

    let d = app.view(|s| s.get_dashboard("2024-03-31".into())).unwrap();
    assert_eq!(d.bank_accounts[0].balance, 118_500);
    assert_eq!(d.bank_accounts[0].unreconciled, 1);

    // Voiding the payment unreconciles its line, by derivation alone.
    app.call(|s| s.void_record(pay.clone(), String::new()))
        .unwrap();
    assert!(
        !app.view(|s| s.list_statement_lines("acc-bank".into()))
            .unwrap()
            .iter()
            .find(|l| l.id == acme)
            .unwrap()
            .reconciled
    );
    app.call(|s| s.unreconcile_statement_line(acme.clone()))
        .unwrap();
    app.call(|s| s.delete_statement_line(acme.clone())).unwrap();
}

#[test]
fn a_statement_line_reconciles_against_a_transfer() {
    let mut app = new_app();
    let savings = app
        .call(|s| {
            s.create_account(
                "091".into(),
                "Savings".into(),
                "bank".into(),
                String::new(),
                None,
            )
        })
        .unwrap();
    let x = app
        .call(|s| {
            s.record_transfer(
                "acc-bank".into(),
                savings.clone(),
                "2024-01-02".into(),
                5_000,
                String::new(),
            )
        })
        .unwrap();
    app.call(|s| {
        s.import_statement_lines(
            savings.clone(),
            vec![stmt("2024-01-02", "FROM CURRENT", 5_000)],
        )
    })
    .unwrap();
    app.call(|s| {
        s.import_statement_lines(
            "acc-bank".into(),
            vec![stmt("2024-01-02", "TO SAVINGS", -5_000)],
        )
    })
    .unwrap();
    for bank in [savings.clone(), "acc-bank".to_string()] {
        let l = app
            .view(|s| s.list_statement_lines(bank.clone()))
            .unwrap()
            .remove(0);
        app.call(|s| s.reconcile_statement_line(l.id.clone(), x.clone()))
            .unwrap();
        assert!(app.view(|s| s.list_statement_lines(bank.clone())).unwrap()[0].reconciled);
    }
}

// ── Lock date ───────────────────────────────────────────────────────────────

#[test]
fn nothing_posts_or_voids_on_or_before_the_lock_date() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let old = approved_invoice(&mut app, &c, "2024-03-31");
    let draft = draft_invoice(&mut app, &c, "2024-03-15");
    app.call(|s| s.set_lock_date(Some("2024-03-31".into())))
        .unwrap();
    assert_eq!(
        app.view(|s| s.get_settings()).unwrap().lock_date.as_deref(),
        Some("2024-03-31")
    );
    assert!(app.call(|s| s.approve_invoice(draft.clone())).is_err());
    assert!(app
        .call(|s| s.void_record(old.clone(), String::new()))
        .is_err());
    assert!(app
        .call(|s| s.record_payment(
            old.clone(),
            "acc-bank".into(),
            "2024-03-31".into(),
            1,
            String::new()
        ))
        .is_err());
    app.call(|s| {
        s.record_payment(
            old.clone(),
            "acc-bank".into(),
            "2024-04-01".into(),
            1,
            String::new(),
        )
    })
    .unwrap();
    assert!(app
        .call(|s| s.create_journal(
            "2024-01-01".into(),
            "x".into(),
            vec![jl("acc-bank", 1, 0), jl("acc-owner-funds", 0, 1)]
        ))
        .is_err());
    app.call(|s| s.set_lock_date(None)).unwrap();
    app.call(|s| s.approve_invoice(draft.clone())).unwrap();
    assert!(app
        .call(|s| s.set_lock_date(Some("31/03/2024".into())))
        .is_err());
}

// ── Chart, tax rates, contacts ──────────────────────────────────────────────

#[test]
fn the_chart_protects_system_accounts_and_unique_codes() {
    let mut app = new_app();
    assert!(app
        .call(|s| s.create_account(
            "200".into(),
            "Dup".into(),
            "revenue".into(),
            String::new(),
            None
        ))
        .is_err());
    assert!(app
        .call(|s| s.create_account(
            "x y".into(),
            "Bad".into(),
            "revenue".into(),
            String::new(),
            None
        ))
        .is_err());
    assert!(app
        .call(|s| s.create_account(
            "201".into(),
            "Bad".into(),
            "income".into(),
            String::new(),
            None
        ))
        .is_err());
    let id = app
        .call(|s| {
            s.create_account(
                "201".into(),
                "Services".into(),
                "revenue".into(),
                "Fees".into(),
                Some("tax-standard".into()),
            )
        })
        .unwrap();
    app.call(|s| {
        s.update_account(
            id.clone(),
            "201".into(),
            "Service fees".into(),
            "revenue".into(),
            String::new(),
            None,
        )
    })
    .unwrap();
    assert!(app
        .call(|s| s.update_account(
            "acc-ar".into(),
            "610".into(),
            "AR".into(),
            "bank".into(),
            String::new(),
            None
        ))
        .is_err());
    assert!(app
        .call(|s| s.set_account_archived("acc-tax".into(), true))
        .is_err());
    assert!(app.call(|s| s.delete_account("acc-ap".into())).is_err());

    // Used accounts are archived, unused ones deleted.
    let c = contact(&mut app, "Acme");
    app.call(|s| {
        s.create_bank_transaction(
            "receive".into(),
            "acc-bank".into(),
            None,
            "2024-01-01".into(),
            String::new(),
            "none".into(),
            vec![line("x", 1_000, 100, &id, "tax-none")],
        )
    })
    .unwrap();
    assert!(app.call(|s| s.delete_account(id.clone())).is_err());
    app.call(|s| s.set_account_archived(id.clone(), true))
        .unwrap();
    assert!(!app
        .view(|s| s.list_accounts(false))
        .unwrap()
        .iter()
        .any(|a| a.id == id));
    assert!(app
        .view(|s| s.list_accounts(true))
        .unwrap()
        .iter()
        .any(|a| a.id == id && a.archived));
    // An archived account takes no new lines.
    assert!(app
        .call(|s| s.create_invoice(
            "sales".into(),
            c.clone(),
            String::new(),
            "2024-01-01".into(),
            "2024-01-01".into(),
            "none".into(),
            vec![line("x", 1_000, 1, &id, "tax-none")],
            String::new()
        ))
        .is_err());
    let spare = app
        .call(|s| {
            s.create_account(
                "999".into(),
                "Spare".into(),
                "expense".into(),
                String::new(),
                None,
            )
        })
        .unwrap();
    app.call(|s| s.delete_account(spare.clone())).unwrap();
}

#[test]
fn tax_rates_are_managed() {
    let mut app = new_app();
    assert!(app
        .call(|s| s.create_tax_rate("Silly".into(), 10_001))
        .is_err());
    let id = app
        .call(|s| s.create_tax_rate("GST".into(), 1_500))
        .unwrap();
    app.call(|s| s.update_tax_rate(id.clone(), "GST 15%".into(), 1_500))
        .unwrap();
    app.call(|s| s.set_tax_rate_archived(id.clone(), true))
        .unwrap();
    assert!(app
        .call(|s| s.set_tax_rate_archived("tax-none".into(), true))
        .is_err());
    let r = app
        .view(|s| s.list_tax_rates())
        .unwrap()
        .into_iter()
        .find(|r| r.id == id)
        .unwrap();
    assert_eq!((r.name.as_str(), r.archived), ("GST 15%", true));
}

#[test]
fn contacts_carry_their_balances_and_are_kept_while_used() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    assert!(app
        .call(|s| s.create_contact(
            "X".into(),
            "not-an-email".into(),
            String::new(),
            String::new(),
            String::new()
        ))
        .is_err());
    app.call(|s| {
        s.update_contact(
            c.clone(),
            "Acme Ltd".into(),
            "ap@acme.test".into(),
            "1".into(),
            "1 Road".into(),
            "VAT1".into(),
        )
    })
    .unwrap();
    approved_invoice(&mut app, &c, "2024-01-01");
    let v = app.view(|s| s.list_contacts()).unwrap().remove(0);
    assert_eq!(
        (v.name.as_str(), v.receivable, v.invoice_count),
        ("Acme Ltd", 120_000, 1)
    );
    assert!(app.call(|s| s.delete_contact(c.clone())).is_err());
    let spare = contact(&mut app, "Spare");
    app.call(|s| s.delete_contact(spare.clone())).unwrap();
}

#[test]
fn notes_are_attributed() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = draft_invoice(&mut app, &c, "2024-01-01");
    assert!(app.call(|s| s.add_note(id.clone(), "  ".into())).is_err());
    app.call_as_account(OTHER, OTHER, |s| {
        s.add_note(id.clone(), "Chased by phone".into())
    })
    .unwrap();
    let h = app.view(|s| s.list_history(id.clone())).unwrap();
    let note = h.iter().find(|h| h.action == "note").unwrap();
    assert_eq!(note.detail, "Chased by phone");
    assert_eq!(note.author, AccountId::from(OTHER).to_string());
}

// ── Storage-enforced guarantees (hold against a patched node) ───────────────

#[test]
fn nobody_rewrites_or_removes_a_posted_record() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-01-01");
    let p = app
        .call(|s| {
            s.record_payment(
                id.clone(),
                "acc-bank".into(),
                "2024-01-02".into(),
                100,
                String::new(),
            )
        })
        .unwrap();
    // Not the poster either. `WriteOnce` has no modify or remove at all, so
    // the one write left is inserting over the entry, which is refused.
    let mut emptied = app.view(|s| s.approvals.get(&id)).unwrap().unwrap();
    emptied.lines.clear();
    assert!(app
        .call(|s| s.approvals.insert(id.clone(), emptied.clone()))
        .is_err());
    let mut shrunk = app.view(|s| s.payments.get(&p)).unwrap().unwrap();
    shrunk.amount = 1;
    assert!(app
        .call(|s| s.payments.insert(p.clone(), shrunk.clone()))
        .is_err());
    assert_eq!(invoice(&app, &id).total, 120_000);
    assert_eq!(invoice(&app, &id).paid, 100);
}

#[test]
fn editing_the_draft_row_after_approval_moves_nothing_posted() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-01-01");
    // What a patched node can do: rewrite the shared draft's registers.
    app.call(|s| s.invoices.update(&id, |d| d.lines.set(vec![])))
        .unwrap();
    assert_eq!(invoice(&app, &id).total, 120_000);
    let tb = app.view(|s| s.trial_balance("2024-12-31".into())).unwrap();
    assert_eq!(row(&tb.rows, "acc-ar"), (120_000, 0));
}

#[test]
fn a_competing_approval_is_flagged_and_cannot_be_used_to_edit() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-01-01");
    let original = invoice(&app, &id);
    // Another member files a second approval at the same id, later.
    app.call_as_account(OTHER, OTHER, |s| {
        s.approvals.insert(
            id.clone(),
            Approval {
                kind: "sales".into(),
                contact_id: c.clone(),
                reference: String::new(),
                issue_date: "2024-01-01".into(),
                due_date: "2024-01-01".into(),
                amounts_are: "none".into(),
                lines: vec![],
                notes: String::new(),
                at: u64::MAX,
            },
        )
    })
    .unwrap();
    let v = invoice(&app, &id);
    assert!(v.conflicted);
    assert_eq!(
        (v.total, v.approved_by.as_str()),
        (original.total, original.approved_by.as_str())
    );
}

#[test]
fn an_unbalanced_journal_written_around_the_api_stays_out_of_the_ledger() {
    let mut app = new_app();
    app.call(|s| {
        s.journals.insert(
            "jnl-forged".into(),
            Journal {
                date: "2024-01-01".into(),
                narration: "Free money".into(),
                lines: vec![jl("acc-bank", 1_000_000, 0)],
                source: "journal".into(),
                at: 1,
            },
        )
    })
    .unwrap();
    let j = app.view(|s| s.list_journals()).unwrap().remove(0);
    assert!(!j.balanced);
    assert!(app
        .view(|s| s.trial_balance("2024-12-31".into()))
        .unwrap()
        .rows
        .is_empty());
    // And it can be voided, so the list stops showing it as live.
    app.call(|s| s.void_record("jnl-forged".into(), "Forged".into()))
        .unwrap();
    assert!(app.view(|s| s.list_journals()).unwrap()[0].voided);
}

#[test]
fn any_members_void_voids_and_the_voider_is_the_stamp() {
    let mut app = new_app();
    let c = contact(&mut app, "Acme");
    let id = approved_invoice(&mut app, &c, "2024-01-01");
    app.call_as_account(OTHER, OTHER, |s| {
        s.void_record(id.clone(), "Duplicate".into())
    })
    .unwrap();
    assert_eq!(invoice(&app, &id).status, "void");
    let h = app.view(|s| s.list_history(id.clone())).unwrap();
    let v = h.iter().find(|h| h.action == "voided").unwrap();
    assert_eq!(v.author, AccountId::from(OTHER).to_string());
    // Nobody un-voids: `WriteOnce` has no remove, and the voider cannot
    // write over their void either.
    let void = VoidRecord {
        reason: String::new(),
        at: 0,
    };
    assert!(app
        .call_as_account(OTHER, OTHER, |s| s.voids.insert(id.clone(), void.clone()))
        .is_err());
}

#[test]
fn out_of_range_settings_written_around_the_api_are_clamped_on_read() {
    let mut app = new_app();
    app.call(|s| {
        s.fy_end_month.set(99);
        s.payment_terms_days.set(10_000);
        s.lock_date.set(Some("garbage".into()));
        Ok::<_, calimero_storage::collections::StoreError>(())
    })
    .unwrap();
    let s = app.view(|s| s.get_settings()).unwrap();
    assert_eq!(
        (s.fy_end_month, s.payment_terms_days, s.lock_date),
        (12, 365, None)
    );
}
