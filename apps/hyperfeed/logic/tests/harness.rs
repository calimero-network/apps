//! Hyperfeed on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method (one module per area under `tests/harness/`), what
//! v1's merge tests become under one log, and the access and wire checks v1
//! could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

#[path = "harness/support.rs"]
mod support;

#[path = "harness/wire.rs"]
mod wire;

/// v1's `tests.rs`: rules, actions, notifications, the feed and its chains.
#[path = "harness/part_a.rs"]
mod part_a;

/// v1's `tests.rs`: asks, messages, typed rows, lenses, archive, grants, rules, leases.
#[path = "harness/part_b.rs"]
mod part_b;

/// v1's `tests.rs`: subjects, links, push, agent accounts, actions, situations, defaults.
#[path = "harness/part_c.rs"]
mod part_c;

/// v1's inline module tests: checkpoints, memos, PRs, watches.
#[path = "harness/modules.rs"]
mod modules;
