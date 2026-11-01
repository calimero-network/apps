//! The vault on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's storage-level write rules (capability masks, owner
//! stamps) as the method checks they became, and the access and wire checks v1
//! could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner (the vault's creator, its first Admin), members `bob`, `carol` and
/// `dave`, and a guest, `gus`.
fn vault() -> TestApp {
    common::app(Org::new().members(["bob", "carol", "dave"]).guests(["gus"]))
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

/// The code of a refused call.
fn refused(t: &mut TestApp, who: &str, method: &str, args: Value) -> String {
    match t.as_(who).call(method, args) {
        Err(Failure::App { code, .. }) => code,
        other => panic!("{who} {method}: expected an app error, got {other:?}"),
    }
}

fn fp(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

fn sid(n: u8) -> String {
    format!("secret_{}", format!("{n:02x}").repeat(16))
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

fn add_login(t: &mut TestApp, who: &str, n: u8) -> String {
    call(
        t,
        who,
        "addSecret",
        json!({
            "id": sid(n),
            "kind": "login",
            "name": "enc:name",
            "tags": "enc:tags",
            "fields": { "username": "enc:user", "password": "enc:pw1" },
        }),
    )
    .as_str()
    .expect("an id")
    .to_owned()
}

fn set_role(t: &mut TestApp, account: &str, role: &str) {
    call(
        t,
        "owner",
        "setRole",
        json!({ "account": account, "role": role }),
    );
}

fn register(t: &mut TestApp, who: &str, n: u8, kind: &str) {
    call(
        t,
        who,
        "registerDevice",
        json!({ "fingerprint": fp(n), "publicKey": format!("pk{n}"), "label": "Laptop", "kind": kind }),
    );
}

fn wrap(key_id: &str, recipient: &str, wrapper: &str) -> Value {
    json!({ "keyId": key_id, "recipient": recipient, "wrapper": wrapper, "envelope": "env" })
}

fn role_of(t: &mut TestApp, who: &str) -> Value {
    view(t, who, "vaultInfo", json!({}))["myRole"].clone()
}

fn member(t: &mut TestApp, account: &str) -> Value {
    view(t, "owner", "listMembers", json!({}))
        .as_array()
        .expect("a list")
        .iter()
        .find(|m| m["account"] == account)
        .cloned()
        .unwrap_or(Value::Null)
}

// ── the vault ────────────────────────────────────────────────────────────────

#[test]
fn the_creator_is_the_first_admin_and_names_the_vault() {
    let mut t = vault();
    assert_eq!(
        view(&mut t, "owner", "vaultInfo", json!({})),
        json!({
            "name": "",
            "currentKey": "",
            "defaultRole": "editor",
            "myAccount": "owner",
            "myRole": "admin",
        })
    );
    call(&mut t, "owner", "renameVault", json!({ "name": "Ops" }));
    assert_eq!(view(&mut t, "bob", "vaultName", json!({})), json!("Ops"));
    assert_eq!(view(&mut t, "bob", "vaultInfo", json!({}))["name"], "Ops");
    assert_eq!(names(&t, "bob"), ["VaultRenamed"]);
}

#[test]
fn only_an_editor_renames_the_vault() {
    let mut t = vault();
    assert_eq!(
        refused(&mut t, "bob", "renameVault", json!({ "name": "x" })),
        "Forbidden"
    );
    set_role(&mut t, "bob", "viewer");
    assert_eq!(
        refused(&mut t, "bob", "renameVault", json!({ "name": "x" })),
        "Forbidden"
    );
    set_role(&mut t, "bob", "editor");
    call(&mut t, "bob", "renameVault", json!({ "name": "Renamed" }));
    assert_eq!(view(&mut t, "owner", "vaultName", json!({})), "Renamed");
}

// ── secrets are stored as the client sent them ───────────────────────────────

#[test]
fn a_secret_round_trips_as_ciphertext_with_a_cleartext_kind() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    assert_eq!(id, sid(1));
    let got = view(&mut t, "bob", "getSecret", json!({ "id": id }));
    assert_eq!(
        got,
        json!({
            "id": sid(1),
            "kind": "login",
            "name": "enc:name",
            "tags": "enc:tags",
            "fields": { "password": "enc:pw1", "username": "enc:user" },
            "createdAt": common::T0.to_string(),
            "createdBy": "owner",
            "updatedAt": common::T0.to_string(),
            "updatedBy": "owner",
            "trashed": false,
            "trashedAt": "0",
        })
    );
    assert_eq!(view(&mut t, "bob", "listSecrets", json!({})), json!([got]));
    assert_eq!(
        view(&mut t, "bob", "getSecret", json!({ "id": sid(9) })),
        json!(null)
    );
    assert_eq!(names(&t, "bob"), ["SecretChanged"]);
    assert_eq!(t.events_for("bob")[0].1, json!({ "secretId": sid(1) }));
}

#[test]
fn every_kind_is_accepted_and_an_unknown_kind_is_refused() {
    let mut t = vault();
    for (n, kind) in [
        "login",
        "secure_note",
        "totp",
        "ssh_key",
        "payment_card",
        "identity",
        "api_key",
        "oauth2",
    ]
    .into_iter()
    .enumerate()
    {
        call(
            &mut t,
            "owner",
            "addSecret",
            json!({ "id": sid(n as u8), "kind": kind, "name": "n", "tags": "t", "fields": {} }),
        );
    }
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "addSecret",
            json!({ "id": sid(50), "kind": "bitcoin", "name": "n", "tags": "t", "fields": {} }),
        ),
        "Invalid"
    );
    assert_eq!(
        view(&mut t, "owner", "listSecrets", json!({}))
            .as_array()
            .map(Vec::len),
        Some(8)
    );
}

#[test]
fn a_client_id_must_be_well_formed_and_unused() {
    let mut t = vault();
    for bad in ["secret_xyz", "nope_00000000000000000000000000000000", ""] {
        assert_eq!(
            refused(
                &mut t,
                "owner",
                "addSecret",
                json!({ "id": bad, "kind": "login", "name": "n", "tags": "t", "fields": {} }),
            ),
            "Invalid",
            "{bad}"
        );
    }
    add_login(&mut t, "owner", 1);
    match t.as_("owner").call(
        "addSecret",
        json!({ "id": sid(1), "kind": "login", "name": "n2", "tags": "t", "fields": {} }),
    ) {
        Err(Failure::App { code, fields }) => {
            assert_eq!(code, "Conflict");
            assert_eq!(
                fields,
                json!({ "message": "a secret with this id already exists" })
            );
        }
        other => panic!("{other:?}"),
    }
    // The first stays as it was: an add is never an upsert.
    assert_eq!(
        view(&mut t, "owner", "getSecret", json!({ "id": sid(1) }))["name"],
        "enc:name"
    );
}

#[test]
fn limits_on_fields_and_envelopes() {
    let mut t = vault();
    let many: serde_json::Map<String, Value> =
        (0..65).map(|i| (format!("f{i}"), json!("v"))).collect();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "addSecret",
            json!({ "id": sid(1), "kind": "login", "name": "n", "tags": "t", "fields": many }),
        ),
        "Invalid"
    );
    let big = "x".repeat(128 * 1024 + 1);
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "addSecret",
            json!({ "id": sid(1), "kind": "login", "name": big, "tags": "t", "fields": {} }),
        ),
        "Invalid"
    );
    // 64 fields fit; one more by update is refused and changes nothing.
    let sixty_four: serde_json::Map<String, Value> =
        (0..64).map(|i| (format!("f{i}"), json!("v"))).collect();
    call(
        &mut t,
        "owner",
        "addSecret",
        json!({ "id": sid(2), "kind": "login", "name": "n", "tags": "t", "fields": sixty_four }),
    );
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "updateSecret",
            json!({ "id": sid(2), "name": null, "tags": null, "fields": { "f64": "v" }, "rekey": false }),
        ),
        "Invalid"
    );
    let fields = view(&mut t, "owner", "getSecret", json!({ "id": sid(2) }))["fields"].clone();
    assert_eq!(fields.as_object().map(|f| f.len()), Some(64));
}

// ── field-level edits ────────────────────────────────────────────────────────

#[test]
fn editing_one_field_leaves_the_others_alone_and_keeps_history() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    set_role(&mut t, "bob", "editor");
    t.advance(1_000);
    call(
        &mut t,
        "bob",
        "updateSecret",
        json!({ "id": id, "name": null, "tags": null, "fields": { "password": "enc:pw2" }, "rekey": false }),
    );
    t.advance(1_000);
    call(
        &mut t,
        "owner",
        "updateSecret",
        json!({ "id": id, "name": "enc:name2", "tags": null, "fields": { "url": "enc:url" }, "rekey": false }),
    );
    let got = view(&mut t, "owner", "getSecret", json!({ "id": id }));
    assert_eq!(
        got["fields"],
        json!({ "password": "enc:pw2", "url": "enc:url", "username": "enc:user" })
    );
    assert_eq!(got["name"], "enc:name2");
    assert_eq!(got["tags"], "enc:tags");
    assert_eq!(got["createdBy"], "owner");
    assert_eq!(got["updatedBy"], "owner");
    assert_eq!(got["updatedAt"], (common::T0 + 2_000).to_string());

    // Newest first; a field that had no value (url) leaves no revision.
    assert_eq!(
        view(&mut t, "owner", "secretHistory", json!({ "id": id })),
        json!([
            { "field": "name", "previous": "enc:name", "replacedAt": (common::T0 + 2_000).to_string(), "replacedBy": "owner" },
            { "field": "password", "previous": "enc:pw1", "replacedAt": (common::T0 + 1_000).to_string(), "replacedBy": "bob" },
        ])
    );
    assert_eq!(
        view(&mut t, "owner", "secretHistory", json!({ "id": sid(9) })),
        json!([])
    );
}

#[test]
fn an_unchanged_value_does_not_write_history() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    call(
        &mut t,
        "owner",
        "updateSecret",
        json!({ "id": id, "name": null, "tags": null, "fields": { "password": "enc:pw1" }, "rekey": false }),
    );
    assert_eq!(
        view(&mut t, "owner", "secretHistory", json!({ "id": id })),
        json!([])
    );
}

#[test]
fn a_rekey_rewrites_ciphertext_without_polluting_history() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    call(
        &mut t,
        "owner",
        "updateSecret",
        json!({ "id": id, "name": "k2:name", "tags": "k2:tags", "fields": { "password": "k2:pw", "username": "k2:user" }, "rekey": true }),
    );
    let got = view(&mut t, "owner", "getSecret", json!({ "id": id }));
    assert_eq!(
        got["fields"],
        json!({ "password": "k2:pw", "username": "k2:user" })
    );
    assert_eq!(
        view(&mut t, "owner", "secretHistory", json!({ "id": id })),
        json!([])
    );
    let actions: Vec<Value> = view(&mut t, "owner", "getAuditLogs", json!({}))
        .as_array()
        .expect("a list")
        .iter()
        .map(|l| l["action"].clone())
        .collect();
    assert_eq!(actions[0], "secret_rekeyed");
}

#[test]
fn an_empty_value_clears_a_field() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    call(
        &mut t,
        "owner",
        "updateSecret",
        json!({ "id": id, "name": null, "tags": null, "fields": { "username": "" }, "rekey": false }),
    );
    assert_eq!(
        view(&mut t, "owner", "getSecret", json!({ "id": id }))["fields"],
        json!({ "password": "enc:pw1" })
    );
    // The cleared value is kept in the history.
    assert_eq!(
        view(&mut t, "owner", "secretHistory", json!({ "id": id }))[0]["previous"],
        "enc:user"
    );
}

#[test]
fn updating_a_missing_secret_is_not_found() {
    let mut t = vault();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "updateSecret",
            json!({ "id": sid(1), "name": null, "tags": null, "fields": {}, "rekey": false }),
        ),
        "NotFound"
    );
}

// ── roles ────────────────────────────────────────────────────────────────────

#[test]
fn an_account_without_a_role_is_pending_and_cannot_write() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    assert_eq!(role_of(&mut t, "bob"), "pending");
    // Reads are open to everyone the org lets in: they are ciphertext.
    assert_eq!(
        view(&mut t, "bob", "getSecret", json!({ "id": id }))["kind"],
        "login"
    );
    for (method, args) in [
        (
            "addSecret",
            json!({ "id": sid(2), "kind": "login", "name": "n", "tags": "t", "fields": {} }),
        ),
        (
            "updateSecret",
            json!({ "id": id, "name": "x", "tags": null, "fields": {}, "rekey": false }),
        ),
        ("trashSecret", json!({ "id": id })),
        ("restoreSecret", json!({ "id": id })),
        ("renameVault", json!({ "name": "x" })),
    ] {
        assert_eq!(
            refused(&mut t, "bob", method, args),
            "Forbidden",
            "{method}"
        );
    }
}

#[test]
fn an_editor_can_write_but_not_administer() {
    let mut t = vault();
    set_role(&mut t, "bob", "editor");
    assert_eq!(role_of(&mut t, "bob"), "editor");
    let id = add_login(&mut t, "bob", 1);
    call(&mut t, "bob", "trashSecret", json!({ "id": id }));
    call(&mut t, "bob", "restoreSecret", json!({ "id": id }));
    call(&mut t, "bob", "trashSecret", json!({ "id": id }));
    register(&mut t, "owner", 1, "browser");
    call(
        &mut t,
        "owner",
        "addKeyWraps",
        json!({ "wraps": [wrap("k1", &fp(1), &fp(1))] }),
    );
    for (method, args) in [
        ("purgeSecret", json!({ "id": id })),
        ("setRole", json!({ "account": "carol", "role": "editor" })),
        ("removeMember", json!({ "account": "carol" })),
        ("setDefaultRole", json!({ "role": "viewer" })),
        ("rotateKey", json!({ "keyId": "k1" })),
    ] {
        assert_eq!(
            refused(&mut t, "bob", method, args),
            "Forbidden",
            "{method}"
        );
    }
}

#[test]
fn a_viewer_reads_but_does_not_write() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    set_role(&mut t, "bob", "viewer");
    assert_eq!(role_of(&mut t, "bob"), "viewer");
    assert_eq!(
        view(&mut t, "bob", "listSecrets", json!({}))
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    assert_eq!(
        refused(&mut t, "bob", "trashSecret", json!({ "id": id })),
        "Forbidden"
    );
}

#[test]
fn demoting_an_editor_takes_write_away() {
    let mut t = vault();
    set_role(&mut t, "bob", "editor");
    add_login(&mut t, "bob", 1);
    set_role(&mut t, "bob", "viewer");
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "addSecret",
            json!({ "id": sid(2), "kind": "login", "name": "n", "tags": "t", "fields": {} }),
        ),
        "Forbidden"
    );
}

#[test]
fn a_second_admin_can_purge_and_the_last_admin_cannot_step_down() {
    let mut t = vault();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "setRole",
            json!({ "account": "owner", "role": "editor" }),
        ),
        "Conflict"
    );
    set_role(&mut t, "bob", "admin");
    let id = add_login(&mut t, "owner", 1);
    call(&mut t, "owner", "trashSecret", json!({ "id": id }));
    call(&mut t, "bob", "purgeSecret", json!({ "id": id }));
    // With a second admin, the first may step down; then bob is the last.
    set_role(&mut t, "owner", "editor");
    assert_eq!(role_of(&mut t, "owner"), "editor");
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "setRole",
            json!({ "account": "bob", "role": "viewer" }),
        ),
        "Conflict"
    );
}

#[test]
fn an_unknown_role_or_a_stranger_is_refused() {
    let mut t = vault();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "setRole",
            json!({ "account": "bob", "role": "owner" }),
        ),
        "Invalid"
    );
    // An account the organization does not hold cannot be given a role.
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "setRole",
            json!({ "account": "mallory", "role": "editor" }),
        ),
        "NotFound"
    );
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "setDefaultRole",
            json!({ "role": "admin" }),
        ),
        "Invalid"
    );
}

#[test]
fn the_default_role_is_editor_until_an_admin_sets_it() {
    let mut t = vault();
    call(
        &mut t,
        "owner",
        "setDefaultRole",
        json!({ "role": "viewer" }),
    );
    assert_eq!(
        view(&mut t, "bob", "vaultInfo", json!({}))["defaultRole"],
        "viewer"
    );
}

#[test]
fn roles_are_explicit_and_pending_is_not_viewer() {
    let mut t = vault();
    register(&mut t, "bob", 2, "browser");
    set_role(&mut t, "carol", "viewer");
    assert_eq!(
        member(&mut t, "bob"),
        json!({ "account": "bob", "role": "pending", "devices": 1 })
    );
    assert_eq!(
        member(&mut t, "carol"),
        json!({ "account": "carol", "role": "viewer", "devices": 0 })
    );
    assert_eq!(
        view(&mut t, "owner", "listMembers", json!({})),
        json!([
            { "account": "bob", "role": "pending", "devices": 1 },
            { "account": "carol", "role": "viewer", "devices": 0 },
            { "account": "owner", "role": "admin", "devices": 0 },
        ])
    );
    assert_eq!(names(&t, "dave"), ["KeysChanged", "MembersChanged"]);
}

#[test]
fn a_removed_member_who_re_registers_is_marked_removed_until_re_admitted() {
    let mut t = vault();
    set_role(&mut t, "bob", "editor");
    register(&mut t, "bob", 2, "browser");
    call(&mut t, "owner", "removeMember", json!({ "account": "bob" }));
    assert_eq!(role_of(&mut t, "bob"), "pending");
    // Their device is revoked, so they are listed only once they register anew.
    assert_eq!(member(&mut t, "bob"), Value::Null);
    register(&mut t, "bob", 3, "browser");
    assert_eq!(
        member(&mut t, "bob"),
        json!({ "account": "bob", "role": "removed", "devices": 1 })
    );
    set_role(&mut t, "bob", "viewer");
    assert_eq!(
        member(&mut t, "bob"),
        json!({ "account": "bob", "role": "viewer", "devices": 1 })
    );
}

#[test]
fn removing_a_member_drops_their_role_and_revokes_their_devices() {
    let mut t = vault();
    set_role(&mut t, "bob", "editor");
    register(&mut t, "bob", 2, "browser");
    register(&mut t, "bob", 3, "recovery");
    register(&mut t, "carol", 4, "browser");
    call(&mut t, "owner", "removeMember", json!({ "account": "bob" }));
    let devices = view(&mut t, "owner", "listDevices", json!({}));
    let revoked: Vec<(Value, Value)> = devices
        .as_array()
        .expect("a list")
        .iter()
        .map(|d| (d["fingerprint"].clone(), d["revoked"].clone()))
        .collect();
    assert_eq!(
        revoked,
        [
            (json!(fp(2)), json!(true)),
            (json!(fp(3)), json!(true)),
            (json!(fp(4)), json!(false)),
        ]
    );
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "addSecret",
            json!({ "id": sid(1), "kind": "login", "name": "n", "tags": "t", "fields": {} }),
        ),
        "Forbidden"
    );
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "removeMember",
            json!({ "account": "owner" }),
        ),
        "Invalid"
    );
}

// ── trash ────────────────────────────────────────────────────────────────────

#[test]
fn trash_is_recoverable_and_purge_needs_the_trash_first() {
    let mut t = vault();
    let id = add_login(&mut t, "owner", 1);
    set_role(&mut t, "bob", "editor");
    call(
        &mut t,
        "owner",
        "updateSecret",
        json!({ "id": id, "name": "n2", "tags": null, "fields": {}, "rekey": false }),
    );
    assert_eq!(
        refused(&mut t, "owner", "purgeSecret", json!({ "id": id })),
        "Invalid"
    );
    t.advance(500);
    call(&mut t, "bob", "trashSecret", json!({ "id": id }));
    let got = view(&mut t, "owner", "getSecret", json!({ "id": id }));
    assert_eq!(got["trashed"], true);
    assert_eq!(got["trashedAt"], (common::T0 + 500).to_string());
    call(&mut t, "bob", "restoreSecret", json!({ "id": id }));
    let got = view(&mut t, "owner", "getSecret", json!({ "id": id }));
    assert_eq!(
        (got["trashed"].clone(), got["trashedAt"].clone()),
        (json!(false), json!("0"))
    );

    call(&mut t, "bob", "trashSecret", json!({ "id": id }));
    call(&mut t, "owner", "purgeSecret", json!({ "id": id }));
    assert_eq!(
        view(&mut t, "owner", "getSecret", json!({ "id": id })),
        json!(null)
    );
    assert_eq!(
        view(&mut t, "owner", "secretHistory", json!({ "id": id })),
        json!([])
    );
    // The id is free again, with no old fields left under it.
    call(
        &mut t,
        "owner",
        "addSecret",
        json!({ "id": id, "kind": "secure_note", "name": "n", "tags": "t", "fields": {} }),
    );
    assert_eq!(
        view(&mut t, "owner", "getSecret", json!({ "id": id }))["fields"],
        json!({})
    );
    for method in ["trashSecret", "restoreSecret", "purgeSecret"] {
        assert_eq!(
            refused(&mut t, "owner", method, json!({ "id": sid(9) })),
            "NotFound",
            "{method}"
        );
    }
}

// ── devices and key wraps ────────────────────────────────────────────────────

#[test]
fn a_device_is_registered_under_the_callers_account() {
    let mut t = vault();
    register(&mut t, "bob", 2, "browser");
    // A repeat of one's own registration is a no-op.
    register(&mut t, "bob", 2, "browser");
    assert_eq!(
        view(&mut t, "owner", "listDevices", json!({})),
        json!([{
            "fingerprint": fp(2),
            "publicKey": "pk2",
            "label": "Laptop",
            "kind": "browser",
            "account": "bob",
            "addedAt": common::T0.to_string(),
            "revoked": false,
        }])
    );
    assert_eq!(names(&t, "carol"), ["KeysChanged"]);
}

#[test]
fn one_fingerprint_two_accounts_are_two_devices() {
    let mut t = vault();
    register(&mut t, "bob", 2, "browser");
    register(&mut t, "carol", 2, "browser");
    let accounts: Vec<Value> = view(&mut t, "owner", "listDevices", json!({}))
        .as_array()
        .expect("a list")
        .iter()
        .map(|d| d["account"].clone())
        .collect();
    assert_eq!(accounts, [json!("bob"), json!("carol")]);
}

#[test]
fn a_malformed_fingerprint_or_an_unknown_kind_is_refused() {
    let mut t = vault();
    for (fingerprint, kind) in [
        ("abc".to_owned(), "browser"),
        ("zz".repeat(32), "browser"),
        (fp(1), "phone"),
    ] {
        assert_eq!(
            refused(
                &mut t,
                "bob",
                "registerDevice",
                json!({ "fingerprint": fingerprint, "publicKey": "pk", "label": "l", "kind": kind }),
            ),
            "Invalid"
        );
    }
    for kind in ["browser", "recovery", "agent"] {
        let n = match kind {
            "browser" => 1,
            "recovery" => 2,
            _ => 3,
        };
        register(&mut t, "bob", n, kind);
    }
    let kinds: Vec<Value> = view(&mut t, "owner", "listDevices", json!({}))
        .as_array()
        .expect("a list")
        .iter()
        .map(|d| d["kind"].clone())
        .collect();
    assert_eq!(kinds, [json!("browser"), json!("recovery"), json!("agent")]);
}

#[test]
fn wraps_only_land_on_registered_unrevoked_devices() {
    let mut t = vault();
    register(&mut t, "owner", 1, "browser");
    register(&mut t, "bob", 2, "browser");
    register(&mut t, "carol", 3, "browser");
    call(
        &mut t,
        "owner",
        "revokeDevice",
        json!({ "fingerprint": fp(3) }),
    );
    let added = call(
        &mut t,
        "owner",
        "addKeyWraps",
        json!({ "wraps": [
            wrap("k1", &fp(1), &fp(1)),
            wrap("k1", &fp(2), &fp(1)),
            wrap("k1", &fp(3), &fp(1)),   // revoked
            wrap("k1", &fp(9), &fp(1)),   // never registered
            wrap("k:1", &fp(2), &fp(1)),  // a colon in the key id
            wrap("k1", &fp(2), &fp(1)),   // a repeat
        ] }),
    );
    assert_eq!(added, json!(2));
    assert_eq!(
        view(&mut t, "bob", "keyWrapsFor", json!({ "recipient": fp(2) })),
        json!([{
            "keyId": "k1",
            "recipient": fp(2),
            "wrapper": fp(1),
            "envelope": "env",
            "wrappedBy": "owner",
        }])
    );
    assert_eq!(
        view(&mut t, "bob", "keyWrapsFor", json!({ "recipient": fp(3) })),
        json!([])
    );
    assert_eq!(
        view(&mut t, "bob", "wrappedPairs", json!({})),
        json!([format!("k1:{}", fp(1)), format!("k1:{}", fp(2))])
    );
    // Nothing stored, no event.
    let before = names(&t, "dave").len();
    assert_eq!(
        call(
            &mut t,
            "owner",
            "addKeyWraps",
            json!({ "wraps": [wrap("k1", &fp(9), &fp(1))] }),
        ),
        json!(0)
    );
    assert_eq!(names(&t, "dave").len(), before);
}

#[test]
fn switching_keys_needs_a_wrap_and_an_admin() {
    let mut t = vault();
    register(&mut t, "owner", 1, "browser");
    assert_eq!(
        refused(&mut t, "owner", "rotateKey", json!({ "keyId": "k1" })),
        "Invalid"
    );
    call(
        &mut t,
        "owner",
        "addKeyWraps",
        json!({ "wraps": [wrap("k1", &fp(1), &fp(1))] }),
    );
    call(&mut t, "owner", "rotateKey", json!({ "keyId": "k1" }));
    assert_eq!(
        view(&mut t, "bob", "vaultInfo", json!({}))["currentKey"],
        "k1"
    );
    call(
        &mut t,
        "owner",
        "addKeyWraps",
        json!({ "wraps": [wrap("k2", &fp(1), &fp(1))] }),
    );
    set_role(&mut t, "bob", "editor");
    assert_eq!(
        refused(&mut t, "bob", "rotateKey", json!({ "keyId": "k2" })),
        "Forbidden"
    );
    call(&mut t, "owner", "rotateKey", json!({ "keyId": "k2" }));
    let actions: Vec<Value> = view(&mut t, "owner", "getAuditLogs", json!({}))
        .as_array()
        .expect("a list")
        .iter()
        .filter(|l| l["action"].as_str().is_some_and(|a| a.starts_with("key_")))
        .map(|l| json!([l["action"], l["target"]]))
        .collect();
    assert_eq!(
        actions,
        [json!(["key_rotated", "k2"]), json!(["key_created", "k1"])]
    );
}

#[test]
fn an_owner_can_revoke_their_own_device_but_not_someone_elses() {
    let mut t = vault();
    register(&mut t, "bob", 2, "browser");
    register(&mut t, "carol", 3, "browser");
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "revokeDevice",
            json!({ "fingerprint": fp(3) }),
        ),
        "Forbidden"
    );
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "revokeDevice",
            json!({ "fingerprint": fp(9) }),
        ),
        "NotFound"
    );
    // The owner withdraws the key: the row is gone, not marked.
    call(
        &mut t,
        "bob",
        "revokeDevice",
        json!({ "fingerprint": fp(2) }),
    );
    let fingerprints: Vec<Value> = view(&mut t, "owner", "listDevices", json!({}))
        .as_array()
        .expect("a list")
        .iter()
        .map(|d| d["fingerprint"].clone())
        .collect();
    assert_eq!(fingerprints, [json!(fp(3))]);
    // An admin marks it revoked.
    call(
        &mut t,
        "owner",
        "revokeDevice",
        json!({ "fingerprint": fp(3) }),
    );
    assert_eq!(
        view(&mut t, "owner", "listDevices", json!({}))[0]["revoked"],
        true
    );
}

// ── authorship: what v1 kept in owner stamps ─────────────────────────────────

/// v1: a modified node writing a wrap to its own device under a forged stamp.
/// Here the wrap's author is the caller, and a pending account's wrap never
/// makes a device look approved.
#[test]
fn a_member_without_a_role_cannot_make_a_device_look_entitled() {
    let mut t = vault();
    register(&mut t, "owner", 1, "browser");
    register(&mut t, "bob", 2, "browser");
    assert_eq!(
        call(
            &mut t,
            "bob",
            "addKeyWraps",
            json!({ "wraps": [wrap("k1", &fp(2), &fp(2))] }),
        ),
        json!(1)
    );
    assert_eq!(
        view(
            &mut t,
            "owner",
            "keyWrapsFor",
            json!({ "recipient": fp(2) })
        )[0]["wrappedBy"],
        "bob"
    );
    assert_eq!(view(&mut t, "owner", "wrappedPairs", json!({})), json!([]));
    set_role(&mut t, "bob", "viewer");
    assert_eq!(
        view(&mut t, "owner", "wrappedPairs", json!({})),
        json!([format!("k1:{}", fp(2))])
    );
    // Removed again: their wrap stops counting.
    call(&mut t, "owner", "removeMember", json!({ "account": "bob" }));
    assert_eq!(view(&mut t, "owner", "wrappedPairs", json!({})), json!([]));
}

#[test]
fn only_an_admin_admits_an_agent() {
    let mut t = vault();
    register(&mut t, "owner", 1, "browser");
    register(&mut t, "bob", 2, "browser");
    register(&mut t, "carol", 5, "agent");
    set_role(&mut t, "bob", "editor");
    assert_eq!(
        call(
            &mut t,
            "bob",
            "addKeyWraps",
            json!({ "wraps": [wrap("k1", &fp(5), &fp(2))] }),
        ),
        json!(0)
    );
    assert_eq!(
        call(
            &mut t,
            "owner",
            "addKeyWraps",
            json!({ "wraps": [wrap("k1", &fp(5), &fp(1))] }),
        ),
        json!(1)
    );
    assert_eq!(
        view(&mut t, "owner", "wrappedPairs", json!({})),
        json!([format!("k1:{}", fp(5))])
    );
}

#[test]
fn an_agent_entry_does_not_hijack_a_browser() {
    let mut t = vault();
    register(&mut t, "bob", 2, "browser");
    set_role(&mut t, "bob", "editor");
    // carol files an agent entry at bob's browser's fingerprint.
    register(&mut t, "carol", 2, "agent");
    register(&mut t, "dave", 4, "browser");
    set_role(&mut t, "dave", "editor");
    assert_eq!(
        call(
            &mut t,
            "dave",
            "addKeyWraps",
            json!({ "wraps": [wrap("k1", &fp(2), &fp(4))] }),
        ),
        json!(1)
    );
    assert_eq!(
        view(&mut t, "owner", "wrappedPairs", json!({})),
        json!([format!("k1:{}", fp(2))])
    );
}

/// v1: a random nonce per slot, so nobody could occupy the slot a genuine wrap
/// would be written under. Here two authors' wraps of one key to one device are
/// two rows, and one author's repeat is skipped.
#[test]
fn a_wrap_cannot_be_squatted() {
    let mut t = vault();
    register(&mut t, "owner", 1, "browser");
    register(&mut t, "bob", 2, "browser");
    call(
        &mut t,
        "bob",
        "addKeyWraps",
        json!({ "wraps": [wrap("k1", &fp(2), &fp(1))] }),
    );
    assert_eq!(
        call(
            &mut t,
            "owner",
            "addKeyWraps",
            json!({ "wraps": [wrap("k1", &fp(2), &fp(1))] }),
        ),
        json!(1)
    );
    let mut authors: Vec<String> =
        view(&mut t, "bob", "keyWrapsFor", json!({ "recipient": fp(2) }))
            .as_array()
            .expect("a list")
            .iter()
            .map(|w| w["wrappedBy"].as_str().unwrap_or_default().to_owned())
            .collect();
    authors.sort();
    assert_eq!(authors, ["bob", "owner"]);
}

// ── audit ────────────────────────────────────────────────────────────────────

#[test]
fn every_change_is_audited_by_account_and_without_names() {
    let mut t = vault();
    register(&mut t, "owner", 1, "browser");
    call(
        &mut t,
        "owner",
        "addKeyWraps",
        json!({ "wraps": [wrap("k1", &fp(1), &fp(1))] }),
    );
    call(&mut t, "owner", "rotateKey", json!({ "keyId": "k1" }));
    let id = add_login(&mut t, "owner", 1);
    set_role(&mut t, "bob", "editor");
    call(
        &mut t,
        "bob",
        "updateSecret",
        json!({ "id": id, "name": "n2", "tags": null, "fields": {}, "rekey": false }),
    );
    call(&mut t, "bob", "trashSecret", json!({ "id": id }));
    call(&mut t, "bob", "restoreSecret", json!({ "id": id }));
    call(&mut t, "bob", "trashSecret", json!({ "id": id }));
    call(&mut t, "owner", "purgeSecret", json!({ "id": id }));
    call(
        &mut t,
        "owner",
        "setDefaultRole",
        json!({ "role": "viewer" }),
    );
    call(&mut t, "bob", "renameVault", json!({ "name": "V" }));
    register(&mut t, "carol", 3, "browser");
    call(
        &mut t,
        "carol",
        "revokeDevice",
        json!({ "fingerprint": fp(3) }),
    );
    call(
        &mut t,
        "owner",
        "removeMember",
        json!({ "account": "carol" }),
    );

    let logs = view(&mut t, "dave", "getAuditLogs", json!({}));
    let lines: Vec<(String, String, String)> = logs
        .as_array()
        .expect("a list")
        .iter()
        .map(|l| {
            assert_eq!(l["device"], "");
            assert_eq!(l["redacted"], false);
            assert_eq!(l["timestamp"], common::T0.to_string());
            (
                l["action"].as_str().unwrap_or_default().to_owned(),
                l["target"].as_str().unwrap_or_default().to_owned(),
                l["account"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect();
    let line = |a: &str, tg: &str, who: &str| (a.to_owned(), tg.to_owned(), who.to_owned());
    assert_eq!(
        lines,
        [
            line("member_removed", "carol", "owner"),
            line("device_revoked", &fp(3), "carol"),
            line("device_registered", &fp(3), "carol"),
            line("vault_renamed", "vault", "bob"),
            line("default_role:viewer", "vault", "owner"),
            line("secret_purged", &id, "owner"),
            line("secret_trashed", &id, "bob"),
            line("secret_restored", &id, "bob"),
            line("secret_trashed", &id, "bob"),
            line("secret_updated", &id, "bob"),
            line("role_set:editor", "bob", "owner"),
            line("secret_added", &id, "owner"),
            line("key_created", "k1", "owner"),
            line("device_registered", &fp(1), "owner"),
        ]
    );
    // Nothing in the trail is a name or a value.
    let text = logs.to_string();
    assert!(!text.contains("enc:") && !text.contains("n2"));
}

#[test]
fn events_carry_ids_only_and_reach_everyone_the_app_reaches() {
    let mut t = vault();
    register(&mut t, "owner", 1, "browser");
    call(
        &mut t,
        "owner",
        "addKeyWraps",
        json!({ "wraps": [wrap("k1", &fp(1), &fp(1))] }),
    );
    call(&mut t, "owner", "rotateKey", json!({ "keyId": "k1" }));
    add_login(&mut t, "owner", 1);
    set_role(&mut t, "bob", "editor");
    call(&mut t, "owner", "renameVault", json!({ "name": "V" }));
    let expected = [
        ("KeysChanged".to_owned(), json!({})),
        ("KeysChanged".to_owned(), json!({})),
        ("KeysChanged".to_owned(), json!({})),
        ("SecretChanged".to_owned(), json!({ "secretId": sid(1) })),
        ("MembersChanged".to_owned(), json!({})),
        ("VaultRenamed".to_owned(), json!({})),
    ];
    let normalise = |events: Vec<(String, Value)>| -> Vec<(String, Value)> {
        events
            .into_iter()
            .map(|(n, d)| (n, if d.is_null() { json!({}) } else { d }))
            .collect()
    };
    assert_eq!(normalise(t.events_for("dave")), expected);
    // A guest of the org hears them too (ids only, nothing to decrypt).
    assert_eq!(normalise(t.events_for("gus")), expected);
}

// ── what v1 could not check ──────────────────────────────────────────────────

/// The org decides who reaches the vault; inside it, a guest is like any other
/// account without a vault role: `pending` until an admin gives it one.
#[test]
fn who_reaches_the_vault() {
    let mut t = vault();
    register(&mut t, "gus", 7, "browser");
    assert_eq!(role_of(&mut t, "gus"), "pending");
    assert_eq!(
        refused(
            &mut t,
            "gus",
            "addSecret",
            json!({ "id": sid(1), "kind": "login", "name": "n", "tags": "t", "fields": {} }),
        ),
        "Forbidden"
    );
    set_role(&mut t, "gus", "editor");
    add_login(&mut t, "gus", 1);

    assert_eq!(
        t.anonymous().view("vaultInfo", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory").call(
            "registerDevice",
            json!({ "fingerprint": fp(8), "publicKey": "pk", "label": "l", "kind": "browser" }),
        ),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory").view("listSecrets", json!({})),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
}

/// An account the org removes stops reaching the vault at once, whatever its
/// vault role (v1 needed a key rotation and a removal on every node).
#[test]
fn leaving_the_org_ends_access_at_once() {
    let mut t = vault();
    set_role(&mut t, "bob", "admin");
    t.remove_member("bob");
    assert_eq!(
        t.as_("bob").view("listSecrets", json!({})),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    // The vault still lists their role until an admin removes it, which the
    // client does when it next opens the vault (`allowed` in VaultSession).
    assert_eq!(member(&mut t, "bob")["role"], "admin");
    call(&mut t, "owner", "removeMember", json!({ "account": "bob" }));
    assert_eq!(member(&mut t, "bob"), Value::Null);
}

/// Arguments are a JSON object of exactly the method's parameters.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = vault();
    for args in [
        json!({ "id": sid(1), "kind": "login", "name": "n", "tags": "t" }),
        json!({ "id": sid(1), "kind": "login", "name": "n", "tags": "t", "fields": {}, "extra": 1 }),
        json!({ "id": sid(1), "kind": "login", "name": "n", "tags": "t", "fields": [] }),
    ] {
        assert!(
            matches!(
                t.as_("owner").call("addSecret", args.clone()),
                Err(Failure::App { ref code, .. }) if code == "BadArgs"
            ),
            "{args}"
        );
    }
    assert!(matches!(
        t.as_("owner").call("addKeyWraps", json!({ "wraps": [{ "key_id": "k" }] })),
        Err(Failure::App { ref code, .. }) if code == "BadArgs"
    ));
    assert_eq!(view(&mut t, "owner", "listSecrets", json!({})), json!([]));
}

/// v1's snake_case names are not methods any more: the ABI's are camelCase.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = vault();
    assert!(matches!(
        t.as_("owner").view("vault_info", json!({})),
        Err(Failure::App { ref code, .. }) if code == "UnknownMethod"
    ));
    assert!(matches!(
        t.as_("owner").view("renameVault", json!({ "name": "x" })),
        Err(Failure::App { ref code, .. }) if code == "NotAView"
    ));
}

/// Lists are not capped at one page: a vault of 1,001 secrets lists all of them.
#[test]
fn list_secrets_reads_every_page() {
    let mut t = vault();
    for i in 0..1001u32 {
        call(
            &mut t,
            "owner",
            "addSecret",
            json!({ "id": format!("secret_{i:032x}"), "kind": "login", "name": "n", "tags": "t", "fields": {} }),
        );
    }
    assert_eq!(
        view(&mut t, "owner", "listSecrets", json!({}))
            .as_array()
            .map(Vec::len),
        Some(1001)
    );
    // The trail answers its newest 1,000 lines.
    assert_eq!(
        view(&mut t, "owner", "getAuditLogs", json!({}))
            .as_array()
            .map(Vec::len),
        Some(1000)
    );
}
