//! Mero Chat on core's real wasmtime engine (`TestApp`): every method, v1's
//! `TestHost` tests method for method, the storage-level write rules v1 relied
//! on (`Authored*`, `Moderated`, `SharedStorage`, `UserStorage`,
//! `AccessControl`) as the same calls made by an account the method refuses,
//! and the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The harness clock at init (`common::T0`), in seconds: client timestamps
/// are seconds and may not run more than 300 s ahead of it.
const NOW: u64 = common::T0 / 1_000;

/// The owner (the creator, so the first admin), members `bob`, `carol` and
/// `dave`, and a guest `gus`.
fn app() -> TestApp {
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
fn code(result: Result<Value, Failure>) -> String {
    match result {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn send_at(t: &mut TestApp, who: &str, text: &str, ts: u64) -> String {
    let m = call(
        t,
        who,
        "sendMessage",
        json!({ "message": text, "mentions": [], "mentionsUsernames": [], "timestamp": ts.to_string() }),
    );
    m["id"].as_str().expect("an id").to_owned()
}

fn send(t: &mut TestApp, who: &str, text: &str) -> String {
    send_at(t, who, text, NOW)
}

fn reply_at(t: &mut TestApp, who: &str, parent: &str, text: &str, ts: u64) -> String {
    let m = call(
        t,
        who,
        "sendMessage",
        json!({
            "message": text, "mentions": [], "mentionsUsernames": [],
            "parentMessage": parent, "timestamp": ts.to_string()
        }),
    );
    assert_eq!(m["parentMessageId"], json!(parent));
    m["id"].as_str().expect("an id").to_owned()
}

fn messages(t: &mut TestApp, who: &str, args: Value) -> Value {
    view(t, who, "getMessages", args)
}

fn texts(page: &Value) -> Vec<String> {
    page["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .map(|m| m["text"].as_str().expect("text").to_owned())
        .collect()
}

fn role(t: &mut TestApp, who: &str) -> Value {
    view(t, "owner", "getMemberRole", json!({ "identity": who }))
}

fn set_role(t: &mut TestApp, actor: &str, target: &str, role: &str) -> Result<Value, Failure> {
    t.as_(actor)
        .call("setMemberRole", json!({ "target": target, "role": role }))
}

fn event_names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── init and info ────────────────────────────────────────────────────────────

/// Created without `initArgs` (as the harness and a bare `createApp` do): a
/// nameless channel whose creator is the owner and its only admin.
#[test]
fn a_new_conversation_is_a_channel_of_its_creator() {
    let mut t = app();
    let info = view(&mut t, "bob", "getInfo", json!({}));
    assert_eq!(
        info,
        json!({
            "name": "", "contextType": "Channel", "description": "",
            "createdAt": NOW.to_string(), "creator": "owner"
        })
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "getChannelInfo",
            json!({ "channel": "general" })
        ),
        info
    );
    assert_eq!(view(&mut t, "bob", "getChannelInfo", json!({})), info);
    assert_eq!(role(&mut t, "owner"), json!("Admin"));
    assert_eq!(role(&mut t, "bob"), json!("User"));
    assert_eq!(
        view(&mut t, "bob", "listRoles", json!({})),
        json!({ "items": [{ "identity": "owner", "role": "Admin" }], "next": null })
    );
}

#[test]
fn only_admins_change_the_channels_info() {
    let mut t = app();
    assert_eq!(
        code(
            t.as_("bob")
                .call("updateInfo", json!({ "name": "hijacked" }))
        ),
        "Forbidden"
    );
    assert_eq!(
        call(
            &mut t,
            "owner",
            "updateInfo",
            json!({ "name": "General", "description": "all hands" })
        ),
        json!("Info updated")
    );
    // `null` leaves a field as it is.
    call(
        &mut t,
        "owner",
        "updateInfo",
        json!({ "name": "General (updated)" }),
    );
    let info = view(&mut t, "bob", "getInfo", json!({}));
    assert_eq!(info["name"], json!("General (updated)"));
    assert_eq!(info["description"], json!("all hands"));
    assert_eq!(
        event_names(&t, "bob"),
        ["Initialized", "InfoUpdated", "InfoUpdated"]
    );
    // A promoted admin may too.
    set_role(&mut t, "owner", "bob", "Admin").expect("promote");
    call(
        &mut t,
        "bob",
        "updateInfo",
        json!({ "description": "by bob" }),
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("updateInfo", json!({ "name": "x".repeat(101) }))
        ),
        "Invalid"
    );
}

// ── messages ─────────────────────────────────────────────────────────────────

#[test]
fn a_sent_message_comes_back_whole() {
    let mut t = app();
    let m = call(
        &mut t,
        "bob",
        "sendMessage",
        json!({
            "message": "<p>hi <b>@carol</b></p>",
            "mentions": ["carol"], "mentionsUsernames": ["Carol"],
            "timestamp": NOW.to_string()
        }),
    );
    let id = m["id"].as_str().expect("id").to_owned();
    assert_eq!(
        m,
        json!({
            "index": "0", "timestamp": NOW.to_string(), "sender": "bob",
            "mentions": ["carol"], "mentionsUsernames": ["Carol"],
            "files": [], "images": [], "id": id, "text": "<p>hi <b>@carol</b></p>",
            "editedOn": null, "reactions": null, "deleted": null,
            "threadCount": 0, "threadLastTimestamp": "0", "parentMessageId": null
        })
    );
    assert_eq!(
        t.events_for("carol").last(),
        Some(&("MessageSent".to_owned(), json!({ "messageId": id })))
    );
    let page = messages(&mut t, "carol", json!({}));
    assert_eq!(page["totalCount"], json!(1));
    assert_eq!(page["startPosition"], json!(0));
    assert_eq!(page["messages"][0], m);
    assert_eq!(
        view(&mut t, "carol", "getMessageCount", json!({})),
        json!("1")
    );
}

/// A message id is 64 hex characters, `_`, the timestamp: a random digest,
/// never the text, the same length however long the message, distinct for
/// identical messages.
#[test]
fn a_message_id_does_not_contain_the_message() {
    let mut t = app();
    let long = "secret ".repeat(500);
    let a = send(&mut t, "bob", &long);
    let b = send(&mut t, "bob", "same");
    let c = send(&mut t, "bob", "same");
    for id in [&a, &b, &c] {
        let (hex, ts) = id.split_once('_').expect("hex_ts");
        assert_eq!(hex.len(), 64);
        assert!(hex.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(ts, NOW.to_string());
        assert!(!id.contains("secret"));
    }
    assert_ne!(b, c);
}

#[test]
fn what_one_write_may_add_is_bounded() {
    let mut t = app();
    let base = |extra: Value| {
        let mut args = json!({ "message": "x", "mentions": [], "mentionsUsernames": [], "timestamp": NOW.to_string() });
        for (k, v) in extra.as_object().expect("object") {
            args[k] = v.clone();
        }
        args
    };
    let too_many: Vec<String> = (0..101).map(|i| format!("m{i}")).collect();
    for args in [
        base(json!({ "message": "x".repeat(20_001) })),
        base(json!({ "mentions": too_many })),
        base(json!({ "mentionsUsernames": too_many })),
        base(json!({ "timestamp": (NOW + 301).to_string() })),
        base(json!({ "parentMessage": "nope" })),
    ] {
        let c = code(t.as_("bob").call("sendMessage", args.clone()));
        assert!(c == "Invalid" || c == "NotFound", "{args}: {c}");
    }
    // A clock behind is fine: only the future is bounded.
    send_at(&mut t, "bob", "late", NOW - 86_400);
    send_at(&mut t, "bob", "edge", NOW + 300);
    assert_eq!(
        view(&mut t, "bob", "getMessageCount", json!({})),
        json!("2")
    );
}

/// Positions never move: a stored index names the same message however much
/// is sent after it, and a client resumes from it exactly.
#[test]
fn catching_up_from_the_last_index_returns_exactly_what_was_missed() {
    let mut t = app();
    for i in 0..5 {
        send(&mut t, "bob", &format!("m{i}"));
    }
    let first = view(
        &mut t,
        "carol",
        "getMessagesFrom",
        json!({ "start": "0", "limit": 3 }),
    );
    assert_eq!(texts(&first), ["m0", "m1", "m2"]);
    assert_eq!(first["totalCount"], json!(5));
    assert_eq!(first["messages"][2]["index"], json!("2"));
    for i in 5..8 {
        send(&mut t, "dave", &format!("m{i}"));
    }
    let rest = view(&mut t, "carol", "getMessagesFrom", json!({ "start": "3" }));
    assert_eq!(texts(&rest), ["m3", "m4", "m5", "m6", "m7"]);
    assert_eq!(rest["startPosition"], json!(3));
    assert_eq!(rest["messages"][0]["index"], json!("3"));
    // Past the end: nothing, and the current length.
    let past = view(&mut t, "carol", "getMessagesFrom", json!({ "start": "99" }));
    assert_eq!(
        past,
        json!({ "totalCount": 8, "messages": [], "startPosition": 99 })
    );
}

#[test]
fn a_page_counts_back_from_the_newest_message() {
    let mut t = app();
    let empty = messages(&mut t, "bob", json!({ "limit": 2 }));
    assert_eq!(
        empty,
        json!({ "totalCount": 0, "messages": [], "startPosition": 0 })
    );
    for i in 0..5 {
        send(&mut t, "bob", &format!("m{i}"));
    }
    let newest = messages(&mut t, "bob", json!({ "limit": 2 }));
    assert_eq!(texts(&newest), ["m3", "m4"]);
    assert_eq!(newest["startPosition"], json!(0));
    let older = messages(&mut t, "bob", json!({ "limit": 2, "offset": 2 }));
    assert_eq!(texts(&older), ["m1", "m2"]);
    assert_eq!(older["startPosition"], json!(2));
    let oldest = messages(&mut t, "bob", json!({ "limit": 2, "offset": 4 }));
    assert_eq!(texts(&oldest), ["m0"]);
    let beyond = messages(&mut t, "bob", json!({ "limit": 2, "offset": 9 }));
    assert_eq!(beyond["messages"], json!([]));
    assert_eq!(beyond["startPosition"], json!(9));
    assert_eq!(texts(&messages(&mut t, "bob", json!({}))).len(), 5);
}

/// A page holds at most 500 messages, 100 when the caller names no limit.
#[test]
fn a_page_is_bounded() {
    let mut t = app();
    for i in 0..120 {
        send(&mut t, "bob", &format!("m{i}"));
    }
    let default = messages(&mut t, "bob", json!({}));
    assert_eq!(default["messages"].as_array().map(Vec::len), Some(100));
    assert_eq!(default["totalCount"], json!(120));
    assert_eq!(default["messages"][0]["text"], json!("m20"));
    let asked = messages(&mut t, "bob", json!({ "limit": 100_000 }));
    assert_eq!(asked["messages"].as_array().map(Vec::len), Some(120));
    let from = view(&mut t, "bob", "getMessagesFrom", json!({ "start": "0" }));
    assert_eq!(from["messages"].as_array().map(Vec::len), Some(100));
}

#[test]
fn a_thread_is_read_with_its_parent_and_on_its_own() {
    let mut t = app();
    let parent = send(&mut t, "bob", "question");
    reply_at(&mut t, "carol", &parent, "a1", NOW + 1);
    let last = reply_at(&mut t, "dave", &parent, "a2", NOW + 2);
    let top = messages(&mut t, "bob", json!({}));
    assert_eq!(top["totalCount"], json!(1), "replies are not top-level");
    assert_eq!(top["messages"][0]["threadCount"], json!(2));
    assert_eq!(
        top["messages"][0]["threadLastTimestamp"],
        json!((NOW + 2).to_string())
    );
    let thread = messages(&mut t, "bob", json!({ "parentMessage": parent }));
    assert_eq!(texts(&thread), ["a1", "a2"]);
    assert_eq!(thread["totalCount"], json!(2));
    assert_eq!(thread["messages"][1]["index"], json!("1"));
    assert_eq!(thread["messages"][1]["parentMessageId"], json!(parent));
    assert_eq!(thread["messages"][1]["sender"], json!("dave"));
    assert_eq!(
        t.events_for("bob").last(),
        Some(&(
            "MessageSentThread".to_owned(),
            json!({ "messageId": last, "parentMessageId": parent })
        ))
    );
    // A reply to a reply is refused: threads are one level, as in v1.
    let c = code(t.as_("bob").call(
        "sendMessage",
        json!({ "message": "x", "mentions": [], "mentionsUsernames": [], "parentMessage": last, "timestamp": NOW.to_string() }),
    ));
    assert_eq!(c, "NotFound");
}

/// The sender is the caller: nobody sends in another's name (v1 read it
/// from the entry's owner stamp, because a patched node could write any
/// `sender`; there is no field to forge here).
#[test]
fn a_messages_sender_is_its_caller() {
    let mut t = app();
    let m = call(
        &mut t,
        "carol",
        "sendMessage",
        json!({ "message": "me", "mentions": [], "mentionsUsernames": [], "timestamp": NOW.to_string() }),
    );
    assert_eq!(m["sender"], json!("carol"));
    assert!(matches!(
        t.as_("carol").call(
            "sendMessage",
            json!({ "message": "x", "mentions": [], "mentionsUsernames": [], "timestamp": NOW.to_string(), "sender": "bob" })
        ),
        Err(Failure::App { ref code, .. }) if code == "BadArgs"
    ));
}

#[test]
fn only_the_sender_edits_a_message() {
    let mut t = app();
    let id = send(&mut t, "bob", "original");
    for who in ["carol", "owner"] {
        assert_eq!(
            code(t.as_(who).call(
                "editMessage",
                json!({ "messageId": id, "newMessage": "forged", "timestamp": NOW.to_string() })
            )),
            "Forbidden",
            "{who}"
        );
    }
    let edited = call(
        &mut t,
        "bob",
        "editMessage",
        json!({ "messageId": id, "newMessage": "fixed", "timestamp": (NOW + 5).to_string() }),
    );
    assert_eq!(edited["text"], json!("fixed"));
    assert_eq!(edited["editedOn"], json!((NOW + 5).to_string()));
    assert_eq!(edited["index"], json!("0"));
    assert_eq!(
        t.events_for("carol").last(),
        Some(&("MessageEdited".to_owned(), json!({ "messageId": id })))
    );
    assert_eq!(
        code(t.as_("bob").call(
            "editMessage",
            json!({ "messageId": "nope", "newMessage": "x", "timestamp": NOW.to_string() })
        )),
        "NotFound"
    );
    // A reply is edited with its thread named, and only its own.
    let reply = reply_at(&mut t, "carol", &id, "r", NOW);
    assert_eq!(
        code(t.as_("carol").call(
            "editMessage",
            json!({ "messageId": reply, "newMessage": "x", "timestamp": NOW.to_string(), "parentId": "other" })
        )),
        "NotFound"
    );
    let r = call(
        &mut t,
        "carol",
        "editMessage",
        json!({ "messageId": reply, "newMessage": "r2", "timestamp": NOW.to_string(), "parentId": id }),
    );
    assert_eq!(r["text"], json!("r2"));
}

/// The sender blanks their message in place; the staff remove anyone's; a
/// member who is neither deletes nothing, and nobody undeletes.
#[test]
fn only_the_sender_or_staff_delete_a_message() {
    let mut t = app();
    let own = send(&mut t, "bob", "mine");
    let other = send(&mut t, "carol", "hers");
    let third = send(&mut t, "dave", "his");
    assert_eq!(
        code(
            t.as_("bob")
                .call("deleteMessage", json!({ "messageId": other }))
        ),
        "Forbidden"
    );
    assert_eq!(
        call(&mut t, "bob", "deleteMessage", json!({ "messageId": own })),
        json!("Message deleted successfully")
    );
    // The owner is an admin: staff.
    call(
        &mut t,
        "owner",
        "deleteMessage",
        json!({ "messageId": other }),
    );
    let page = messages(&mut t, "dave", json!({}));
    assert_eq!(texts(&page), ["", "", "his"]);
    assert_eq!(page["messages"][0]["deleted"], json!(true));
    assert_eq!(page["messages"][1]["deleted"], json!(true));
    assert_eq!(page["messages"][1]["index"], json!("1"), "the slot stays");
    assert_eq!(page["totalCount"], json!(3));
    // A deleted message cannot be edited back.
    assert_eq!(
        code(t.as_("bob").call(
            "editMessage",
            json!({ "messageId": own, "newMessage": "back", "timestamp": NOW.to_string() })
        )),
        "NotFound"
    );
    assert_eq!(
        t.events_for("dave").last(),
        Some(&("MessageSent".to_owned(), json!({ "messageId": other })))
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("deleteMessage", json!({ "messageId": "nope" }))
        ),
        "NotFound"
    );
    let _ = third;
}

#[test]
fn a_moderator_removes_a_thread_reply_and_a_member_cannot() {
    let mut t = app();
    let parent = send(&mut t, "bob", "parent");
    let r1 = reply_at(&mut t, "carol", &parent, "r1", NOW + 1);
    let r2 = reply_at(&mut t, "carol", &parent, "r2", NOW + 2);
    call(
        &mut t,
        "bob",
        "updateReaction",
        json!({ "messageId": r1, "emoji": "👍", "add": true }),
    );
    assert_eq!(
        code(t.as_("bob").call(
            "deleteMessage",
            json!({ "messageId": r1, "parentId": parent })
        )),
        "Forbidden"
    );
    set_role(&mut t, "owner", "dave", "Mod").expect("promote");
    assert_eq!(
        call(
            &mut t,
            "dave",
            "deleteMessage",
            json!({ "messageId": r1, "parentId": parent })
        ),
        json!("Thread message deleted successfully")
    );
    let thread = messages(&mut t, "bob", json!({ "parentMessage": parent }));
    assert_eq!(texts(&thread), ["r2"]);
    assert_eq!(thread["totalCount"], json!(1));
    assert_eq!(thread["messages"][0]["index"], json!("1"), "positions stay");
    assert_eq!(
        messages(&mut t, "bob", json!({}))["messages"][0]["threadCount"],
        json!(1)
    );
    // Gone: reacting to it or deleting it again finds nothing.
    assert_eq!(
        code(t.as_("bob").call(
            "updateReaction",
            json!({ "messageId": r1, "emoji": "👍", "add": true })
        )),
        "NotFound"
    );
    // Its sender blanks their own reply in place.
    call(
        &mut t,
        "carol",
        "deleteMessage",
        json!({ "messageId": r2, "parentId": parent }),
    );
    let thread = messages(&mut t, "bob", json!({ "parentMessage": parent }));
    assert_eq!(thread["messages"][0]["deleted"], json!(true));
    assert_eq!(
        t.events_for("bob").last(),
        Some(&(
            "MessageSentThread".to_owned(),
            json!({ "messageId": r2, "parentMessageId": parent })
        ))
    );
}

// ── reactions ────────────────────────────────────────────────────────────────

#[test]
fn a_reaction_records_the_caller_account() {
    let mut t = app();
    let id = send(&mut t, "bob", "react to me");
    for who in ["carol", "dave"] {
        assert_eq!(
            call(
                &mut t,
                who,
                "updateReaction",
                json!({ "messageId": id, "emoji": "👍", "add": true })
            ),
            json!("Reaction added successfully")
        );
    }
    call(
        &mut t,
        "carol",
        "updateReaction",
        json!({ "messageId": id, "emoji": "🎉", "add": true }),
    );
    // Adding twice is one reaction.
    call(
        &mut t,
        "carol",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    let m = &messages(&mut t, "bob", json!({}))["messages"][0];
    assert_eq!(
        m["reactions"],
        json!({ "👍": ["carol", "dave"], "🎉": ["carol"] })
    );
    assert_eq!(
        t.events_for("bob").last(),
        Some(&("ReactionUpdated".to_owned(), json!({ "messageId": id })))
    );
}

/// Removing the last reaction of a kind removes the kind; with none left
/// `reactions` is `null`. A removal is only ever the caller's own.
#[test]
fn removing_the_last_reaction_of_a_kind_removes_the_kind() {
    let mut t = app();
    let id = send(&mut t, "bob", "x");
    let react = |t: &mut TestApp, who: &str, emoji: &str, add: bool| {
        call(
            t,
            who,
            "updateReaction",
            json!({ "messageId": id, "emoji": emoji, "add": add }),
        )
    };
    react(&mut t, "carol", "👍", true);
    react(&mut t, "dave", "👍", true);
    react(&mut t, "dave", "❤️", true);
    // Carol removing Dave's is not possible: she removes her own (none for ❤️).
    assert_eq!(
        react(&mut t, "carol", "❤️", false),
        json!("Reaction removed successfully")
    );
    react(&mut t, "dave", "❤️", false);
    assert_eq!(
        messages(&mut t, "bob", json!({}))["messages"][0]["reactions"],
        json!({ "👍": ["carol", "dave"] })
    );
    react(&mut t, "carol", "👍", false);
    react(&mut t, "dave", "👍", false);
    assert_eq!(
        messages(&mut t, "bob", json!({}))["messages"][0]["reactions"],
        json!(null)
    );
    for emoji in ["", &"x".repeat(65)] {
        assert_eq!(
            code(t.as_("bob").call(
                "updateReaction",
                json!({ "messageId": id, "emoji": emoji, "add": true })
            )),
            "Invalid"
        );
    }
    assert_eq!(
        code(t.as_("bob").call(
            "updateReaction",
            json!({ "messageId": "missing", "emoji": "👍", "add": true })
        )),
        "NotFound"
    );
}

/// Two members who chose the same display name do not share a reaction:
/// reactions are by account.
#[test]
fn same_named_members_do_not_share_a_reaction() {
    let mut t = app();
    for who in ["carol", "dave"] {
        call(&mut t, who, "setProfile", json!({ "username": "Sam" }));
    }
    let id = send(&mut t, "bob", "x");
    call(
        &mut t,
        "carol",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    assert_eq!(
        messages(&mut t, "bob", json!({}))["messages"][0]["reactions"],
        json!({ "👍": ["carol"] })
    );
}

/// A deleted message shows no reactions.
#[test]
fn a_deleted_message_shows_no_reactions() {
    let mut t = app();
    let id = send(&mut t, "bob", "x");
    call(
        &mut t,
        "carol",
        "updateReaction",
        json!({ "messageId": id, "emoji": "👍", "add": true }),
    );
    call(&mut t, "bob", "deleteMessage", json!({ "messageId": id }));
    assert_eq!(
        messages(&mut t, "bob", json!({}))["messages"][0]["reactions"],
        json!(null)
    );
}

// ── profiles ─────────────────────────────────────────────────────────────────

/// A profile is its owner's alone: `setProfile` writes only the caller's, and
/// the first username sticks (later calls change the avatar).
#[test]
fn a_profile_slot_is_its_owners_alone() {
    let mut t = app();
    assert_eq!(
        call(&mut t, "bob", "setProfile", json!({ "username": "Bob" })),
        json!("Profile set")
    );
    call(
        &mut t,
        "carol",
        "setProfile",
        json!({ "username": "Carol" }),
    );
    // Bob cannot rename himself, nor become Carol.
    call(&mut t, "bob", "setProfile", json!({ "username": "Carol" }));
    let page = view(&mut t, "dave", "getProfiles", json!({}));
    assert_eq!(
        page,
        json!({
            "items": [
                { "identity": "bob", "username": "Bob", "avatar": null },
                { "identity": "carol", "username": "Carol", "avatar": null }
            ],
            "next": null
        })
    );
    assert_eq!(
        t.events_for("dave").last(),
        Some(&("ProfileUpdated".to_owned(), json!({ "identity": "bob" })))
    );
    for name in ["", "   ", &"x".repeat(51)] {
        assert_eq!(
            code(
                t.as_("dave")
                    .call("setProfile", json!({ "username": name }))
            ),
            "Invalid"
        );
    }
}

/// An avatar is a blob uploaded to the app; the profile keeps the blob alive,
/// and a `null` avatar keeps the one there.
#[test]
fn an_avatar_is_a_held_blob() {
    let mut t = app();
    assert_eq!(
        code(t.as_("bob").call(
            "setProfile",
            json!({ "username": "Bob", "avatar": "not-a-blob" })
        )),
        "Invalid"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "setProfile",
            json!({ "username": "Bob", "avatar": "ab".repeat(32) })
        )),
        "Invalid",
        "a well-formed id of a blob the app does not hold"
    );
    let blob = t.upload_blob(b"png bytes", "image/png");
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "username": "Bob", "avatar": blob }),
    );
    call(&mut t, "bob", "setProfile", json!({ "username": "Bob" }));
    let page = view(&mut t, "bob", "getProfiles", json!({}));
    assert_eq!(page["items"][0]["avatar"], json!(blob));
    assert_eq!(t.blob_refs(&blob), 1);
}

/// The creator's username from `initArgs` is seeded; `getProfiles` pages.
#[test]
fn profiles_are_read_in_pages() {
    let mut t = app();
    for who in ["bob", "carol", "dave"] {
        call(&mut t, who, "setProfile", json!({ "username": who }));
    }
    let first = view(&mut t, "owner", "getProfiles", json!({ "limit": 2 }));
    assert_eq!(first["items"].as_array().map(Vec::len), Some(2));
    let next = first["next"].as_str().expect("a next page").to_owned();
    let second = view(
        &mut t,
        "owner",
        "getProfiles",
        json!({ "limit": 2, "cursor": next }),
    );
    assert_eq!(second["items"][0]["identity"], json!("dave"));
    assert_eq!(second["next"], json!(null));
}

// ── drafts and read state ────────────────────────────────────────────────────

#[test]
fn a_draft_round_trips_for_its_author_only() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "saveDraft",
        json!({ "channel": "general", "text": "half a thought" }),
    );
    assert_eq!(
        view(&mut t, "bob", "getDraft", json!({ "channel": "general" })),
        json!("half a thought")
    );
    // Nobody else reads it, the owner included.
    for who in ["carol", "owner"] {
        assert_eq!(
            view(&mut t, who, "getDraft", json!({ "channel": "general" })),
            json!("")
        );
    }
    assert_eq!(
        view(&mut t, "bob", "getDraft", json!({ "channel": "other" })),
        json!("")
    );
    // An empty text deletes it; so does deleteDraft.
    call(
        &mut t,
        "bob",
        "saveDraft",
        json!({ "channel": "general", "text": "" }),
    );
    assert_eq!(
        view(&mut t, "bob", "getDraft", json!({ "channel": "general" })),
        json!("")
    );
    call(
        &mut t,
        "bob",
        "saveDraft",
        json!({ "channel": "general", "text": "again" }),
    );
    call(
        &mut t,
        "bob",
        "deleteDraft",
        json!({ "channel": "general" }),
    );
    assert_eq!(
        view(&mut t, "bob", "getDraft", json!({ "channel": "general" })),
        json!("")
    );
    assert!(
        event_names(&t, "carol").iter().all(|e| e == "Initialized"),
        "drafts announce nothing"
    );
}

/// Unread counts are per account: messages after the caller's own read
/// position, not their own, not deleted; mentions of them or @everyone/@here.
#[test]
fn a_read_receipt_is_per_account() {
    let mut t = app();
    send_at(&mut t, "bob", "one", NOW - 10);
    let two = send_at(&mut t, "bob", "two", NOW - 5);
    call(
        &mut t,
        "bob",
        "sendMessage",
        json!({ "message": "hey @carol", "mentions": ["carol"], "mentionsUsernames": ["Carol"], "timestamp": NOW.to_string() }),
    );
    call(
        &mut t,
        "dave",
        "sendMessage",
        json!({ "message": "@here", "mentions": [], "mentionsUsernames": ["here"], "timestamp": NOW.to_string() }),
    );
    assert_eq!(view(&mut t, "carol", "getUnreadCount", json!({})), json!(4));
    assert_eq!(
        view(&mut t, "carol", "getUnreadMentions", json!({})),
        json!(2)
    );
    // Bob's own messages are never unread to him.
    assert_eq!(view(&mut t, "bob", "getUnreadCount", json!({})), json!(1));
    assert_eq!(
        view(&mut t, "bob", "getUnreadMentions", json!({})),
        json!(1)
    );
    assert_eq!(
        call(
            &mut t,
            "carol",
            "markAsRead",
            json!({ "timestamp": (NOW - 5).to_string() })
        ),
        json!("ok")
    );
    assert_eq!(view(&mut t, "carol", "getUnreadCount", json!({})), json!(2));
    assert_eq!(view(&mut t, "dave", "getUnreadCount", json!({})), json!(3));
    // A deleted message is not unread.
    call(
        &mut t,
        "owner",
        "deleteMessage",
        json!({ "messageId": two }),
    );
    assert_eq!(view(&mut t, "dave", "getUnreadCount", json!({})), json!(2));
    // The legacy no-op answers and records nothing.
    assert_eq!(
        view(
            &mut t,
            "carol",
            "markMessagesAsRead",
            json!({ "channel": "general", "timestamp": NOW.to_string() })
        ),
        json!("ok")
    );
    assert_eq!(view(&mut t, "carol", "getUnreadCount", json!({})), json!(2));
}

// ── roles ────────────────────────────────────────────────────────────────────

#[test]
fn non_admin_cannot_grant_admin() {
    let mut t = app();
    for (actor, target, r) in [
        ("bob", "bob", "Admin"),
        ("bob", "carol", "Mod"),
        ("bob", "carol", "Banned"),
    ] {
        assert_eq!(code(set_role(&mut t, actor, target, r)), "Forbidden");
    }
    assert_eq!(role(&mut t, "bob"), json!("User"));
    assert_eq!(role(&mut t, "carol"), json!("User"));
}

#[test]
fn setting_a_role_a_member_already_has_announces_nothing() {
    let mut t = app();
    assert_eq!(
        set_role(&mut t, "owner", "owner", "Admin"),
        Ok(json!("Role unchanged"))
    );
    assert_eq!(
        set_role(&mut t, "owner", "bob", "User"),
        Ok(json!("Role unchanged"))
    );
    assert_eq!(event_names(&t, "bob"), ["Initialized"]);
}

#[test]
fn admin_promotes_mod_then_mod_moderates_within_limits() {
    let mut t = app();
    assert_eq!(
        set_role(&mut t, "owner", "bob", "Mod"),
        Ok(json!("Role updated"))
    );
    assert_eq!(
        t.events_for("carol").last(),
        Some(&("RoleUpdated".to_owned(), json!({ "identity": "bob" })))
    );
    assert_eq!(role(&mut t, "bob"), json!("Mod"));
    // A moderator bans a user and lifts it, and nothing else.
    assert_eq!(
        set_role(&mut t, "bob", "carol", "Banned"),
        Ok(json!("Role updated"))
    );
    assert_eq!(role(&mut t, "carol"), json!("Banned"));
    assert_eq!(
        set_role(&mut t, "bob", "carol", "User"),
        Ok(json!("Role updated"))
    );
    assert_eq!(code(set_role(&mut t, "bob", "carol", "Mod")), "Forbidden");
    assert_eq!(code(set_role(&mut t, "bob", "dave", "Admin")), "Forbidden");
    assert_eq!(
        code(set_role(&mut t, "bob", "owner", "Banned")),
        "Forbidden"
    );
    // Roles listed, User omitted.
    let roles = view(&mut t, "dave", "listRoles", json!({}));
    assert_eq!(
        roles["items"],
        json!([
            { "identity": "bob", "role": "Mod" },
            { "identity": "owner", "role": "Admin" }
        ])
    );
}

#[test]
fn admin_demotes_mod_to_user_and_cannot_demote_themselves() {
    let mut t = app();
    set_role(&mut t, "owner", "bob", "Mod").expect("mod");
    set_role(&mut t, "owner", "bob", "User").expect("user");
    assert_eq!(role(&mut t, "bob"), json!("User"));
    assert_eq!(
        code(set_role(&mut t, "owner", "owner", "User")),
        "Forbidden"
    );
    // Another admin may demote the creator, as in v1.
    set_role(&mut t, "owner", "bob", "Admin").expect("admin");
    set_role(&mut t, "bob", "owner", "Mod").expect("demote the creator");
    assert_eq!(role(&mut t, "owner"), json!("Mod"));
    assert_eq!(
        code(t.as_("owner").call("updateInfo", json!({ "name": "x" }))),
        "Forbidden"
    );
}

/// Banning a staff member and lifting the ban leaves them a plain user.
#[test]
fn banning_then_clearing_does_not_leave_stale_grants() {
    let mut t = app();
    set_role(&mut t, "owner", "bob", "Admin").expect("admin");
    set_role(&mut t, "owner", "bob", "Banned").expect("ban");
    set_role(&mut t, "owner", "bob", "User").expect("unban");
    assert_eq!(role(&mut t, "bob"), json!("User"));
    assert_eq!(
        code(set_role(&mut t, "bob", "carol", "Banned")),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("bob").call("updateInfo", json!({ "name": "x" }))),
        "Forbidden"
    );
}

/// A banned member reads, and every write of theirs is refused.
#[test]
fn banned_member_is_blocked_from_mutations() {
    let mut t = app();
    let id = send(&mut t, "carol", "before");
    set_role(&mut t, "owner", "carol", "Banned").expect("ban");
    let refused = [
        (
            "sendMessage",
            json!({ "message": "x", "mentions": [], "mentionsUsernames": [], "timestamp": NOW.to_string() }),
        ),
        (
            "editMessage",
            json!({ "messageId": id, "newMessage": "x", "timestamp": NOW.to_string() }),
        ),
        ("deleteMessage", json!({ "messageId": id })),
        (
            "updateReaction",
            json!({ "messageId": id, "emoji": "👍", "add": true }),
        ),
        ("setProfile", json!({ "username": "C" })),
        ("saveDraft", json!({ "channel": "c", "text": "x" })),
        ("deleteDraft", json!({ "channel": "c" })),
    ];
    for (method, args) in refused {
        assert_eq!(
            code(t.as_("carol").call(method, args)),
            "Banned",
            "{method}"
        );
    }
    // Reading still works, and so does marking read.
    assert_eq!(texts(&messages(&mut t, "carol", json!({}))), ["before"]);
    call(
        &mut t,
        "carol",
        "markAsRead",
        json!({ "timestamp": NOW.to_string() }),
    );
    // A banned member cannot unban themselves.
    assert_eq!(
        code(set_role(&mut t, "carol", "carol", "User")),
        "Forbidden"
    );
}

/// v1's `banned` writer set: a member who is not staff cannot ban, whatever
/// they send.
#[test]
fn a_member_who_is_not_staff_cannot_ban() {
    let mut t = app();
    assert_eq!(code(set_role(&mut t, "dave", "bob", "Banned")), "Forbidden");
    assert_eq!(code(set_role(&mut t, "gus", "bob", "Banned")), "Forbidden");
    assert_eq!(role(&mut t, "bob"), json!("User"));
}

/// A role is set only for someone the conversation reaches through its org.
#[test]
fn a_role_names_a_member() {
    let mut t = app();
    assert_eq!(code(set_role(&mut t, "owner", "mallory", "Mod")), "Invalid");
    assert_eq!(
        code(
            t.as_("owner")
                .call("setMemberRole", json!({ "target": "bob", "role": "Root" }))
        ),
        "BadArgs"
    );
    set_role(&mut t, "owner", "gus", "Banned").expect("a guest can be banned");
}

// ── search ───────────────────────────────────────────────────────────────────

fn search(t: &mut TestApp, method: &str, args: Value) -> Value {
    view(t, "bob", method, args)
}

fn hit_ids(page: &Value) -> Vec<String> {
    page["hits"]
        .as_array()
        .expect("hits")
        .iter()
        .map(|h| h["id"].as_str().expect("id").to_owned())
        .collect()
}

#[test]
fn the_index_finds_messages_and_replies_and_message_position_opens_them() {
    let mut t = app();
    send(&mut t, "bob", "nothing here");
    let hit = send_at(&mut t, "carol", "<p>Meet at the <b>Café</b></p>", NOW - 1);
    let reply = reply_at(&mut t, "dave", &hit, "the cafe is closed", NOW);
    let page = search(&mut t, "searchMessages", json!({ "query": "CAFE" }));
    assert_eq!(hit_ids(&page), [reply.clone(), hit.clone()], "newest first");
    let first = &page["hits"][1];
    assert_eq!(first["index"], json!(null));
    assert_eq!(first["sender"], json!("carol"));
    assert_eq!(first["snippet"], json!("Meet at the Café"));
    assert_eq!(first["matchStart"], json!(12));
    assert_eq!(first["matchEnd"], json!(16));
    assert_eq!(page["hits"][0]["parentMessageId"], json!(hit));
    assert_eq!(page["frontierTimestamp"], json!(null));
    assert_eq!(
        view(
            &mut t,
            "bob",
            "messagePosition",
            json!({ "messageId": hit })
        ),
        json!("1")
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "messagePosition",
            json!({ "messageId": reply })
        ),
        json!(null)
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "messagePosition",
            json!({ "messageId": "nope" })
        ),
        json!(null)
    );
    // `messageIdAt` is its inverse, for the top level and a thread.
    assert_eq!(
        view(&mut t, "bob", "messageIdAt", json!({ "index": "1" })),
        json!(hit)
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "messageIdAt",
            json!({ "parentMessage": hit, "index": "0" })
        ),
        json!(reply)
    );
    assert_eq!(
        view(&mut t, "bob", "messageIdAt", json!({ "index": "9" })),
        json!(null)
    );
    // Markup is not text: "strong" or "b" find nothing.
    assert_eq!(
        hit_ids(&search(
            &mut t,
            "searchMessages",
            json!({ "query": "strong" })
        )),
        Vec::<String>::new()
    );
}

#[test]
fn deleted_and_removed_messages_are_not_found() {
    let mut t = app();
    let a = send(&mut t, "bob", "needle one");
    let b = send(&mut t, "carol", "needle two");
    let r = reply_at(&mut t, "carol", &a, "needle three", NOW);
    call(&mut t, "bob", "deleteMessage", json!({ "messageId": a }));
    call(
        &mut t,
        "owner",
        "deleteMessage",
        json!({ "messageId": r, "parentId": a }),
    );
    for method in ["searchMessages", "searchMessagesScan"] {
        assert_eq!(
            hit_ids(&search(&mut t, method, json!({ "query": "needle" }))),
            std::slice::from_ref(&b),
            "{method}"
        );
    }
    let filtered = messages(&mut t, "bob", json!({ "searchTerm": "needle" }));
    assert_eq!(texts(&filtered), ["needle two"]);
    assert_eq!(filtered["totalCount"], json!(1));
}

#[test]
fn the_index_pages_by_cursor_without_gaps_or_repeats() {
    let mut t = app();
    let mut sent = Vec::new();
    for i in 0..7 {
        sent.push(send_at(&mut t, "bob", &format!("topic {i}"), NOW - 100 + i));
    }
    let mut seen = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut args = json!({ "query": "topic", "limit": 3 });
        if let Some(c) = cursor.take() {
            args["cursor"] = json!(c);
        }
        let page = search(&mut t, "searchMessages", args);
        let ids = hit_ids(&page);
        assert!(ids.len() <= 3);
        seen.extend(ids);
        match page["nextCursor"].as_str() {
            Some(c) => cursor = Some(c.to_owned()),
            None => break,
        }
    }
    seen.sort();
    sent.sort();
    assert_eq!(seen, sent);
}

/// The scan walks newest first, each message followed by its thread, and a
/// reply is listed with its thread (anchored at its parent's timestamp).
#[test]
fn the_scan_is_newest_first_and_lists_a_reply_with_its_thread() {
    let mut t = app();
    let old = send_at(&mut t, "bob", "match old", NOW - 30);
    let new = send_at(&mut t, "carol", "match new", NOW - 20);
    let reply = reply_at(&mut t, "dave", &old, "match reply", NOW);
    let page = search(&mut t, "searchMessagesScan", json!({ "query": "match" }));
    assert_eq!(hit_ids(&page), [new.clone(), old.clone(), reply.clone()]);
    let r = &page["hits"][2];
    assert_eq!(r["parentMessageId"], json!(old));
    assert_eq!(r["index"], json!("0"));
    assert_eq!(r["anchorTimestamp"], json!((NOW - 30).to_string()));
    assert_eq!(r["timestamp"], json!(NOW.to_string()));
    assert_eq!(page["hits"][0]["index"], json!("1"));
    assert_eq!(page["frontierTimestamp"], json!((NOW - 30).to_string()));
    assert_eq!(page["nextCursor"], json!(null));
}

#[test]
fn the_scan_pages_by_cursor_without_gaps_or_repeats() {
    let mut t = app();
    let mut sent = Vec::new();
    for i in 0..4 {
        let parent = send_at(&mut t, "bob", &format!("hit {i}"), NOW - 50 + i);
        sent.push(parent.clone());
        for j in 0..2 {
            sent.push(reply_at(
                &mut t,
                "carol",
                &parent,
                &format!("hit {i}.{j}"),
                NOW,
            ));
        }
    }
    let mut seen = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut args = json!({ "query": "hit", "limit": 2 });
        if let Some(c) = cursor.take() {
            args["cursor"] = json!(c);
        }
        let page = search(&mut t, "searchMessagesScan", args);
        seen.extend(hit_ids(&page));
        match page["nextCursor"].as_str() {
            Some(c) => cursor = Some(c.to_owned()),
            None => break,
        }
    }
    let mut unique = seen.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), seen.len(), "no repeats");
    sent.sort();
    assert_eq!(unique, sent);
}

#[test]
fn an_empty_query_finds_nothing_and_bad_input_is_refused() {
    let mut t = app();
    send(&mut t, "bob", "anything");
    for method in ["searchMessages", "searchMessagesScan"] {
        let empty = search(&mut t, method, json!({ "query": "   " }));
        assert_eq!(empty["hits"], json!([]), "{method}");
        assert_eq!(empty["nextCursor"], json!(null));
        assert_eq!(
            code(
                t.as_("bob")
                    .view(method, json!({ "query": "x".repeat(257) }))
            ),
            "Invalid"
        );
        assert_eq!(
            code(
                t.as_("bob")
                    .view(method, json!({ "query": "any", "cursor": "garbage" }))
            ),
            "Invalid"
        );
    }
    assert_eq!(
        code(
            t.as_("bob")
                .view("getMessages", json!({ "searchTerm": "x".repeat(257) }))
        ),
        "Invalid"
    );
    // A normal-length term still works.
    assert_eq!(
        texts(&messages(&mut t, "bob", json!({ "searchTerm": "ANY" }))),
        ["anything"]
    );
}

/// One scan reads a bounded slice of a big channel, and says where to go on.
#[test]
fn one_scan_reads_a_bounded_slice_of_a_big_channel() {
    let mut t = app();
    for i in 0..2_050 {
        send(&mut t, "bob", &format!("m{i}"));
    }
    let page = search(&mut t, "searchMessagesScan", json!({ "query": "nomatch" }));
    assert_eq!(page["hits"], json!([]));
    let cursor = page["nextCursor"]
        .as_str()
        .expect("more to read")
        .to_owned();
    let rest = search(
        &mut t,
        "searchMessagesScan",
        json!({ "query": "nomatch", "cursor": cursor }),
    );
    assert_eq!(rest["nextCursor"], json!(null));
}

// ── attachments ──────────────────────────────────────────────────────────────

#[test]
fn an_attachment_is_a_blob_the_message_keeps() {
    let mut t = app();
    let file = t.upload_blob(b"%PDF report", "application/pdf");
    let image = t.upload_blob(b"\x89PNG", "image/png");
    let m = call(
        &mut t,
        "bob",
        "sendMessage",
        json!({
            "message": "see attached", "mentions": [], "mentionsUsernames": [],
            "timestamp": NOW.to_string(),
            "files": [{ "name": "r.pdf", "mimeType": "application/pdf", "size": "999", "blobIdStr": file }],
            "images": [{ "name": "p.png", "mimeType": "image/png", "size": "4", "blobIdStr": image }]
        }),
    );
    // The node's record of the size wins over the client's.
    assert_eq!(
        m["files"],
        json!([{
            "name": "r.pdf", "mimeType": "application/pdf", "size": "11",
            "blobId": file, "uploadedAt": common::T0.to_string()
        }])
    );
    assert_eq!(m["images"][0]["blobId"], json!(image));
    assert_eq!(t.blob_refs(&file), 1);
    assert_eq!(
        messages(&mut t, "carol", json!({}))["messages"][0]["files"],
        m["files"]
    );
    for bad in ["nope", &"cd".repeat(32)] {
        assert_eq!(
            code(t.as_("bob").call(
                "sendMessage",
                json!({
                    "message": "x", "mentions": [], "mentionsUsernames": [],
                    "timestamp": NOW.to_string(),
                    "files": [{ "name": "x", "mimeType": "x", "size": "1", "blobIdStr": bad }]
                })
            )),
            "Invalid"
        );
    }
    let eleven: Vec<Value> = (0..11)
        .map(|_| json!({ "name": "x", "mimeType": "x", "size": "1", "blobIdStr": file }))
        .collect();
    assert_eq!(
        code(t.as_("bob").call(
            "sendMessage",
            json!({ "message": "x", "mentions": [], "mentionsUsernames": [], "timestamp": NOW.to_string(), "images": eleven })
        )),
        "Invalid"
    );
}

// ── access and the wire ──────────────────────────────────────────────────────

/// The org decides who reaches the conversation: members, admins, the owner
/// and guests (as any member of a v1 context could write). Nobody else.
#[test]
fn who_reaches_the_conversation() {
    let mut t = app();
    let id = send(&mut t, "gus", "a guest speaks");
    assert_eq!(
        messages(&mut t, "bob", json!({}))["messages"][0]["sender"],
        json!("gus")
    );
    assert_eq!(
        event_names(&t, "gus").last().map(String::as_str),
        Some("MessageSent")
    );
    assert_eq!(
        t.anonymous().view("getMessages", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory").call(
            "updateReaction",
            json!({ "messageId": id, "emoji": "👍", "add": true })
        ),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(
        messages(&mut t, "bob", json!({}))["messages"][0]["reactions"],
        json!(null)
    );
}

#[test]
fn malformed_arguments_and_v1_names_are_refused() {
    let mut t = app();
    for args in [
        json!({ "message": "x" }),
        json!({ "message": "x", "mentions": [], "mentionsUsernames": [], "timestamp": 5 }),
        json!({ "message": "x", "mentions": [], "mentionsUsernames": [], "timestamp": "5", "extra": 1 }),
    ] {
        assert_eq!(
            code(t.as_("bob").call("sendMessage", args.clone())),
            "BadArgs",
            "{args}"
        );
    }
    assert_eq!(
        code(t.as_("bob").call("send_message", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_("bob").view("markAsRead", json!({ "timestamp": "1" }))),
        "NotAView"
    );
    assert_eq!(
        view(&mut t, "bob", "getMessageCount", json!({})),
        json!("0")
    );
}

/// Every read is a view: callable without writing anything.
#[test]
fn every_read_is_callable_as_a_view() {
    let mut t = app();
    let id = send(&mut t, "bob", "x");
    for (method, args) in [
        ("getInfo", json!({})),
        ("getChannelInfo", json!({})),
        ("markMessagesAsRead", json!({})),
        ("getUnreadCount", json!({})),
        ("getUnreadMentions", json!({})),
        ("getProfiles", json!({})),
        ("getDraft", json!({ "channel": "c" })),
        ("getMemberRole", json!({ "identity": "bob" })),
        ("listRoles", json!({})),
        ("getMessages", json!({})),
        ("getMessagesFrom", json!({ "start": "0" })),
        ("getMessageCount", json!({})),
        ("searchMessages", json!({ "query": "x" })),
        ("messagePosition", json!({ "messageId": id })),
        ("messageIdAt", json!({ "index": "0" })),
        ("searchMessagesScan", json!({ "query": "x" })),
    ] {
        t.as_("carol")
            .view(method, args)
            .unwrap_or_else(|e| panic!("{method}: {e:?}"));
    }
}
