//! Convergence coverage for the books service.
//!
//! Every replica applies every op under its own executor, in its own shuffled
//! order, and gossips the deltas. The ops are the concurrent moments a team
//! keeping one set of books actually produces: two people approving the same
//! draft, payments recorded at once, the same bank statement imported on two
//! machines, a draft edited while someone renames the organisation. Every
//! replica must land on the same root, and the invariants say what a CORRECT
//! merge produces — hash equality alone would accept a converged wrong answer.
//!
//! `#[serial]`: `converge_app` clears/repopulates the process-global merge
//! registry per run.

use calimero_storage::testing::converge_app;
use mero_books::{LineInput, MeroBooks, StatementLineInput};
use serial_test::serial;

fn seeded() -> MeroBooks {
    let mut s = MeroBooks::init();
    let c = s
        .create_contact(
            "Acme".into(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        )
        .expect("contact");
    s.create_invoice(
        "sales".into(),
        c,
        "PO-1".into(),
        "2024-03-01".into(),
        "2024-03-31".into(),
        "exclusive".into(),
        vec![LineInput {
            description: "Consulting".into(),
            quantity: 1_000,
            unit_price: 100_000,
            account_id: "acc-sales".into(),
            tax_rate_id: "tax-standard".into(),
        }],
        String::new(),
    )
    .expect("draft");
    s
}

fn the_invoice(s: &MeroBooks) -> Option<mero_books::InvoiceView> {
    s.list_invoices(Some("sales".into()))
        .ok()?
        .into_iter()
        .next()
}

#[test]
#[serial]
fn concurrent_approvals_payments_and_imports_converge() {
    MeroBooks::__calimero_register_rekey();

    converge_app(seeded)
        .replicas(3)
        .ops(|s| {
            if let Some(inv) = the_invoice(s) {
                let _ = s.approve_invoice(inv.id);
            }
        })
        .ops(|s| {
            if let Some(inv) = the_invoice(s) {
                let _ = s.record_payment(
                    inv.id,
                    "acc-bank".into(),
                    "2024-03-10".into(),
                    100,
                    String::new(),
                );
            }
        })
        .ops(|s| {
            let _ = s.import_statement_lines(
                "acc-bank".into(),
                vec![StatementLineInput {
                    date: "2024-03-10".into(),
                    description: "ACME LTD".into(),
                    amount: 100,
                }],
            );
        })
        .ops(|s| {
            let _ = s.update_settings(
                "Acme Holdings".into(),
                "GBP".into(),
                3,
                "INV-".into(),
                30,
                "VAT".into(),
                String::new(),
            );
        })
        .invariant(
            "the invoice is approved once, numbered once, and keeps its lines",
            |s| {
                the_invoice(s).is_some_and(|v| {
                    v.status != "draft" && v.number == "INV-0001" && v.total == 120_000
                })
            },
        )
        .invariant("the same statement imported everywhere is one line", |s| {
            s.list_statement_lines("acc-bank".into())
                .is_ok_and(|l| l.len() == 1)
        })
        .invariant("the trial balance balances", |s| {
            s.trial_balance("2024-12-31".into())
                .is_ok_and(|tb| tb.total_debit == tb.total_credit && tb.total_debit > 0)
        })
        .invariant("the settings edit survived", |s| {
            s.get_settings()
                .is_ok_and(|st| st.currency == "GBP" && st.fy_end_month == 3)
        })
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn concurrent_draft_edits_and_account_changes_converge() {
    MeroBooks::__calimero_register_rekey();

    converge_app(seeded)
        .replicas(3)
        .ops(|s| {
            if let Some(inv) = the_invoice(s) {
                let lines = inv
                    .lines
                    .iter()
                    .map(|l| LineInput {
                        description: l.description.clone(),
                        quantity: 2_000,
                        unit_price: l.unit_price,
                        account_id: l.account_id.clone(),
                        tax_rate_id: l.tax_rate_id.clone(),
                    })
                    .collect();
                let _ = s.update_invoice(
                    inv.id,
                    inv.contact_id,
                    "PO-2".into(),
                    inv.issue_date,
                    inv.due_date,
                    inv.amounts_are,
                    lines,
                    inv.notes,
                );
            }
        })
        .ops(|s| {
            let _ = s.update_account(
                "acc-sales".into(),
                "200".into(),
                "Sales - Services".into(),
                "revenue".into(),
                String::new(),
                Some("tax-standard".into()),
            );
        })
        .invariant("the draft took the edit", |s| {
            the_invoice(s)
                .is_some_and(|v| v.status == "draft" && v.reference == "PO-2" && v.total == 240_000)
        })
        .invariant("the account was renamed, not duplicated", |s| {
            s.list_accounts(false).is_ok_and(|a| {
                a.iter().filter(|a| a.code == "200").count() == 1
                    && a.iter().any(|a| a.name == "Sales - Services")
            })
        })
        .assert_all_replicas_equal();
}
