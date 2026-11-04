//! The team on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's storage-tier ("forged row") tests as the method
//! checks that replace them, and the access and wire checks v1 could not
//! express. v1's migration tests are gone with the migration (see the README).

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

const DAY: &str = "2026-10-13";

/// The owner, two members (`bob`, `cy`) and a guest (`gus`).
fn team() -> TestApp {
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

/// The app error a call fails with, as `(code, fields)`.
fn refused(t: &mut TestApp, who: &str, method: &str, args: Value) -> (String, Value) {
    match t.as_(who).call(method, args) {
        Err(Failure::App { code, fields }) => (code, fields),
        other => panic!("{who} {method}: expected an app error, got {other:?}"),
    }
}

fn code(t: &mut TestApp, who: &str, method: &str, args: Value) -> String {
    refused(t, who, method, args).0
}

fn post(t: &mut TestApp, who: &str, day: &str, done: &str, blockers: &str) {
    call(
        t,
        who,
        "postUpdate",
        json!({ "day": day, "done": done, "next": "more", "blockers": blockers }),
    );
}

fn log(t: &mut TestApp, who: &str, title: &str, supersedes: Option<&str>) -> String {
    log_with(t, who, title, supersedes, json!([]), json!([]), None)
}

fn log_with(
    t: &mut TestApp,
    who: &str,
    title: &str,
    supersedes: Option<&str>,
    tags: Value,
    with: Value,
    from_day: Option<&str>,
) -> String {
    let id = call(
        t,
        who,
        "logDecision",
        json!({
            "title": title,
            "decision": format!("{title}: decided"),
            "rationale": "because",
            "supersedes": supersedes,
            "tags": tags,
            "with": with,
            "fromDay": from_day,
        }),
    );
    id.as_str().expect("an id").to_owned()
}

fn list(t: &mut TestApp, args: Value) -> Value {
    let mut full = json!({
        "search": null, "tag": null, "fromDay": null,
        "standingOnly": false, "cursor": null, "limit": 0
    });
    for (k, v) in args.as_object().expect("an object") {
        full[k] = v.clone();
    }
    view(t, "owner", "listDecisions", full)
}

fn titles(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|d| d["title"].as_str().expect("a title").to_owned())
        .collect()
}

fn authors(day: &Value) -> Vec<&str> {
    day["updates"]
        .as_array()
        .expect("updates")
        .iter()
        .map(|u| u["author"].as_str().expect("an author"))
        .collect()
}

fn events(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── days ─────────────────────────────────────────────────────────────────────

#[test]
fn a_day_must_be_a_real_date() {
    let mut t = team();
    for bad in [
        "2026-02-30",
        "2026-13-01",
        "2026-1-01",
        "26-01-01",
        "1999-12-31",
        "2026-01-01x",
        "today",
        "",
    ] {
        assert_eq!(
            refused(
                &mut t,
                "owner",
                "postUpdate",
                json!({ "day": bad, "done": "x", "next": "", "blockers": "" })
            ),
            ("NotADate".to_owned(), json!({ "day": bad })),
            "{bad:?}"
        );
        assert!(matches!(
            t.as_("owner").view("getDay", json!({ "day": bad })),
            Err(Failure::App { ref code, .. }) if code == "NotADate"
        ));
    }
    // 2024 is a leap year, 2100 is not.
    post(&mut t, "owner", "2024-02-29", "leap", "");
    assert_eq!(
        code(
            &mut t,
            "owner",
            "postUpdate",
            json!({ "day": "2100-02-29", "done": "x", "next": "", "blockers": "" })
        ),
        "NotADate"
    );
}

// ── standups ─────────────────────────────────────────────────────────────────

#[test]
fn an_update_round_trips_with_its_author_from_the_caller() {
    let mut t = team();
    call(
        &mut t,
        "owner",
        "postUpdate",
        json!({ "day": DAY, "done": "  wrote it ", "next": "ship it", "blockers": "" }),
    );
    let day = view(&mut t, "bob", "getDay", json!({ "day": DAY }));
    assert_eq!(
        day,
        json!({
            "day": DAY,
            "updates": [{
                "day": DAY,
                "author": "owner",
                "authorName": "",
                "done": "wrote it",
                "next": "ship it",
                "blockers": "",
                "createdAt": common::T0.to_string(),
                "editedAt": common::T0.to_string(),
                "helpers": [],
            }]
        })
    );
    assert_eq!(events(&t, "bob"), ["UpdatePosted"]);
    assert_eq!(
        t.events_for("bob")[0].1,
        json!({ "day": DAY, "account": "owner" })
    );
}

#[test]
fn an_empty_update_is_refused_and_an_oversized_one_too() {
    let mut t = team();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "postUpdate",
            json!({ "day": DAY, "done": " ", "next": "", "blockers": "\n" })
        ),
        ("Empty".to_owned(), json!({ "field": "update" }))
    );
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "postUpdate",
            json!({ "day": DAY, "done": "x".repeat(2_001), "next": "", "blockers": "" })
        ),
        (
            "TooLong".to_owned(),
            json!({ "field": "done", "limit": 2000 })
        )
    );
    // Exactly the limit is fine.
    post(&mut t, "owner", DAY, &"x".repeat(2_000), "");
    assert!(
        events(&t, "bob").len() == 1,
        "refused posts emit nothing and write nothing"
    );
}

/// One entry per account per day: posting again rewrites it, keeps when it
/// was first posted, and does not add a second row.
#[test]
fn posting_twice_the_same_day_rewrites_the_update() {
    let mut t = team();
    post(&mut t, "owner", DAY, "first", "");
    t.advance(60_000);
    post(&mut t, "owner", DAY, "second", "");
    let day = view(&mut t, "owner", "getDay", json!({ "day": DAY }));
    assert_eq!(authors(&day), ["owner"]);
    let u = &day["updates"][0];
    assert_eq!(u["done"], "second");
    assert_eq!(u["createdAt"], common::T0.to_string());
    assert_eq!(u["editedAt"], (common::T0 + 60_000).to_string());
}

/// Bob posting for the same day lands BESIDE the owner's update, never over
/// it: the key is `(day, caller)`, and no argument names the author.
#[test]
fn someone_else_posting_the_same_day_cannot_touch_mine() {
    let mut t = team();
    post(&mut t, "owner", DAY, "mine", "");
    post(&mut t, "bob", DAY, "his", "stuck");
    let day = view(&mut t, "cy", "getDay", json!({ "day": DAY }));
    assert_eq!(authors(&day), ["bob", "owner"], "ordered by author");
    assert_eq!(day["updates"][0]["done"], "his");
    assert_eq!(day["updates"][1]["done"], "mine");
    // An `author` argument is not a parameter: refused before anything runs.
    assert_eq!(
        code(
            &mut t,
            "bob",
            "postUpdate",
            json!({ "day": DAY, "done": "forged", "next": "", "blockers": "", "author": "owner" })
        ),
        "BadArgs"
    );
}

#[test]
fn clearing_needs_an_update_and_posting_again_restores_it() {
    let mut t = team();
    assert_eq!(
        refused(&mut t, "owner", "clearUpdate", json!({ "day": DAY })),
        ("NoUpdate".to_owned(), json!({ "day": DAY }))
    );
    post(&mut t, "owner", DAY, "x", "");
    post(&mut t, "bob", DAY, "y", "");
    // Bob clearing "his" update for the day removes HIS, never the owner's.
    call(&mut t, "bob", "clearUpdate", json!({ "day": DAY }));
    assert_eq!(
        code(&mut t, "bob", "clearUpdate", json!({ "day": DAY })),
        "NoUpdate"
    );
    let day = view(&mut t, "owner", "getDay", json!({ "day": DAY }));
    assert_eq!(authors(&day), ["owner"]);

    t.advance(1_000);
    post(&mut t, "bob", DAY, "again", "");
    let day = view(&mut t, "owner", "getDay", json!({ "day": DAY }));
    assert_eq!(authors(&day), ["bob", "owner"]);
    // A cleared update is gone: posting again starts a new one.
    assert_eq!(
        day["updates"][0]["createdAt"],
        (common::T0 + 1_000).to_string()
    );
    assert_eq!(
        events(&t, "cy"),
        [
            "UpdatePosted",
            "UpdatePosted",
            "UpdateCleared",
            "UpdatePosted"
        ]
    );
}

#[test]
fn days_list_newest_first_with_counts_and_page_without_gaps() {
    let mut t = team();
    for d in ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"] {
        post(&mut t, "owner", d, "x", "");
    }
    post(&mut t, "bob", "2026-10-12", "y", "blocked");
    let page = view(
        &mut t,
        "owner",
        "listDays",
        json!({ "before": null, "limit": 2 }),
    );
    assert_eq!(
        page,
        json!({
            "days": [
                { "day": "2026-10-13", "updates": 1, "blocked": 0 },
                { "day": "2026-10-12", "updates": 2, "blocked": 1 },
            ],
            "nextCursor": "2026-10-12",
        })
    );
    let page = view(
        &mut t,
        "owner",
        "listDays",
        json!({ "before": "2026-10-12", "limit": 2 }),
    );
    assert_eq!(
        page,
        json!({
            "days": [
                { "day": "2026-10-11", "updates": 1, "blocked": 0 },
                { "day": "2026-10-10", "updates": 1, "blocked": 0 },
            ],
            "nextCursor": null,
        })
    );
    // A day nobody has an update for any more drops out of the list.
    call(
        &mut t,
        "owner",
        "clearUpdate",
        json!({ "day": "2026-10-13" }),
    );
    let page = view(
        &mut t,
        "owner",
        "listDays",
        json!({ "before": null, "limit": 1 }),
    );
    assert_eq!(page["days"][0]["day"], "2026-10-12");
}

#[test]
fn page_sizes_are_defaulted_and_capped() {
    let mut t = team();
    // 2026-01-01 .. 2026-04-10: 100 days, and a few more.
    let mut day = (2026, 1, 1);
    for _ in 0..105 {
        post(
            &mut t,
            "owner",
            &format!("{:04}-{:02}-{:02}", day.0, day.1, day.2),
            "x",
            "",
        );
        day = if day.2 < 28 {
            (day.0, day.1, day.2 + 1)
        } else {
            (day.0, day.1 + 1, 1)
        };
    }
    let page = |t: &mut TestApp, limit: u32| -> usize {
        view(
            t,
            "owner",
            "listDays",
            json!({ "before": null, "limit": limit }),
        )["days"]
            .as_array()
            .expect("days")
            .len()
    };
    assert_eq!(page(&mut t, 0), 20);
    assert_eq!(page(&mut t, 1_000), 100);
    assert_eq!(page(&mut t, 7), 7);
}

/// Only each member's LATEST update counts: a blocker you posted past is not
/// blocking anyone any more.
#[test]
fn current_blockers_are_each_members_latest_update_only() {
    let mut t = team();
    post(&mut t, "owner", "2026-10-12", "x", "old blocker");
    post(&mut t, "owner", "2026-10-13", "x", "");
    post(&mut t, "bob", "2026-10-11", "y", "waiting on review");
    post(&mut t, "cy", "2026-10-13", "z", "no access");
    let blockers = view(&mut t, "owner", "currentBlockers", json!({}));
    let who: Vec<(&str, &str)> = blockers
        .as_array()
        .expect("a list")
        .iter()
        .map(|u| {
            (
                u["author"].as_str().expect("author"),
                u["blockers"].as_str().expect("blockers"),
            )
        })
        .collect();
    assert_eq!(
        who,
        [("cy", "no access"), ("bob", "waiting on review")],
        "newest day first"
    );
    // Clearing the latest makes the one before it current again.
    call(
        &mut t,
        "owner",
        "clearUpdate",
        json!({ "day": "2026-10-13" }),
    );
    let blockers = view(&mut t, "owner", "currentBlockers", json!({}));
    assert_eq!(blockers.as_array().expect("a list").len(), 3);
}

#[test]
fn members_are_everyone_who_posted_or_named_themselves() {
    let mut t = team();
    assert_eq!(view(&mut t, "owner", "members", json!({})), json!([]));
    post(&mut t, "owner", "2026-10-12", "x", "");
    post(&mut t, "owner", "2026-10-13", "x", "");
    call(&mut t, "cy", "setName", json!({ "name": "Cy" }));
    post(&mut t, "bob", DAY, "y", "");
    call(&mut t, "bob", "clearUpdate", json!({ "day": DAY }));
    assert_eq!(
        view(&mut t, "bob", "members", json!({})),
        json!([
            { "account": "cy", "name": "Cy", "lastDay": "" },
            { "account": "owner", "name": "", "lastDay": "2026-10-13" },
        ]),
        "bob has neither an update nor a name any more"
    );
}

// ── names and the team ───────────────────────────────────────────────────────

#[test]
fn a_name_reaches_other_readers_and_an_empty_one_clears_it() {
    let mut t = team();
    assert_eq!(view(&mut t, "owner", "whoami", json!({})), json!("owner"));
    assert_eq!(view(&mut t, "bob", "whoami", json!({})), json!("bob"));
    call(&mut t, "owner", "setName", json!({ "name": "  Alice " }));
    post(&mut t, "owner", DAY, "x", "");
    assert_eq!(
        view(&mut t, "bob", "getName", json!({ "account": "owner" })),
        json!("Alice")
    );
    let day = view(&mut t, "bob", "getDay", json!({ "day": DAY }));
    assert_eq!(day["updates"][0]["authorName"], "Alice");
    assert_eq!(
        view(&mut t, "bob", "getName", json!({ "account": "nobody" })),
        json!("")
    );
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "setName",
            json!({ "name": "x".repeat(65) })
        ),
        (
            "TooLong".to_owned(),
            json!({ "field": "name", "limit": 64 })
        )
    );
    call(&mut t, "owner", "setName", json!({ "name": "" }));
    assert_eq!(
        view(&mut t, "bob", "getName", json!({ "account": "owner" })),
        json!("")
    );
    assert_eq!(
        events(&t, "bob"),
        ["ProfileSet", "UpdatePosted", "ProfileSet"]
    );
    assert_eq!(t.events_for("bob")[2].1, json!({ "account": "owner" }));
}

/// v1's `UserStorage`: you can only name yourself. There is no `account`
/// argument, so the call that would name someone else does not exist.
#[test]
fn nobody_names_anyone_else() {
    let mut t = team();
    call(&mut t, "owner", "setName", json!({ "name": "Alice" }));
    assert_eq!(
        code(
            &mut t,
            "bob",
            "setName",
            json!({ "name": "Mallory", "account": "owner" })
        ),
        "BadArgs"
    );
    call(&mut t, "bob", "setName", json!({ "name": "Bob" }));
    assert_eq!(
        view(&mut t, "cy", "getName", json!({ "account": "owner" })),
        json!("Alice")
    );
    assert_eq!(
        view(&mut t, "cy", "getName", json!({ "account": "bob" })),
        json!("Bob")
    );
}

#[test]
fn any_member_names_the_team_and_an_empty_name_clears_it() {
    let mut t = team();
    assert_eq!(view(&mut t, "owner", "teamName", json!({})), json!(""));
    call(
        &mut t,
        "owner",
        "setTeamName",
        json!({ "name": " Platform " }),
    );
    assert_eq!(
        view(&mut t, "bob", "teamName", json!({})),
        json!("Platform")
    );
    call(&mut t, "bob", "setTeamName", json!({ "name": "Infra" }));
    assert_eq!(view(&mut t, "owner", "teamName", json!({})), json!("Infra"));
    assert_eq!(
        code(
            &mut t,
            "bob",
            "setTeamName",
            json!({ "name": "x".repeat(81) })
        ),
        "TooLong"
    );
    call(&mut t, "cy", "setTeamName", json!({ "name": "" }));
    assert_eq!(view(&mut t, "owner", "teamName", json!({})), json!(""));
    assert_eq!(
        t.events_for("owner"),
        [
            ("TeamRenamed".to_owned(), json!({ "name": "Platform" })),
            ("TeamRenamed".to_owned(), json!({ "name": "Infra" })),
            ("TeamRenamed".to_owned(), json!({ "name": "" })),
        ]
    );
}

// ── decisions ────────────────────────────────────────────────────────────────

#[test]
fn a_decision_round_trips_and_needs_a_title_and_a_decision() {
    let mut t = team();
    call(&mut t, "owner", "setName", json!({ "name": "Alice" }));
    let id = log(&mut t, "owner", "Release weekly", None);
    assert_eq!(id.len(), 32, "16 random bytes as hex");
    assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(
        view(&mut t, "bob", "getDecision", json!({ "id": id })),
        json!({
            "id": id,
            "author": "owner",
            "authorName": "Alice",
            "title": "Release weekly",
            "decision": "Release weekly: decided",
            "rationale": "because",
            "supersedes": "",
            "supersededBy": "",
            "createdAt": common::T0.to_string(),
            "tags": [],
            "with": [],
            "fromDay": "",
        })
    );
    assert_eq!(
        refused(&mut t, "owner", "getDecision", json!({ "id": "nope" })),
        ("NoSuchDecision".to_owned(), json!({ "id": "nope" }))
    );
    for (title, decision, field) in [(" ", "d", "title"), ("t", "", "decision")] {
        assert_eq!(
            refused(
                &mut t,
                "owner",
                "logDecision",
                json!({ "title": title, "decision": decision, "rationale": "",
                        "supersedes": null, "tags": [], "with": [], "fromDay": null })
            ),
            ("Empty".to_owned(), json!({ "field": field }))
        );
    }
    assert_eq!(
        code(
            &mut t,
            "owner",
            "logDecision",
            json!({ "title": "x".repeat(201), "decision": "d", "rationale": "",
                    "supersedes": null, "tags": [], "with": [], "fromDay": null })
        ),
        "TooLong"
    );
    assert_eq!(
        t.events_for("bob")[1],
        ("DecisionLogged".to_owned(), json!({ "id": id }))
    );
}

/// Anyone on the team may supersede anyone's decision, but the original is
/// never rewritten: it stays, attributed to its author, marked as replaced.
#[test]
fn a_teammate_supersedes_my_decision_without_rewriting_it() {
    let mut t = team();
    let old = log(&mut t, "owner", "Release every two weeks", None);
    t.advance(1_000);
    let new = log(&mut t, "bob", "Release weekly", Some(&old));
    let o = view(&mut t, "cy", "getDecision", json!({ "id": old }));
    assert_eq!(o["author"], "owner");
    assert_eq!(o["title"], "Release every two weeks");
    assert_eq!(o["supersededBy"], new.as_str());
    let n = view(&mut t, "cy", "getDecision", json!({ "id": new }));
    assert_eq!(n["supersedes"], old.as_str());
    assert_eq!(n["supersededBy"], "");
}

#[test]
fn superseding_needs_a_real_standing_decision() {
    let mut t = team();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "logDecision",
            json!({ "title": "t", "decision": "d", "rationale": "", "supersedes": "ghost",
                    "tags": [], "with": [], "fromDay": null })
        ),
        ("NoSuchDecision".to_owned(), json!({ "id": "ghost" }))
    );
    let a = log(&mut t, "owner", "A", None);
    let b = log(&mut t, "bob", "B", Some(&a));
    // Superseding the same decision twice is refused: the first replacement
    // the log applied is the one that stands.
    assert_eq!(
        refused(
            &mut t,
            "cy",
            "logDecision",
            json!({ "title": "C", "decision": "d", "rationale": "", "supersedes": a,
                    "tags": [], "with": [], "fromDay": null })
        ),
        ("AlreadySuperseded".to_owned(), json!({ "id": a, "by": b }))
    );
    // An empty `supersedes` is none.
    let c = call(
        &mut t,
        "cy",
        "logDecision",
        json!({ "title": "C", "decision": "d", "rationale": "", "supersedes": "",
                "tags": [], "with": [], "fromDay": null }),
    );
    let c = view(&mut t, "cy", "getDecision", json!({ "id": c }));
    assert_eq!(c["supersedes"], "");
}

/// v1's `WriteOnce`: no method changes or removes a logged decision. The
/// methods that exist are the whole surface; a forged "edit" is not one.
#[test]
fn a_logged_decision_cannot_be_rewritten() {
    let mut t = team();
    let id = log(&mut t, "owner", "Original", None);
    for method in ["editDecision", "updateDecision", "removeDecision"] {
        assert_eq!(
            code(&mut t, "bob", method, json!({ "id": id })),
            "UnknownMethod"
        );
    }
    // Logging a new decision never reuses an id.
    let other = log(&mut t, "bob", "Other", None);
    assert_ne!(id, other);
    let d = view(&mut t, "cy", "getDecision", json!({ "id": id }));
    assert_eq!(d["title"], "Original");
    assert_eq!(d["author"], "owner");
}

#[test]
fn the_log_lists_newest_first_searches_and_pages() {
    let mut t = team();
    let mut ids = Vec::new();
    for title in [
        "Use Postgres",
        "Adopt Rust",
        "Weekly releases",
        "Drop Postgres",
    ] {
        ids.push(log(&mut t, "owner", title, None));
        t.advance(1_000);
    }
    let _replaced = log(&mut t, "bob", "Monthly releases", Some(&ids[2]));
    assert_eq!(
        titles(&list(&mut t, json!({}))),
        [
            "Monthly releases",
            "Drop Postgres",
            "Weekly releases",
            "Adopt Rust",
            "Use Postgres"
        ]
    );
    assert_eq!(
        titles(&list(&mut t, json!({ "search": "postgres" }))),
        ["Drop Postgres", "Use Postgres"]
    );
    assert_eq!(
        titles(&list(&mut t, json!({ "search": "DECIDED", "limit": 1 }))),
        ["Monthly releases"]
    );
    assert_eq!(
        titles(&list(&mut t, json!({ "standingOnly": true }))),
        [
            "Monthly releases",
            "Drop Postgres",
            "Adopt Rust",
            "Use Postgres"
        ]
    );

    // Pages of two, without gaps or repeats.
    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = list(&mut t, json!({ "limit": 2, "cursor": cursor }));
        seen.extend(titles(&page));
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    assert_eq!(seen.len(), 5);
    assert_eq!(seen, titles(&list(&mut t, json!({}))));
}

#[test]
fn tags_are_normalized_and_counted() {
    let mut t = team();
    let a = log_with(
        &mut t,
        "owner",
        "A",
        None,
        json!([" Infra ", "infra", "Data Model", ""]),
        json!([]),
        None,
    );
    t.advance(1_000);
    let _b = log_with(
        &mut t,
        "bob",
        "B",
        None,
        json!(["infra", "release"]),
        json!([]),
        None,
    );
    assert_eq!(
        view(&mut t, "owner", "getDecision", json!({ "id": a }))["tags"],
        json!(["data-model", "infra"])
    );
    assert_eq!(
        view(&mut t, "owner", "tags", json!({})),
        json!([
            { "tag": "infra", "count": 2 },
            { "tag": "data-model", "count": 1 },
            { "tag": "release", "count": 1 },
        ])
    );
    assert_eq!(titles(&list(&mut t, json!({ "tag": "INFRA" }))), ["B", "A"]);
    assert_eq!(titles(&list(&mut t, json!({ "tag": "release" }))), ["B"]);
    assert_eq!(
        titles(&list(&mut t, json!({ "search": "model" }))),
        ["A"],
        "search reads tags too"
    );
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "logDecision",
            json!({ "title": "t", "decision": "d", "rationale": "", "supersedes": null,
                    "tags": ["a","b","c","d","e","f","g","h","i"], "with": [], "fromDay": null })
        ),
        ("TooMany".to_owned(), json!({ "field": "tags", "limit": 8 }))
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "logDecision",
            json!({ "title": "t", "decision": "d", "rationale": "", "supersedes": null,
                    "tags": ["x".repeat(33)], "with": [], "fromDay": null })
        ),
        "TooLong"
    );
}

#[test]
fn with_and_from_day_are_recorded_and_checked() {
    let mut t = team();
    call(&mut t, "bob", "setName", json!({ "name": "Bob" }));
    let _alone = log_with(
        &mut t,
        "owner",
        "Paired",
        None,
        json!(["pairing"]),
        json!([]),
        Some(DAY),
    );
    let id2 = log_with(
        &mut t,
        "owner",
        "With people",
        None,
        json!([]),
        json!(["cy", " bob ", "bob", ""]),
        Some(DAY),
    );
    let d = view(&mut t, "owner", "getDecision", json!({ "id": id2 }));
    assert_eq!(
        d["with"],
        json!([{ "account": "bob", "name": "Bob" }, { "account": "cy", "name": "" }])
    );
    assert_eq!(d["fromDay"], DAY);
    assert_eq!(
        titles(&list(&mut t, json!({ "fromDay": DAY }))),
        ["With people", "Paired"]
    );
    assert_eq!(
        titles(&list(&mut t, json!({ "fromDay": "2026-10-14" }))),
        Vec::<String>::new()
    );
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "logDecision",
            json!({ "title": "t", "decision": "d", "rationale": "", "supersedes": null,
                    "tags": [], "with": [], "fromDay": "someday" })
        ),
        ("NotADate".to_owned(), json!({ "day": "someday" }))
    );
    let too_many: Vec<String> = (0..21).map(|i| format!("a{i}")).collect();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "logDecision",
            json!({ "title": "t", "decision": "d", "rationale": "", "supersedes": null,
                    "tags": [], "with": too_many, "fromDay": null })
        ),
        (
            "TooMany".to_owned(),
            json!({ "field": "with", "limit": 20 })
        )
    );
}

// ── helping with blockers ────────────────────────────────────────────────────

fn bob_is_blocked(t: &mut TestApp) {
    post(t, "bob", DAY, "y", "waiting on review");
}

#[test]
fn an_offer_to_help_shows_on_the_blocker_everywhere() {
    let mut t = team();
    bob_is_blocked(&mut t);
    call(&mut t, "owner", "setName", json!({ "name": "Alice" }));
    call(
        &mut t,
        "owner",
        "offerHelp",
        json!({ "day": DAY, "author": "bob", "note": " I can review " }),
    );
    let helper = json!([{
        "account": "owner", "name": "Alice", "note": "I can review",
        "at": common::T0.to_string()
    }]);
    let day = view(&mut t, "cy", "getDay", json!({ "day": DAY }));
    assert_eq!(day["updates"][0]["helpers"], helper);
    let blockers = view(&mut t, "cy", "currentBlockers", json!({}));
    assert_eq!(blockers[0]["helpers"], helper);
    let week = view(&mut t, "cy", "getWeek", json!({ "start": DAY }));
    assert_eq!(week[0]["updates"][0]["helpers"], helper);
    assert_eq!(
        t.events_for("cy").last().cloned(),
        Some((
            "HelpOffered".to_owned(),
            json!({ "day": DAY, "author": "bob" })
        ))
    );
}

#[test]
fn help_needs_a_real_blocker_by_someone_else() {
    let mut t = team();
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "offerHelp",
            json!({ "day": DAY, "author": "bob", "note": "" })
        ),
        (
            "NoSuchUpdate".to_owned(),
            json!({ "day": DAY, "author": "bob" })
        )
    );
    post(&mut t, "bob", DAY, "fine", "");
    assert_eq!(
        refused(
            &mut t,
            "owner",
            "offerHelp",
            json!({ "day": DAY, "author": "bob", "note": "" })
        ),
        (
            "NoBlocker".to_owned(),
            json!({ "day": DAY, "author": "bob" })
        )
    );
    bob_is_blocked(&mut t);
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "offerHelp",
            json!({ "day": DAY, "author": "bob", "note": "" })
        ),
        ("OwnBlocker".to_owned(), json!({}))
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "offerHelp",
            json!({ "day": DAY, "author": "bob", "note": "x".repeat(501) })
        ),
        "TooLong"
    );
}

/// v1's `Authored` helps: each helper owns their own offer, and only the
/// helper withdraws it. Bob "withdrawing" Cy's offer finds no offer of his.
#[test]
fn offers_are_per_helper_and_only_the_helper_withdraws_theirs() {
    let mut t = team();
    post(&mut t, "owner", DAY, "x", "stuck");
    call(
        &mut t,
        "cy",
        "offerHelp",
        json!({ "day": DAY, "author": "owner", "note": "cy here" }),
    );
    t.advance(1_000);
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "day": DAY, "author": "owner", "note": "bob here" }),
    );
    // Changing a note keeps one offer per helper.
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "day": DAY, "author": "owner", "note": "bob, again" }),
    );
    let helpers = |t: &mut TestApp| -> Vec<(String, String)> {
        view(t, "owner", "getDay", json!({ "day": DAY }))["updates"][0]["helpers"]
            .as_array()
            .expect("helpers")
            .iter()
            .map(|h| {
                (
                    h["account"].as_str().expect("account").to_owned(),
                    h["note"].as_str().expect("note").to_owned(),
                )
            })
            .collect()
    };
    assert_eq!(
        helpers(&mut t),
        [
            ("cy".to_owned(), "cy here".to_owned()),
            ("bob".to_owned(), "bob, again".to_owned())
        ],
        "oldest offer first"
    );

    call(
        &mut t,
        "bob",
        "withdrawHelp",
        json!({ "day": DAY, "author": "owner" }),
    );
    assert_eq!(
        refused(
            &mut t,
            "bob",
            "withdrawHelp",
            json!({ "day": DAY, "author": "owner" })
        ),
        (
            "NoHelp".to_owned(),
            json!({ "day": DAY, "author": "owner" })
        ),
        "bob's own offer is gone, and cy's is not his to remove"
    );
    assert_eq!(helpers(&mut t), [("cy".to_owned(), "cy here".to_owned())]);
    assert_eq!(
        code(
            &mut t,
            "bob",
            "withdrawHelp",
            json!({ "day": DAY, "author": "owner", "helper": "cy" })
        ),
        "BadArgs"
    );
    // Events go to everyone the app reaches, a guest included.
    assert_eq!(
        events(&t, "gus"),
        [
            "UpdatePosted",
            "HelpOffered",
            "HelpOffered",
            "HelpOffered",
            "HelpWithdrawn"
        ]
    );
}

/// Once the blocker is gone the offers stop showing: help is about a
/// blocker, not about the person.
#[test]
fn offers_disappear_with_the_blocker() {
    let mut t = team();
    bob_is_blocked(&mut t);
    call(
        &mut t,
        "owner",
        "offerHelp",
        json!({ "day": DAY, "author": "bob", "note": "" }),
    );
    post(&mut t, "bob", DAY, "y", "");
    let day = view(&mut t, "owner", "getDay", json!({ "day": DAY }));
    assert_eq!(day["updates"][0]["helpers"], json!([]));
}

// ── the week ─────────────────────────────────────────────────────────────────

#[test]
fn a_week_is_seven_days_across_a_month_boundary() {
    let mut t = team();
    post(&mut t, "owner", "2026-02-27", "fri", "");
    post(&mut t, "bob", "2026-03-02", "mon", "");
    let week = view(&mut t, "owner", "getWeek", json!({ "start": "2026-02-26" }));
    let days: Vec<&str> = week
        .as_array()
        .expect("a list")
        .iter()
        .map(|d| d["day"].as_str().expect("day"))
        .collect();
    assert_eq!(
        days,
        [
            "2026-02-26",
            "2026-02-27",
            "2026-02-28",
            "2026-03-01",
            "2026-03-02",
            "2026-03-03",
            "2026-03-04"
        ]
    );
    assert_eq!(authors(&week[1]), ["owner"]);
    assert_eq!(authors(&week[4]), ["bob"]);
    let year_end = view(&mut t, "owner", "getWeek", json!({ "start": "2026-12-29" }));
    assert_eq!(year_end[6]["day"], "2027-01-04");
    assert_eq!(
        refused(&mut t, "owner", "getWeek", json!({ "start": "soon" })),
        ("NotADate".to_owned(), json!({ "day": "soon" }))
    );
}

// ── what v1 could not check ──────────────────────────────────────────────────

/// The org decides who reaches the team: members, the owner, and a guest (as
/// any member of a v1 context could write). Nobody else, and nobody anonymous.
#[test]
fn who_reaches_the_team() {
    let mut t = team();
    post(&mut t, "gus", DAY, "guest work", "");
    assert_eq!(
        authors(&view(&mut t, "owner", "getDay", json!({ "day": DAY }))),
        ["gus"]
    );
    for method in ["getDay", "postUpdate"] {
        let args = json!({ "day": DAY, "done": "x", "next": "", "blockers": "" });
        let args = if method == "getDay" {
            json!({ "day": DAY })
        } else {
            args
        };
        assert_eq!(
            t.anonymous().call(method, args.clone()),
            Err(Failure::Refused {
                status: 401,
                code: "UNAUTHENTICATED".to_owned()
            })
        );
        assert_eq!(
            t.as_("mallory").call(method, args),
            Err(Failure::Refused {
                status: 404,
                code: "NOT_FOUND".to_owned()
            })
        );
    }
    // The platform itself is not an author.
    assert!(matches!(
        t.system().call(
            "postUpdate",
            json!({ "day": DAY, "done": "x", "next": "", "blockers": "" })
        ),
        Err(Failure::App { ref code, .. }) if code == "Forbidden"
    ));
    assert_eq!(
        authors(&view(&mut t, "owner", "getDay", json!({ "day": DAY }))),
        ["gus"]
    );
}

/// A member removed from the org stops reaching the team; what they wrote
/// stays, attributed to them.
#[test]
fn a_removed_member_is_refused_and_their_updates_stay() {
    let mut t = team();
    post(&mut t, "bob", DAY, "before leaving", "");
    t.remove_member("bob");
    assert_eq!(
        t.as_("bob").view("getDay", json!({ "day": DAY })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(
        authors(&view(&mut t, "owner", "getDay", json!({ "day": DAY }))),
        ["bob"]
    );
}

/// Arguments are a JSON object of exactly the method's parameters, in
/// camelCase; a u32 is a JSON number.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = team();
    for args in [
        json!({ "day": DAY }),
        json!({ "day": DAY, "done": "x", "next": "", "blockers": "", "extra": 1 }),
        json!({ "day": 7, "done": "x", "next": "", "blockers": "" }),
    ] {
        assert_eq!(
            code(&mut t, "owner", "postUpdate", args.clone()),
            "BadArgs",
            "{args}"
        );
    }
    // v1's snake_case argument names are not parameters any more.
    assert_eq!(
        code(
            &mut t,
            "owner",
            "listDecisions",
            json!({ "search": null, "tag": null, "from_day": null,
                    "standing_only": false, "cursor": null, "limit": 0 })
        ),
        "BadArgs"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "listDays",
            json!({ "before": null, "limit": "10" })
        ),
        "BadArgs"
    );
    assert_eq!(view(&mut t, "owner", "members", json!({})), json!([]));
    assert!(events(&t, "bob").is_empty());
}

/// v1's snake_case names are not methods any more: the ABI's are camelCase.
/// A write is not a view.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = team();
    assert_eq!(
        code(
            &mut t,
            "owner",
            "post_update",
            json!({ "day": DAY, "done": "x", "next": "", "blockers": "" })
        ),
        "UnknownMethod"
    );
    assert!(matches!(
        t.as_("owner").view(
            "postUpdate",
            json!({ "day": DAY, "done": "x", "next": "", "blockers": "" })
        ),
        Err(Failure::App { ref code, .. }) if code == "NotAView"
    ));
    // Every read is a view: it runs without a log entry, as any caller the org holds.
    for (method, args) in [
        ("whoami", json!({})),
        ("getDay", json!({ "day": DAY })),
        ("listDays", json!({ "before": null, "limit": 0 })),
        ("currentBlockers", json!({})),
        ("members", json!({})),
        ("getWeek", json!({ "start": DAY })),
        ("tags", json!({})),
        ("teamName", json!({})),
        ("getName", json!({ "account": "owner" })),
        (
            "listDecisions",
            json!({ "search": null, "tag": null, "fromDay": null,
                    "standingOnly": false, "cursor": null, "limit": 0 }),
        ),
    ] {
        view(&mut t, "gus", method, args);
    }
}

/// The ABI is the method list the frontend's tests check against.
#[test]
fn the_abi_lists_every_method_once() {
    let abi: Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/res/abi.json"))
            .expect("res/abi.json"),
    )
    .expect("json");
    let mut methods: Vec<&str> = abi["methods"]
        .as_object()
        .expect("methods")
        .keys()
        .map(String::as_str)
        .collect();
    methods.sort_unstable();
    assert_eq!(
        methods,
        [
            "clearUpdate",
            "currentBlockers",
            "getDay",
            "getDecision",
            "getName",
            "getWeek",
            "init",
            "listDays",
            "listDecisions",
            "logDecision",
            "members",
            "offerHelp",
            "postUpdate",
            "setName",
            "setTeamName",
            "tags",
            "teamName",
            "whoami",
            "withdrawHelp",
        ]
    );
}
