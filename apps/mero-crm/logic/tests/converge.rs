//! Convergence coverage for the CRM service.
//!
//! `Deal` nests a dozen `LwwRegister`s, so this is the #2577 case: without the
//! generated re-key thunks the value blob is LWW'd as one opaque value and a
//! concurrent stage move on one replica would erase a concurrent value edit on
//! another. Each replica concurrently moves the seeded deal AND edits its value;
//! every replica must land on the same Merkle root.
//!
//! `#[serial]`: `converge_app` clears/repopulates the process-global merge
//! registry per run.

use calimero_storage::testing::converge_app;
use mero_crm::Crm;
use serial_test::serial;

#[test]
#[serial]
fn deal_moves_and_edits_converge() {
    Crm::__calimero_register_rekey();

    converge_app(|| {
        let mut s = Crm::init();
        let _ = s.create_deal(
            "seed".into(),
            1_000,
            "Acme".into(),
            None,
            "stage-lead".into(),
            None,
            None,
            String::new(),
        );
        s
    })
    .replicas(3)
    .ops(|s| {
        if let Some(deal) = s
            .list_deals(None, None, None)
            .ok()
            .and_then(|v| v.into_iter().next())
        {
            let _ = s.move_deal(deal.id.clone(), "stage-proposal".into());
            let _ = s.set_rotting_days(7);
        }
    })
    .invariant("the seeded deal survives in the merged stage", |s| {
        let deals = s.list_deals(None, None, None).unwrap_or_default();
        deals.len() == 1 && deals[0].stage_id == "stage-proposal"
    })
    .assert_all_replicas_equal();
}
