//! Convergence coverage for the item-registry service.
//!
//! `Registry` hand-writes `Mergeable`/`RekeyTarget` on its `Item` map value (it
//! nests an `LwwRegister`), so this is the #2577 case: without deterministic
//! re-keying the nested register would be last-writer-wins'd as an opaque blob.
//! We register the generated re-key thunks (`__calimero_register_rekey()` — the
//! WASM-load / TestHost-bridge path) so the nested register gets a deterministic
//! id and converges as a child entity, then assert every replica lands on the
//! same Merkle root.
//!
//! Surface under test: the `items: UnorderedMap<String, Item>` field only. The
//! sibling `owners: AuthoredMap` is `CrdtType::UserStorage`, whose per-entry
//! merge runs on the *signed* delta path (`Interface::apply_action`) — the bare
//! `converge_app` harness has no signing identity and cannot reconcile `User`
//! deltas (see `core/crates/storage/src/testing.rs` Limitations; no
//! converge-tested core app puts authored/shared/user storage in state). So we
//! seed items at **genesis** (single identity, snapshotted identically into
//! every replica — no concurrent owners-merge) and then drive only `update`,
//! which touches `items` exclusively. That is exactly the nested-register #2577
//! exercise, isomorphic to the canonical `team-metrics-custom` converge test.
//!
//! `#[serial]`: `converge_app` clears/repopulates the process-global merge
//! registry per run (it self-serializes via an internal lock, but `#[serial]`
//! avoids the contention and matches the canonical core pattern —
//! `apps/team-metrics-custom/tests/converge.rs`). Own integration binary so it
//! is isolated from the in-`lib.rs` `TestHost` unit tests.

use calimero_storage::testing::converge_app;
use p2p_sheets_spreadsheet::Registry;
use serial_test::serial;

// One item is seeded at genesis (under the genesis identity, before any
// concurrent op), so every replica starts from the identical seeded state. Each
// replica then concurrently `update`s that item's nested `LwwRegister` to the
// same value, in a per-replica shuffled order. The hand-written `Item` merge +
// nested-register re-key must converge all replicas to one Merkle root, and the
// value must survive (LWW, not blob-LWW'd to a stale/empty value).
#[test]
#[serial]
fn registry_updates_converge() {
    // Register the nested-CRDT-value re-key thunks for `Item` (its `LwwRegister`
    // field). Without this the value blob is LWW'd and replicas can diverge.
    Registry::__calimero_register_rekey();

    converge_app(|| {
        // Genesis seed: runs once under the single genesis identity, so the
        // `owners` AuthoredMap entry is written without any concurrent
        // User-storage merge, then snapshotted byte-identical into all replicas.
        let mut r = Registry::init();
        let _ = r.add("widget".into(), "v0".into());
        r
    })
    .replicas(3)
    // Each replica concurrently rewrites the single seeded item's value. `update`
    // touches `items` only (no `owners` write), so this is the pure nested-
    // register convergence case.
    .ops(|s| {
        if let Some(view) = s.list().ok().and_then(|v| v.into_iter().next()) {
            let _ = s.update(view.id, "v1".into());
        }
    })
    .invariant("the single seeded item survives and holds the merged value", |s| {
        let items = s.list().unwrap_or_default();
        items.len() == 1 && items[0].value == "v1"
    })
    .assert_all_replicas_equal();
}
