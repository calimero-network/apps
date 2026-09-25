//! Convergence of the parts of mero-vote that several members write at once.
//!
//! Every replica applies every op under its own account and then gossips, so
//! these are the concurrent interleavings a sequential scenario never reaches.
//! The protocol-level lifecycle is in `src/tests.rs`; this file is only about
//! the CRDT shape: per-account slots and creator-owned polls must union, never
//! overwrite each other.

use calimero_storage::testing::converge_app;
use mero_vote::MeroVote;

const REPLICAS: usize = 3;

fn node_init() -> MeroVote {
    let mut state = MeroVote::init();
    state.__assign_deterministic_ids();
    state
}

#[test]
fn every_members_slot_survives_concurrent_writes() {
    converge_app(node_init)
        .replicas(REPLICAS)
        .ops(|s: &mut MeroVote| {
            let me = s.whoami().account;
            let _ = s.set_name(format!("member-{}", &me[..8]));
        })
        .invariant("one roster entry per account", |s: &MeroVote| {
            s.roster().map(|r| r.len()).unwrap_or(0) == REPLICAS
        })
        .assert_all_replicas_equal();
}

#[test]
fn polls_created_concurrently_all_survive() {
    converge_app(node_init)
        .replicas(REPLICAS)
        .ops(|s: &mut MeroVote| {
            let me = s.whoami().account;
            let _ = s.create_poll(
                "Concurrent".into(),
                String::new(),
                vec!["yes".into(), "no".into()],
                1,
                1,
                vec![me],
                vec![],
                None,
            );
        })
        .invariant("one poll per creator", |s: &MeroVote| {
            s.list_polls().map(|p| p.len()).unwrap_or(0) == REPLICAS
        })
        .assert_all_replicas_equal();
}
