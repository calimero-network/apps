//! The calendar on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method, v1's storage-level write rules as the method checks
//! they became (forged writes are now calls the method refuses), booking links
//! through an API key acting for their owner, and the access and wire checks v1
//! could not express. Every method of the ABI is called here.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// 2026-07-06 00:00 UTC, a Monday.
const MONDAY: u64 = 1_783_296_000_000;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 86_400_000;

/// The owner, two members and a guest.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "cy"]).guests(["gus"]))
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

fn event(peers: &[&str]) -> Value {
    json!({
        "title": "Standup",
        "description": "daily",
        "start": "2026-07-06T09:00:00.000Z",
        "end": "2026-07-06T09:15:00.000Z",
        "event_type": "event",
        "color": "rgb(1, 2, 3)",
        "peers": peers,
    })
}

fn ids(events: &Value) -> Vec<String> {
    events
        .as_array()
        .expect("a list")
        .iter()
        .map(|e| e["id"].as_str().expect("an id").to_owned())
        .collect()
}

fn names(t: &TestApp, account: &str) -> Vec<String> {
    t.events_for(account).into_iter().map(|(n, _)| n).collect()
}

// ── members ──────────────────────────────────────────────────────────────────

#[test]
fn set_username_registers_member_and_is_idempotent() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "setUsername",
        json!({ "username": "  Ann " }),
    );
    call(
        &mut t,
        "owner",
        "setUsername",
        json!({ "username": "Anna" }),
    );
    let members = view(&mut t, "bob", "getMembers", json!({}));
    assert_eq!(members.as_array().map(Vec::len), Some(1));
    assert_eq!(members[0]["id"], json!("owner"));
    assert_eq!(members[0]["username"], json!("Anna"));
    // u64s are decimal strings on the wire.
    assert!(members[0]["joinedAt"].is_string());
    assert!(members[0]["usernameUpdatedAt"].is_string());
    assert_eq!(names(&t, "bob"), ["MemberJoined", "MemberUsernameUpdated"]);
    assert_eq!(
        t.events_for("bob")[0].1,
        json!({ "account": "owner" }),
        "member events name the account"
    );
}

#[test]
fn set_username_rejects_empty_and_long_names() {
    let mut t = app();
    for name in ["", "   ", &"x".repeat(51)] {
        assert_eq!(
            code(
                t.as_("owner")
                    .call("setUsername", json!({ "username": name }))
            ),
            "Invalid"
        );
    }
    assert_eq!(view(&mut t, "owner", "getMembers", json!({})), json!([]));
}

#[test]
fn members_are_keyed_per_account_and_nobody_renames_another() {
    let mut t = app();
    call(&mut t, "owner", "setUsername", json!({ "username": "Ann" }));
    call(&mut t, "bob", "setUsername", json!({ "username": "Bob" }));
    // bob setting a name only ever writes bob's row.
    call(&mut t, "bob", "setUsername", json!({ "username": "Ann" }));
    let members = view(&mut t, "cy", "getMembers", json!({}));
    let pairs: Vec<(String, String)> = members
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["id"].as_str().unwrap().to_owned(),
                m["username"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(pairs.len(), 2);
    assert!(pairs.contains(&("owner".to_owned(), "Ann".to_owned())));
    assert!(pairs.contains(&("bob".to_owned(), "Ann".to_owned())));
    // The method takes no account argument: naming someone else is refused.
    assert_eq!(
        code(t.as_("bob").call(
            "setUsername",
            json!({ "username": "x", "account": "owner" })
        )),
        "BadArgs"
    );
}

// ── shared events ────────────────────────────────────────────────────────────

#[test]
fn owner_can_create_and_see_a_shared_event() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    let events = view(&mut t, "owner", "getEvents", json!({}));
    assert_eq!(ids(&events), [id.as_str().unwrap()]);
    let e = &events[0];
    assert_eq!(e["owner"], json!("owner"));
    assert_eq!(e["title"], json!("Standup"));
    assert_eq!(e["event_type"], json!("event"));
    assert_eq!(e["peers"], json!(["bob"]));
    assert_eq!(e["private"], json!(false));
    assert_eq!(names(&t, "bob"), ["CalendarEventCreated"]);
    assert_eq!(t.events_for("bob")[0].1, json!({ "id": id }));
}

#[test]
fn peers_round_trip_in_order_without_duplicates() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["cy", "bob", "cy"]) }),
    );
    let events = view(&mut t, "owner", "getEvents", json!({}));
    assert_eq!(events[0]["peers"], json!(["cy", "bob"]));
}

#[test]
fn an_invited_peer_sees_the_event_and_a_stranger_does_not() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    assert_eq!(
        ids(&view(&mut t, "bob", "getEvents", json!({}))),
        [id.as_str().unwrap()]
    );
    assert_eq!(view(&mut t, "cy", "getEvents", json!({})), json!([]));
    // Events reach the owner and the peers only, not other members or guests.
    assert_eq!(names(&t, "owner"), ["CalendarEventCreated"]);
    assert!(names(&t, "cy").is_empty());
    assert!(names(&t, "gus").is_empty());
}

#[test]
fn only_the_owner_can_update_or_delete() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    // A peer, a stranger and a guest are refused, and nothing changes.
    for who in ["bob", "cy", "gus"] {
        assert_eq!(
            code(t.as_(who).call(
                "updateEvent",
                json!({ "eventId": id, "eventData": { "title": "Hijacked" } })
            )),
            "Forbidden"
        );
        assert_eq!(
            code(t.as_(who).call("deleteEvent", json!({ "eventId": id }))),
            "Forbidden"
        );
    }
    assert_eq!(
        view(&mut t, "owner", "getEvents", json!({}))[0]["title"],
        json!("Standup")
    );

    let updated = call(
        &mut t,
        "owner",
        "updateEvent",
        json!({ "eventId": id, "eventData": { "title": "Retro", "color": "red" } }),
    );
    assert_eq!(updated, id);
    let e = view(&mut t, "bob", "getEvents", json!({}));
    assert_eq!(e[0]["title"], json!("Retro"));
    assert_eq!(e[0]["color"], json!("red"));
    assert_eq!(e[0]["description"], json!("daily"), "unnamed fields stay");

    assert_eq!(
        call(&mut t, "owner", "deleteEvent", json!({ "eventId": id })),
        id
    );
    assert_eq!(view(&mut t, "owner", "getEvents", json!({})), json!([]));
    assert_eq!(view(&mut t, "bob", "getEvents", json!({})), json!([]));
    assert_eq!(
        names(&t, "bob"),
        [
            "CalendarEventCreated",
            "CalendarEventEdited",
            "CalendarEventDeleted"
        ]
    );
}

#[test]
fn a_missing_event_is_not_found() {
    let mut t = app();
    assert_eq!(
        t.as_("owner")
            .call("deleteEvent", json!({ "eventId": "nope" })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "id": "nope" })
        })
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("updateEvent", json!({ "eventId": "nope", "eventData": {} }))
        ),
        "NotFound"
    );
}

/// v1 could only drop a row a patched node forged. Here the owner is never an
/// argument: there is no way to write an event as someone else.
#[test]
fn an_owner_cannot_be_forged() {
    let mut t = app();
    let mut forged = event(&["owner"]);
    forged["owner"] = json!("owner");
    assert_eq!(
        code(
            t.as_("bob")
                .call("createEvent", json!({ "eventData": forged }))
        ),
        "BadArgs"
    );
    let id = call(
        &mut t,
        "bob",
        "createEvent",
        json!({ "eventData": event(&["owner"]) }),
    );
    let mine = view(&mut t, "owner", "getEvents", json!({}));
    assert_eq!(ids(&mine), [id.as_str().unwrap()]);
    assert_eq!(mine[0]["owner"], json!("bob"), "the caller is the owner");
    assert_eq!(
        code(t.as_("owner").call("deleteEvent", json!({ "eventId": id }))),
        "Forbidden"
    );
}

#[test]
fn removing_a_peer_drops_the_event_from_their_calendar_and_tells_them() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["bob", "cy"]) }),
    );
    call(
        &mut t,
        "owner",
        "updateEvent",
        json!({ "eventId": id, "eventData": { "peers": ["cy"] } }),
    );
    assert_eq!(view(&mut t, "bob", "getEvents", json!({})), json!([]));
    assert_eq!(
        ids(&view(&mut t, "cy", "getEvents", json!({}))),
        [id.as_str().unwrap()]
    );
    // bob hears of the edit that removed him.
    assert_eq!(
        names(&t, "bob"),
        ["CalendarEventCreated", "CalendarEventEdited"]
    );
}

#[test]
fn removing_every_peer_does_not_make_a_shared_event_private() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    call(
        &mut t,
        "owner",
        "updateEvent",
        json!({ "eventId": id, "eventData": { "peers": [] } }),
    );
    let shared = view(&mut t, "owner", "getEvents", json!({}));
    assert_eq!(ids(&shared), [id.as_str().unwrap()]);
    assert_eq!(shared[0]["peers"], json!([]));
    assert_eq!(
        view(&mut t, "owner", "getPrivateEvents", json!({})),
        json!([])
    );
}

#[test]
fn bad_peers_are_refused() {
    let mut t = app();
    for peers in [json!([""]), json!(["x".repeat(257)])] {
        let mut e = event(&[]);
        e["peers"] = peers;
        assert_eq!(
            code(
                t.as_("owner")
                    .call("createEvent", json!({ "eventData": e }))
            ),
            "Invalid"
        );
    }
    let mut many = event(&[]);
    many["peers"] = json!((0..101).map(|i| format!("p{i}")).collect::<Vec<_>>());
    assert_eq!(
        code(
            t.as_("owner")
                .call("createEvent", json!({ "eventData": many }))
        ),
        "Invalid"
    );
}

// ── private events ───────────────────────────────────────────────────────────

#[test]
fn an_event_with_no_peers_is_private() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&[]) }),
    );
    assert_eq!(view(&mut t, "owner", "getEvents", json!({})), json!([]));
    let private = view(&mut t, "owner", "getPrivateEvents", json!({}));
    assert_eq!(ids(&private), [id.as_str().unwrap()]);
    assert_eq!(private[0]["private"], json!(true));
    assert_eq!(private[0]["owner"], json!("owner"));
    assert_eq!(private[0]["peers"], json!([]));
    // Nobody else hears of it, nor sees it.
    assert!(names(&t, "owner").is_empty());
    assert!(names(&t, "bob").is_empty());
    assert_eq!(
        view(&mut t, "bob", "getPrivateEvents", json!({})),
        json!([])
    );
}

#[test]
fn create_private_event_ignores_peers() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createPrivateEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    assert_eq!(view(&mut t, "bob", "getEvents", json!({})), json!([]));
    let private = view(&mut t, "owner", "getPrivateEvents", json!({}));
    assert_eq!(ids(&private), [id.as_str().unwrap()]);
    assert_eq!(private[0]["peers"], json!([]));
}

#[test]
fn private_events_can_be_updated_and_deleted_by_their_owner_only() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createPrivateEvent",
        json!({ "eventData": event(&[]) }),
    );
    // Another account cannot reach it: their private rows are their own.
    for who in ["bob", "gus"] {
        assert_eq!(
            code(t.as_(who).call(
                "updatePrivateEvent",
                json!({ "eventId": id, "eventData": { "title": "x" } })
            )),
            "NotFound"
        );
        assert_eq!(
            code(
                t.as_(who)
                    .call("deletePrivateEvent", json!({ "eventId": id }))
            ),
            "NotFound"
        );
    }
    call(
        &mut t,
        "owner",
        "updatePrivateEvent",
        json!({ "eventId": id, "eventData": { "title": "Dentist", "peers": [] } }),
    );
    let private = view(&mut t, "owner", "getPrivateEvents", json!({}));
    assert_eq!(private[0]["title"], json!("Dentist"));
    assert_eq!(
        call(
            &mut t,
            "owner",
            "deletePrivateEvent",
            json!({ "eventId": id })
        ),
        id
    );
    assert_eq!(
        view(&mut t, "owner", "getPrivateEvents", json!({})),
        json!([])
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("deletePrivateEvent", json!({ "eventId": id }))
        ),
        "NotFound"
    );
}

#[test]
fn adding_a_peer_promotes_a_private_event_keeping_its_id() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&[]) }),
    );
    call(
        &mut t,
        "owner",
        "updatePrivateEvent",
        json!({ "eventId": id, "eventData": { "peers": ["bob"], "title": "Pairing" } }),
    );
    assert_eq!(
        view(&mut t, "owner", "getPrivateEvents", json!({})),
        json!([])
    );
    let shared = view(&mut t, "bob", "getEvents", json!({}));
    assert_eq!(ids(&shared), [id.as_str().unwrap()]);
    assert_eq!(shared[0]["title"], json!("Pairing"));
    assert_eq!(shared[0]["description"], json!("daily"));
    assert_eq!(shared[0]["owner"], json!("owner"));
    assert_eq!(names(&t, "bob"), ["CalendarEventCreated"]);
}

#[test]
fn private_and_shared_events_are_separate() {
    let mut t = app();
    let private = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&[]) }),
    );
    let shared = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    assert_eq!(
        ids(&view(&mut t, "owner", "getEvents", json!({}))),
        [shared.as_str().unwrap()]
    );
    assert_eq!(
        ids(&view(&mut t, "owner", "getPrivateEvents", json!({}))),
        [private.as_str().unwrap()]
    );
    // A private id is not a shared event, and the other way round.
    assert_eq!(
        code(
            t.as_("owner")
                .call("deleteEvent", json!({ "eventId": private }))
        ),
        "NotFound"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("deletePrivateEvent", json!({ "eventId": shared }))
        ),
        "NotFound"
    );
}

#[test]
fn each_account_has_its_own_events() {
    let mut t = app();
    let a = call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["cy"]) }),
    );
    let b = call(
        &mut t,
        "bob",
        "createEvent",
        json!({ "eventData": event(&["cy"]) }),
    );
    let g = call(
        &mut t,
        "gus",
        "createEvent",
        json!({ "eventData": event(&[]) }),
    );
    assert_ne!(a, b);
    let mut both = vec![
        a.as_str().unwrap().to_owned(),
        b.as_str().unwrap().to_owned(),
    ];
    both.sort();
    assert_eq!(ids(&view(&mut t, "cy", "getEvents", json!({}))), both);
    assert_eq!(
        ids(&view(&mut t, "gus", "getPrivateEvents", json!({}))),
        [g.as_str().unwrap()]
    );
}

// ── booking links ────────────────────────────────────────────────────────────

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Monday 09:00-11:00 UTC, 30-minute meetings, two weeks ahead.
fn link(token: &str) -> Value {
    json!({
        "tokenHash": hash(token),
        "grantId": format!("key-{token}"),
        "title": "Intro call",
        "description": "Say hi",
        "durationMinutes": 30,
        "weeklyHours": [{ "weekday": 0, "startMinute": 540, "endMinute": 660 }],
        "utcOffsetMinutes": 0,
        "horizonDays": 14,
    })
}

fn guest() -> Value {
    json!({ "name": "Gina Guest", "email": "gina@example.com", "note": "hello" })
}

fn slots(t: &mut TestApp, token: &str) -> Vec<u64> {
    let answer = t
        .api_key(&format!("key-{token}"), "owner")
        .view(
            "getAvailableSlots",
            json!({ "token": token, "fromMs": "0", "toMs": (MONDAY + 7 * DAY).to_string() }),
        )
        .expect("slots");
    answer
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().expect("a decimal string").parse().unwrap())
        .collect()
}

/// Sunday before the Monday window.
fn at_sunday(t: &mut TestApp) {
    t.set_time(MONDAY - DAY);
}

#[test]
fn a_link_books_once_then_reschedules_and_cancels() {
    let mut t = app();
    at_sunday(&mut t);
    call(&mut t, "owner", "setUsername", json!({ "username": "Ann" }));
    let made = call(
        &mut t,
        "owner",
        "createBookingLink",
        json!({ "link": link("tok") }),
    );
    assert_eq!(made["linkId"], json!(hash("tok")));
    assert_eq!(made["status"], json!("open"));
    assert!(made["createdAtMs"].is_string());
    assert_eq!(made["expiresAtMs"], json!(null));

    let nine = MONDAY + 9 * HOUR;
    let half = 30 * 60_000;
    assert_eq!(
        slots(&mut t, "tok"),
        [nine, nine + half, nine + 2 * half, nine + 3 * half]
    );

    // The guest's calls arrive with the owner's API key.
    let page = t
        .api_key("key-tok", "owner")
        .view("getBookingPage", json!({ "token": "tok" }))
        .unwrap();
    assert_eq!(page["title"], json!("Intro call"));
    assert_eq!(page["ownerName"], json!("Ann"));
    assert_eq!(page["status"], json!("open"));
    assert_eq!(page["booking"], json!(null));

    let booked = t
        .api_key("key-tok", "owner")
        .call(
            "bookSlot",
            json!({ "token": "tok", "startMs": nine.to_string(), "guest": guest() }),
        )
        .unwrap();
    assert_eq!(booked["startMs"], json!(nine.to_string()));
    assert_eq!(booked["endMs"], json!((nine + half).to_string()));
    assert_eq!(booked["guestName"], json!("Gina Guest"));
    assert_eq!(booked["rescheduledCount"], json!(0));

    // The meeting is a private event of the owner's, and blocks its slot.
    let private = view(&mut t, "owner", "getPrivateEvents", json!({}));
    assert_eq!(private[0]["title"], json!("Intro call with Gina Guest"));
    assert_eq!(private[0]["start"], json!("2026-07-06T09:00:00.000Z"));
    assert_eq!(
        slots(&mut t, "tok"),
        [nine + half, nine + 2 * half, nine + 3 * half]
    );

    // Books once.
    assert_eq!(
        code(t.api_key("key-tok", "owner").call(
            "bookSlot",
            json!({ "token": "tok", "startMs": (nine + half).to_string(), "guest": guest() })
        )),
        "AlreadyBooked"
    );

    let moved = t
        .api_key("key-tok", "owner")
        .call(
            "rescheduleBooking",
            json!({ "token": "tok", "startMs": (nine + 2 * half).to_string() }),
        )
        .unwrap();
    assert_eq!(moved["startMs"], json!((nine + 2 * half).to_string()));
    assert_eq!(moved["rescheduledCount"], json!(1));
    let private = view(&mut t, "owner", "getPrivateEvents", json!({}));
    assert_eq!(private[0]["start"], json!("2026-07-06T10:00:00.000Z"));

    let links = view(&mut t, "owner", "listBookingLinks", json!({}));
    assert_eq!(links[0]["status"], json!("booked"));
    assert_eq!(links[0]["booking"]["guestEmail"], json!("gina@example.com"));

    t.api_key("key-tok", "owner")
        .call("cancelBooking", json!({ "token": "tok" }))
        .unwrap();
    assert_eq!(
        view(&mut t, "owner", "getPrivateEvents", json!({})),
        json!([])
    );
    assert!(
        slots(&mut t, "tok").is_empty(),
        "a cancelled link offers nothing"
    );
    assert_eq!(
        code(t.api_key("key-tok", "owner").call(
            "bookSlot",
            json!({ "token": "tok", "startMs": nine.to_string(), "guest": guest() })
        )),
        "LinkCancelled"
    );
    assert_eq!(
        code(
            t.api_key("key-tok", "owner")
                .call("cancelBooking", json!({ "token": "tok" }))
        ),
        "NotBooked"
    );
    assert_eq!(
        code(t.api_key("key-tok", "owner").call(
            "rescheduleBooking",
            json!({ "token": "tok", "startMs": nine.to_string() })
        )),
        "NotBooked"
    );
}

#[test]
fn a_slot_must_be_one_the_link_offers() {
    let mut t = app();
    at_sunday(&mut t);
    call(
        &mut t,
        "owner",
        "createBookingLink",
        json!({ "link": link("tok") }),
    );
    // Off the grid, outside the window, and busy with a shared event.
    call(
        &mut t,
        "bob",
        "createEvent",
        json!({ "eventData": event(&["owner"]) }),
    );
    let nine = MONDAY + 9 * HOUR;
    for start in [nine + 60_000, MONDAY + 12 * HOUR, nine] {
        assert_eq!(
            code(t.api_key("key-tok", "owner").call(
                "bookSlot",
                json!({ "token": "tok", "startMs": start.to_string(), "guest": guest() })
            )),
            "SlotUnavailable",
            "{start}"
        );
    }
    let bad_guest = json!({ "name": "", "email": "x@y" });
    assert_eq!(
        code(t.api_key("key-tok", "owner").call(
            "bookSlot",
            json!({ "token": "tok", "startMs": (nine + HOUR).to_string(), "guest": bad_guest })
        )),
        "Invalid"
    );
}

#[test]
fn a_token_opens_only_its_own_owners_link() {
    let mut t = app();
    at_sunday(&mut t);
    call(
        &mut t,
        "owner",
        "createBookingLink",
        json!({ "link": link("tok") }),
    );
    // Another token, or the same token on another account, finds nothing.
    assert_eq!(
        t.api_key("key-x", "owner")
            .view("getBookingPage", json!({ "token": "other" })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "id": "booking link" })
        })
    );
    assert_eq!(
        code(
            t.as_("bob")
                .view("getBookingPage", json!({ "token": "tok" }))
        ),
        "NotFound"
    );
    assert_eq!(
        view(&mut t, "bob", "listBookingLinks", json!({})),
        json!([])
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("deleteBookingLink", json!({ "linkId": hash("tok") }))
        ),
        "NotFound"
    );
    // A token makes one link.
    assert_eq!(
        code(
            t.as_("owner")
                .call("createBookingLink", json!({ "link": link("tok") }))
        ),
        "LinkExists"
    );
    assert_eq!(
        call(
            &mut t,
            "owner",
            "deleteBookingLink",
            json!({ "linkId": hash("tok") })
        ),
        json!(hash("tok"))
    );
    assert_eq!(
        code(
            t.api_key("key-tok", "owner")
                .view("getBookingPage", json!({ "token": "tok" }))
        ),
        "NotFound"
    );
}

#[test]
fn links_list_newest_first() {
    let mut t = app();
    at_sunday(&mut t);
    call(
        &mut t,
        "owner",
        "createBookingLink",
        json!({ "link": link("a") }),
    );
    t.advance(60_000);
    call(
        &mut t,
        "owner",
        "createBookingLink",
        json!({ "link": link("b") }),
    );
    let links = view(&mut t, "owner", "listBookingLinks", json!({}));
    let ids: Vec<&str> = links
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["linkId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [hash("b"), hash("a")]);
}

#[test]
fn a_slot_window_is_clamped_to_now_and_its_maximum_width() {
    let mut t = app();
    let mut long = link("tok");
    long["horizonDays"] = json!(365);
    long["weeklyHours"] = json!([0, 1, 2, 3, 4, 5, 6]
        .iter()
        .map(|d| json!({ "weekday": d, "startMinute": 0, "endMinute": 1440 }))
        .collect::<Vec<_>>());
    long["durationMinutes"] = json!(480);
    at_sunday(&mut t);
    call(
        &mut t,
        "owner",
        "createBookingLink",
        json!({ "link": long }),
    );
    let now = MONDAY - DAY;
    let all = t
        .api_key("key-tok", "owner")
        .view(
            "getAvailableSlots",
            json!({ "token": "tok", "fromMs": "0", "toMs": u64::MAX.to_string() }),
        )
        .unwrap();
    let all: Vec<u64> = all
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().parse().unwrap())
        .collect();
    assert_eq!(all.first().copied(), Some(now));
    assert!(*all.last().unwrap() < now + 62 * DAY);
    assert_eq!(all.len(), 62 * 3);
}

#[test]
fn an_expired_link_offers_and_books_nothing() {
    let mut t = app();
    at_sunday(&mut t);
    let mut expiring = link("tok");
    expiring["expiresAtMs"] = json!((MONDAY - DAY + HOUR).to_string());
    call(
        &mut t,
        "owner",
        "createBookingLink",
        json!({ "link": expiring }),
    );
    t.set_time(MONDAY);
    let slots = json!({ "token": "tok", "fromMs": "0", "toMs": (MONDAY + DAY).to_string() });
    // A view's clock is the time of the app's last logged run (here Sunday,
    // before the expiry), not the wall clock: it still answers, with no slot
    // (they are past the expiry anyway). v1's views read the node's clock.
    assert_eq!(
        t.api_key("key-tok", "owner")
            .view("getAvailableSlots", slots.clone()),
        Ok(json!([]))
    );
    // A call runs at the time it is logged: the link has expired.
    assert_eq!(
        code(t.api_key("key-tok", "owner").call(
            "bookSlot",
            json!({ "token": "tok", "startMs": (MONDAY + 9 * HOUR).to_string(), "guest": guest() })
        )),
        "LinkExpired"
    );
    // That run (refused, but logged) moved the views' clock on too.
    assert_eq!(
        code(
            t.api_key("key-tok", "owner")
                .view("getAvailableSlots", slots)
        ),
        "LinkExpired"
    );
}

#[test]
fn link_validation_refuses_what_v1_refused() {
    let mut t = app();
    let cases = [
        ("tokenHash", json!("not-a-hash")),
        ("title", json!("  ")),
        ("durationMinutes", json!(4)),
        ("horizonDays", json!(0)),
        ("utcOffsetMinutes", json!(15 * 60)),
        ("weeklyHours", json!([])),
        (
            "weeklyHours",
            json!([{ "weekday": 0, "startMinute": 600, "endMinute": 540 }]),
        ),
    ];
    for (field, value) in cases {
        let mut bad = link("tok");
        bad[field] = value;
        assert_eq!(
            code(
                t.as_("owner")
                    .call("createBookingLink", json!({ "link": bad }))
            ),
            "Invalid",
            "{field}"
        );
    }
    assert_eq!(
        view(&mut t, "owner", "listBookingLinks", json!({})),
        json!([])
    );
}

// ── access and wire ──────────────────────────────────────────────────────────

/// The org decides who reaches the app; the methods decide the rest.
#[test]
fn who_reaches_the_calendar() {
    let mut t = app();
    assert_eq!(
        t.anonymous().view("getEvents", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.anonymous()
            .view("getBookingPage", json!({ "token": "t" })),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory")
            .call("createEvent", json!({ "eventData": event(&[]) })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    // A guest keeps a calendar of their own, as any v1 context member could.
    call(
        &mut t,
        "gus",
        "createEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    assert_eq!(
        view(&mut t, "bob", "getEvents", json!({}))
            .as_array()
            .map(Vec::len),
        Some(1)
    );
}

#[test]
fn a_removed_member_reaches_nothing() {
    let mut t = app();
    call(
        &mut t,
        "owner",
        "createEvent",
        json!({ "eventData": event(&["bob"]) }),
    );
    t.remove_member("bob");
    assert_eq!(
        t.as_("bob").view("getEvents", json!({})),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
}

#[test]
fn malformed_arguments_and_v1_names_are_refused() {
    let mut t = app();
    for args in [
        json!({}),
        json!({ "eventData": event(&[]), "timestamp": "1" }),
        json!({ "eventData": { "title": "only" } }),
    ] {
        assert_eq!(code(t.as_("owner").call("createEvent", args)), "BadArgs");
    }
    assert_eq!(
        code(
            t.as_("owner")
                .call("create_event", json!({ "eventData": event(&[]) }))
        ),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("createEvent", json!({ "eventData": event(&[]) }))
        ),
        "NotAView"
    );
    assert_eq!(
        view(&mut t, "owner", "getPrivateEvents", json!({})),
        json!([])
    );
}
