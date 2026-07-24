//! Emit the docs service's ABI manifest alongside the built `.wasm`.
//!
//! The crate carries BOTH schema versions in one source tree (v1 under
//! `#[cfg(not(feature = "schema_v2"))]`, v2 + migrate under `#[cfg(feature =
//! "schema_v2")]`). `emit_manifest_from_crate` is cfg-blind, so we cfg-filter
//! the top-level items ourselves before handing the source to it. Otherwise
//! both builds emit the same manifest (last state wins) and the node sees no
//! migration edge, swaps bytecode code-only, and panics on first read.

use std::fs;
use std::path::Path;

use calimero_wasm_abi::emitter::emit_manifest_from_crate;
use quote::ToTokens;

fn main() {
    let src_dir = Path::new("src");
    let module_files = ["lib.rs", "events.rs"];

    for name in &module_files {
        println!("cargo:rerun-if-changed=src/{}", name);
    }
    // cargo sets CARGO_FEATURE_SCHEMA_V2 when the feature is on; the manifest
    // schema changes with it, so re-run when it flips.
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_SCHEMA_V2");

    let feature_on = std::env::var("CARGO_FEATURE_SCHEMA_V2").is_ok();

    let sources: Vec<(String, String)> = module_files
        .iter()
        .map(|name| {
            let path = src_dir.join(name);
            let content = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("Failed to read {}: {}", path.display(), e));
            (name.to_string(), filter_cfg(&content, feature_on, &path))
        })
        .collect();

    let manifest = emit_manifest_from_crate(&sources).expect("Failed to emit ABI manifest");
    let json = serde_json::to_string_pretty(&manifest).expect("Failed to serialize manifest");

    let res_dir = Path::new("res");
    if !res_dir.exists() {
        fs::create_dir_all(res_dir).expect("Failed to create res directory");
    }

    let abi_path = res_dir.join("abi.json");
    fs::write(&abi_path, json).expect("Failed to write ABI JSON");

    println!("cargo:rerun-if-changed={}", abi_path.display());
}

/// Drop items, enum variants, and struct fields (named and tuple) whose
/// `#[cfg(...)]` contradicts the active build, recursing into inline modules,
/// then re-serialize. Only the two exact schema-selecting shapes are matched;
/// body/statement-level cfgs are left alone (function bodies never reach the
/// manifest). Any other cfg shape that mentions schema_v2 fails the build
/// loudly instead of silently mis-filtering.
fn filter_cfg(content: &str, feature_on: bool, path: &Path) -> String {
    let mut file = syn::parse_file(content)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));
    filter_items(&mut file.items, feature_on);
    file.into_token_stream().to_string()
}

fn filter_items(items: &mut Vec<syn::Item>, feature_on: bool) {
    items.retain(|item| !dropped_by_cfg(item_attrs(item), feature_on));
    for item in items {
        match item {
            syn::Item::Enum(e) => {
                e.variants = std::mem::take(&mut e.variants)
                    .into_iter()
                    .filter(|v| !dropped_by_cfg(&v.attrs, feature_on))
                    .collect();
            }
            syn::Item::Struct(s) => match &mut s.fields {
                syn::Fields::Named(fields) => {
                    fields.named = std::mem::take(&mut fields.named)
                        .into_iter()
                        .filter(|f| !dropped_by_cfg(&f.attrs, feature_on))
                        .collect();
                }
                syn::Fields::Unnamed(fields) => {
                    fields.unnamed = std::mem::take(&mut fields.unnamed)
                        .into_iter()
                        .filter(|f| !dropped_by_cfg(&f.attrs, feature_on))
                        .collect();
                }
                syn::Fields::Unit => {}
            },
            syn::Item::Mod(m) => {
                if let Some((_, nested)) = &mut m.content {
                    filter_items(nested, feature_on);
                }
            }
            _ => {}
        }
    }
}

fn dropped_by_cfg(attrs: &[syn::Attribute], feature_on: bool) -> bool {
    attrs.iter().any(|attr| match cfg_schema_v2_flavor(attr) {
        // `#[cfg(feature = "schema_v2")]`: keep only when the feature is on.
        Some(true) => !feature_on,
        // `#[cfg(not(feature = "schema_v2"))]`: keep only when it is off.
        Some(false) => feature_on,
        None => false,
    })
}

/// `Some(true)` for `#[cfg(feature = "schema_v2")]`, `Some(false)` for
/// `#[cfg(not(feature = "schema_v2"))]`, `None` for anything else. The compare
/// is on the parsed Meta re-tokenized with all whitespace stripped, so quote's
/// spacing choices cannot affect the match. A cfg that mentions schema_v2 in
/// any OTHER shape (all/any/cfg_attr combos) would silently escape filtering
/// and reintroduce the lying-manifest bug, so it aborts the build instead.
fn cfg_schema_v2_flavor(attr: &syn::Attribute) -> Option<bool> {
    if !attr.path().is_ident("cfg") {
        return None;
    }
    let meta: syn::Meta = attr.parse_args().ok()?;
    let normalized: String = meta
        .into_token_stream()
        .to_string()
        .split_whitespace()
        .collect();
    match normalized.as_str() {
        "feature=\"schema_v2\"" => Some(true),
        "not(feature=\"schema_v2\")" => Some(false),
        other if other.contains("schema_v2") => panic!(
            "unsupported cfg shape referencing schema_v2: `{}`. Use exactly \
             #[cfg(feature = \"schema_v2\")] or #[cfg(not(feature = \"schema_v2\"))] \
             so the ABI manifest filter can evaluate it.",
            other
        ),
        _ => None,
    }
}

fn item_attrs(item: &syn::Item) -> &[syn::Attribute] {
    match item {
        syn::Item::Const(i) => &i.attrs,
        syn::Item::Enum(i) => &i.attrs,
        syn::Item::ExternCrate(i) => &i.attrs,
        syn::Item::Fn(i) => &i.attrs,
        syn::Item::ForeignMod(i) => &i.attrs,
        syn::Item::Impl(i) => &i.attrs,
        syn::Item::Macro(i) => &i.attrs,
        syn::Item::Mod(i) => &i.attrs,
        syn::Item::Static(i) => &i.attrs,
        syn::Item::Struct(i) => &i.attrs,
        syn::Item::Trait(i) => &i.attrs,
        syn::Item::TraitAlias(i) => &i.attrs,
        syn::Item::Type(i) => &i.attrs,
        syn::Item::Union(i) => &i.attrs,
        syn::Item::Use(i) => &i.attrs,
        _ => &[],
    }
}
