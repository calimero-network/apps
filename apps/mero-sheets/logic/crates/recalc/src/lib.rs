//! Pure recalculation engine for mero-sheets: workbook inputs -> computed values.
//!
//! `std`-only and free of any calimero dependency, so it links into the node
//! service crate as an rlib AND compiles to browser WASM (via `recalc-wasm`).
//! One implementation, two homes — both agree by construction.

// The engine's own unit tests exercise deliberate shapes that trip style
// lints: identical branches in a cycle fixture, and `&closure` passed to a
// generic `Fn` arg (the closures capture nothing, so they are Copy and the
// borrow reads as redundant). These are test-only and not correctness
// issues, so allow them under `-D warnings` rather than reshape the fixtures.
#![cfg_attr(
    test,
    allow(clippy::needless_borrows_for_generic_args, clippy::if_same_then_else)
)]

pub mod formula;
pub mod recalc;
