//! Convergence coverage for the canonical `UnorderedMap<String, LwwRegister>`
//! key-value store. Distinct keys written concurrently must all survive (map
//! union); `LwwRegister` values converge by HLC last-writer-wins.
//!
//! These run in milliseconds and cover the property the merobox scenarios are
//! worst at reaching reliably: CONCURRENT writes from several replicas with a
//! shuffled delivery order.
//!
//! Two things about the harness that the assertions below depend on:
//!
//!   * `.ops(..)` is NOT a partition of work. EVERY replica applies EVERY
//!     registered op locally, under its own executor id, in a per-replica
//!     shuffled order, then gossips the delta. So an op listed once and run with
//!     `n` replicas executes `n` times. `REPLICAS` is used in the arithmetic
//!     rather than a literal so the two cannot drift apart.
//!   * `assert_all_replicas_equal()` alone is not enough. Deterministic
//!     last-writer-wins converges every replica on the same *wrong* value, so a
//!     data-loss bug passes a pure hash check. Every test that can express a
//!     value-level expectation also asserts an `.invariant(..)`.

use kv_store::KvStore;

use calimero_storage::testing::converge_app;

/// In one place: the counter/length invariants multiply by it.
const REPLICAS: usize = 3;

#[test]
fn distinct_keys_all_survive() {
    converge_app(KvStore::init)
        .replicas(3)
        .ops(|s| {
            let _ = s.set("a".into(), "1".into());
        })
        .ops(|s| {
            let _ = s.set("b".into(), "2".into());
        })
        .ops(|s| {
            let _ = s.set("c".into(), "3".into());
        })
        .invariant("all three keys present", |s| s.len().unwrap_or(0) == 3)
        .invariant("every value survived intact", |s| {
            s.get("a").ok().flatten().as_deref() == Some("1")
                && s.get("b").ok().flatten().as_deref() == Some("2")
                && s.get("c").ok().flatten().as_deref() == Some("3")
        })
        .assert_all_replicas_equal();
}

#[test]
fn one_key_written_by_everyone_converges_without_splitting() {
    // The LWW case. Exactly one value may survive — and the part worth
    // asserting is that the map still holds ONE key, not one per writer. A
    // per-writer split converges too, and every single-key read would still
    // return something.
    converge_app(KvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.set("contended".into(), "from-a".into());
        })
        .ops(|s| {
            let _ = s.set("contended".into(), "from-b".into());
        })
        .invariant("the key did not split per writer", |s| {
            s.len().unwrap_or(0) == 1
        })
        .invariant("a value survived", |s| {
            s.get("contended").ok().flatten().is_some()
        })
        .assert_all_replicas_equal();
}

#[test]
fn update_if_exists_never_inserts_however_the_deltas_interleave() {
    // The contract guarantee that is easiest to break by accident: it is the
    // `get_mut` path, so a missing key must be a no-op rather than an insert.
    // Running it with no prior write means EVERY replica attempts it on an
    // absent key, in a shuffled order — the interleaving a sequential scenario
    // cannot produce.
    converge_app(KvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.update_if_exists("ghost".into(), "should-not-land".into());
        })
        .invariant("nothing was inserted", |s| s.len().unwrap_or(1) == 0)
        .invariant("the key is genuinely absent", |s| {
            s.get("ghost").ok().flatten().is_none()
        })
        .assert_all_replicas_equal();
}

#[test]
fn get_or_insert_yields_one_agreed_value_under_concurrency() {
    // `entry().or_insert()`. Every replica races to insert a DIFFERENT value
    // for the same key; afterwards all of them must read the same one back, and
    // there must be exactly one entry.
    converge_app(KvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.get_or_insert("shared".into(), "first".into());
        })
        .ops(|s| {
            let _ = s.get_or_insert("shared".into(), "second".into());
        })
        .invariant("exactly one entry", |s| s.len().unwrap_or(0) == 1)
        .invariant("a value is readable", |s| {
            s.get("shared").ok().flatten().is_some()
        })
        .assert_all_replicas_equal();
}

#[test]
fn a_remove_concurrent_with_a_write_still_converges() {
    // Remove and set on the SAME key, issued by every replica in a shuffled
    // order. Which one wins is the CRDT's business; that all replicas end up
    // agreeing is not. This is the interleaving most likely to leave two nodes
    // permanently disagreeing about whether a key exists.
    converge_app(KvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.set("churn".into(), "value".into());
        })
        .ops(|s| {
            let _ = s.remove("churn");
        })
        .invariant("the map is in a coherent state", |s| {
            // Either outcome is legitimate; a half-removed entry is not. len()
            // and get() are separate code paths over the same map, and this is
            // exactly where they can disagree.
            let present = s.get("churn").ok().flatten().is_some();
            let len = s.len().unwrap_or(usize::MAX);
            (present && len == 1) || (!present && len == 0)
        })
        .assert_all_replicas_equal();
}

#[test]
fn entries_agrees_with_len_after_a_merge() {
    // Two different reads over the same merged map. `entries()` walks the
    // collection and `len()` asks it for a count, so a merge that left a
    // dangling child would show up as a disagreement between them and in
    // neither one alone.
    converge_app(KvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.set("k1".into(), "v1".into());
        })
        .ops(|s| {
            let _ = s.set("k2".into(), "v2".into());
        })
        .invariant("entries() and len() see the same map", |s| {
            let entries = s.entries().map(|e| e.len()).unwrap_or(usize::MAX);
            let len = s.len().unwrap_or(0);
            entries == len && len == 2
        })
        .assert_all_replicas_equal();
}

#[test]
fn clear_converges_against_concurrent_writes() {
    // `clear` is the whole-collection operation, and it is racing writes here.
    // The invariant is coherence rather than emptiness: a write that lands after
    // the clear legitimately survives.
    converge_app(KvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.set("before".into(), "x".into());
        })
        .ops(|s| {
            let _ = s.clear();
        })
        .invariant("entries() and len() still agree", |s| {
            let entries = s.entries().map(|e| e.len()).unwrap_or(usize::MAX);
            entries == s.len().unwrap_or(0)
        })
        .assert_all_replicas_equal();
}

#[test]
fn one_person_on_several_devices_shares_one_map() {
    // `.one_account()` models ONE person on N devices rather than N unrelated
    // people. The map is context state, not per-account state, so the outcome
    // must be identical either way — this is the control that says the account
    // plane does not leak into ordinary collection storage.
    converge_app(KvStore::init)
        .replicas(REPLICAS)
        .one_account()
        .ops(|s| {
            let _ = s.set("laptop".into(), "1".into());
        })
        .ops(|s| {
            let _ = s.set("phone".into(), "2".into());
        })
        .invariant("both devices' writes are in one map", |s| {
            s.len().unwrap_or(0) == 2
        })
        .assert_all_replicas_equal();
}
