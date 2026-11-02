//! The bench on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, what v1's convergence and forged-write checks become
//! under one log, and the access and wire checks v1 could not express. The
//! method-by-method coverage is in `scenarios/*.json`, which the cluster runs too.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner, members `bob` and `carol`, guest `gus`.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "carol"]).guests(["gus"]))
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

/// The app error code a call answers.
fn refused(t: &mut TestApp, who: &str, method: &str, args: Value) -> String {
    match t.as_(who).call(method, args) {
        Err(Failure::App { code, .. }) => code,
        other => panic!("{who} {method}: expected an app error, got {other:?}"),
    }
}

/// The `items` of a listing's first page, which these tests keep to one page.
fn items(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    let page = view(t, who, method, args);
    assert_eq!(page["next"], Value::Null, "{method}: one page");
    page["items"].clone()
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

/// The workspace claimed by the owner.
fn workspace() -> TestApp {
    let mut t = app();
    call(&mut t, "owner", "wsInit", json!({ "name": "Acme" }));
    t
}

fn channel(t: &mut TestApp, who: &str, id: &str) -> Result<Value, Failure> {
    t.as_(who).call(
        "wsRegisterChannel",
        json!({ "contextId": id, "name": id, "topic": "" }),
    )
}

// ── v1's TestHost tests ──────────────────────────────────────────────────────

#[test]
fn only_an_admin_can_claim_the_workspace() {
    let mut t = app();
    assert_eq!(
        refused(&mut t, "bob", "wsInit", json!({ "name": "Mine" })),
        "Forbidden"
    );
    call(&mut t, "owner", "wsInit", json!({ "name": "Acme" }));
    let info = view(&mut t, "bob", "wsGetInfo", json!({}));
    assert_eq!(info["name"], "Acme");
    assert_eq!(info["admin"], "owner");
    assert_eq!(view(&mut t, "owner", "wsMyRole", json!({})), json!("admin"));
}

#[test]
fn a_member_cannot_grant_itself_admin() {
    let mut t = workspace();
    call(
        &mut t,
        "owner",
        "wsSetMemberRole",
        json!({ "identity": "bob", "role": "member" }),
    );
    let code = refused(
        &mut t,
        "bob",
        "wsSetMemberRole",
        json!({ "identity": "bob", "role": "admin" }),
    );
    assert_eq!(code, "Forbidden");
    assert_eq!(
        view(
            &mut t,
            "owner",
            "wsGetMemberRole",
            json!({ "identity": "bob" })
        ),
        json!("member")
    );
    // Nor can a member demote the real admin.
    let code = refused(
        &mut t,
        "bob",
        "wsSetMemberRole",
        json!({ "identity": "owner", "role": "read-only" }),
    );
    assert_eq!(code, "Forbidden");
}

#[test]
fn a_channel_belongs_to_its_registrant_and_admins_moderate() {
    let mut t = workspace();
    for who in ["bob", "carol"] {
        call(
            &mut t,
            "owner",
            "wsSetMemberRole",
            json!({ "identity": who, "role": "member" }),
        );
    }
    channel(&mut t, "bob", "ctx-1").expect("bob registers");
    // Someone else's channel: no overwrite, no removal.
    assert!(
        matches!(channel(&mut t, "carol", "ctx-1"), Err(Failure::App { code, .. }) if code == "Forbidden")
    );
    assert_eq!(
        refused(
            &mut t,
            "carol",
            "wsUnregisterChannel",
            json!({ "contextId": "ctx-1" })
        ),
        "Forbidden"
    );
    // The admin moderates.
    call(
        &mut t,
        "owner",
        "wsUnregisterChannel",
        json!({ "contextId": "ctx-1" }),
    );
    assert_eq!(items(&mut t, "bob", "wsListChannels", json!({})), json!([]));
}

#[test]
fn one_authored_key_two_owners_are_two_entries() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "authoredInsert",
        json!({ "key": "k", "value": "b" }),
    );
    call(
        &mut t,
        "carol",
        "authoredInsert",
        json!({ "key": "k", "value": "c" }),
    );
    assert_eq!(view(&mut t, "owner", "authoredLen", json!({})), json!("2"));
    assert_eq!(
        items(&mut t, "owner", "authoredOwners", json!({ "key": "k" })),
        json!(["bob", "carol"])
    );
    // The lowest holder answers a key-only read.
    assert_eq!(
        view(&mut t, "owner", "authoredGet", json!({ "key": "k" })),
        json!("b")
    );
    assert_eq!(
        view(&mut t, "owner", "authoredGetOwner", json!({ "key": "k" })),
        json!("bob")
    );
    // Removing is per owner: carol's entry stays.
    assert_eq!(
        call(&mut t, "bob", "authoredRemove", json!({ "key": "k" })),
        json!("b")
    );
    assert_eq!(
        view(&mut t, "owner", "authoredGet", json!({ "key": "k" })),
        json!("c")
    );
    assert_eq!(
        items(&mut t, "owner", "authoredEntries", json!({})),
        json!({ "k": "c" })
    );
}

#[test]
fn a_listing_reports_the_registrant_not_a_claimed_author() {
    let mut t = workspace();
    call(
        &mut t,
        "owner",
        "wsSetMemberRole",
        json!({ "identity": "bob", "role": "member" }),
    );
    channel(&mut t, "bob", "ctx-b").expect("bob registers");
    call(
        &mut t,
        "bob",
        "wsRegisterGroup",
        json!({ "groupId": "g", "name": "G", "description": "" }),
    );
    let channels = items(&mut t, "owner", "wsListChannels", json!({}));
    assert_eq!(channels[0]["createdBy"], "bob");
    assert_eq!(channels[0]["contextId"], "ctx-b");
    // u64 fields are decimal strings on the wire.
    assert!(channels[0]["registeredAt"].is_string());
    let groups = items(&mut t, "owner", "wsListGroups", json!({}));
    assert_eq!(groups[0]["createdBy"], "bob");
}

#[test]
fn granting_admin_hands_over_moderation_and_demoting_takes_it_back() {
    let mut t = workspace();
    for who in ["bob", "carol"] {
        call(
            &mut t,
            "owner",
            "wsSetMemberRole",
            json!({ "identity": who, "role": "member" }),
        );
    }
    channel(&mut t, "carol", "ctx-c").expect("carol registers");
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "wsUnregisterChannel",
            json!({ "contextId": "ctx-c" })
        ),
        "Forbidden"
    );
    call(
        &mut t,
        "owner",
        "wsSetMemberRole",
        json!({ "identity": "bob", "role": "admin" }),
    );
    call(
        &mut t,
        "bob",
        "wsUnregisterChannel",
        json!({ "contextId": "ctx-c" }),
    );
    channel(&mut t, "carol", "ctx-c").expect("carol registers again");
    call(
        &mut t,
        "owner",
        "wsSetMemberRole",
        json!({ "identity": "bob", "role": "member" }),
    );
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "wsUnregisterChannel",
            json!({ "contextId": "ctx-c" })
        ),
        "Forbidden"
    );
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "wsSetMemberRole",
            json!({ "identity": "carol", "role": "read-only" })
        ),
        "Forbidden"
    );
}

#[test]
fn uploads_get_distinct_ids() {
    let mut t = app();
    let blob = t.upload_blob(b"x", "text/plain");
    let args = json!({ "name": "f", "blobIdStr": blob, "size": "1", "mimeType": "text/plain" });
    let a = call(&mut t, "bob", "uploadFile", args.clone());
    let b = call(&mut t, "carol", "uploadFile", args);
    assert_ne!(a, b);
    let files = items(&mut t, "owner", "listFiles", json!({}));
    assert_eq!(files.as_array().map(Vec::len), Some(2));
    assert_eq!(files[0]["size"], "1");
    assert_eq!(files[0]["blobId"], blob);
    let found = items(&mut t, "owner", "searchFiles", json!({ "query": "F" }));
    assert_eq!(found.as_array().map(Vec::len), Some(2));
}

// ── rc.8: blobs, search, xcall ───────────────────────────────────────────────

#[test]
fn a_file_refers_to_its_blob_until_it_is_deleted() {
    let mut t = app();
    let blob = t.upload_blob(b"hello world", "text/plain");
    // Not uploaded to this app: the node's record decides, not the argument.
    let missing = "0".repeat(64);
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "uploadFile",
            json!({ "name": "r", "blobIdStr": missing, "size": "11", "mimeType": "text/plain" })
        ),
        "NotFound"
    );
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "uploadFile",
            json!({ "name": "r", "blobIdStr": "xyz", "size": "11", "mimeType": "text/plain" })
        ),
        "Invalid"
    );
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "uploadFile",
            json!({ "name": "r", "blobIdStr": blob, "size": "12", "mimeType": "text/plain" })
        ),
        "Invalid",
        "a size that is not the upload's"
    );
    // Upper-case hex is the same blob.
    let id = call(
        &mut t,
        "bob",
        "uploadFile",
        json!({ "name": "Report.TXT", "blobIdStr": blob.to_uppercase(), "size": "11", "mimeType": "application/octet-stream" }),
    );
    let id = id.as_str().expect("a file id").to_owned();
    assert!(id.starts_with("file_"));
    assert_eq!(t.blob_refs(&blob), 1, "the record keeps the blob");
    let record = view(&mut t, "carol", "getFile", json!({ "fileId": id }));
    assert_eq!(record["blobId"], blob);
    assert_eq!(record["size"], "11");
    assert_eq!(record["mimeType"], "application/octet-stream");
    assert_eq!(record["uploadedBy"], "bob");
    assert!(record["uploadedAt"].is_string());
    assert_eq!(
        view(&mut t, "carol", "getBlobIdHex", json!({ "fileId": id })),
        json!(blob)
    );
    let grant = view(
        &mut t,
        "gus",
        "fileDownloadGrant",
        json!({ "fileId": id, "ttlSeconds": 60 }),
    );
    assert!(
        grant.as_str().is_some_and(|g| g.starts_with(&blob)),
        "{grant}"
    );
    assert!(matches!(
        t.as_("bob")
            .view("fileDownloadGrant", json!({ "fileId": id, "ttlSeconds": 0 })),
        Err(Failure::App { ref code, .. }) if code == "Invalid"
    ));
    assert_eq!(
        t.events_for("carol").last(),
        Some(&(
            "FileUploaded".to_owned(),
            json!({ "id": id, "name": "Report.TXT", "size": "11", "uploader": "bob" })
        ))
    );

    call(&mut t, "carol", "deleteFile", json!({ "fileId": id }));
    assert_eq!(t.blob_refs(&blob), 0, "the blob is released");
    assert_eq!(items(&mut t, "owner", "listFiles", json!({})), json!([]));
    assert_eq!(
        refused(&mut t, "carol", "deleteFile", json!({ "fileId": id })),
        "NotFound"
    );
}

#[test]
fn search_files_uses_the_name_index() {
    let mut t = app();
    let blob = t.upload_blob(b"bytes", "image/png");
    for name in [
        "Quarterly report.pdf",
        "holiday photo.png",
        "Report draft.txt",
    ] {
        call(
            &mut t,
            "bob",
            "uploadFile",
            json!({ "name": name, "blobIdStr": blob, "size": "5", "mimeType": "" }),
        );
    }
    let names_of = |v: &Value| -> Vec<String> {
        let mut n: Vec<String> = v
            .as_array()
            .expect("files")
            .iter()
            .map(|f| f["name"].as_str().expect("name").to_owned())
            .collect();
        n.sort();
        n
    };
    let found = items(&mut t, "owner", "searchFiles", json!({ "query": "REPORT" }));
    assert_eq!(
        names_of(&found),
        ["Quarterly report.pdf", "Report draft.txt"]
    );
    assert_eq!(
        names_of(&items(
            &mut t,
            "owner",
            "searchFiles",
            json!({ "query": "  " })
        )),
        [
            "Quarterly report.pdf",
            "Report draft.txt",
            "holiday photo.png"
        ],
        "an empty query lists every file"
    );
    assert_eq!(
        items(
            &mut t,
            "owner",
            "searchFiles",
            json!({ "query": "spreadsheet" })
        ),
        json!([])
    );
    // Pages of one, followed by `next`.
    let first = view(
        &mut t,
        "owner",
        "searchFiles",
        json!({ "query": "report", "limit": 1 }),
    );
    assert_eq!(first["items"].as_array().map(Vec::len), Some(1));
    let next = first["next"].as_str().expect("a second page").to_owned();
    let second = view(
        &mut t,
        "owner",
        "searchFiles",
        json!({ "query": "report", "limit": 1, "cursor": next }),
    );
    assert_eq!(second["items"].as_array().map(Vec::len), Some(1));
    assert_ne!(first["items"][0]["id"], second["items"][0]["id"]);
}

#[test]
fn a_ping_is_an_xcall_to_the_target_and_its_pong_counts() {
    let mut t = workspace();
    call(
        &mut t,
        "owner",
        "wsSetMemberRole",
        json!({ "identity": "bob", "role": "member" }),
    );
    let _ = t.take_xcalls();
    call(
        &mut t,
        "bob",
        "wsPingChannel",
        json!({ "targetContextId": "other-app" }),
    );
    let sent = t.take_xcalls();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].app, "other-app");
    assert_eq!(sent[0].method, "wsPong");
    assert_eq!(sent[0].args, json!({ "fromContext": "test-app" }));
    assert_eq!(
        t.events_for("carol").last(),
        Some(&(
            "ChannelPinged".to_owned(),
            json!({ "toContext": "other-app", "by": "bob" })
        ))
    );
    // A refused ping sends nothing.
    assert_eq!(
        refused(
            &mut t,
            "carol",
            "wsPingChannel",
            json!({ "targetContextId": "other-app" })
        ),
        "Forbidden"
    );
    assert!(t.take_xcalls().is_empty());

    // The target side: another app's delivery counts, a forged origin does not.
    t.deliver("other-app", "wsPong", json!({ "fromContext": "other-app" }))
        .expect("a pong from the app it names");
    assert_eq!(view(&mut t, "owner", "wsPingCount", json!({})), json!("1"));
    assert!(matches!(
        t.deliver("other-app", "wsPong", json!({ "fromContext": "someone-else" })),
        Err(Failure::App { ref code, .. }) if code == "Invalid"
    ));
    assert_eq!(view(&mut t, "owner", "wsPingCount", json!({})), json!("1"));
}

#[test]
fn listings_are_paged_and_follow_next() {
    let mut t = app();
    for i in 0..5 {
        call(
            &mut t,
            "owner",
            "set",
            json!({ "key": format!("k{i}"), "value": format!("v{i}") }),
        );
    }
    let mut seen = serde_json::Map::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0;
    loop {
        let mut args = json!({ "limit": 2 });
        if let Some(c) = &cursor {
            args["cursor"] = json!(c);
        }
        let page = view(&mut t, "bob", "entries", args);
        seen.extend(page["items"].as_object().expect("a map").clone());
        pages += 1;
        match page["next"].as_str() {
            Some(n) => cursor = Some(n.to_owned()),
            None => break,
        }
    }
    assert_eq!(pages, 3);
    assert_eq!(seen.len(), 5);
    assert_eq!(seen["k4"], "v4");
    // A limit over 1,000 is 1,000; 0 is an empty page.
    assert_eq!(
        view(&mut t, "bob", "entries", json!({ "limit": 5000 }))["items"]
            .as_object()
            .map(serde_json::Map::len),
        Some(5)
    );
    assert_eq!(
        view(&mut t, "bob", "entries", json!({ "limit": 0 })),
        json!({ "items": {}, "next": null })
    );
}

#[test]
fn another_account_cannot_write_into_my_nested_user_map() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setUserNested",
        json!({ "key": "k", "value": "bob's" }),
    );
    call(
        &mut t,
        "carol",
        "setUserNested",
        json!({ "key": "k", "value": "carol's" }),
    );
    assert_eq!(
        view(&mut t, "bob", "getUserNested", json!({ "key": "k" })),
        json!("bob's")
    );
    assert_eq!(
        view(&mut t, "carol", "getUserNested", json!({ "key": "k" })),
        json!("carol's")
    );
    // No method takes the account it writes for.
    assert_eq!(
        refused(
            &mut t,
            "carol",
            "setUserNested",
            json!({ "key": "k", "value": "x", "account": "bob" })
        ),
        "BadArgs"
    );
}

#[test]
fn removing_an_absent_key_or_clearing_nothing_emits_nothing() {
    let mut t = app();
    assert_eq!(
        call(&mut t, "owner", "remove", json!({ "key": "nope" })),
        json!(null)
    );
    call(&mut t, "owner", "clear", json!({}));
    assert!(names(&t, "bob").is_empty());
    call(&mut t, "owner", "set", json!({ "key": "k", "value": "v" }));
    call(&mut t, "owner", "set", json!({ "key": "k", "value": "w" }));
    call(&mut t, "owner", "remove", json!({ "key": "k" }));
    call(&mut t, "owner", "set", json!({ "key": "k", "value": "v" }));
    call(&mut t, "owner", "clear", json!({}));
    assert_eq!(
        names(&t, "bob"),
        ["Inserted", "Updated", "Removed", "Inserted", "Cleared"]
    );
}

// ── what one log makes of v1's multi-node behavior ───────────────────────────

#[test]
fn handlers_run_once_in_the_call_that_names_them() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "setWithHandler",
        json!({ "key": "k", "value": "1" }),
    );
    call(
        &mut t,
        "owner",
        "setWithHandler",
        json!({ "key": "k", "value": "2" }),
    );
    call(&mut t, "owner", "removeWithHandler", json!({ "key": "k" }));
    call(&mut t, "owner", "clearWithHandler", json!({}));
    assert_eq!(
        view(&mut t, "bob", "getHandlerExecutionCount", json!({})),
        json!("4")
    );
    assert_eq!(
        names(&t, "bob"),
        ["Inserted", "Updated", "Removed", "Cleared"]
    );
}

#[test]
fn every_members_increment_counts() {
    let mut t = app();
    for who in ["owner", "bob", "carol"] {
        call(&mut t, who, "incrementGCounter", json!({ "key": "c" }));
        call(&mut t, who, "decrementPnCounter", json!({ "key": "p" }));
    }
    assert_eq!(
        view(&mut t, "owner", "getGCounter", json!({ "key": "c" })),
        json!("3")
    );
    assert_eq!(
        view(&mut t, "owner", "getPnCounter", json!({ "key": "p" })),
        json!("-3")
    );
    let events = t.events_for("bob");
    let last = events.last().expect("an event");
    assert_eq!(last.0, "PnCounterChanged");
    assert_eq!(
        last.1,
        json!({ "key": "p", "value": "-3", "operation": "decrement" })
    );
}

#[test]
fn a_later_write_replaces_an_earlier_one() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setRegister",
        json!({ "key": "r", "value": "bob" }),
    );
    call(
        &mut t,
        "carol",
        "setRegister",
        json!({ "key": "r", "value": "carol" }),
    );
    assert_eq!(
        view(&mut t, "owner", "getRegister", json!({ "key": "r" })),
        json!("carol")
    );
}

#[test]
fn text_edits_land_where_they_are_sent() {
    let mut t = app();
    call(&mut t, "bob", "rgaAppendText", json!({ "text": "ac" }));
    call(
        &mut t,
        "carol",
        "rgaInsertText",
        json!({ "position": "1", "text": "b" }),
    );
    assert_eq!(view(&mut t, "owner", "rgaGetText", json!({})), json!("abc"));
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "rgaDeleteText",
            json!({ "start": "2", "end": "1" })
        ),
        "Invalid"
    );
    call(&mut t, "owner", "rgaClear", json!({}));
    assert_eq!(view(&mut t, "owner", "rgaGetLength", json!({})), json!("0"));
    assert_eq!(
        names(&t, "bob"),
        ["TextInserted", "TextInserted", "TextDeleted"]
    );
}

// ── identity, access and the wire ────────────────────────────────────────────

#[test]
fn whoami_names_the_account() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "bob", "whoami", json!({})),
        json!({ "deviceId": "bob", "accountId": "bob" })
    );
    assert_eq!(
        t.api_key("key-1", "carol")
            .view("whoami", json!({}))
            .expect("api key"),
        json!({ "deviceId": "key-1", "accountId": "carol" })
    );
    assert_eq!(
        view(&mut t, "carol", "myAccount", json!({})),
        json!("carol")
    );
}

#[test]
fn the_org_decides_who_reaches_the_app() {
    let mut t = app();
    // A guest reaches it.
    call(&mut t, "gus", "set", json!({ "key": "g", "value": "1" }));
    // Anonymous: 401 at the access gate; an outsider: 404.
    assert!(matches!(
        t.anonymous().view("get", json!({ "key": "g" })),
        Err(Failure::Refused { status: 401, .. })
    ));
    assert!(matches!(
        t.as_("mallory").view("get", json!({ "key": "g" })),
        Err(Failure::Refused { status: 404, .. })
    ));
    // A removed member is an outsider from then on.
    t.remove_member("carol");
    assert!(matches!(
        t.as_("carol")
            .call("set", json!({ "key": "c", "value": "1" })),
        Err(Failure::Refused { status: 404, .. })
    ));
}

#[test]
fn ws_pong_refuses_a_direct_call() {
    let mut t = app();
    assert_eq!(
        refused(&mut t, "owner", "wsPong", json!({ "fromContext": "other" })),
        "Invalid"
    );
    assert_eq!(view(&mut t, "owner", "wsPingCount", json!({})), json!("0"));
}

#[test]
fn wire_checks() {
    let mut t = app();
    assert!(matches!(
        t.as_("owner").call("noSuchMethod", json!({})),
        Err(Failure::App { code, .. }) if code == "UnknownMethod"
    ));
    // snake_case names are not the ABI's.
    assert!(matches!(
        t.as_("owner").call("get_result", json!({ "key": "k" })),
        Err(Failure::App { code, .. }) if code == "UnknownMethod"
    ));
    assert!(matches!(
        t.as_("owner").view("set", json!({ "key": "k", "value": "v" })),
        Err(Failure::App { code, .. }) if code == "NotAView"
    ));
    assert_eq!(
        refused(&mut t, "owner", "pushMetric", json!({ "value": 3 })),
        "BadArgs"
    );
    assert_eq!(
        refused(&mut t, "owner", "set", json!({ "key": "k" })),
        "BadArgs"
    );
    // A view may run as a call (it then commits nothing).
    assert_eq!(
        t.as_("owner").call("len", json!({})).expect("view as call"),
        json!("0")
    );
}

#[test]
fn errors_are_typed() {
    let mut t = app();
    match t.as_("owner").view("getResult", json!({ "key": "nope" })) {
        Err(Failure::App { code, fields }) => {
            assert_eq!(code, "NotFound");
            assert_eq!(fields, json!({ "key": "nope" }));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "addGuess",
            json!({ "gameId": "g", "guess": "x" })
        ),
        "NoHash"
    );
}

#[test]
fn a_grant_confers_nothing_until_it_is_projected() {
    let mut t = app();
    assert_eq!(
        items(&mut t, "owner", "aclCapabilities", json!({})),
        json!({ "owner": ["write", "delete", "admin"] })
    );
    call(
        &mut t,
        "owner",
        "aclGrant",
        json!({ "role": "moderator", "accountHex": "bob" }),
    );
    assert_eq!(
        refused(&mut t, "bob", "aclDocSet", json!({ "value": "x" })),
        "Forbidden"
    );
    assert_eq!(call(&mut t, "owner", "aclProject", json!({})), json!("2"));
    assert_eq!(
        items(&mut t, "owner", "aclCapabilities", json!({})),
        json!({ "bob": ["write", "delete"], "owner": ["write", "delete", "admin"] })
    );
    call(&mut t, "bob", "aclDocSet", json!({ "value": "x" }));
    // An admin grant projects itself.
    call(
        &mut t,
        "owner",
        "aclGrantAdmin",
        json!({ "accountHex": "carol" }),
    );
    assert_eq!(
        items(&mut t, "owner", "aclCapabilities", json!({}))["carol"],
        json!(["write", "delete", "admin"])
    );
    let last = t.events_for("bob").last().cloned().expect("an event");
    assert_eq!(
        last,
        (
            "CapabilitiesProjected".to_owned(),
            json!({ "accounts": "3" })
        )
    );
}
