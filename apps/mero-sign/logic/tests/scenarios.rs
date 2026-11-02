//! Every `scenarios/*.json` on the real engine, each in the org its `.org.json` names.
//!
//! One addition to kv-store's runner: a scenario's `.org.json` may list blobs
//! (`"blobs": { "<label>": "<utf-8 content>" }`) the app holds before the first
//! step, as the client would have uploaded them. A blob's id is the SHA-256 of
//! its bytes, so the scenario names each one by that hex digest.
//! `pnpm merod-local e2e` uploads the same blobs on the cluster.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::run_scenario;

#[test]
fn every_scenario_passes() {
    let files = common::scenarios();
    assert!(!files.is_empty(), "no scenarios");
    for path in files {
        let mut t = common::app(common::org_of(&path));
        for bytes in common::blobs_of(&path) {
            let _ = t.upload_blob(&bytes, "application/octet-stream");
        }
        if let Err(e) = run_scenario(&mut t, &path) {
            panic!("{}: {e:#}", path.display());
        }
    }
}
