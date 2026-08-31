//! Convergence coverage for every CRDT family this scaffold exposes.
//!
//! WHY THIS FILE EXISTS
//!
//! The app had ONE Rust test for a 130-method contract, and that one is
//! macro-generated (the `#[app::logic]` ABI conformance check) — so nothing
//! hand-written covered the contract at all. Everything was verified either
//! through merobox (real nodes, minutes per run, and only the paths a scenario
//! happens to walk) or through the Playwright suite, which MOCKS the RPC layer
//! and therefore proves nothing about the contract. That is the same shape of
//! hole that let 13 phantom `ws_*` methods ship: two test layers, both blind in
//! the same place.
//!
//! These run in milliseconds under `cargo test` and cover the property merobox
//! is worst at: CONCURRENT writes from several replicas, with a shuffled
//! delivery order.
//!
//! HOW THE HARNESS APPLIES OPS — the thing that trips people up
//!
//! `.ops(..)` is not a partition of work across replicas. EVERY replica applies
//! EVERY registered op locally, under its own executor id, in a per-replica
//! shuffled order, then gossips the delta. So an op listed once and run with
//! `n` replicas executes `n` times in total. Counter invariants below are
//! written against that model, and `REPLICAS` is used in the arithmetic rather
//! than a literal so the two cannot drift apart.
//!
//! And `assert_all_replicas_equal()` alone is NOT enough: deterministic
//! last-writer-wins converges every replica on the same *wrong* value, so a
//! data-loss bug passes a pure hash check. Every test here that can express a
//! value-level expectation also asserts an `.invariant(..)`.

use calimero_storage::testing::converge_app;
use scaffolding_e2e::E2eKvStore;

/// Kept in one place: the counter invariants multiply by it, so a change here
/// cannot silently invalidate them.
const REPLICAS: usize = 3;

// ── UnorderedMap + LwwRegister ────────────────────────────────────────────────

#[test]
fn distinct_keys_all_survive_a_map_union() {
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.set("alpha".into(), "1".into());
        })
        .ops(|s| {
            let _ = s.set("beta".into(), "2".into());
        })
        .ops(|s| {
            let _ = s.set("gamma".into(), "3".into());
        })
        .invariant("all three keys survive", |s| s.len().unwrap_or(0) == 3)
        .invariant("values are intact", |s| {
            s.get("alpha").ok().flatten().as_deref() == Some("1")
                && s.get("beta").ok().flatten().as_deref() == Some("2")
                && s.get("gamma").ok().flatten().as_deref() == Some("3")
        })
        .assert_all_replicas_equal();
}

#[test]
fn concurrent_writes_to_one_key_converge_without_splitting_it() {
    // The LWW case: every replica writes the SAME key with a different value.
    // Exactly one value may survive, and — the part worth asserting — the map
    // must still hold one key, not one per writer.
    converge_app(E2eKvStore::init)
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

// ── Counters: the family where a wrong merge is silent ────────────────────────

#[test]
fn g_counter_sums_every_replicas_increment() {
    // The regression this guards is a merge that keeps the MAXIMUM instead of
    // summing per-writer slots. Both converge; only one is correct, and the
    // hash check cannot tell them apart.
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.increment_g_counter("hits".into());
        })
        .invariant("increments summed across replicas", |s| {
            s.get_g_counter("hits".into()).unwrap_or(0) == REPLICAS as u64
        })
        .assert_all_replicas_equal();
}

#[test]
fn pn_counter_nets_concurrent_increments_and_decrements() {
    // Two ops, each run by every replica: +1 and -1 per replica, so the net is
    // zero regardless of delivery order. A PN-counter that dropped the negative
    // slots would converge on `REPLICAS` instead.
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.increment_pn_counter("balance".into());
        })
        .ops(|s| {
            let _ = s.decrement_pn_counter("balance".into());
        })
        .invariant("increments and decrements net to zero", |s| {
            s.get_pn_counter("balance".into()).unwrap_or(-1) == 0
        })
        .assert_all_replicas_equal();
}

#[test]
fn pn_counter_may_go_negative() {
    // The whole reason `Counter<true>` exists. A G-counter clamped at zero would
    // converge on 0 here and look fine.
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.decrement_pn_counter("debt".into());
        })
        .invariant("decrement-only counter is negative", |s| {
            s.get_pn_counter("debt".into()).unwrap_or(0) == -(REPLICAS as i64)
        })
        .assert_all_replicas_equal();
}

// ── Sets and nested maps ──────────────────────────────────────────────────────

#[test]
fn set_tags_union_rather_than_overwrite() {
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.add_tag("post".into(), "rust".into());
        })
        .ops(|s| {
            let _ = s.add_tag("post".into(), "crdt".into());
        })
        .ops(|s| {
            let _ = s.add_tag("post".into(), "p2p".into());
        })
        .invariant("all three tags present", |s| {
            s.get_tag_count("post".into()).unwrap_or(0) == 3
        })
        .invariant("each tag is individually readable", |s| {
            ["rust", "crdt", "p2p"]
                .iter()
                .all(|t| s.has_tag("post".into(), (*t).into()).unwrap_or(false))
        })
        .assert_all_replicas_equal();
}

#[test]
fn vector_of_counters_merges_element_wise() {
    // `Vector<Counter>` — the nested case. Every replica pushes, so the length
    // is REPLICAS per registered op; the point is that pushes do not clobber
    // one another into a single slot.
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.push_metric(7);
        })
        .invariant("one element per replica push", |s| {
            s.metrics_len().unwrap_or(0) == REPLICAS
        })
        .assert_all_replicas_equal();
}

// ── Sorted collections: the only host-ORDERED-INDEX path in the app ───────────

#[test]
fn sorted_map_keeps_key_order_after_a_merge() {
    // `SortedMap`/`SortedSet` are the only things here that touch the host's
    // ordered index (`storage_index_set`), so a regression in that path shows up
    // in no other test. Order must hold after a concurrent merge, not just after
    // a single-replica insert.
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.sorted_set("c".into(), "3".into());
        })
        .ops(|s| {
            let _ = s.sorted_set("a".into(), "1".into());
        })
        .ops(|s| {
            let _ = s.sorted_set("b".into(), "2".into());
        })
        .invariant("keys come back sorted", |s| {
            s.sorted_keys().unwrap_or_default() == vec!["a", "b", "c"]
        })
        .invariant("last() is the greatest key", |s| {
            s.sorted_last_key().ok().flatten().as_deref() == Some("c")
        })
        .assert_all_replicas_equal();
}

#[test]
fn sorted_set_range_seek_is_bounded_after_a_merge() {
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.sorted_tag_add("apple".into());
        })
        .ops(|s| {
            let _ = s.sorted_tag_add("banana".into());
        })
        .ops(|s| {
            let _ = s.sorted_tag_add("cherry".into());
        })
        .invariant("all elements present and ordered", |s| {
            s.sorted_tags_all().unwrap_or_default() == vec!["apple", "banana", "cherry"]
        })
        .invariant("a range excludes its upper bound", |s| {
            s.sorted_tags_range("apple".into(), "cherry".into())
                .unwrap_or_default()
                == vec!["apple", "banana"]
        })
        .assert_all_replicas_equal();
}

// ── RGA text ─────────────────────────────────────────────────────────────────

#[test]
fn rga_keeps_every_concurrent_insertion() {
    // Concurrent appends into one document. The characters may interleave in any
    // order the RGA chooses — what must NOT happen is losing a writer's text
    // entirely, which a last-writer-wins string would do.
    converge_app(E2eKvStore::init)
        .replicas(REPLICAS)
        .ops(|s| {
            let _ = s.rga_append_text("xx".into());
        })
        .invariant("no writer's characters were dropped", |s| {
            s.rga_get_length().unwrap_or(0) == 2 * REPLICAS
        })
        .invariant("text length agrees with the char count", |s| {
            s.rga_get_text().unwrap_or_default().chars().count() == 2 * REPLICAS
        })
        .assert_all_replicas_equal();
}

// ── Deliberately NOT here: Shared / Authored / User / Frozen storage ─────────
//
// `frozen_items`, `authored_items`, `authored_vec`, `user_items_*`, `acl_doc`,
// `owned_doc` and `shared_data` are all covered by merobox workflows instead,
// and that is not a gap in this file — it is the harness's documented limit:
//
//     Limitations
//     - `Shared` / `Authored` / `User` / `Frozen` storage need the node's
//       signing identity (delta apply verifies signatures), which this bare
//       harness does not provide — test those with merobox workflows.
//     — calimero_storage::testing
//
// Measured, not assumed. Written against those families, the tests split two ways:
//
//   * UserStorage and AuthoredMap satisfied every value-level `.invariant(..)`
//     and then failed `assert_all_replicas_equal()` on the ROOT HASH. Their
//     entries embed the writing DEVICE (`signature_data.signer`), so three
//     replicas holding the same logical value still hash differently. The merge
//     is right; hash equality is simply the wrong assertion for them.
//   * AuthoredVector and FrozenStorage failed the invariants themselves, because
//     without a signing identity the delta apply cannot admit their entries at
//     all.
//
// Both outcomes are the same message: these need a real node. So they are tested
// where a real node exists — see `logic/workflows/authored-shared.yml`,
// `access-control.yml`, and the `user_storage_ops` / `shared_write_read` /
// `frozen_ops` / `authored_insert_get` patterns in `fuzzy-test.yml`.
