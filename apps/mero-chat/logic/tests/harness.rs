//! Chat on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's storage-enforced rules (owner stamps, writer sets,
//! forged writes from a patched node) as the method checks they became, and the
//! access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The harness's clock at `init`, in seconds (what message timestamps are).
const NOW: u64 = common::T0 / 1000;
const MAX_MESSAGE_LEN: usize = 20_000;
const MAX_SEARCH_BYTES: usize = 1 << 20;

/// The owner (creator, so the only admin), members `bob`, `cy` and `dee`, and
/// a guest, `gus`.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "cy", "dee"]).guests(["gus"]))
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

fn code(result: Result<Value, Failure>) -> String {
    match result {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn error(result: Result<Value, Failure>) -> (String, String) {
    match result {
        Err(Failure::App { code, fields }) => (
            code,
            fields["message"].as_str().unwrap_or_default().to_owned(),
        ),
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn send_args(text: &str, parent: Option<&str>, ts: u64) -> Value {
    json!({
        "message": text,
        "mentions": [],
        "mentionsUsernames": [],
        "parentMessage": parent,
        "timestamp": ts.to_string(),
        "files": null,
        "images": null,
    })
}

/// A top-level message from `who` at `ts`; its id.
fn send(t: &mut TestApp, who: &str, text: &str, ts: u64) -> String {
    call(t, who, "sendMessage", send_args(text, None, ts))["id"]
        .as_str()
        .expect("an id")
        .to_owned()
}

fn reply(t: &mut TestApp, who: &str, parent: &str, text: &str, ts: u64) -> String {
    call(t, who, "sendMessage", send_args(text, Some(parent), ts))["id"]
        .as_str()
        .expect("an id")
        .to_owned()
}

fn page(t: &mut TestApp, limit: Option<u32>, offset: Option<u32>) -> Value {
    view(
        t,
        "owner",
        "getMessages",
        json!({ "parentMessage": null, "limit": limit, "offset": offset, "searchTerm": null }),
    )
}

fn thread(t: &mut TestApp, parent: &str) -> Value {
    view(
        t,
        "owner",
        "getMessages",
        json!({ "parentMessage": parent, "limit": null, "offset": null, "searchTerm": null }),
    )
}

fn texts(page: &Value) -> Vec<String> {
    page["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .map(|m| m["text"].as_str().expect("text").to_owned())
        .collect()
}

fn role(t: &mut TestApp, who: &str) -> String {
    view(t, "owner", "getMemberRole", json!({ "identity": who }))
        .as_str()
        .expect("a role")
        .to_owned()
}

fn set_role(t: &mut TestApp, actor: &str, target: &str, role: &str) -> Result<Value, Failure> {
    t.as_(actor)
        .call("setMemberRole", json!({ "target": target, "role": role }))
}

fn message_at(t: &mut TestApp, index: u64) -> Value {
    view(
        t,
        "owner",
        "getMessagesFrom",
        json!({ "start": index.to_string(), "limit": 1 }),
    )["messages"][0]
        .clone()
}

fn search(t: &mut TestApp, query: &str, cursor: Value, limit: Option<u32>) -> Value {
    view(
        t,
        "owner",
        "searchMessagesScan",
        json!({ "query": query, "cursor": cursor, "limit": limit }),
    )
}

/// Every hit, page by page; and how many pages it took.
fn search_all(t: &mut TestApp, query: &str, limit: u32) -> (Vec<Value>, usize) {
    let mut hits = Vec::new();
    let mut cursor = Value::Null;
    let mut pages = 0;
    loop {
        let p = search(t, query, cursor, Some(limit));
        pages += 1;
        hits.extend(p["hits"].as_array().expect("hits").iter().cloned());
        if p["nextCursor"].is_null() {
            return (hits, pages);
        }
        cursor = p["nextCursor"].clone();
    }
}

fn ids(hits: &[Value]) -> Vec<String> {
    hits.iter()
        .map(|h| h["id"].as_str().expect("id").to_owned())
        .collect()
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── init and info ────────────────────────────────────────────────────────────

/// The harness creates the app with no arguments: an unnamed channel, its
/// owner the creator and only admin.
#[test]
fn init_founds_a_channel_owned_by_its_creator() {
    let mut t = app();
    let info = view(&mut t, "bob", "getInfo", json!({}));
    assert_eq!(info["name"], json!(""));
    assert_eq!(info["contextType"], json!("Channel"));
    assert_eq!(info["creator"], json!("owner"));
    assert_eq!(info["createdAt"], json!(NOW.to_string()));
    assert_eq!(
        view(&mut t, "bob", "getChannelInfo", json!({ "channel": "x" })),
        info
    );
    assert_eq!(names(&t, "bob"), ["Initialized"]);
}

#[test]
fn only_admins_change_the_channels_info() {
    let mut t = app();
    assert_eq!(
        error(t.as_("bob").call(
            "updateInfo",
            json!({ "name": "hijacked", "description": null })
        )),
        (
            "Forbidden".to_owned(),
            "Only an admin can change the channel's info".to_owned()
        )
    );
    assert_eq!(
        call(
            &mut t,
            "owner",
            "updateInfo",
            json!({ "name": "General (updated)", "description": "Main" })
        ),
        json!("Info updated")
    );
    let info = view(&mut t, "bob", "getInfo", json!({}));
    assert_eq!(info["name"], json!("General (updated)"));
    assert_eq!(info["description"], json!("Main"));
    assert_eq!(
        names(&t, "bob").last().map(String::as_str),
        Some("InfoUpdated")
    );

    // A promoted admin may; the limits hold for everyone.
    set_role(&mut t, "owner", "bob", "Admin").unwrap();
    call(
        &mut t,
        "bob",
        "updateInfo",
        json!({ "name": "B", "description": null }),
    );
    assert_eq!(
        view(&mut t, "cy", "getInfo", json!({}))["description"],
        json!("Main")
    );
    assert_eq!(
        code(t.as_("owner").call(
            "updateInfo",
            json!({ "name": "x".repeat(101), "description": null })
        )),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("owner").call(
            "updateInfo",
            json!({ "name": null, "description": "x".repeat(1001) })
        )),
        "Invalid"
    );
}

// ── roles ────────────────────────────────────────────────────────────────────

#[test]
fn creator_is_the_sole_admin() {
    let mut t = app();
    assert_eq!(role(&mut t, "owner"), "Admin");
    assert_eq!(role(&mut t, "bob"), "User");
    assert_eq!(
        view(&mut t, "bob", "listRoles", json!({})),
        json!([["owner", "Admin"]])
    );
}

#[test]
fn non_admin_cannot_grant_admin() {
    let mut t = app();
    for (target, r) in [
        ("cy", "Admin"),
        ("bob", "Admin"),
        ("cy", "Mod"),
        ("cy", "Banned"),
    ] {
        assert_eq!(
            error(set_role(&mut t, "bob", target, r)),
            (
                "Forbidden".to_owned(),
                "You don't have permission to change this member's role".to_owned()
            )
        );
    }
    assert_eq!(role(&mut t, "bob"), "User");
    assert_eq!(role(&mut t, "cy"), "User");
}

#[test]
fn setting_a_role_a_member_already_has_announces_nothing() {
    let mut t = app();
    assert_eq!(
        set_role(&mut t, "owner", "owner", "Admin").unwrap(),
        json!("Role unchanged")
    );
    assert_eq!(names(&t, "bob"), ["Initialized"]);
    assert_eq!(
        set_role(&mut t, "owner", "bob", "Mod").unwrap(),
        json!("Role updated")
    );
    assert_eq!(
        t.events_for("cy").last().cloned(),
        Some(("RoleUpdated".to_owned(), json!({ "account": "bob" })))
    );
}

#[test]
fn an_admin_cannot_demote_themselves() {
    let mut t = app();
    for r in ["User", "Mod", "Banned"] {
        assert_eq!(
            error(set_role(&mut t, "owner", "owner", r)),
            (
                "Forbidden".to_owned(),
                "An admin cannot demote themselves below Admin".to_owned()
            )
        );
    }
    assert_eq!(role(&mut t, "owner"), "Admin");
}

#[test]
fn admin_promotes_mod_then_mod_moderates_within_limits() {
    let mut t = app();
    set_role(&mut t, "owner", "bob", "Mod").unwrap();
    assert_eq!(role(&mut t, "bob"), "Mod");
    // A moderator flips a plain member to Banned and back...
    set_role(&mut t, "bob", "cy", "Banned").unwrap();
    assert_eq!(role(&mut t, "cy"), "Banned");
    set_role(&mut t, "bob", "cy", "User").unwrap();
    assert_eq!(role(&mut t, "cy"), "User");
    // ...and nothing else.
    for (target, r) in [
        ("cy", "Mod"),
        ("cy", "Admin"),
        ("owner", "Banned"),
        ("dee", "Mod"),
    ] {
        assert_eq!(code(set_role(&mut t, "bob", target, r)), "Forbidden");
    }
    set_role(&mut t, "owner", "dee", "Mod").unwrap();
    assert_eq!(code(set_role(&mut t, "bob", "dee", "Banned")), "Forbidden");
}

#[test]
fn admin_demotes_mod_to_user() {
    let mut t = app();
    set_role(&mut t, "owner", "bob", "Mod").unwrap();
    set_role(&mut t, "owner", "bob", "User").unwrap();
    assert_eq!(role(&mut t, "bob"), "User");
    // No grant is left behind: bob cannot ban any more.
    assert_eq!(code(set_role(&mut t, "bob", "cy", "Banned")), "Forbidden");
}

#[test]
fn banning_then_clearing_does_not_leave_stale_grants() {
    let mut t = app();
    set_role(&mut t, "owner", "bob", "Admin").unwrap();
    set_role(&mut t, "owner", "bob", "Banned").unwrap();
    assert_eq!(role(&mut t, "bob"), "Banned");
    set_role(&mut t, "owner", "bob", "User").unwrap();
    assert_eq!(role(&mut t, "bob"), "User");
    assert_eq!(
        view(&mut t, "owner", "listRoles", json!({})),
        json!([["owner", "Admin"]])
    );
    assert_eq!(code(set_role(&mut t, "bob", "cy", "Banned")), "Forbidden");
}

/// v1: a ban flag on an admin (only a patched moderator could write one) must
/// not lock the admins out. Here the only way to ban an admin is an admin doing
/// it, which revokes the admin grant first; and the admin check comes first.
#[test]
fn banning_an_admin_revokes_the_admin_grant() {
    let mut t = app();
    set_role(&mut t, "owner", "bob", "Admin").unwrap();
    set_role(&mut t, "bob", "owner", "Banned").unwrap();
    assert_eq!(role(&mut t, "owner"), "Banned");
    assert_eq!(
        code(
            t.as_("owner")
                .call("sendMessage", send_args("hi", None, NOW))
        ),
        "Banned"
    );
    set_role(&mut t, "bob", "owner", "Admin").unwrap();
    assert_eq!(role(&mut t, "owner"), "Admin");
}

#[test]
fn a_member_who_is_not_staff_cannot_ban() {
    let mut t = app();
    assert_eq!(code(set_role(&mut t, "cy", "bob", "Banned")), "Forbidden");
    assert_eq!(code(set_role(&mut t, "gus", "bob", "Banned")), "Forbidden");
    assert_eq!(role(&mut t, "bob"), "User");
}

#[test]
fn a_banned_member_cannot_unban_themselves() {
    let mut t = app();
    set_role(&mut t, "owner", "bob", "Banned").unwrap();
    assert_eq!(code(set_role(&mut t, "bob", "bob", "User")), "Forbidden");
    assert_eq!(role(&mut t, "bob"), "Banned");
}

#[test]
fn banned_member_is_blocked_from_mutations() {
    let mut t = app();
    let id = send(&mut t, "bob", "before", NOW);
    set_role(&mut t, "owner", "bob", "Banned").unwrap();
    for (method, args) in [
        ("sendMessage", send_args("after", None, NOW)),
        (
            "updateReaction",
            json!({ "messageId": id, "emoji": "👍", "add": true }),
        ),
        (
            "editMessage",
            json!({ "messageId": id, "newMessage": "x", "timestamp": NOW.to_string(), "parentId": null }),
        ),
        (
            "deleteMessage",
            json!({ "messageId": id, "parentId": null }),
        ),
        ("setProfile", json!({ "username": "Bob", "avatar": null })),
        ("saveDraft", json!({ "channel": "general", "text": "x" })),
        ("deleteDraft", json!({ "channel": "general" })),
    ] {
        assert_eq!(
            error(t.as_("bob").call(method, args)),
            (
                "Banned".to_owned(),
                "You are banned from this context".to_owned()
            ),
            "{method}"
        );
    }
    // Reads stay open.
    assert_eq!(texts(&page(&mut t, None, None)), ["before"]);
    view(
        &mut t,
        "bob",
        "getMessages",
        json!({ "parentMessage": null, "limit": null, "offset": null, "searchTerm": null }),
    );
}

// ── profiles ─────────────────────────────────────────────────────────────────

#[test]
fn a_profile_is_its_owners_alone_and_its_name_is_kept() {
    let mut t = app();
    let avatar = "ab".repeat(32);
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "username": "Bob", "avatar": null }),
    );
    call(
        &mut t,
        "cy",
        "setProfile",
        json!({ "username": "Bob", "avatar": null }),
    );
    // A second call keeps the name; only the avatar changes.
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "username": "Robert", "avatar": avatar }),
    );
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "username": "Bobby", "avatar": null }),
    );
    assert_eq!(
        view(&mut t, "owner", "getProfiles", json!({})),
        json!([
            { "identity": "bob", "username": "Bob", "avatar": avatar },
            { "identity": "cy", "username": "Bob", "avatar": null },
        ])
    );
    assert_eq!(
        t.events_for("dee").last().cloned(),
        Some(("ProfileUpdated".to_owned(), json!({ "account": "bob" })))
    );
    for (args, message) in [
        (
            json!({ "username": "  ", "avatar": null }),
            "Username cannot be empty",
        ),
        (
            json!({ "username": "x".repeat(51), "avatar": null }),
            "Username cannot be longer than 50 characters",
        ),
    ] {
        assert_eq!(
            error(t.as_("dee").call("setProfile", args)),
            ("Invalid".to_owned(), message.to_owned())
        );
    }
    assert_eq!(
        code(t.as_("dee").call(
            "setProfile",
            json!({ "username": "Dee", "avatar": "not-a-blob" })
        )),
        "Invalid"
    );
}

// ── drafts ───────────────────────────────────────────────────────────────────

#[test]
fn a_draft_round_trips_for_its_author_only() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "saveDraft",
        json!({ "channel": "general", "text": "half a" }),
    );
    assert_eq!(
        view(&mut t, "bob", "getDraft", json!({ "channel": "general" })),
        json!("half a")
    );
    assert_eq!(
        view(&mut t, "cy", "getDraft", json!({ "channel": "general" })),
        json!("")
    );
    assert_eq!(
        view(&mut t, "bob", "getDraft", json!({ "channel": "random" })),
        json!("")
    );
    // Drafts announce nothing.
    assert_eq!(names(&t, "cy"), ["Initialized"]);
}

#[test]
fn a_deleted_draft_is_gone() {
    let mut t = app();
    for clear in [
        ("deleteDraft", json!({ "channel": "general" })),
        ("saveDraft", json!({ "channel": "general", "text": "" })),
    ] {
        call(
            &mut t,
            "bob",
            "saveDraft",
            json!({ "channel": "general", "text": "x" }),
        );
        call(&mut t, "bob", clear.0, clear.1);
        assert_eq!(
            view(&mut t, "bob", "getDraft", json!({ "channel": "general" })),
            json!("")
        );
    }
}

// ── messages ─────────────────────────────────────────────────────────────────

#[test]
fn a_message_round_trips_with_its_sender_from_the_caller() {
    let mut t = app();
    let sent = call(
        &mut t,
        "bob",
        "sendMessage",
        json!({
            "message": "hi @cy",
            "mentions": ["cy", "cy"],
            "mentionsUsernames": ["cy"],
            "parentMessage": null,
            "timestamp": NOW.to_string(),
            "files": [{ "name": "a.pdf", "mimeType": "application/pdf", "size": 3, "blobIdStr": "0f".repeat(32) }],
            "images": null,
        }),
    );
    assert_eq!(sent["sender"], json!("bob"));
    assert_eq!(sent["index"], json!("0"));
    assert_eq!(sent["timestamp"], json!(NOW.to_string()));
    assert_eq!(sent["mentions"], json!(["cy"]));
    assert_eq!(
        sent["files"],
        json!([{ "name": "a.pdf", "mimeType": "application/pdf", "size": "3", "blobId": "0f".repeat(32), "uploadedAt": common::T0.to_string() }])
    );
    assert_eq!(sent["images"], json!([]));
    assert_eq!(sent["deleted"], Value::Null);
    assert_eq!(sent["editedOn"], Value::Null);
    assert_eq!(sent["threadCount"], json!(0));
    assert_eq!(message_at(&mut t, 0), sent);
    assert_eq!(
        t.events_for("cy").last().cloned(),
        Some(("MessageSent".to_owned(), json!({ "messageId": sent["id"] })))
    );
}

/// v1 hex-encoded the plaintext into the id; ids are random now, with the
/// timestamp suffix kept.
#[test]
fn a_message_id_does_not_contain_the_message() {
    let mut t = app();
    let a = send(&mut t, "bob", "secret plans", NOW);
    let b = send(&mut t, "bob", "secret plans", NOW);
    assert_ne!(a, b, "identical messages still get distinct ids");
    let long = send(&mut t, "bob", &"y".repeat(5_000), NOW);
    for id in [&a, &b, &long] {
        let (head, ts) = id.split_once('_').expect("<hex>_<ts>");
        assert_eq!(head.len(), 32, "{id}");
        assert!(head.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(ts, NOW.to_string());
    }
}

#[test]
fn what_one_write_may_add_is_bounded() {
    let mut t = app();
    let blob = |i: usize| json!({ "name": "f", "mimeType": "x", "size": 1, "blobIdStr": format!("{i:064x}") });
    let eleven: Vec<Value> = (0..11).map(blob).collect();
    let many: Vec<String> = (0..101).map(|i| format!("m{i}")).collect();
    for (args, message) in [
        (
            send_args(&"x".repeat(MAX_MESSAGE_LEN + 1), None, NOW),
            "Message cannot be longer than 20000 bytes".to_owned(),
        ),
        (
            json!({ "message": "m", "mentions": many, "mentionsUsernames": [], "parentMessage": null, "timestamp": NOW.to_string(), "files": null, "images": null }),
            "A message can mention at most 100 members".to_owned(),
        ),
        (
            json!({ "message": "m", "mentions": [], "mentionsUsernames": [], "parentMessage": null, "timestamp": NOW.to_string(), "files": eleven, "images": null }),
            "A message can carry at most 10 files and 10 images".to_owned(),
        ),
        (
            json!({ "message": "m", "mentions": [], "mentionsUsernames": [], "parentMessage": null, "timestamp": NOW.to_string(), "files": null, "images": [{ "name": "f", "mimeType": "x", "size": 1, "blobIdStr": "3vQB7B6MrGQZaxCuFg4oh" }] }),
            "Invalid blob ID: 3vQB7B6MrGQZaxCuFg4oh".to_owned(),
        ),
        (
            send_args("future", None, NOW + 301),
            format!("Timestamp {} is too far in the future", NOW + 301),
        ),
    ] {
        assert_eq!(
            error(t.as_("bob").call("sendMessage", args)),
            ("Invalid".to_owned(), message)
        );
    }
    assert_eq!(
        error(
            t.as_("bob")
                .call("sendMessage", send_args("r", Some("nope_1"), NOW))
        ),
        ("NotFound".to_owned(), "Parent message not found".to_owned())
    );
    assert_eq!(
        view(&mut t, "bob", "getMessageCount", json!({})),
        json!("0")
    );
    // The past is not bounded: clocks run behind as well as ahead.
    send(&mut t, "bob", "old", 1);
    send(&mut t, "bob", "skewed", NOW + 300);
}

#[test]
fn an_index_keeps_naming_the_same_message_as_the_channel_grows() {
    let mut t = app();
    let first = send(&mut t, "bob", "first", NOW);
    for i in 0..5 {
        send(&mut t, "cy", &format!("later {i}"), NOW);
    }
    call(
        &mut t,
        "bob",
        "deleteMessage",
        json!({ "messageId": first, "parentId": null }),
    );
    let m = message_at(&mut t, 0);
    assert_eq!(m["id"], json!(first));
    assert_eq!(m["deleted"], json!(true));
    assert_eq!(m["text"], json!(""));
    assert_eq!(message_at(&mut t, 3)["text"], json!("later 2"));
}

#[test]
fn catching_up_from_the_last_index_returns_exactly_what_was_missed() {
    let mut t = app();
    for i in 0..3 {
        send(&mut t, "bob", &format!("seen {i}"), NOW);
    }
    for i in 0..4 {
        send(&mut t, "cy", &format!("missed {i}"), NOW);
    }
    let caught = view(
        &mut t,
        "bob",
        "getMessagesFrom",
        json!({ "start": "3", "limit": null }),
    );
    assert_eq!(caught["totalCount"], json!(7));
    assert_eq!(caught["startPosition"], json!(3));
    assert_eq!(
        texts(&caught),
        ["missed 0", "missed 1", "missed 2", "missed 3"]
    );
    let two = view(
        &mut t,
        "bob",
        "getMessagesFrom",
        json!({ "start": "3", "limit": 2 }),
    );
    assert_eq!(texts(&two), ["missed 0", "missed 1"]);
    assert_eq!(
        view(&mut t, "bob", "getMessageCount", json!({})),
        json!("7")
    );
}

#[test]
fn a_cursor_past_the_end_returns_nothing_and_the_current_length() {
    let mut t = app();
    send(&mut t, "bob", "only", NOW);
    let past = view(
        &mut t,
        "bob",
        "getMessagesFrom",
        json!({ "start": "9", "limit": 5 }),
    );
    assert_eq!(
        past,
        json!({ "totalCount": 1, "messages": [], "startPosition": 9 })
    );
}

#[test]
fn a_page_counts_back_from_the_newest_message() {
    let mut t = app();
    for i in 0..5 {
        send(&mut t, "bob", &format!("m{i}"), NOW);
    }
    let newest = page(&mut t, Some(2), None);
    assert_eq!(texts(&newest), ["m3", "m4"]);
    assert_eq!(newest["totalCount"], json!(5));
    assert_eq!(newest["startPosition"], json!(0));
    let older = page(&mut t, Some(2), Some(2));
    assert_eq!(texts(&older), ["m1", "m2"]);
    assert_eq!(older["startPosition"], json!(2));
    assert_eq!(older["messages"][0]["index"], json!("1"));
    assert_eq!(texts(&page(&mut t, Some(2), Some(4))), ["m0"]);
    assert_eq!(texts(&page(&mut t, Some(2), Some(5))), Vec::<String>::new());
    assert_eq!(texts(&page(&mut t, None, None)).len(), 5);
}

#[test]
fn an_empty_channel_pages_from_position_zero() {
    let mut t = app();
    assert_eq!(
        page(&mut t, Some(10), Some(3)),
        json!({ "totalCount": 0, "messages": [], "startPosition": 0 })
    );
}

#[test]
fn a_thread_counts_its_replies_and_pages_them() {
    let mut t = app();
    let parent = send(&mut t, "bob", "parent", NOW);
    let r1 = reply(&mut t, "cy", &parent, "r1", NOW + 1);
    reply(&mut t, "bob", &parent, "r2", NOW + 2);
    let top = message_at(&mut t, 0);
    assert_eq!(top["threadCount"], json!(2));
    assert_eq!(top["threadLastTimestamp"], json!((NOW + 2).to_string()));
    let replies = thread(&mut t, &parent);
    assert_eq!(texts(&replies), ["r1", "r2"]);
    assert_eq!(replies["messages"][0]["parentMessageId"], json!(parent));
    assert_eq!(replies["messages"][0]["sender"], json!("cy"));
    assert_eq!(replies["messages"][1]["index"], json!("1"));
    // A reply is not in the channel, and not a parent.
    assert_eq!(
        view(&mut t, "bob", "getMessageCount", json!({})),
        json!("1")
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("sendMessage", send_args("nested", Some(&r1), NOW))
        ),
        "NotFound"
    );
    assert_eq!(
        t.events_for("dee").last().map(|e| e.0.clone()),
        Some("MessageSentThread".to_owned())
    );
}

#[test]
fn only_the_sender_edits_a_message() {
    let mut t = app();
    let id = send(&mut t, "bob", "original", NOW);
    let parent = send(&mut t, "bob", "parent", NOW);
    let r = reply(&mut t, "cy", &parent, "reply", NOW);
    for (who, msg, p) in [
        ("cy", &id, None),
        ("owner", &id, None),
        ("bob", &r, Some(&parent)),
    ] {
        assert_eq!(
            error(t.as_(who).call(
                "editMessage",
                json!({ "messageId": msg, "newMessage": "x", "timestamp": NOW.to_string(), "parentId": p })
            )),
            (
                "Forbidden".to_owned(),
                "You can only edit your own messages".to_owned()
            )
        );
    }
    let edited = call(
        &mut t,
        "bob",
        "editMessage",
        json!({ "messageId": id, "newMessage": "fixed", "timestamp": (NOW + 1).to_string(), "parentId": null }),
    );
    assert_eq!(edited["text"], json!("fixed"));
    assert_eq!(edited["editedOn"], json!((NOW + 1).to_string()));
    assert_eq!(
        t.events_for("dee").last().cloned(),
        Some(("MessageEdited".to_owned(), json!({ "messageId": id })))
    );
    let er = call(
        &mut t,
        "cy",
        "editMessage",
        json!({ "messageId": r, "newMessage": "reply!", "timestamp": NOW.to_string(), "parentId": parent }),
    );
    assert_eq!(er["parentMessageId"], json!(parent));
    assert_eq!(texts(&thread(&mut t, &parent)), ["reply!"]);
    // The wrong slot is not found: a reply without its parent, a message with one.
    for (msg, p) in [
        (&r, None),
        (&id, Some(&parent)),
        (&"nope_1".to_owned(), None),
    ] {
        assert_eq!(
            code(t.as_("bob").call(
                "editMessage",
                json!({ "messageId": msg, "newMessage": "x", "timestamp": NOW.to_string(), "parentId": p })
            )),
            "NotFound"
        );
    }
}

#[test]
fn only_the_sender_or_staff_delete_a_message_and_nobody_else_undeletes_it() {
    let mut t = app();
    let mine = send(&mut t, "bob", "mine", NOW);
    let spam = send(&mut t, "cy", "spam", NOW);
    assert_eq!(
        error(t.as_("dee").call(
            "deleteMessage",
            json!({ "messageId": spam, "parentId": null })
        )),
        (
            "Forbidden".to_owned(),
            "You don't have permission to delete this message".to_owned()
        )
    );
    call(
        &mut t,
        "bob",
        "deleteMessage",
        json!({ "messageId": mine, "parentId": null }),
    );
    call(
        &mut t,
        "owner",
        "deleteMessage",
        json!({ "messageId": spam, "parentId": null }),
    );
    for i in 0..2 {
        let m = message_at(&mut t, i);
        assert_eq!(m["deleted"], json!(true));
        assert_eq!(m["text"], json!(""));
        assert_eq!(m["reactions"], Value::Null);
    }
    // The sender's edit does not bring back a message the staff removed.
    call(
        &mut t,
        "cy",
        "editMessage",
        json!({ "messageId": spam, "newMessage": "back", "timestamp": NOW.to_string(), "parentId": null }),
    );
    assert_eq!(message_at(&mut t, 1)["text"], json!(""));
    assert_eq!(
        t.events_for("dee").last().cloned(),
        Some(("MessageEdited".to_owned(), json!({ "messageId": spam })))
    );
}

#[test]
fn a_moderator_removes_a_thread_reply_and_a_member_cannot() {
    let mut t = app();
    set_role(&mut t, "owner", "dee", "Mod").unwrap();
    let parent = send(&mut t, "bob", "parent", NOW);
    let a = reply(&mut t, "cy", &parent, "a", NOW + 1);
    let b = reply(&mut t, "cy", &parent, "b", NOW + 2);
    let own = reply(&mut t, "bob", &parent, "own", NOW + 3);
    assert_eq!(
        code(t.as_("bob").call(
            "deleteMessage",
            json!({ "messageId": a, "parentId": parent })
        )),
        "Forbidden"
    );
    call(
        &mut t,
        "dee",
        "deleteMessage",
        json!({ "messageId": b, "parentId": parent }),
    );
    call(
        &mut t,
        "bob",
        "deleteMessage",
        json!({ "messageId": own, "parentId": parent }),
    );
    let replies = thread(&mut t, &parent);
    assert_eq!(texts(&replies), ["a", ""], "removed outright vs blanked");
    assert_eq!(replies["messages"][1]["deleted"], json!(true));
    let top = message_at(&mut t, 0);
    assert_eq!(top["threadCount"], json!(2));
    assert_eq!(top["threadLastTimestamp"], json!((NOW + 3).to_string()));
    // A removed reply is gone: not found again, and cannot be reacted to.
    assert_eq!(
        code(t.as_("dee").call(
            "deleteMessage",
            json!({ "messageId": b, "parentId": parent })
        )),
        "NotFound"
    );
    assert_eq!(
        code(t.as_("cy").call(
            "updateReaction",
            json!({ "messageId": b, "emoji": "👍", "add": true })
        )),
        "NotFound"
    );
    assert_eq!(
        t.events_for("cy").last().cloned(),
        Some(("MessageSentThread".to_owned(), json!({ "messageId": own })))
    );
}

// ── reactions ────────────────────────────────────────────────────────────────

#[test]
fn a_reaction_records_the_caller_account() {
    let mut t = app();
    let id = send(&mut t, "owner", "hi", NOW);
    assert_eq!(
        call(
            &mut t,
            "bob",
            "updateReaction",
            json!({ "messageId": id, "emoji": "👍", "add": true })
        ),
        json!("Reaction added successfully")
    );
    // Twice is still once.
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    call(
        &mut t,
        "cy",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    assert_eq!(
        message_at(&mut t, 0)["reactions"],
        json!({ "👍": ["bob", "cy"] })
    );
    assert_eq!(
        t.events_for("dee").last().cloned(),
        Some(("ReactionUpdated".to_owned(), json!({ "messageId": id })))
    );
}

/// v1 keyed reactions by display name, so two members called "Bob" shared one;
/// they are keyed by account.
#[test]
fn same_named_members_do_not_share_a_reaction() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "username": "Bob", "avatar": null }),
    );
    call(
        &mut t,
        "cy",
        "setProfile",
        json!({ "username": "Bob", "avatar": null }),
    );
    let id = send(&mut t, "owner", "hi", NOW);
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "🎉", "add": true }),
    );
    call(
        &mut t,
        "cy",
        "updateReaction",
        json!({ "messageId": id, "emoji": "🎉", "add": true }),
    );
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "🎉", "add": false }),
    );
    assert_eq!(message_at(&mut t, 0)["reactions"], json!({ "🎉": ["cy"] }));
}

/// v1: a forged removal of someone else's reaction. A removal only ever names
/// the caller's own.
#[test]
fn a_reaction_is_its_reactors_alone() {
    let mut t = app();
    let id = send(&mut t, "owner", "hi", NOW);
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    assert_eq!(
        call(
            &mut t,
            "cy",
            "updateReaction",
            json!({ "messageId": id, "emoji": "👍", "add": false })
        ),
        json!("Reaction removed successfully")
    );
    assert_eq!(message_at(&mut t, 0)["reactions"], json!({ "👍": ["bob"] }));
}

#[test]
fn removing_the_last_reaction_of_a_kind_removes_the_kind() {
    let mut t = app();
    let id = send(&mut t, "owner", "hi", NOW);
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "❤️", "add": true }),
    );
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": false }),
    );
    assert_eq!(message_at(&mut t, 0)["reactions"], json!({ "❤️": ["bob"] }));
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": id, "emoji": "❤️", "add": false }),
    );
    assert_eq!(message_at(&mut t, 0)["reactions"], Value::Null);
}

#[test]
fn a_bad_emoji_or_unknown_message_is_refused() {
    let mut t = app();
    let id = send(&mut t, "owner", "hi", NOW);
    for emoji in [String::new(), "x".repeat(65), "a\u{1f}b".to_owned()] {
        assert_eq!(
            error(t.as_("bob").call(
                "updateReaction",
                json!({ "messageId": id, "emoji": emoji, "add": true })
            )),
            ("Invalid".to_owned(), "Invalid emoji".to_owned())
        );
    }
    assert_eq!(
        error(t.as_("bob").call(
            "updateReaction",
            json!({ "messageId": "nope_1", "emoji": "👍", "add": true })
        )),
        ("NotFound".to_owned(), "Message not found".to_owned())
    );
}

// ── read state ───────────────────────────────────────────────────────────────

#[test]
fn a_read_receipt_is_per_account() {
    let mut t = app();
    send(&mut t, "owner", "one", NOW - 10);
    send(&mut t, "owner", "hey @everyone", NOW - 5);
    call(
        &mut t,
        "owner",
        "sendMessage",
        json!({ "message": "hi bob", "mentions": ["bob"], "mentionsUsernames": [], "parentMessage": null, "timestamp": (NOW - 4).to_string(), "files": null, "images": null }),
    );
    call(
        &mut t,
        "owner",
        "sendMessage",
        json!({ "message": "hey all", "mentions": [], "mentionsUsernames": ["everyone"], "parentMessage": null, "timestamp": (NOW - 3).to_string(), "files": null, "images": null }),
    );
    send(&mut t, "bob", "my own", NOW - 2);
    assert_eq!(view(&mut t, "bob", "getUnreadCount", json!({})), json!(4));
    assert_eq!(
        view(&mut t, "bob", "getUnreadMentions", json!({})),
        json!(2)
    );
    assert_eq!(
        call(
            &mut t,
            "bob",
            "markAsRead",
            json!({ "timestamp": (NOW - 4).to_string() })
        ),
        json!("ok")
    );
    assert_eq!(view(&mut t, "bob", "getUnreadCount", json!({})), json!(1));
    assert_eq!(
        view(&mut t, "bob", "getUnreadMentions", json!({})),
        json!(1)
    );
    // Cy's are untouched; the owner's own messages never count for them.
    assert_eq!(view(&mut t, "cy", "getUnreadCount", json!({})), json!(5));
    assert_eq!(view(&mut t, "owner", "getUnreadCount", json!({})), json!(1));
    // Marking read announces nothing; the legacy no-op answers "ok".
    assert_eq!(
        names(&t, "cy").last().map(String::as_str),
        Some("MessageSent")
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "markMessagesAsRead",
            json!({ "channel": null, "timestamp": null })
        ),
        json!("ok")
    );
}

#[test]
fn a_deleted_message_is_not_unread() {
    let mut t = app();
    let id = send(&mut t, "owner", "oops", NOW);
    assert_eq!(view(&mut t, "bob", "getUnreadCount", json!({})), json!(1));
    call(
        &mut t,
        "owner",
        "deleteMessage",
        json!({ "messageId": id, "parentId": null }),
    );
    assert_eq!(view(&mut t, "bob", "getUnreadCount", json!({})), json!(0));
}

// ── search ───────────────────────────────────────────────────────────────────

#[test]
fn an_oversized_search_term_is_refused() {
    let mut t = app();
    let long = "x".repeat(257);
    for method in ["searchMessages", "searchMessagesScan"] {
        assert_eq!(
            error(t.as_("bob").view(
                method,
                json!({ "query": long, "cursor": null, "limit": null })
            )),
            (
                "Invalid".to_owned(),
                "Search term too long: 257 characters, limit is 256".to_owned()
            )
        );
    }
    assert_eq!(
        code(t.as_("bob").view(
            "getMessages",
            json!({ "parentMessage": null, "limit": null, "offset": null, "searchTerm": long })
        )),
        "Invalid"
    );
}

#[test]
fn a_normal_search_term_still_works() {
    let mut t = app();
    send(&mut t, "bob", "hello world", NOW);
    send(&mut t, "bob", "other", NOW);
    let found = view(
        &mut t,
        "bob",
        "getMessages",
        json!({ "parentMessage": null, "limit": 10, "offset": 0, "searchTerm": "WORLD" }),
    );
    assert_eq!(found["totalCount"], json!(1));
    assert_eq!(texts(&found), ["hello world"]);
    assert_eq!(found["messages"][0]["index"], json!("0"));
    let x = "x".repeat(256);
    view(
        &mut t,
        "bob",
        "searchMessages",
        json!({ "query": x, "cursor": null, "limit": null }),
    );
}

#[test]
fn a_hit_is_opened_at_the_position_message_position_names() {
    let mut t = app();
    send(&mut t, "bob", "first", NOW);
    let id = send(&mut t, "bob", "the needle", NOW);
    let parent = send(&mut t, "bob", "parent", NOW);
    let r = reply(&mut t, "cy", &parent, "reply", NOW);
    let hit = &view(
        &mut t,
        "cy",
        "searchMessages",
        json!({ "query": "needle", "cursor": null, "limit": null }),
    )["hits"][0];
    assert_eq!(hit["id"], json!(id));
    assert_eq!(hit["index"], json!("1"));
    assert_eq!(
        view(&mut t, "cy", "messagePosition", json!({ "messageId": id })),
        json!("1")
    );
    for none in [r, "nope_1".to_owned()] {
        assert_eq!(
            view(
                &mut t,
                "cy",
                "messagePosition",
                json!({ "messageId": none })
            ),
            Value::Null
        );
    }
}

#[test]
fn search_is_newest_first_and_lists_a_reply_with_its_thread() {
    let mut t = app();
    let first = send(&mut t, "bob", "needle one", 1);
    let quiet = send(&mut t, "bob", "nothing here", 2);
    let last = send(&mut t, "cy", "needle three", 3);
    let late = reply(&mut t, "cy", &quiet, "a needle in the thread", 4);
    let own = reply(&mut t, "bob", &last, "needle again", 5);

    let p = search(&mut t, "NEEDLE", Value::Null, None);
    let hits = p["hits"].as_array().unwrap().clone();
    assert_eq!(ids(&hits), [last.clone(), own, late, first]);
    assert!(p["nextCursor"].is_null(), "the whole channel fits one page");
    assert_eq!(p["frontierTimestamp"], json!("1"));
    let r = &hits[2];
    assert_eq!(r["parentMessageId"], json!(quiet));
    assert_eq!(
        r["index"],
        json!("1"),
        "a reply carries its parent's position"
    );
    assert_eq!(
        (&r["timestamp"], &r["anchorTimestamp"]),
        (&json!("4"), &json!("2"))
    );
    assert_eq!(r["sender"], json!("cy"));
    assert_eq!(hits[0]["sender"], json!("cy"));
    assert_eq!(hits[3]["sender"], json!("bob"));
    assert_eq!(hits[3]["parentMessageId"], Value::Null);
    // `searchMessages` answers the same walk.
    assert_eq!(
        view(
            &mut t,
            "owner",
            "searchMessages",
            json!({ "query": "NEEDLE", "cursor": null, "limit": null })
        ),
        p
    );
}

#[test]
fn search_pages_by_cursor_without_gaps_or_repeats() {
    let mut t = app();
    for i in 0..12u64 {
        let id = send(&mut t, "bob", &format!("needle {i}"), 10 + i);
        if i % 4 == 0 {
            for r in 0..5u64 {
                reply(
                    &mut t,
                    "cy",
                    &id,
                    &format!("needle reply {i}.{r}"),
                    100 + i * 10 + r,
                );
            }
        }
    }
    let whole = search(&mut t, "needle", Value::Null, Some(50));
    let whole_ids = ids(whole["hits"].as_array().unwrap());
    assert_eq!(whole_ids.len(), 12 + 3 * 5);
    assert!(whole["nextCursor"].is_null());
    for limit in [1, 2, 3, 7] {
        let (paged, pages) = search_all(&mut t, "needle", limit);
        assert_eq!(ids(&paged), whole_ids, "paging by {limit}");
        assert!(pages >= whole_ids.len().div_ceil(limit as usize));
    }
    let first = search(&mut t, "needle", Value::Null, Some(3));
    send(&mut t, "bob", "needle late", 999);
    let next = search(&mut t, "needle", first["nextCursor"].clone(), Some(3));
    assert_eq!(next["hits"][0]["id"], json!(whole_ids[3]));
}

#[test]
fn deleted_and_removed_messages_are_not_found() {
    let mut t = app();
    set_role(&mut t, "owner", "dee", "Mod").unwrap();
    let own = send(&mut t, "bob", "needle mine", 1);
    let spam = send(&mut t, "cy", "needle spam", 2);
    let parent = send(&mut t, "bob", "parent", 3);
    let removed = reply(&mut t, "cy", &parent, "needle removed reply", 4);
    let withdrawn = reply(&mut t, "bob", &parent, "needle withdrawn reply", 5);
    let kept = send(&mut t, "bob", "needle kept", 6);
    call(
        &mut t,
        "bob",
        "deleteMessage",
        json!({ "messageId": own, "parentId": null }),
    );
    call(
        &mut t,
        "owner",
        "deleteMessage",
        json!({ "messageId": spam, "parentId": null }),
    );
    call(
        &mut t,
        "dee",
        "deleteMessage",
        json!({ "messageId": removed, "parentId": parent }),
    );
    call(
        &mut t,
        "bob",
        "deleteMessage",
        json!({ "messageId": withdrawn, "parentId": parent }),
    );
    let (hits, _) = search_all(&mut t, "needle", 50);
    assert_eq!(ids(&hits), [kept]);
    let p = view(
        &mut t,
        "bob",
        "getMessages",
        json!({ "parentMessage": null, "limit": null, "offset": null, "searchTerm": "spam" }),
    );
    assert_eq!(p["totalCount"], json!(0));
}

#[test]
fn search_reads_text_as_it_is_shown() {
    let mut t = app();
    send(
        &mut t,
        "bob",
        "<p>Meet at the <strong>Caf\u{e9}</strong> &amp; bring the \u{fb01}les</p>",
        1,
    );
    let found = search(&mut t, "cafe", Value::Null, None);
    let hit = &found["hits"][0];
    let snippet = hit["snippet"].as_str().unwrap();
    assert_eq!(snippet, "Meet at the Caf\u{e9} & bring the \u{fb01}les");
    let units: Vec<u16> = snippet.encode_utf16().collect();
    let (s, e) = (
        hit["matchStart"].as_u64().unwrap() as usize,
        hit["matchEnd"].as_u64().unwrap() as usize,
    );
    assert_eq!(String::from_utf16(&units[s..e]).unwrap(), "Caf\u{e9}");
    for query in ["files", "  CAFÉ  ", "the caf"] {
        assert_eq!(
            search(&mut t, query, Value::Null, None)["hits"]
                .as_array()
                .unwrap()
                .len(),
            1,
            "{query:?}"
        );
    }
    for query in ["strong", "<p>", "amp"] {
        assert!(
            search(&mut t, query, Value::Null, None)["hits"]
                .as_array()
                .unwrap()
                .is_empty(),
            "{query:?}"
        );
    }
}

#[test]
fn an_empty_query_finds_nothing_and_a_bad_cursor_is_refused() {
    let mut t = app();
    send(&mut t, "bob", "hello", 1);
    let empty = search(&mut t, "   ", Value::Null, None);
    assert_eq!(empty["hits"], json!([]));
    assert!(empty["nextCursor"].is_null());
    for cursor in ["nope", "5", "-1", "0:bad"] {
        let result = t.as_("owner").view(
            "searchMessagesScan",
            json!({ "query": "hello", "cursor": cursor, "limit": null }),
        );
        assert_eq!(
            error(result),
            ("Invalid".to_owned(), "Invalid search cursor".to_owned()),
            "{cursor:?}"
        );
    }
    assert_eq!(
        search(&mut t, "hello", Value::Null, Some(0))["hits"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

/// However long the channel, one call reads at most `MAX_SEARCH_BYTES` of text,
/// then hands back a cursor.
#[test]
fn one_call_reads_a_bounded_slice_of_a_big_channel() {
    let mut t = app();
    send(&mut t, "bob", "the needle is in the oldest message", 1);
    let filler = "x".repeat(MAX_MESSAGE_LEN);
    let n = 3 * MAX_SEARCH_BYTES / MAX_MESSAGE_LEN;
    for i in 0..n {
        send(&mut t, "bob", &filler, 2 + i as u64);
    }
    let per_call = MAX_SEARCH_BYTES.div_ceil(MAX_MESSAGE_LEN);
    let first = search(&mut t, "needle", Value::Null, None);
    assert_eq!(first["hits"], json!([]));
    let cursor: usize = first["nextCursor"].as_str().unwrap().parse().unwrap();
    let read = n - cursor;
    assert!(
        read <= per_call + 1,
        "one call read {read}, the cap allows {per_call}"
    );
    let (hits, pages) = search_all(&mut t, "needle", 20);
    assert_eq!(hits.len(), 1);
    assert!(pages >= 3, "the walk took {pages} pages");
}

// ── access and wire ──────────────────────────────────────────────────────────

/// Every read is a view.
#[test]
fn every_read_is_callable_as_a_view() {
    let mut t = app();
    let id = send(&mut t, "bob", "hello", NOW);
    for (method, args) in [
        ("getInfo", json!({})),
        ("getChannelInfo", json!({ "channel": null })),
        (
            "markMessagesAsRead",
            json!({ "channel": null, "timestamp": null }),
        ),
        ("getUnreadCount", json!({})),
        ("getUnreadMentions", json!({})),
        ("getProfiles", json!({})),
        ("getDraft", json!({ "channel": "general" })),
        ("getMemberRole", json!({ "identity": "bob" })),
        ("listRoles", json!({})),
        (
            "getMessages",
            json!({ "parentMessage": id, "limit": null, "offset": null, "searchTerm": null }),
        ),
        ("getMessagesFrom", json!({ "start": "0", "limit": null })),
        ("getMessageCount", json!({})),
        (
            "searchMessages",
            json!({ "query": "hello", "cursor": null, "limit": null }),
        ),
        (
            "searchMessagesScan",
            json!({ "query": "hello", "cursor": null, "limit": null }),
        ),
        ("messagePosition", json!({ "messageId": id })),
    ] {
        view(&mut t, "gus", method, args);
    }
}

/// A guest reaches the conversation like any member; an outsider and an
/// anonymous caller are refused by the platform before the app runs.
#[test]
fn guests_take_part_and_outsiders_are_refused() {
    let mut t = app();
    let id = send(&mut t, "gus", "from a guest", NOW);
    call(
        &mut t,
        "gus",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    assert_eq!(message_at(&mut t, 0)["sender"], json!("gus"));
    for (method, args) in [
        ("getInfo", json!({})),
        ("getMessagesFrom", json!({ "start": "0", "limit": null })),
    ] {
        assert_eq!(
            t.anonymous().view(method, args.clone()),
            Err(Failure::Refused {
                status: 401,
                code: "UNAUTHENTICATED".to_owned()
            })
        );
        assert_eq!(
            t.as_("mallory").view(method, args),
            Err(Failure::Refused {
                status: 404,
                code: "NOT_FOUND".to_owned()
            })
        );
    }
    assert_eq!(
        t.as_("mallory")
            .call("sendMessage", send_args("x", None, NOW)),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(
        t.anonymous().call("sendMessage", send_args("x", None, NOW)),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        view(&mut t, "owner", "getMessageCount", json!({})),
        json!("1")
    );
}

#[test]
fn a_removed_member_is_refused() {
    let mut t = app();
    let id = send(&mut t, "bob", "before", NOW);
    t.remove_member("bob");
    for result in [
        t.as_("bob")
            .call("sendMessage", send_args("after", None, NOW)),
        t.as_("bob").call(
            "deleteMessage",
            json!({ "messageId": id, "parentId": null }),
        ),
        t.as_("bob").view("getInfo", json!({})),
    ] {
        assert_eq!(
            result,
            Err(Failure::Refused {
                status: 404,
                code: "NOT_FOUND".to_owned()
            })
        );
    }
    assert_eq!(message_at(&mut t, 0)["sender"], json!("bob"));
}

#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = app();
    for args in [
        json!({ "message": "m" }),
        json!({ "message": "m", "mentions": [], "mentionsUsernames": [], "parentMessage": null, "timestamp": NOW.to_string(), "files": null, "images": null, "extra": 1 }),
        // u64 travels as a decimal string.
        json!({ "message": "m", "mentions": [], "mentionsUsernames": [], "parentMessage": null, "timestamp": NOW, "files": null, "images": null }),
        // v1's snake_case argument names.
        json!({ "message": "m", "mentions": [], "mentions_usernames": [], "parent_message": null, "timestamp": NOW.to_string() }),
    ] {
        assert_eq!(
            code(t.as_("bob").call("sendMessage", args.clone())),
            "BadArgs",
            "{args}"
        );
    }
    assert_eq!(
        code(
            t.as_("owner")
                .call("setMemberRole", json!({ "target": "bob", "role": "Owner" }))
        ),
        "BadArgs"
    );
    assert_eq!(
        view(&mut t, "owner", "getMessageCount", json!({})),
        json!("0")
    );
    assert_eq!(names(&t, "bob"), ["Initialized"]);
}

#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = app();
    assert_eq!(
        code(t.as_("bob").call("send_message", send_args("m", None, NOW))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_("bob").view("sendMessage", send_args("m", None, NOW))),
        "NotAView"
    );
    assert_eq!(
        code(t.as_("bob").view("markAsRead", json!({ "timestamp": "1" }))),
        "NotAView"
    );
    t.as_("bob")
        .call("getInfo", json!({}))
        .expect("a view as a call");
}
