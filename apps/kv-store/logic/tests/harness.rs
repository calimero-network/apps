//! The store on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's convergence tests as what they become under one log,
//! and the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner and one member, `bob`, who hears every event.
fn app() -> TestApp {
    common::app(Org::new().members(["bob"]))
}

fn call(t: &mut TestApp, method: &str, args: Value) -> Value {
    t.as_("owner")
        .call(method, args)
        .unwrap_or_else(|e| panic!("{method}: {e:?}"))
}

fn view(t: &mut TestApp, method: &str, args: Value) -> Value {
    t.as_("owner")
        .view(method, args)
        .unwrap_or_else(|e| panic!("{method}: {e:?}"))
}

fn names(t: &TestApp) -> Vec<String> {
    t.events_for("bob").into_iter().map(|(n, _)| n).collect()
}

// ── v1's TestHost tests ──────────────────────────────────────────────────────

#[test]
fn set_get_len_remove() {
    let mut t = app();
    call(&mut t, "set", json!({ "key": "k", "value": "v" }));
    assert_eq!(view(&mut t, "get", json!({ "key": "k" })), json!("v"));
    // `len` is a u64: a decimal string on the wire (v1 answered the number 1).
    assert_eq!(view(&mut t, "len", json!({})), json!("1"));

    assert_eq!(call(&mut t, "remove", json!({ "key": "k" })), json!("v"));
    assert_eq!(view(&mut t, "get", json!({ "key": "k" })), json!(null));
    assert_eq!(view(&mut t, "len", json!({})), json!("0"));
}

#[test]
fn entries_and_clear() {
    let mut t = app();
    call(&mut t, "set", json!({ "key": "b", "value": "2" }));
    call(&mut t, "set", json!({ "key": "a", "value": "1" }));
    assert_eq!(
        view(&mut t, "entries", json!({})),
        json!({ "a": "1", "b": "2" })
    );
    call(&mut t, "clear", json!({}));
    assert_eq!(view(&mut t, "len", json!({})), json!("0"));
    assert_eq!(view(&mut t, "entries", json!({})), json!({}));
}

#[test]
fn update_if_exists_and_get_or_insert() {
    let mut t = app();
    // Before any write, so the map is genuinely empty: run after a `set` it
    // would pass whether or not `updateIfExists` inserts.
    assert_eq!(
        call(
            &mut t,
            "updateIfExists",
            json!({ "key": "k", "value": "v" })
        ),
        json!(false)
    );
    assert_eq!(view(&mut t, "get", json!({ "key": "k" })), json!(null));
    assert_eq!(view(&mut t, "len", json!({})), json!("0"));
    assert!(names(&t).is_empty(), "a refused update emits nothing");

    // Inserts on the first call, then returns the EXISTING value, not the argument.
    let first = json!({ "key": "k", "value": "first" });
    let second = json!({ "key": "k", "value": "second" });
    assert_eq!(call(&mut t, "getOrInsert", first), json!("first"));
    assert_eq!(call(&mut t, "getOrInsert", second), json!("first"));

    assert_eq!(
        call(
            &mut t,
            "updateIfExists",
            json!({ "key": "k", "value": "v" })
        ),
        json!(true)
    );
    assert_eq!(view(&mut t, "get", json!({ "key": "k" })), json!("v"));
    assert_eq!(view(&mut t, "len", json!({})), json!("1"));
    assert_eq!(names(&t), ["Inserted", "Updated"]);
}

#[test]
fn set_emits_inserted_then_updated() {
    let mut t = app();
    call(&mut t, "set", json!({ "key": "k", "value": "v" }));
    call(&mut t, "set", json!({ "key": "k", "value": "w" }));
    assert_eq!(
        t.events_for("bob"),
        [
            ("Inserted".to_owned(), json!({ "key": "k", "value": "v" })),
            ("Updated".to_owned(), json!({ "key": "k", "value": "w" })),
        ]
    );
}

#[test]
fn remove_absent_and_clear_empty_emit_nothing() {
    let mut t = app();
    assert_eq!(
        call(&mut t, "remove", json!({ "key": "missing" })),
        json!(null)
    );
    call(&mut t, "clear", json!({}));
    assert!(names(&t).is_empty());

    // A real removal and a real clear emit exactly one event each.
    call(&mut t, "set", json!({ "key": "k", "value": "v" }));
    assert_eq!(call(&mut t, "remove", json!({ "key": "k" })), json!("v"));
    call(&mut t, "set", json!({ "key": "k", "value": "v" }));
    call(&mut t, "clear", json!({}));
    assert_eq!(names(&t), ["Inserted", "Removed", "Inserted", "Cleared"]);
    assert_eq!(
        t.events_for("bob")[1],
        ("Removed".to_owned(), json!({ "key": "k" }))
    );
}

#[test]
fn get_result_and_get_unchecked_on_a_missing_key() {
    let mut t = app();
    assert_eq!(
        t.as_("owner").view("getResult", json!({ "key": "nope" })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "key": "nope" })
        })
    );
    // A panic is a trap: the run aborts and commits nothing.
    assert!(matches!(
        t.as_("owner")
            .view("getUnchecked", json!({ "key": "nope" })),
        Err(Failure::Trap(_))
    ));
    assert!(matches!(
        t.as_("owner")
            .call("getUnchecked", json!({ "key": "nope" })),
        Err(Failure::Trap(_))
    ));

    call(&mut t, "set", json!({ "key": "k", "value": "v" }));
    assert_eq!(view(&mut t, "getResult", json!({ "key": "k" })), json!("v"));
    assert_eq!(
        view(&mut t, "getUnchecked", json!({ "key": "k" })),
        json!("v")
    );
}

// ── v1's tests/converge.rs, under one log ────────────────────────────────────

/// Every member's write to a distinct key survives: the map is a union of them.
#[test]
fn distinct_keys_from_several_members_all_survive() {
    let mut t = common::app(Org::new().members(["bob", "cy"]));
    for (who, key) in [("owner", "a"), ("bob", "b"), ("cy", "c")] {
        t.as_(who)
            .call("set", json!({ "key": key, "value": who }))
            .expect("set");
    }
    assert_eq!(view(&mut t, "len", json!({})), json!("3"));
    assert_eq!(
        view(&mut t, "entries", json!({})),
        json!({ "a": "owner", "b": "bob", "c": "cy" })
    );
}

/// Two members writing one key leave ONE entry holding the later write: the
/// leader's log orders them, where v1's `LwwRegister` picked by timestamp.
#[test]
fn one_key_written_by_two_members_holds_the_later_write() {
    let mut t = app();
    call(
        &mut t,
        "set",
        json!({ "key": "contended", "value": "owner" }),
    );
    t.as_("bob")
        .call("set", json!({ "key": "contended", "value": "bob" }))
        .expect("set");
    assert_eq!(
        view(&mut t, "get", json!({ "key": "contended" })),
        json!("bob")
    );
    assert_eq!(view(&mut t, "len", json!({})), json!("1"));
    assert_eq!(names(&t), ["Inserted", "Updated"]);
}

// ── what v1 could not check ──────────────────────────────────────────────────

/// The org decides who reaches the app: members, admins, the owner, and a guest
/// (as any member of a v1 context could write). Nobody else.
#[test]
fn who_reaches_the_store() {
    let mut t = common::app(Org::new().members(["bob"]).guests(["gus"]));
    t.as_("gus")
        .call("set", json!({ "key": "g", "value": "guest" }))
        .expect("a guest writes");
    assert_eq!(view(&mut t, "get", json!({ "key": "g" })), json!("guest"));

    assert_eq!(
        t.anonymous().view("get", json!({ "key": "g" })),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory")
            .call("set", json!({ "key": "g", "value": "x" })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(view(&mut t, "get", json!({ "key": "g" })), json!("guest"));
}

/// Arguments are a JSON object of exactly the method's parameters.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = app();
    for args in [
        json!({ "key": "k" }),
        json!({ "key": "k", "value": "v", "extra": 1 }),
        json!({ "key": 7, "value": "v" }),
    ] {
        assert!(
            matches!(
                t.as_("owner").call("set", args.clone()),
                Err(Failure::App { ref code, .. }) if code == "BadArgs"
            ),
            "{args}"
        );
    }
    assert_eq!(view(&mut t, "len", json!({})), json!("0"));
    assert!(names(&t).is_empty());
}

/// v1's snake_case names are not methods any more: the ABI's are camelCase.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = app();
    assert!(matches!(
        t.as_("owner")
            .call("update_if_exists", json!({ "key": "k", "value": "v" })),
        Err(Failure::App { ref code, .. }) if code == "UnknownMethod"
    ));
    // A write is not a view.
    assert!(matches!(
        t.as_("owner")
            .view("set", json!({ "key": "k", "value": "v" })),
        Err(Failure::App { ref code, .. }) if code == "NotAView"
    ));
}

/// `entries` answers one page of the map: the first 1,000 keys in key order.
#[test]
fn entries_is_one_page_of_a_thousand() {
    let mut t = app();
    for i in 0..1001 {
        call(
            &mut t,
            "set",
            json!({ "key": format!("k{i:04}"), "value": "v" }),
        );
    }
    assert_eq!(view(&mut t, "len", json!({})), json!("1001"));
    let entries = view(&mut t, "entries", json!({}));
    let keys: Vec<&String> = entries.as_object().expect("an object").keys().collect();
    assert_eq!(keys.len(), 1000);
    assert_eq!(keys.first().map(|k| k.as_str()), Some("k0000"));
    assert_eq!(keys.last().map(|k| k.as_str()), Some("k0999"));
}
