//! Native coverage for the three authorization families: `AccessControl`,
//! `Ownable` and `SharedStorage`.
//!
//! These had NO Rust coverage. The gap was found the hard way: a stale bundle
//! made `init` store empty writer sets on a real node — `acl_admins` `[]`,
//! `owned_owner` `null`, every gated write refused with `Executor is not
//! authorised for this operation`, including for the account that created the
//! context — and the only thing that noticed was the in-app test panel, which
//! a person has to open and read.
//!
//! ⚠️ WHAT THESE TESTS CANNOT CATCH, so nobody reads them as a guarantee they
//! are not: the failure above was in the SHIPPED ARTIFACT, not in this source.
//! `cargo test` compiles the tree it is run in, so it is green by construction
//! against a .mpk built from anything. `logic/check-bundle-fresh.sh` is what
//! covers that; these cover the semantics.
//!
//! ⚠️ A second blind spot, relevant if you extend these: `converge_app` builds
//! genesis with `Root::new(build).commit()` and NEVER calls
//! `__assign_deterministic_ids()`, which the node's `#[app::init]` wrapper does
//! call right after `init()` returns. So the default harness path skips the
//! re-key of every top-level collection. `node_init` below calls it, so these
//! run the same sequence a node runs.

use calimero_storage::testing::converge_app;
use scaffolding_e2e::E2eKvStore;

/// `init()` followed by the re-key the node's init wrapper performs. Use this
/// rather than `E2eKvStore::init` directly — see the note above.
fn node_init() -> E2eKvStore {
    let mut state = E2eKvStore::init();
    state.__assign_deterministic_ids();
    state
}

// ── AccessControl ─────────────────────────────────────────────────────────────

#[test]
fn init_seeds_exactly_one_admin() {
    converge_app(node_init)
        .replicas(1)
        .one_account()
        .invariant("acl_admins has exactly one entry", |s: &E2eKvStore| {
            s.acl_admins().map(|a| a.len()).unwrap_or(0) == 1
        })
        .assert_all_replicas_equal();
}

#[test]
fn the_seeded_admin_can_write_the_guarded_document() {
    converge_app(node_init)
        .replicas(1)
        .one_account()
        .ops(|s: &mut E2eKvStore| {
            let _ = s.acl_doc_set("seeded-admin-wrote-this".to_owned());
        })
        .invariant(
            "the guarded doc holds the admin's write",
            |s: &E2eKvStore| {
                s.acl_doc_get()
                    .is_ok_and(|v| v == "seeded-admin-wrote-this")
            },
        )
        .assert_all_replicas_equal();
}

// ── Ownable ───────────────────────────────────────────────────────────────────

#[test]
fn init_makes_the_caller_the_owner() {
    converge_app(node_init)
        .replicas(1)
        .one_account()
        .invariant("owned_owner is Some", |s: &E2eKvStore| {
            matches!(s.owned_owner(), Ok(Some(_)))
        })
        .assert_all_replicas_equal();
}

#[test]
fn the_owner_can_write_and_read_back() {
    converge_app(node_init)
        .replicas(1)
        .one_account()
        .ops(|s: &mut E2eKvStore| {
            let _ = s.owned_set("owned-value".to_owned());
        })
        .invariant("owned_get returns the owner's write", |s: &E2eKvStore| {
            s.owned_get().is_ok_and(|v| v == "owned-value")
        })
        .assert_all_replicas_equal();
}

// ── SharedStorage ─────────────────────────────────────────────────────────────

#[test]
fn init_seeds_the_shared_writer_set_with_the_caller() {
    converge_app(node_init)
        .replicas(1)
        .one_account()
        .invariant("shared_data has at least one writer", |s: &E2eKvStore| {
            s.shared_get_writers().map(|w| w.len()).unwrap_or(0) >= 1
        })
        .assert_all_replicas_equal();
}

#[test]
fn the_seeded_writer_can_set_and_get() {
    converge_app(node_init)
        .replicas(1)
        .one_account()
        .ops(|s: &mut E2eKvStore| {
            let _ = s.shared_set("shared-value".to_owned());
        })
        .invariant("shared_get returns the write", |s: &E2eKvStore| {
            s.shared_get().is_ok_and(|v| v == "shared-value")
        })
        .assert_all_replicas_equal();
}

/// Two devices of ONE account, writing concurrently to `SharedStorage`.
///
/// Every replica must end with the same value AND the same root hash. Sync
/// compares root hashes, so two nodes holding identical data under different
/// hashes would keep seeing each other as out of date.
///
/// This was `#[ignore]`d from rc.34 to rc.41: the values agreed but the root
/// hashes did not (`replicas DIVERGED`), specifically for `SharedStorage`
/// written by two devices of one account. It passes from rc.42, where core
/// carries a collection container's own row over sync's hash comparison
/// (core#4008, #4009) — verified by running this test against both SDK tags:
/// rc.41 diverges, rc.42 passes 10/10. It stays here so the divergence cannot
/// come back unnoticed.
#[test]
fn two_devices_of_the_seeded_account_both_write() {
    converge_app(node_init)
        .replicas(3)
        .one_account()
        .ops(|s: &mut E2eKvStore| {
            let _ = s.shared_set("from-a-device".to_owned());
        })
        .invariant(
            "the shared cell converged to a real write",
            |s: &E2eKvStore| s.shared_get().is_ok_and(|v| v == "from-a-device"),
        )
        .assert_all_replicas_equal();
}
