//! The contract on core's real wasmtime engine (`TestApp`): every method, the
//! author and writer checks v1 made when it applied a signed delta (now method
//! checks), and the access and wire checks the matrix relies on.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner, one member (`bob`) and one guest (`gus`).
fn app() -> TestApp {
    common::app(Org::new().members(["bob"]).guests(["gus"]))
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn view(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .view(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn app_error(code: &str, fields: Value) -> Failure {
    Failure::App {
        code: code.to_owned(),
        fields,
    }
}

fn names(t: &TestApp) -> Vec<String> {
    t.events_for("bob").into_iter().map(|(n, _)| n).collect()
}

// ── public values ───────────────────────────────────────────────────────────

#[test]
fn set_get_remove_len() {
    let mut t = app();
    call(&mut t, "owner", "set", json!({ "key": "k", "value": "v" }));
    call(&mut t, "bob", "set", json!({ "key": "k", "value": "w" }));
    assert_eq!(
        view(&mut t, "gus", "get", json!({ "key": "k" })),
        json!("w")
    );
    assert_eq!(view(&mut t, "owner", "len", json!({})), json!("1"));
    assert_eq!(
        call(&mut t, "owner", "remove", json!({ "key": "k" })),
        json!("w")
    );
    assert_eq!(
        call(&mut t, "owner", "remove", json!({ "key": "k" })),
        json!(null)
    );
    assert_eq!(
        view(&mut t, "owner", "get", json!({ "key": "k" })),
        json!(null)
    );
    assert_eq!(view(&mut t, "owner", "len", json!({})), json!("0"));
    // A no-op remove emits nothing.
    assert_eq!(names(&t), ["Inserted", "Updated", "Removed"]);
    assert_eq!(
        t.events_for("bob")[0],
        ("Inserted".to_owned(), json!({ "key": "k", "value": "v" }))
    );
}

#[test]
fn confirmed_set_needs_the_passkey() {
    let mut t = app();
    let args = json!({ "key": "c", "value": "1" });
    assert_eq!(
        t.as_("owner").call("confirmedSet", args.clone()),
        Err(Failure::ConfirmRequired)
    );
    assert_eq!(
        view(&mut t, "owner", "get", json!({ "key": "c" })),
        json!(null)
    );
    t.as_("owner")
        .confirmed()
        .call("confirmedSet", args)
        .expect("confirmed");
    assert_eq!(
        view(&mut t, "owner", "get", json!({ "key": "c" })),
        json!("1")
    );
    // A confirm method is never a view.
    assert!(matches!(
        t.as_("owner")
            .confirmed()
            .view("confirmedSet", json!({ "key": "c", "value": "2" })),
        Err(Failure::App { .. })
    ));
}

#[test]
fn get_result_and_get_unchecked_on_a_missing_key() {
    let mut t = app();
    assert_eq!(
        t.as_("owner").view("getResult", json!({ "key": "nope" })),
        Err(app_error("NotFound", json!({ "key": "nope" })))
    );
    assert!(matches!(
        t.as_("owner")
            .view("getUnchecked", json!({ "key": "nope" })),
        Err(Failure::Trap(_))
    ));
    call(&mut t, "owner", "set", json!({ "key": "k", "value": "v" }));
    assert_eq!(
        view(&mut t, "owner", "getResult", json!({ "key": "k" })),
        json!("v")
    );
    assert_eq!(
        view(&mut t, "owner", "getUnchecked", json!({ "key": "k" })),
        json!("v")
    );
}

#[test]
fn public_get_is_still_behind_the_org_gate() {
    let mut t = app();
    call(&mut t, "owner", "set", json!({ "key": "k", "value": "v" }));
    assert_eq!(
        view(&mut t, "gus", "publicGet", json!({ "key": "k" })),
        json!("v")
    );
    // The harness app is an org app: anonymous is refused before the ABI is
    // read, `public` methods included. Only a public app lets it through.
    assert_eq!(
        t.anonymous().view("publicGet", json!({ "key": "k" })),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
}

#[test]
fn my_account_names_the_caller() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "owner", "myAccount", json!({})),
        json!("owner")
    );
    assert_eq!(view(&mut t, "gus", "myAccount", json!({})), json!("gus"));
    // An API key acts for its account.
    assert_eq!(
        t.api_key("key-1", "bob").view("myAccount", json!({})),
        Ok(json!("bob"))
    );
}

// ── per-account values ──────────────────────────────────────────────────────

#[test]
fn user_values_are_per_account() {
    let mut t = app();
    call(&mut t, "owner", "setUserSimple", json!({ "value": "mine" }));
    call(&mut t, "bob", "setUserSimple", json!({ "value": "bob's" }));
    assert_eq!(
        view(&mut t, "owner", "getUserSimple", json!({})),
        json!("mine")
    );
    assert_eq!(
        view(&mut t, "bob", "getUserSimple", json!({})),
        json!("bob's")
    );
    assert_eq!(view(&mut t, "gus", "getUserSimple", json!({})), json!(null));
    assert_eq!(
        view(
            &mut t,
            "gus",
            "getUserSimpleFor",
            json!({ "account": "owner" })
        ),
        json!("mine")
    );
    assert_eq!(
        view(
            &mut t,
            "owner",
            "getUserSimpleFor",
            json!({ "account": "nobody" })
        ),
        json!(null)
    );
    assert_eq!(
        t.events_for("bob")[1],
        (
            "UserSimpleSet".to_owned(),
            json!({ "account": "bob", "value": "bob's" })
        )
    );
}

// ── content-addressed values ────────────────────────────────────────────────

#[test]
fn frozen_values_by_hash() {
    let mut t = app();
    let hash = call(&mut t, "owner", "addFrozen", json!({ "value": "ice" }));
    let hash = hash.as_str().expect("a hex hash").to_owned();
    assert_eq!(hash.len(), 64);
    // The same content is the same hash and writes nothing new.
    assert_eq!(
        call(&mut t, "bob", "addFrozen", json!({ "value": "ice" })),
        json!(hash)
    );
    assert_eq!(names(&t), ["FrozenAdded"]);
    assert_eq!(
        view(&mut t, "gus", "getFrozen", json!({ "hashHex": hash })),
        json!("ice")
    );
    let absent = "0".repeat(64);
    assert_eq!(
        t.as_("owner")
            .view("getFrozen", json!({ "hashHex": absent })),
        Err(app_error("FrozenNotFound", json!({ "hashHex": absent })))
    );
    assert_eq!(
        t.as_("owner")
            .view("getFrozen", json!({ "hashHex": "not-hex" })),
        Err(app_error("FrozenNotFound", json!({ "hashHex": "not-hex" })))
    );
}

// ── the authored map ────────────────────────────────────────────────────────

#[test]
fn authored_entries_belong_to_their_author() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "authoredInsert",
        json!({ "key": "a", "value": "by owner" }),
    );
    assert_eq!(
        view(&mut t, "bob", "authoredGetOwner", json!({ "key": "a" })),
        json!("owner")
    );
    assert_eq!(
        view(&mut t, "bob", "authoredGet", json!({ "key": "a" })),
        json!("by owner")
    );
    // Bob cannot change the owner's entry: his update finds none of his own.
    assert_eq!(
        t.as_("bob")
            .call("authoredUpdate", json!({ "key": "a", "value": "hijack" })),
        Err(app_error("NotAuthor", json!({ "key": "a" })))
    );
    assert_eq!(
        call(&mut t, "bob", "authoredRemove", json!({ "key": "a" })),
        json!(null)
    );
    // His insert under the same key is his own entry beside the owner's.
    call(
        &mut t,
        "bob",
        "authoredInsert",
        json!({ "key": "a", "value": "by bob" }),
    );
    assert_eq!(
        view(&mut t, "gus", "authoredGetOwner", json!({ "key": "a" })),
        json!("bob"),
        "the first author by account id"
    );
    call(
        &mut t,
        "owner",
        "authoredUpdate",
        json!({ "key": "a", "value": "edited" }),
    );
    assert_eq!(
        call(&mut t, "bob", "authoredRemove", json!({ "key": "a" })),
        json!("by bob")
    );
    assert_eq!(
        view(&mut t, "gus", "authoredGet", json!({ "key": "a" })),
        json!("edited")
    );
    assert_eq!(
        view(
            &mut t,
            "gus",
            "authoredGetOwner",
            json!({ "key": "missing" })
        ),
        json!(null)
    );
    assert_eq!(
        names(&t),
        [
            "AuthoredInserted",
            "AuthoredInserted",
            "AuthoredUpdated",
            "AuthoredRemoved"
        ]
    );
    assert_eq!(
        t.events_for("bob")[0],
        (
            "AuthoredInserted".to_owned(),
            json!({ "key": "a", "value": "by owner", "owner": "owner" })
        )
    );
}

// ── the authored vector ─────────────────────────────────────────────────────

#[test]
fn authored_vector_items_belong_to_their_pusher() {
    let mut t = app();
    assert_eq!(
        call(
            &mut t,
            "owner",
            "authoredVecPush",
            json!({ "value": "zero" })
        ),
        json!("0")
    );
    assert_eq!(
        call(&mut t, "bob", "authoredVecPush", json!({ "value": "one" })),
        json!("1")
    );
    assert_eq!(view(&mut t, "gus", "authoredVecLen", json!({})), json!("2"));
    assert_eq!(
        view(
            &mut t,
            "gus",
            "authoredVecGetOwner",
            json!({ "index": "0" })
        ),
        json!("owner")
    );
    assert_eq!(
        view(&mut t, "gus", "authoredVecGet", json!({ "index": "1" })),
        json!("one")
    );
    assert_eq!(
        t.as_("bob")
            .call("authoredVecUpdate", json!({ "index": "0", "value": "x" })),
        Err(app_error("NotItemOwner", json!({ "index": "0" })))
    );
    assert_eq!(
        t.as_("bob")
            .call("authoredVecUpdate", json!({ "index": "9", "value": "x" })),
        Err(app_error("NotItemOwner", json!({ "index": "9" })))
    );
    call(
        &mut t,
        "bob",
        "authoredVecUpdate",
        json!({ "index": "1", "value": "uno" }),
    );
    assert_eq!(
        view(&mut t, "owner", "authoredVecGet", json!({ "index": "1" })),
        json!("uno")
    );
    assert_eq!(
        view(&mut t, "owner", "authoredVecGet", json!({ "index": "2" })),
        json!(null)
    );
    assert_eq!(
        t.events_for("bob")[0],
        (
            "AuthoredVecPushed".to_owned(),
            json!({ "index": "0", "value": "zero", "owner": "owner" })
        )
    );
    assert_eq!(
        t.events_for("bob")[2],
        (
            "AuthoredVecUpdated".to_owned(),
            json!({ "index": "1", "value": "uno" })
        )
    );
}

// ── the shared value ────────────────────────────────────────────────────────

#[test]
fn only_writers_set_the_shared_value() {
    let mut t = app();
    assert_eq!(view(&mut t, "bob", "sharedGet", json!({})), json!(null));
    assert_eq!(
        view(&mut t, "bob", "sharedGetWriters", json!({})),
        json!(["owner"]),
        "init makes the app's owner the one writer"
    );
    call(&mut t, "owner", "sharedSet", json!({ "value": "first" }));
    assert_eq!(
        t.as_("bob")
            .call("sharedSet", json!({ "value": "not mine" })),
        Err(app_error("NotAWriter", json!({ "account": "bob" })))
    );
    assert_eq!(
        t.as_("bob")
            .call("sharedAddWriter", json!({ "account": "bob" })),
        Err(app_error("NotAWriter", json!({ "account": "bob" })))
    );
    assert_eq!(view(&mut t, "gus", "sharedGet", json!({})), json!("first"));

    call(
        &mut t,
        "owner",
        "sharedAddWriter",
        json!({ "account": "bob" }),
    );
    // Adding a writer twice changes nothing and announces nothing.
    call(
        &mut t,
        "owner",
        "sharedAddWriter",
        json!({ "account": "bob" }),
    );
    call(&mut t, "bob", "sharedSet", json!({ "value": "second" }));
    assert_eq!(view(&mut t, "gus", "sharedGet", json!({})), json!("second"));
    assert_eq!(
        view(&mut t, "gus", "sharedGetWriters", json!({})),
        json!(["bob", "owner"])
    );
    assert_eq!(names(&t), ["SharedSet", "SharedWriterAdded", "SharedSet"]);
    assert_eq!(
        t.events_for("bob")[2],
        (
            "SharedSet".to_owned(),
            json!({ "value": "second", "by": "bob" })
        )
    );
}

// ── access and the wire ─────────────────────────────────────────────────────

#[test]
fn the_org_decides_who_reaches_the_app() {
    let mut t = app();
    let unauthenticated = Err(Failure::Refused {
        status: 401,
        code: "UNAUTHENTICATED".to_owned(),
    });
    let not_found = Err(Failure::Refused {
        status: 404,
        code: "NOT_FOUND".to_owned(),
    });
    assert_eq!(t.anonymous().view("myAccount", json!({})), unauthenticated);
    assert_eq!(
        t.anonymous()
            .call("set", json!({ "key": "k", "value": "v" })),
        unauthenticated
    );
    assert_eq!(t.as_("mallory").view("myAccount", json!({})), not_found);
    assert_eq!(
        t.as_("mallory")
            .call("set", json!({ "key": "k", "value": "v" })),
        not_found
    );
    // A guest writes: no method here checks a role.
    call(
        &mut t,
        "gus",
        "set",
        json!({ "key": "k", "value": "guest" }),
    );

    // A removed member is an outsider from then on.
    t.remove_member("bob");
    assert_eq!(t.as_("bob").view("get", json!({ "key": "k" })), not_found);
}

#[test]
fn malformed_calls_are_refused() {
    let mut t = app();
    let bad_args = |r: Result<Value, Failure>| matches!(r, Err(Failure::App { code, .. }) if code == "BadArgs");
    assert!(bad_args(t.as_("owner").call("set", json!({ "key": "k" }))));
    assert!(bad_args(t.as_("owner").call(
        "set",
        json!({ "key": "k", "value": "v", "extra": true })
    )));
    // u64 arguments are decimal strings, not numbers.
    assert!(bad_args(
        t.as_("owner").view("authoredVecGet", json!({ "index": 0 }))
    ));
    assert!(matches!(
        t.as_("owner").call("noSuchMethod", json!({})),
        Err(Failure::App { code, .. }) if code == "UnknownMethod"
    ));
    // v1's snake_case names are gone from the wire.
    assert!(matches!(
        t.as_("owner").view("my_account", json!({})),
        Err(Failure::App { code, .. }) if code == "UnknownMethod"
    ));
    assert!(matches!(
        t.as_("owner").view("set", json!({ "key": "k", "value": "v" })),
        Err(Failure::App { code, .. }) if code == "NotAView"
    ));
    assert_eq!(
        view(&mut t, "owner", "get", json!({ "key": "k" })),
        json!(null)
    );
}
