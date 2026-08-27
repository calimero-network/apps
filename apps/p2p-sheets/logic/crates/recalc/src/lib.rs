//! Pure recalculation engine for p2p-sheets: workbook inputs -> computed values.
//!
//! `std`-only and free of any calimero dependency, so it links into the node
//! service crate as an rlib AND compiles to browser WASM (via `recalc-wasm`).
//! One implementation, two homes — both agree by construction.

pub mod formula;
pub mod recalc;
