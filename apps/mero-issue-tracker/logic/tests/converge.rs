//! Convergence coverage for the issue-tracker service.
//!
//! `IssueTracker` hand-writes `Mergeable`/`RekeyTarget` on its `Issue` map value
//! (it nests several `LwwRegister`s), so this is the #2577 case: without
//! deterministic re-keying the nested registers would be last-writer-wins'd as
//! an opaque blob. We register the generated re-key thunks
//! (`__calimero_register_rekey()`) so each nested register gets a deterministic
//! id and converges as a child entity, then assert every replica lands on the
//! same Merkle root.
//!
//! Surface under test: the `issues: UnorderedMap<String, Issue>` field. It (and
//! the `comments`/`labels` maps) are all plain `UnorderedMap`s — there is no
//! `AuthoredMap`/`SharedStorage` in state, so the bare `converge_app` harness
//! (which has no signing identity) can reconcile every field. We still seed the
//! issue at genesis (single identity) and drive only `set_status`, which touches
//! the `issues` map, to keep the test focused on the nested-register merge.
//!
//! `#[serial]`: `converge_app` clears/repopulates the process-global merge
//! registry per run. Own integration binary so it is isolated from the
//! in-`lib.rs` `TestHost` unit tests.

use calimero_storage::testing::converge_app;
use mero_issue_tracker::IssueTracker;
use serial_test::serial;

#[test]
#[serial]
fn issue_status_updates_converge() {
    // Register the nested-CRDT-value re-key thunks for `Issue` (its LwwRegister
    // fields). Without this the value blob is LWW'd and replicas can diverge.
    IssueTracker::__calimero_register_rekey();

    converge_app(|| {
        // Genesis seed: one issue, created under the single genesis identity and
        // snapshotted byte-identical into every replica.
        let mut s = IssueTracker::init();
        let _ = s.create_issue(
            "seed".into(),
            "seed summary".into(),
            "seed impact".into(),
            "seed repro".into(),
            "seed resolution".into(),
            "low".into(),
            None,
        );
        s
    })
    .replicas(3)
    // Each replica concurrently moves the single seeded issue to "Done".
    // `set_status` touches only the `issues` UnorderedMap's nested register.
    .ops(|s| {
        if let Some(issue) = s
            .list_issues(None, None, None)
            .ok()
            .and_then(|v| v.into_iter().next())
        {
            let _ = s.set_status(issue.id, "Done".into());
        }
    })
    .invariant(
        "the single seeded issue survives and holds the merged status",
        |s| {
            let issues = s.list_issues(None, None, None).unwrap_or_default();
            issues.len() == 1 && issues[0].status == "Done"
        },
    )
    .assert_all_replicas_equal();
}
