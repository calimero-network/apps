//! Cross-replica convergence for the collaborative Yjs op-log — the #1
//! correctness requirement of the BlockNote-collab work.
//!
//! Two replicas of the docs service independently create the SAME logical doc
//! (`doc-1`) and each appends a DISTINCT opaque "Yjs update" blob to that doc's
//! `content_updates` set. They exchange deltas via `Root::sync` and we assert:
//!
//!   1. each replica ends up holding BOTH blobs (add-wins set union — concurrent
//!      edits MERGE, they do not last-writer-wins-clobber each other), and
//!   2. the replicas converge to the same root hash (deterministic state).
//!
//! This only holds if `DocRecord` is a registered `RekeyTarget`, so the nested
//! `content_updates` `UnorderedSet` gets a DETERMINISTIC storage id derived from
//! its doc's map-entry id on every node. The negative control documents the
//! pre-fix failure: a record whose nested set is NOT deterministically re-keyed
//! keeps a per-replica-random set id and the two logs never merge (one whole
//! record blob wins LWW, the other replica's blob is lost). If a future change
//! ever makes the unregistered path converge, that test fires so we re-examine
//! whether the rekey machinery is still doing the work.
//!
//! Mirrors core's own `crates/storage/tests/rekey_record.rs` harness. Gated on
//! `calimero-storage/testing` (native merge registry + `Root`/`env` plumbing)
//! and run `#[serial]` because the rekey/merge registries are process-global
//! with no reset.

#![cfg(test)]
#![allow(clippy::unwrap_used)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::{field_child_id, RekeyTarget};
use calimero_storage::collections::{Mergeable, Root, UnorderedMap, UnorderedSet};
use calimero_storage::env::{self, RuntimeEnv};
use calimero_storage::interface::ApplyContext;
use calimero_storage::store::Key;
use calimero_storage::{
    register_crdt_merge_for_test, register_rekey_if_supported, rekey_field_if_supported,
};
use serial_test::serial;

// ---------------------------------------------------------------------------
// A focused stand-in for the production `DocRecord` + `DocsState`.
//
// We deliberately do NOT depend on the production types here: this test must
// prove that the SHAPE (a custom Mergeable struct holding an `UnorderedSet`,
// stored as a map value) converges when registered as a `RekeyTarget` and is
// LWW-clobbered when not. Using a stand-in lets us instantiate BOTH the fixed
// and the unfixed variant — the production `DocRecord` only exists in the fixed
// form, and the process-global rekey registry has no reset, so the two must be
// DISTINCT types. The production type's own convergence is covered transitively
// (it uses the exact same `rekey_field_if_supported!` + `register_*` calls,
// verified by the in-crate unit tests + the WASM build).
// ---------------------------------------------------------------------------

/// FIXED: a `RekeyTarget` whose nested update-set is re-keyed deterministically
/// — the production `DocRecord` shape. Concurrent appends converge.
#[derive(BorshSerialize, BorshDeserialize, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
struct FixedDoc {
    updates: UnorderedSet<Vec<u8>>,
}

impl Mergeable for FixedDoc {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        <UnorderedSet<Vec<u8>> as Mergeable>::merge(&mut self.updates, &other.updates)
    }
}

impl RekeyTarget for FixedDoc {
    fn rekey_relative_to(&mut self, parent_id: Id) {
        rekey_field_if_supported!(&mut self.updates, field_child_id(parent_id, "updates"));
    }
    fn register_nested_value_types() {
        register_rekey_if_supported!(UnorderedSet<Vec<u8>>);
    }
}

/// UNFIXED: identical shape, but never registered / re-keyed — the pre-fix
/// world. Its nested set keeps a per-replica-random id and never merges.
#[derive(BorshSerialize, BorshDeserialize, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
struct UnfixedDoc {
    updates: UnorderedSet<Vec<u8>>,
}

impl Mergeable for UnfixedDoc {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        <UnorderedSet<Vec<u8>> as Mergeable>::merge(&mut self.updates, &other.updates)
    }
}

/// Root app generic over the doc value type, so one driver exercises both.
trait DocsApp: BorshSerialize + BorshDeserialize + Default + Mergeable + 'static {
    fn append_update(&mut self, doc: &str, blob: Vec<u8>) -> Result<(), MergeError>;
    fn updates(&self, doc: &str) -> Vec<Vec<u8>>;
}

macro_rules! docs_app {
    ($app:ident, $val:ty) => {
        #[derive(BorshSerialize, BorshDeserialize, Default)]
        #[borsh(crate = "calimero_sdk::borsh")]
        struct $app {
            docs: UnorderedMap<String, $val>,
        }
        impl Mergeable for $app {
            fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
                self.docs.merge(&other.docs)
            }
        }
        impl DocsApp for $app {
            fn append_update(&mut self, doc: &str, blob: Vec<u8>) -> Result<(), MergeError> {
                // `entry().or_default()` write-back guard: the nested set insert
                // persists when the guard drops — the same in-place mutation the
                // production `append_doc_update_inner` does via `get_mut`.
                let mut rec = self.docs.entry(doc.to_owned())?.or_default()?;
                let _ = rec.updates.insert(blob)?;
                Ok(())
            }
            fn updates(&self, doc: &str) -> Vec<Vec<u8>> {
                match self.docs.get(doc).unwrap() {
                    Some(r) => {
                        let mut v: Vec<Vec<u8>> = r.updates.iter().unwrap().collect();
                        v.sort();
                        v
                    }
                    None => Vec::new(),
                }
            }
        }
    };
}

docs_app!(FixedApp, FixedDoc);
docs_app!(UnfixedApp, UnfixedDoc);

type Store = Rc<RefCell<HashMap<[u8; 32], Vec<u8>>>>;

fn env_for(s: &Store, ex: [u8; 32]) -> RuntimeEnv {
    let r = s.clone();
    let reader = Rc::new(move |k: &Key| r.borrow().get(&k.to_bytes()).cloned());
    let w = s.clone();
    let writer =
        Rc::new(move |k: Key, v: &[u8]| w.borrow_mut().insert(k.to_bytes(), v.to_vec()).is_some());
    let rm = s.clone();
    let remover = Rc::new(move |k: &Key| rm.borrow_mut().remove(&k.to_bytes()).is_some());
    RuntimeEnv::new(reader, writer, remover, [7u8; 32], ex)
}

/// Two replicas independently create the SAME doc and each append ONE distinct
/// blob under its own executor id, exchange deltas, and we read back each
/// replica's update set (sorted) + root hash. Returns `(updates_a, updates_b,
/// converged)`.
fn drive<T: DocsApp>(blob_a: Vec<u8>, blob_b: Vec<u8>) -> (Vec<Vec<u8>>, Vec<Vec<u8>>, bool) {
    let a: Store = Default::default();
    let b: Store = Default::default();
    // Both replicas start from the same committed empty state.
    env::with_runtime_env(env_for(&a, [1; 32]), || {
        Root::new(T::default).commit();
    });
    *b.borrow_mut() = a.borrow().clone();

    let da = env::with_runtime_env(env_for(&a, [1; 32]), || {
        let mut app = Root::<T>::fetch().unwrap();
        app.append_update("doc-1", blob_a.clone()).unwrap();
        app.commit();
        env::take_last_artifact().unwrap()
    });
    let db = env::with_runtime_env(env_for(&b, [2; 32]), || {
        let mut app = Root::<T>::fetch().unwrap();
        app.append_update("doc-1", blob_b.clone()).unwrap();
        app.commit();
        env::take_last_artifact().unwrap()
    });

    let (ha, ua) = env::with_runtime_env(env_for(&a, [1; 32]), || {
        Root::<T>::sync(&db, &ApplyContext::empty()).unwrap();
        (
            env::root_hash(),
            Root::<T>::fetch().unwrap().updates("doc-1"),
        )
    });
    let (hb, ub) = env::with_runtime_env(env_for(&b, [2; 32]), || {
        Root::<T>::sync(&da, &ApplyContext::empty()).unwrap();
        (
            env::root_hash(),
            Root::<T>::fetch().unwrap().updates("doc-1"),
        )
    });
    (ua, ub, ha == hb)
}

#[test]
#[serial]
fn registered_rekey_makes_doc_update_logs_converge() {
    env::reset_environment();
    register_crdt_merge_for_test::<FixedApp>();
    // What the root `#[app::state]` scan emits for `docs: UnorderedMap<String,
    // FixedDoc>`: register the value type (`FixedDoc`) and the key type. The
    // cascade through `FixedDoc::register_nested_value_types` reaches the
    // nested `UnorderedSet<Vec<u8>>`.
    register_rekey_if_supported!(FixedDoc);
    register_rekey_if_supported!(String);

    let (ua, ub, converged) = drive::<FixedApp>(vec![0xAA], vec![0xBB]);
    println!("FIXED   a={ua:?} b={ub:?} converged={converged}");
    let expected = vec![vec![0xAA], vec![0xBB]];
    assert_eq!(
        ua, expected,
        "replica A must hold BOTH update blobs (union)"
    );
    assert_eq!(
        ub, expected,
        "replica B must hold BOTH update blobs (union)"
    );
    assert!(converged, "replicas must converge to the same root hash");
}

#[test]
#[serial]
fn unregistered_doc_loses_concurrent_update_pre_fix() {
    // NEGATIVE CONTROL — this is NOT a failing/bug test. It pins the WRONG
    // (pre-fix) behaviour of an UNregistered record so that the positive test
    // above (`registered_rekey_makes_doc_update_logs_converge`) is a meaningful
    // contrast and so a future regression that silently changes the
    // unregistered path is caught. `UnfixedDoc` is deliberately NOT a registered
    // `RekeyTarget`, so its nested update-set keeps a per-replica-random id and
    // the whole record blob is last-writer-wins'd: exactly ONE replica's blob
    // survives, the other is lost. The assertions below assert that this
    // KNOWN-WRONG outcome still holds; they do NOT mean the production bug is
    // unfixed (production uses the registered `DocRecord`, covered above).
    env::reset_environment();
    register_crdt_merge_for_test::<UnfixedApp>();
    register_rekey_if_supported!(String);
    // Deliberately NO `register_rekey_if_supported!(UnfixedDoc)`.

    let (ua, ub, converged) = drive::<UnfixedApp>(vec![0xAA], vec![0xBB]);
    println!("UNFIXED a={ua:?} b={ub:?} converged={converged}");
    assert!(
        converged,
        "negative control: the unregistered (pre-fix) path is expected to \
         converge to a single LWW value; if it diverges instead, this control \
         no longer models the pre-fix behaviour — re-examine it"
    );
    assert_eq!(
        ua, ub,
        "negative control: both replicas should agree on the same LWW-clobbered \
         value (the WRONG one — one side's blob was dropped)"
    );
    assert_eq!(
        ua.len(),
        1,
        "negative control: without rekey the record is LWW'd to exactly ONE \
         blob (the pre-fix data-loss this test documents). If it ever holds \
         BOTH, the unregistered path started converging correctly — re-examine \
         whether the rekey registration is still what makes production converge."
    );
}
