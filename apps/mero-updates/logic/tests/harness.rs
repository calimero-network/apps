//! Mero Updates on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method, v1's storage-level write rules (`AccessControl`,
//! `SharedStorage`, `Moderated`, `Authored`, `UserStorage`) as the same calls
//! made by accounts the methods refuse, v1's merge tests as what they become
//! under one log, and the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The founder is `owner` (the instance's owner, so its first admin). `bob` and
/// `cy` are members (an investor and a future co-founder), `ada` an admin of the
/// organization, `gus` a guest.
fn app() -> TestApp {
    common::app(
        Org::new()
            .admins(["ada"])
            .members(["bob", "cy"])
            .guests(["gus"]),
    )
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

fn fails(t: &mut TestApp, who: &str, method: &str, args: Value) -> (String, String) {
    match t.as_(who).call(method, args) {
        Err(Failure::App { code, fields }) => (
            code,
            fields["message"].as_str().unwrap_or_default().to_owned(),
        ),
        other => panic!("{who} {method}: expected an app error, got {other:?}"),
    }
}

fn code(t: &mut TestApp, who: &str, method: &str, args: Value) -> String {
    fails(t, who, method, args).0
}

fn update_input(title: &str) -> Value {
    json!({
        "title": title,
        "summary": "tl;dr",
        "categoryId": "",
        "sections": [
            { "kind": "highlights", "title": "Highlights", "body": "Closed our first enterprise customer." },
            // An untouched template placeholder: must not be published.
            { "kind": "lowlights", "title": "Lowlights", "body": "   " }
        ],
        "metrics": [{ "name": "MRR", "value": "$42k", "unit": "" }],
        "asks": [{ "id": null, "kind": "intro", "title": "Intro to a fintech CFO", "detail": "Selling into finance teams" }]
    })
}

fn publish(t: &mut TestApp, title: &str) -> String {
    let id = call(
        t,
        "owner",
        "publishUpdate",
        json!({ "input": update_input(title) }),
    );
    id.as_str().expect("an id").to_owned()
}

fn post(t: &mut TestApp, who: &str, id: &str) -> Value {
    view(t, who, "getPost", json!({ "postId": id }))
}

fn feed(t: &mut TestApp, who: &str, kind: Option<&str>) -> Vec<Value> {
    let page = view(
        t,
        who,
        "listPosts",
        json!({ "kind": kind, "categoryId": null, "cursor": null, "limit": 0 }),
    );
    page["items"].as_array().expect("items").clone()
}

fn first_ask(t: &mut TestApp, post_id: &str) -> String {
    post(t, "owner", post_id)["asks"][0]["id"]
        .as_str()
        .expect("an ask")
        .to_owned()
}

fn events(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── roles ────────────────────────────────────────────────────────────────────

#[test]
fn the_creator_is_admin_and_team_and_a_reader_is_neither() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "owner", "getMe", json!({})),
        json!({ "account": "owner", "name": "", "firm": "", "isAdmin": true, "isTeam": true, "muted": [] })
    );
    let bob = view(&mut t, "bob", "getMe", json!({}));
    assert_eq!(bob["isAdmin"], json!(false));
    assert_eq!(bob["isTeam"], json!(false));
    // An admin of the organization is an admin here too; a guest is a reader.
    assert_eq!(
        view(&mut t, "ada", "getMe", json!({}))["isAdmin"],
        json!(true)
    );
    assert_eq!(
        view(&mut t, "gus", "getMe", json!({}))["isTeam"],
        json!(false)
    );
}

#[test]
fn only_the_team_can_publish() {
    let mut t = app();
    let (c, m) = fails(
        &mut t,
        "bob",
        "publishUpdate",
        json!({ "input": update_input("Forged") }),
    );
    assert_eq!(
        (c.as_str(), m.as_str()),
        ("Forbidden", "only the company team can do this")
    );
    assert!(feed(&mut t, "owner", None).is_empty());
}

#[test]
fn an_admin_can_add_a_teammate_who_can_then_publish() {
    let mut t = app();
    call(&mut t, "owner", "addTeammate", json!({ "account": "cy" }));
    let me = view(&mut t, "cy", "getMe", json!({}));
    assert_eq!(
        (me["isTeam"].clone(), me["isAdmin"].clone()),
        (json!(true), json!(false))
    );
    let id = call(
        &mut t,
        "cy",
        "publishUpdate",
        json!({ "input": update_input("Q2") }),
    );
    assert_eq!(
        post(&mut t, "bob", id.as_str().unwrap())["card"]["author"],
        json!("cy")
    );
    // A teammate is not an admin: cannot grant the role on.
    assert_eq!(
        code(&mut t, "cy", "addTeammate", json!({ "account": "bob" })),
        "Forbidden"
    );
    // Removed, they stop publishing at once (one log: no window to sync).
    call(
        &mut t,
        "owner",
        "removeTeammate",
        json!({ "account": "cy" }),
    );
    assert_eq!(
        code(
            &mut t,
            "cy",
            "publishUpdate",
            json!({ "input": update_input("Q3") })
        ),
        "Forbidden"
    );
    assert_eq!(events(&t, "bob")[..2], ["TeamChanged", "UpdatePublished"]);
}

#[test]
fn an_organization_admin_can_manage_the_team() {
    let mut t = app();
    call(&mut t, "ada", "addTeammate", json!({ "account": "bob" }));
    assert_eq!(
        view(&mut t, "bob", "getMe", json!({}))["isTeam"],
        json!(true)
    );
    // An admin stays team after `removeTeammate`: the role is the organization's.
    call(
        &mut t,
        "owner",
        "removeTeammate",
        json!({ "account": "ada" }),
    );
    assert_eq!(
        view(&mut t, "ada", "getMe", json!({}))["isTeam"],
        json!(true)
    );
}

#[test]
fn a_reader_cannot_grant_themselves_the_team_role() {
    let mut t = app();
    let (c, m) = fails(&mut t, "bob", "addTeammate", json!({ "account": "bob" }));
    assert_eq!(
        (c.as_str(), m.as_str()),
        ("Forbidden", "only an admin can do this")
    );
    assert_eq!(
        code(
            &mut t,
            "gus",
            "removeTeammate",
            json!({ "account": "owner" })
        ),
        "Forbidden"
    );
    assert_eq!(
        view(&mut t, "bob", "getMe", json!({}))["isTeam"],
        json!(false)
    );
}

#[test]
fn an_account_outside_the_company_is_rejected() {
    let mut t = app();
    let (c, m) = fails(
        &mut t,
        "owner",
        "addTeammate",
        json!({ "account": "not-a-member" }),
    );
    assert_eq!(c, "Invalid");
    assert_eq!(m, "not a member of this company: not-a-member");
    assert_eq!(
        code(&mut t, "owner", "addTeammate", json!({ "account": "  " })),
        "Invalid"
    );
}

// ── settings & categories ────────────────────────────────────────────────────

#[test]
fn settings_round_trip_and_readers_cannot_change_them() {
    let mut t = app();
    let empty = view(&mut t, "bob", "getSettings", json!({}));
    assert_eq!(
        empty,
        json!({ "companyName": "", "cadenceDays": 0, "updatedAt": "0" })
    );
    call(
        &mut t,
        "owner",
        "setSettings",
        json!({ "companyName": " Acme ", "cadenceDays": 30 }),
    );
    let s = view(&mut t, "bob", "getSettings", json!({}));
    assert_eq!(
        (s["companyName"].clone(), s["cadenceDays"].clone()),
        (json!("Acme"), json!(30))
    );
    assert_eq!(s["updatedAt"], json!(common::T0.to_string()));
    assert_eq!(
        code(
            &mut t,
            "bob",
            "setSettings",
            json!({ "companyName": "Hijacked", "cadenceDays": 1 })
        ),
        "Forbidden"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setSettings",
            json!({ "companyName": "Acme", "cadenceDays": 367 })
        ),
        "Invalid"
    );
    assert_eq!(
        view(&mut t, "bob", "getSettings", json!({}))["companyName"],
        json!("Acme")
    );
}

#[test]
fn categories_are_team_managed_and_archiving_hides_them() {
    let mut t = app();
    let monthly = call(
        &mut t,
        "owner",
        "createCategory",
        json!({ "name": "Monthly", "emoji": "📅", "color": "#2563eb" }),
    );
    assert_eq!(
        code(
            &mut t,
            "bob",
            "createCategory",
            json!({ "name": "X", "emoji": "", "color": "" })
        ),
        "Forbidden"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "createCategory",
            json!({ "name": " ", "emoji": "", "color": "" })
        ),
        "Invalid"
    );
    call(
        &mut t,
        "owner",
        "editCategory",
        json!({ "categoryId": monthly, "name": "Monthly update", "emoji": "📅", "color": "#000" }),
    );
    let scratch = call(
        &mut t,
        "owner",
        "createCategory",
        json!({ "name": "Scratch", "emoji": "", "color": "" }),
    );
    assert_eq!(
        code(
            &mut t,
            "bob",
            "archiveCategory",
            json!({ "categoryId": scratch })
        ),
        "Forbidden"
    );
    call(
        &mut t,
        "owner",
        "archiveCategory",
        json!({ "categoryId": scratch }),
    );
    let cats = view(&mut t, "bob", "listCategories", json!({}));
    assert_eq!(
        cats,
        json!([{ "id": monthly, "name": "Monthly update", "emoji": "📅", "color": "#000",
                 "updateCount": "0", "unreadCount": "0", "muted": false }])
    );
    // Archived: no edits, no new updates filed under it.
    assert_eq!(
        code(
            &mut t,
            "owner",
            "editCategory",
            json!({ "categoryId": scratch, "name": "Back", "emoji": "", "color": "" })
        ),
        "Invalid"
    );
    let mut input = update_input("Into the archive");
    input["categoryId"] = scratch.clone();
    assert_eq!(
        code(&mut t, "owner", "publishUpdate", json!({ "input": input })),
        "Invalid"
    );
    let (c, m) = fails(
        &mut t,
        "owner",
        "archiveCategory",
        json!({ "categoryId": "nope" }),
    );
    assert_eq!(
        (c.as_str(), m.as_str()),
        ("NotFound", "no such category: nope")
    );
}

#[test]
fn at_most_fifty_live_categories() {
    let mut t = app();
    for n in 0..50 {
        call(
            &mut t,
            "owner",
            "createCategory",
            json!({ "name": format!("c{n}"), "emoji": "", "color": "" }),
        );
    }
    assert_eq!(
        code(
            &mut t,
            "owner",
            "createCategory",
            json!({ "name": "one more", "emoji": "", "color": "" })
        ),
        "Invalid"
    );
}

#[test]
fn category_counts_and_filters_follow_the_updates() {
    let mut t = app();
    let cat = call(
        &mut t,
        "owner",
        "createCategory",
        json!({ "name": "Product", "emoji": "", "color": "" }),
    );
    let mut input = update_input("Shipped");
    input["categoryId"] = cat.clone();
    call(&mut t, "owner", "publishUpdate", json!({ "input": input }));
    publish(&mut t, "Uncategorized");
    let cats = view(&mut t, "bob", "listCategories", json!({}));
    assert_eq!(
        (
            cats[0]["updateCount"].clone(),
            cats[0]["unreadCount"].clone()
        ),
        (json!("1"), json!("1"))
    );
    // The author has read their own.
    assert_eq!(
        view(&mut t, "owner", "listCategories", json!({}))[0]["unreadCount"],
        json!("0")
    );
    let page = view(
        &mut t,
        "bob",
        "listPosts",
        json!({ "kind": "update", "categoryId": cat, "cursor": null, "limit": 10 }),
    );
    let items = page["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["title"], json!("Shipped"));
}

#[test]
fn muting_a_category_drops_it_from_unread() {
    let mut t = app();
    let cat = call(
        &mut t,
        "owner",
        "createCategory",
        json!({ "name": "Hiring", "emoji": "", "color": "" }),
    );
    let mut input = update_input("Hiring");
    input["categoryId"] = cat.clone();
    call(&mut t, "owner", "publishUpdate", json!({ "input": input }));
    publish(&mut t, "General");
    assert_eq!(
        view(&mut t, "bob", "getOverview", json!({}))["unreadUpdates"],
        json!("2")
    );
    call(
        &mut t,
        "bob",
        "setMutedCategories",
        json!({ "categoryIds": [cat, cat] }),
    );
    assert_eq!(
        view(&mut t, "bob", "getMe", json!({}))["muted"],
        json!([cat])
    );
    assert_eq!(
        view(&mut t, "bob", "listCategories", json!({}))[0]["muted"],
        json!(true)
    );
    assert_eq!(
        view(&mut t, "bob", "getOverview", json!({}))["unreadUpdates"],
        json!("1")
    );
    // Bob's mute is his own.
    assert_eq!(
        view(&mut t, "cy", "getOverview", json!({}))["unreadUpdates"],
        json!("2")
    );
    let too_many: Vec<String> = (0..51).map(|n| n.to_string()).collect();
    assert_eq!(
        code(
            &mut t,
            "bob",
            "setMutedCategories",
            json!({ "categoryIds": too_many })
        ),
        "Invalid"
    );
}

// ── updates ──────────────────────────────────────────────────────────────────

#[test]
fn an_update_round_trips_without_its_empty_sections() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let p = post(&mut t, "bob", &id);
    assert_eq!(
        p["sections"],
        json!([{ "kind": "highlights", "title": "Highlights", "body": "Closed our first enterprise customer." }])
    );
    assert_eq!(
        p["metrics"],
        json!([{ "name": "MRR", "value": "$42k", "unit": "" }])
    );
    let card = &p["card"];
    assert_eq!(card["kind"], json!("update"));
    assert_eq!(card["author"], json!("owner"));
    assert_eq!(card["authorIsTeam"], json!(true));
    assert_eq!(card["status"], json!("published"));
    assert_eq!(card["createdAt"], json!(common::T0.to_string()));
    assert_eq!(card["metricCount"], json!("1"));
    assert_eq!(card["askCount"], json!("1"));
    assert_eq!(card["openAskCount"], json!("1"));
    assert_eq!(card["readCount"], json!("1"));
    assert_eq!(card["readByMe"], json!(false));
    assert_eq!(card["reactions"].as_array().unwrap().len(), 6);
    let ask = &p["asks"][0];
    assert_eq!(ask["kind"], json!("intro"));
    assert_eq!(ask["postTitle"], json!("June"));
    assert_eq!(ask["myOffer"], json!(null));
    assert_eq!(events(&t, "bob"), ["UpdatePublished"]);
}

#[test]
fn oversized_or_invalid_input_is_rejected() {
    let mut t = app();
    let mut input = update_input("");
    assert_eq!(
        code(&mut t, "owner", "publishUpdate", json!({ "input": input })),
        "Invalid"
    );
    input = update_input(&"x".repeat(201));
    assert_eq!(
        code(&mut t, "owner", "publishUpdate", json!({ "input": input })),
        "Invalid"
    );
    input = update_input("ok");
    input["asks"][0]["kind"] = json!("bribe");
    let (c, m) = fails(&mut t, "owner", "publishUpdate", json!({ "input": input }));
    assert_eq!(c, "Invalid");
    assert!(m.starts_with("ask kind must be one of intro, hire"), "{m}");
    input = update_input("ok");
    input["asks"] = json!((0..11)
        .map(|n| json!({ "id": null, "kind": "other", "title": format!("a{n}"), "detail": "" }))
        .collect::<Vec<_>>());
    assert_eq!(
        code(&mut t, "owner", "publishUpdate", json!({ "input": input })),
        "Invalid"
    );
    input = update_input("ok");
    input["metrics"][0]["value"] = json!("");
    assert_eq!(
        code(&mut t, "owner", "publishUpdate", json!({ "input": input })),
        "Invalid"
    );
    input = update_input("ok");
    input["categoryId"] = json!("missing");
    assert_eq!(
        code(&mut t, "owner", "publishUpdate", json!({ "input": input })),
        "NotFound"
    );
    assert!(
        feed(&mut t, "owner", None).is_empty(),
        "nothing was written"
    );
}

#[test]
fn editing_an_update_keeps_listed_asks_and_removes_the_rest() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let keep = first_ask(&mut t, &id);
    t.advance(1_000);
    let mut input = update_input("June (fixed)");
    input["asks"] = json!([
        { "id": keep, "kind": "hire", "title": "A VP Sales", "detail": "" },
        { "id": null, "kind": "advice", "title": "Pricing", "detail": "" }
    ]);
    call(
        &mut t,
        "owner",
        "editUpdate",
        json!({ "postId": id, "input": input }),
    );
    let p = post(&mut t, "bob", &id);
    assert_eq!(p["card"]["title"], json!("June (fixed)"));
    assert_eq!(
        p["card"]["editedAt"],
        json!((common::T0 + 1_000).to_string())
    );
    let asks = p["asks"].as_array().unwrap();
    assert_eq!(asks.len(), 2);
    assert_eq!(
        (asks[0]["id"].clone(), asks[0]["kind"].clone()),
        (json!(keep), json!("hire"))
    );
    assert_eq!(asks[1]["title"], json!("Pricing"));

    // Dropping every ask removes them; an unknown ask id is refused whole.
    let mut input = update_input("June (fixed)");
    input["asks"] = json!([{ "id": "nope", "kind": "hire", "title": "x", "detail": "" }]);
    assert_eq!(
        code(
            &mut t,
            "owner",
            "editUpdate",
            json!({ "postId": id, "input": input })
        ),
        "NotFound"
    );
    assert_eq!(
        post(&mut t, "bob", &id)["asks"].as_array().unwrap().len(),
        2
    );
    let mut input = update_input("June (fixed)");
    input["asks"] = json!([]);
    call(
        &mut t,
        "owner",
        "editUpdate",
        json!({ "postId": id, "input": input }),
    );
    assert!(post(&mut t, "bob", &id)["asks"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        events(&t, "bob"),
        ["UpdatePublished", "PostEdited", "PostEdited"]
    );
}

#[test]
fn a_reader_cannot_edit_or_delete_an_update() {
    let mut t = app();
    let id = publish(&mut t, "June");
    assert_eq!(
        code(
            &mut t,
            "bob",
            "editUpdate",
            json!({ "postId": id, "input": update_input("Forged") })
        ),
        "Forbidden"
    );
    let (c, m) = fails(&mut t, "bob", "deletePost", json!({ "postId": id }));
    assert_eq!(
        (c.as_str(), m.as_str()),
        ("Forbidden", "you cannot delete this post")
    );
    assert_eq!(post(&mut t, "bob", &id)["card"]["title"], json!("June"));
}

#[test]
fn a_deleted_update_leaves_the_feed_and_takes_its_asks_along() {
    let mut t = app();
    let id = publish(&mut t, "June");
    call(&mut t, "owner", "deletePost", json!({ "postId": id }));
    assert!(feed(&mut t, "bob", Some("update")).is_empty());
    assert_eq!(
        view(&mut t, "bob", "listAsks", json!({ "status": null })),
        json!([])
    );
    assert_eq!(
        view(&mut t, "bob", "getOverview", json!({}))["openAsks"],
        json!("0")
    );
    match t.as_("bob").view("getPost", json!({ "postId": id })) {
        Err(Failure::App { code, fields }) => {
            assert_eq!(code, "NotFound");
            assert_eq!(
                fields,
                json!({ "message": format!("post is deleted: {id}") })
            );
        }
        other => panic!("{other:?}"),
    }
    // Comments and reactions on it are refused too.
    assert_eq!(
        code(
            &mut t,
            "bob",
            "addComment",
            json!({ "postId": id, "parentId": null, "body": "hi" })
        ),
        "NotFound"
    );
    assert_eq!(events(&t, "bob"), ["UpdatePublished", "PostDeleted"]);
}

#[test]
fn the_feed_pages_newest_first_without_skipping_or_repeating() {
    let mut t = app();
    let mut ids = Vec::new();
    for n in 0..5 {
        ids.push(publish(&mut t, &format!("u{n}")));
        t.advance(10);
    }
    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = view(
            &mut t,
            "bob",
            "listPosts",
            json!({ "kind": "update", "categoryId": null, "cursor": cursor, "limit": 2 }),
        );
        for item in page["items"].as_array().unwrap() {
            seen.push(item["id"].as_str().unwrap().to_owned());
        }
        if page["nextCursor"].is_null() {
            break;
        }
        cursor = page["nextCursor"].clone();
    }
    ids.reverse();
    assert_eq!(seen, ids);
    // `limit` above 100 is capped, not refused.
    let page = view(
        &mut t,
        "bob",
        "listPosts",
        json!({ "kind": null, "categoryId": null, "cursor": null, "limit": 1000 }),
    );
    assert_eq!(page["items"].as_array().unwrap().len(), 5);
}

// ── questions ────────────────────────────────────────────────────────────────

#[test]
fn a_reader_can_ask_and_the_team_can_answer() {
    let mut t = app();
    let q = call(
        &mut t,
        "bob",
        "askQuestion",
        json!({ "title": "Runway?", "body": "After the hires.", "categoryId": null }),
    );
    let p = post(&mut t, "owner", q.as_str().unwrap());
    assert_eq!(p["card"]["kind"], json!("question"));
    assert_eq!(p["card"]["author"], json!("bob"));
    assert_eq!(p["card"]["authorIsTeam"], json!(false));
    assert_eq!(p["card"]["status"], json!("open"));
    assert_eq!(
        p["sections"],
        json!([{ "kind": "text", "title": "", "body": "After the hires." }])
    );
    assert_eq!(
        view(&mut t, "owner", "getOverview", json!({}))["openQuestions"],
        json!("1")
    );
    // Only the team triages it, not the asker.
    assert_eq!(
        code(
            &mut t,
            "bob",
            "setQuestionStatus",
            json!({ "postId": q, "status": "answered" })
        ),
        "Forbidden"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setQuestionStatus",
            json!({ "postId": q, "status": "closed" })
        ),
        "Invalid"
    );
    call(
        &mut t,
        "owner",
        "addComment",
        json!({ "postId": q, "parentId": null, "body": "19 months." }),
    );
    call(
        &mut t,
        "owner",
        "setQuestionStatus",
        json!({ "postId": q, "status": "answered" }),
    );
    assert_eq!(
        post(&mut t, "bob", q.as_str().unwrap())["card"]["status"],
        json!("answered")
    );
    assert_eq!(
        view(&mut t, "owner", "getOverview", json!({}))["openQuestions"],
        json!("0")
    );
    // An update is not a question.
    let u = publish(&mut t, "June");
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setQuestionStatus",
            json!({ "postId": u, "status": "answered" })
        ),
        "Invalid"
    );
    assert_eq!(feed(&mut t, "bob", Some("question")).len(), 1);
    assert_eq!(
        events(&t, "owner"),
        [
            "QuestionAsked",
            "Commented",
            "StatusChanged",
            "UpdatePublished"
        ]
    );
}

#[test]
fn the_asker_can_delete_their_question_but_not_someone_elses() {
    let mut t = app();
    let q = call(
        &mut t,
        "bob",
        "askQuestion",
        json!({ "title": "Mine", "body": "", "categoryId": null }),
    );
    assert_eq!(
        code(&mut t, "cy", "deletePost", json!({ "postId": q })),
        "Forbidden"
    );
    call(&mut t, "bob", "deletePost", json!({ "postId": q }));
    assert!(feed(&mut t, "owner", None).is_empty());
    // The team moderates any question.
    let q2 = call(
        &mut t,
        "cy",
        "askQuestion",
        json!({ "title": "Spam", "body": "", "categoryId": null }),
    );
    call(&mut t, "owner", "deletePost", json!({ "postId": q2 }));
    let (c, _) = fails(&mut t, "owner", "deletePost", json!({ "postId": q2 }));
    assert_eq!(c, "NotFound");
}

// ── comments ─────────────────────────────────────────────────────────────────

#[test]
fn replies_thread_one_level_deep() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let top = call(
        &mut t,
        "bob",
        "addComment",
        json!({ "postId": id, "parentId": null, "body": "Congrats" }),
    );
    t.advance(1);
    let reply = call(
        &mut t,
        "owner",
        "addComment",
        json!({ "postId": id, "parentId": top, "body": "Thanks" }),
    );
    t.advance(1);
    // A reply to the reply attaches to the top-level comment.
    let deeper = call(
        &mut t,
        "cy",
        "addComment",
        json!({ "postId": id, "parentId": reply, "body": "+1" }),
    );
    let thread = view(&mut t, "bob", "listComments", json!({ "postId": id }));
    let rows = thread.as_array().unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["id"], top);
    assert_eq!(rows[0]["parentId"], json!(""));
    assert_eq!(rows[1]["parentId"], top);
    assert_eq!(rows[1]["authorIsTeam"], json!(true));
    assert_eq!(rows[2]["id"], deeper);
    assert_eq!(rows[2]["parentId"], top);
    assert_eq!(post(&mut t, "bob", &id)["card"]["commentCount"], json!("3"));
    // A parent on another post is refused; so is an empty body.
    let other = publish(&mut t, "July");
    assert_eq!(
        code(
            &mut t,
            "bob",
            "addComment",
            json!({ "postId": other, "parentId": top, "body": "x" })
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            &mut t,
            "bob",
            "addComment",
            json!({ "postId": id, "parentId": null, "body": " " })
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            &mut t,
            "bob",
            "addComment",
            json!({ "postId": id, "parentId": "nope", "body": "x" })
        ),
        "NotFound"
    );
}

#[test]
fn only_the_author_edits_a_comment_but_the_team_can_moderate() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let c = call(
        &mut t,
        "bob",
        "addComment",
        json!({ "postId": id, "parentId": null, "body": "Typo" }),
    );
    let (code_, m) = fails(
        &mut t,
        "owner",
        "editComment",
        json!({ "commentId": c, "body": "Forged" }),
    );
    assert_eq!(
        (code_.as_str(), m.as_str()),
        ("Forbidden", "only the author can edit this comment")
    );
    t.advance(5);
    call(
        &mut t,
        "bob",
        "editComment",
        json!({ "commentId": c, "body": "Fixed" }),
    );
    let row = view(&mut t, "owner", "listComments", json!({ "postId": id }))[0].clone();
    assert_eq!(
        (row["body"].clone(), row["author"].clone()),
        (json!("Fixed"), json!("bob"))
    );
    assert_eq!(row["editedAt"], json!((common::T0 + 5).to_string()));
    // Another reader cannot delete it; the team can.
    assert_eq!(
        code(&mut t, "cy", "deleteComment", json!({ "commentId": c })),
        "Forbidden"
    );
    call(&mut t, "owner", "deleteComment", json!({ "commentId": c }));
    assert_eq!(
        view(&mut t, "owner", "listComments", json!({ "postId": id })),
        json!([])
    );
    // The author deletes their own.
    let c2 = call(
        &mut t,
        "cy",
        "addComment",
        json!({ "postId": id, "parentId": null, "body": "Mine" }),
    );
    call(&mut t, "cy", "deleteComment", json!({ "commentId": c2 }));
    assert_eq!(post(&mut t, "bob", &id)["card"]["commentCount"], json!("0"));
    assert_eq!(
        events(&t, "bob"),
        [
            "UpdatePublished",
            "Commented",
            "Commented",
            "Commented",
            "Commented",
            "Commented"
        ]
    );
}

// ── reactions ────────────────────────────────────────────────────────────────

#[test]
fn reactions_are_one_per_account_per_emoji_and_can_be_retracted() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let react = |t: &mut TestApp, who: &str, emoji: &str, on: bool| {
        call(
            t,
            who,
            "react",
            json!({ "postId": id, "emoji": emoji, "on": on }),
        );
    };
    react(&mut t, "bob", "🎉", true);
    react(&mut t, "bob", "🎉", true);
    react(&mut t, "cy", "🎉", true);
    react(&mut t, "cy", "🚀", true);
    let reactions = post(&mut t, "bob", &id)["card"]["reactions"].clone();
    assert_eq!(
        reactions[1],
        json!({ "emoji": "🎉", "count": "2", "mine": true })
    );
    assert_eq!(
        reactions[3],
        json!({ "emoji": "🚀", "count": "1", "mine": false })
    );
    react(&mut t, "bob", "🎉", false);
    react(&mut t, "bob", "🎉", false);
    let reactions = post(&mut t, "bob", &id)["card"]["reactions"].clone();
    assert_eq!(
        reactions[1],
        json!({ "emoji": "🎉", "count": "1", "mine": false })
    );
    assert_eq!(
        code(
            &mut t,
            "bob",
            "react",
            json!({ "postId": id, "emoji": "💩", "on": true })
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            &mut t,
            "bob",
            "react",
            json!({ "postId": "nope", "emoji": "👍", "on": true })
        ),
        "NotFound"
    );
}

// ── asks & offers ────────────────────────────────────────────────────────────

#[test]
fn a_reader_offers_help_and_the_team_accepts_it_into_a_contribution() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "name": "Ben", "firm": "Seed Fund" }),
    );
    let id = publish(&mut t, "June");
    let ask = first_ask(&mut t, &id);
    t.advance(10);
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "askId": ask, "note": "I know two CFOs" }),
    );
    // Offering again edits the note: still one offer.
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "askId": ask, "note": "I know three CFOs" }),
    );

    // The reader sees their own offer, not everyone's; the team sees all.
    let reader = post(&mut t, "bob", &id)["asks"][0].clone();
    assert_eq!(reader["offerCount"], json!("1"));
    assert_eq!(reader["offers"], json!([]));
    assert_eq!(reader["myOffer"]["note"], json!("I know three CFOs"));
    assert_eq!(reader["myOffer"]["status"], json!("offered"));
    let team = post(&mut t, "owner", &id)["asks"][0].clone();
    assert_eq!(team["offers"][0]["name"], json!("Ben"));
    assert_eq!(team["offers"][0]["firm"], json!("Seed Fund"));

    // The helper cannot accept their own offer; the team can.
    assert_eq!(
        code(
            &mut t,
            "bob",
            "setOfferStatus",
            json!({ "askId": ask, "account": "bob", "status": "accepted" })
        ),
        "Forbidden"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setOfferStatus",
            json!({ "askId": ask, "account": "cy", "status": "accepted" })
        ),
        "NotFound"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setOfferStatus",
            json!({ "askId": ask, "account": "bob", "status": "maybe" })
        ),
        "Invalid"
    );
    t.advance(10);
    call(
        &mut t,
        "owner",
        "setOfferStatus",
        json!({ "askId": ask, "account": "bob", "status": "accepted" }),
    );
    // Editing the note afterwards does not undo the acceptance.
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "askId": ask, "note": "Intro sent" }),
    );

    let contributions = view(
        &mut t,
        "owner",
        "listContributions",
        json!({ "since": "0" }),
    );
    assert_eq!(
        contributions,
        json!([{ "askId": ask, "askTitle": "Intro to a fintech CFO", "askKind": "intro",
                 "account": "bob", "name": "Ben", "firm": "Seed Fund", "note": "Intro sent",
                 "acceptedAt": (common::T0 + 20).to_string() }])
    );
    let later = (common::T0 + 21).to_string();
    assert_eq!(
        view(
            &mut t,
            "owner",
            "listContributions",
            json!({ "since": later })
        ),
        json!([])
    );

    let bob = view(&mut t, "owner", "listPeople", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["account"] == json!("bob"))
        .cloned()
        .unwrap();
    assert_eq!(
        (bob["offers"].clone(), bob["acceptedOffers"].clone()),
        (json!("1"), json!("1"))
    );
}

#[test]
fn a_withdrawn_offer_disappears_and_a_resolved_ask_takes_no_more() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let ask = first_ask(&mut t, &id);
    let (c, m) = fails(&mut t, "bob", "withdrawOffer", json!({ "askId": ask }));
    assert_eq!(
        (c.as_str(), m.as_str()),
        ("NotFound", "you have not offered to help with this")
    );
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "askId": ask, "note": "" }),
    );
    call(&mut t, "bob", "withdrawOffer", json!({ "askId": ask }));
    let a = post(&mut t, "owner", &id)["asks"][0].clone();
    assert_eq!(
        (a["offerCount"].clone(), a["offers"].clone()),
        (json!("0"), json!([]))
    );

    assert_eq!(
        code(
            &mut t,
            "bob",
            "setAskStatus",
            json!({ "askId": ask, "status": "resolved" })
        ),
        "Forbidden"
    );
    call(
        &mut t,
        "owner",
        "setAskStatus",
        json!({ "askId": ask, "status": "resolved" }),
    );
    let (c, m) = fails(
        &mut t,
        "cy",
        "offerHelp",
        json!({ "askId": ask, "note": "" }),
    );
    assert_eq!(
        (c.as_str(), m.as_str()),
        ("Invalid", "this ask is resolved")
    );
    assert_eq!(
        view(&mut t, "bob", "listAsks", json!({ "status": "open" })),
        json!([])
    );
    assert_eq!(
        view(&mut t, "bob", "listAsks", json!({ "status": "resolved" }))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(post(&mut t, "bob", &id)["card"]["openAskCount"], json!("0"));
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setAskStatus",
            json!({ "askId": "nope", "status": "open" })
        ),
        "NotFound"
    );
}

// ── reads, overview, engagement, metrics ─────────────────────────────────────

#[test]
fn reads_feed_unread_counts_and_the_teams_follow_up_list() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "name": "Ben", "firm": "Seed Fund" }),
    );
    call(
        &mut t,
        "cy",
        "setProfile",
        json!({ "name": "Cy", "firm": "" }),
    );
    let id = publish(&mut t, "June");
    assert_eq!(
        view(&mut t, "bob", "getOverview", json!({}))["unreadUpdates"],
        json!("1")
    );
    t.advance(100);
    call(&mut t, "bob", "markRead", json!({ "postId": id }));
    t.advance(100);
    call(&mut t, "bob", "markRead", json!({ "postId": id }));
    let card = post(&mut t, "bob", &id)["card"].clone();
    assert_eq!(
        (card["readCount"].clone(), card["readByMe"].clone()),
        (json!("2"), json!(true))
    );
    assert_eq!(
        view(&mut t, "bob", "getOverview", json!({}))["unreadUpdates"],
        json!("0")
    );

    let report = view(&mut t, "owner", "getEngagement", json!({}));
    let row = &report[0];
    assert_eq!(row["title"], json!("June"));
    // The founder's own read is not a reader's; first read kept.
    assert_eq!(
        row["readers"],
        json!([{ "account": "bob", "name": "Ben", "firm": "Seed Fund",
                 "firstAt": (common::T0 + 100).to_string() }])
    );
    assert_eq!(
        row["notRead"],
        json!([{ "account": "cy", "name": "Cy", "firm": "", "firstAt": "0" }])
    );
    let (c, _) = fails(&mut t, "bob", "markRead", json!({ "postId": "nope" }));
    assert_eq!(c, "NotFound");
    // Team only.
    match t.as_("bob").view("getEngagement", json!({})) {
        Err(Failure::App { code, .. }) => assert_eq!(code, "Forbidden"),
        other => panic!("{other:?}"),
    }
    let bob = view(&mut t, "owner", "listPeople", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["account"] == json!("bob"))
        .cloned()
        .unwrap();
    assert_eq!(bob["updatesRead"], json!("1"));
    assert_eq!(bob["updatesTotal"], json!("1"));
    assert_eq!(bob["lastReadAt"], json!((common::T0 + 200).to_string()));
}

#[test]
fn the_overview_computes_the_next_due_date_from_the_cadence() {
    let mut t = app();
    let o = view(&mut t, "owner", "getOverview", json!({}));
    assert_eq!(
        (o["lastUpdateAt"].clone(), o["nextDueAt"].clone()),
        (json!("0"), json!("0"))
    );
    call(
        &mut t,
        "owner",
        "setSettings",
        json!({ "companyName": "Acme", "cadenceDays": 30 }),
    );
    publish(&mut t, "June");
    call(
        &mut t,
        "bob",
        "askQuestion",
        json!({ "title": "Q", "body": "", "categoryId": null }),
    );
    let o = view(&mut t, "bob", "getOverview", json!({}));
    assert_eq!(
        o,
        json!({
            "companyName": "Acme", "cadenceDays": 30,
            "lastUpdateAt": common::T0.to_string(),
            "nextDueAt": (common::T0 + 30 * 86_400_000).to_string(),
            "updatesTotal": "1", "unreadUpdates": "1", "openAsks": "1",
            "openQuestions": "1", "people": "1", "isTeam": false
        })
    );
}

#[test]
fn metrics_group_into_series_across_updates() {
    let mut t = app();
    publish(&mut t, "May");
    t.advance(1_000);
    let mut input = update_input("June");
    input["metrics"] = json!([
        { "name": "mrr", "value": "$48k", "unit": "USD" },
        { "name": "Customers", "value": "12", "unit": "" }
    ]);
    call(&mut t, "owner", "publishUpdate", json!({ "input": input }));
    let series = view(&mut t, "bob", "listMetrics", json!({}));
    assert_eq!(series.as_array().unwrap().len(), 2);
    assert_eq!(series[0]["name"], json!("mrr"));
    assert_eq!(series[0]["unit"], json!("USD"));
    let values: Vec<&str> = series[0]["points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["value"].as_str().unwrap())
        .collect();
    assert_eq!(values, ["$42k", "$48k"]);
    assert_eq!(
        series[0]["points"][1]["at"],
        json!((common::T0 + 1_000).to_string())
    );
    assert_eq!(series[1]["points"][0]["postTitle"], json!("June"));
}

// ── drafts & profiles ────────────────────────────────────────────────────────

#[test]
fn drafts_save_list_overwrite_and_delete() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "saveDraft",
        json!({ "draftId": null, "title": "July", "payload": "{\"title\":\"July\"}" }),
    );
    t.advance(10);
    let id2 = call(
        &mut t,
        "owner",
        "saveDraft",
        json!({ "title": "Aug", "payload": "{}" }),
    );
    t.advance(10);
    call(
        &mut t,
        "owner",
        "saveDraft",
        json!({ "draftId": id, "title": "July v2", "payload": "{}" }),
    );
    let drafts = view(&mut t, "owner", "listDrafts", json!({}));
    assert_eq!(
        drafts,
        json!([
            { "id": id, "title": "July v2", "payload": "{}", "updatedAt": (common::T0 + 20).to_string() },
            { "id": id2, "title": "Aug", "payload": "{}", "updatedAt": (common::T0 + 10).to_string() }
        ])
    );
    call(&mut t, "owner", "deleteDraft", json!({ "draftId": id }));
    call(
        &mut t,
        "owner",
        "deleteDraft",
        json!({ "draftId": "unknown" }),
    );
    assert_eq!(
        view(&mut t, "owner", "listDrafts", json!({}))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "saveDraft",
            json!({ "title": "big", "payload": "x".repeat(100_001) })
        ),
        "Invalid"
    );
    // Saving a draft is no event.
    assert!(events(&t, "bob").is_empty());
}

/// v1 kept drafts in node-local storage. Here they are the author's own: no
/// other account lists, overwrites or deletes them, even with the id.
#[test]
fn a_draft_is_its_authors_only() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "saveDraft",
        json!({ "title": "Secret", "payload": "{}" }),
    );
    assert_eq!(view(&mut t, "bob", "listDrafts", json!({})), json!([]));
    assert_eq!(view(&mut t, "ada", "listDrafts", json!({})), json!([]));
    // Bob saving under the founder's id writes his own draft, not hers.
    call(
        &mut t,
        "bob",
        "saveDraft",
        json!({ "draftId": id, "title": "Mine", "payload": "" }),
    );
    call(&mut t, "bob", "deleteDraft", json!({ "draftId": id }));
    let drafts = view(&mut t, "owner", "listDrafts", json!({}));
    assert_eq!(drafts[0]["title"], json!("Secret"));
}

#[test]
fn a_profile_is_per_account_and_bounded() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "name": " Ben ", "firm": "Seed" }),
    );
    let me = view(&mut t, "bob", "getMe", json!({}));
    assert_eq!(
        (me["name"].clone(), me["firm"].clone()),
        (json!("Ben"), json!("Seed"))
    );
    assert_eq!(view(&mut t, "cy", "getMe", json!({}))["name"], json!(""));
    assert_eq!(
        code(
            &mut t,
            "bob",
            "setProfile",
            json!({ "name": "x".repeat(65), "firm": "" })
        ),
        "Invalid"
    );
    assert_eq!(events(&t, "owner"), ["ProfileSet"]);
    assert_eq!(t.events_for("owner")[0].1, json!({ "account": "bob" }));
}

#[test]
fn renaming_and_muting_are_separate() {
    let mut t = app();
    call(
        &mut t,
        "bob",
        "setMutedCategories",
        json!({ "categoryIds": ["a"] }),
    );
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "name": "Ben", "firm": "" }),
    );
    let me = view(&mut t, "bob", "getMe", json!({}));
    assert_eq!(
        (me["name"].clone(), me["muted"].clone()),
        (json!("Ben"), json!(["a"]))
    );
}

#[test]
fn people_lists_the_team_first_then_by_name() {
    let mut t = app();
    call(&mut t, "owner", "addTeammate", json!({ "account": "cy" }));
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "name": "Ben", "firm": "" }),
    );
    call(
        &mut t,
        "gus",
        "setProfile",
        json!({ "name": "Al", "firm": "" }),
    );
    let people = view(&mut t, "bob", "listPeople", json!({}));
    let order: Vec<(&str, bool)> = people
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["account"].as_str().unwrap(),
                p["isTeam"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        order,
        [
            ("cy", true),
            ("owner", true),
            ("gus", false),
            ("bob", false)
        ]
    );
}

// ── v1's storage write rules, as method checks ───────────────────────────────

/// v1: team data was `SharedStorage` whose writers were the team, so a reader's
/// forged write was refused on apply. Here every team write is a method that
/// refuses a reader before writing anything.
#[test]
fn team_data_is_written_only_by_the_team() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let ask = first_ask(&mut t, &id);
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "askId": ask, "note": "" }),
    );
    let q = call(
        &mut t,
        "bob",
        "askQuestion",
        json!({ "title": "Q", "body": "", "categoryId": null }),
    );
    let cat = call(
        &mut t,
        "owner",
        "createCategory",
        json!({ "name": "C", "emoji": "", "color": "" }),
    );
    for who in ["bob", "gus"] {
        for (method, args) in [
            (
                "setSettings",
                json!({ "companyName": "x", "cadenceDays": 1 }),
            ),
            (
                "createCategory",
                json!({ "name": "x", "emoji": "", "color": "" }),
            ),
            (
                "editCategory",
                json!({ "categoryId": cat, "name": "x", "emoji": "", "color": "" }),
            ),
            ("archiveCategory", json!({ "categoryId": cat })),
            ("publishUpdate", json!({ "input": update_input("x") })),
            (
                "editUpdate",
                json!({ "postId": id, "input": update_input("x") }),
            ),
            ("deletePost", json!({ "postId": id })),
            (
                "setAskStatus",
                json!({ "askId": ask, "status": "resolved" }),
            ),
            (
                "setQuestionStatus",
                json!({ "postId": q, "status": "answered" }),
            ),
            (
                "setOfferStatus",
                json!({ "askId": ask, "account": "bob", "status": "accepted" }),
            ),
            ("addTeammate", json!({ "account": who })),
            ("removeTeammate", json!({ "account": "owner" })),
        ] {
            assert_eq!(
                code(&mut t, who, method, args),
                "Forbidden",
                "{who} {method}"
            );
        }
    }
    let p = post(&mut t, "owner", &id);
    assert_eq!(p["card"]["title"], json!("June"));
    assert_eq!(p["asks"][0]["status"], json!("open"));
    assert_eq!(p["asks"][0]["offers"][0]["status"], json!("offered"));
}

/// v1: reactions, reads and offers were `Authored` and keyed by the account
/// they name, and a row filed under someone else's key was ignored. Here no
/// method takes an account to act as: every such row is the caller's own.
#[test]
fn nobody_reacts_reads_or_offers_in_someone_elses_name() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let ask = first_ask(&mut t, &id);
    call(
        &mut t,
        "bob",
        "react",
        json!({ "postId": id, "emoji": "👍", "on": true }),
    );
    call(&mut t, "bob", "markRead", json!({ "postId": id }));
    call(
        &mut t,
        "bob",
        "offerHelp",
        json!({ "askId": ask, "note": "bob's" }),
    );
    // An extra `account` argument is refused, not honoured.
    for (method, args) in [
        (
            "react",
            json!({ "postId": id, "emoji": "👍", "on": false, "account": "bob" }),
        ),
        ("markRead", json!({ "postId": id, "account": "cy" })),
        ("withdrawOffer", json!({ "askId": ask, "account": "bob" })),
        (
            "setProfile",
            json!({ "name": "x", "firm": "", "account": "bob" }),
        ),
    ] {
        assert_eq!(code(&mut t, "cy", method, args), "BadArgs", "{method}");
    }
    // Cy turning 👍 off removes only Cy's (absent) reaction; withdrawing reaches
    // only Cy's own (absent) offer.
    call(
        &mut t,
        "cy",
        "react",
        json!({ "postId": id, "emoji": "👍", "on": false }),
    );
    assert_eq!(
        code(&mut t, "cy", "withdrawOffer", json!({ "askId": ask })),
        "NotFound"
    );
    let p = post(&mut t, "owner", &id);
    assert_eq!(p["card"]["reactions"][0]["count"], json!("1"));
    assert_eq!(p["asks"][0]["offers"][0]["note"], json!("bob's"));
    assert_eq!(view(&mut t, "cy", "getMe", json!({}))["name"], json!(""));
}

/// v1: questions and comments were `Moderated`: the author alone edits, the
/// author or a moderator (the team) removes. A demoted teammate stops being a
/// moderator at once.
#[test]
fn a_demoted_teammate_loses_moderation_at_once() {
    let mut t = app();
    call(&mut t, "owner", "addTeammate", json!({ "account": "cy" }));
    let id = publish(&mut t, "June");
    let c1 = call(
        &mut t,
        "bob",
        "addComment",
        json!({ "postId": id, "parentId": null, "body": "a" }),
    );
    let c2 = call(
        &mut t,
        "bob",
        "addComment",
        json!({ "postId": id, "parentId": null, "body": "b" }),
    );
    call(&mut t, "cy", "deleteComment", json!({ "commentId": c1 }));
    call(
        &mut t,
        "owner",
        "removeTeammate",
        json!({ "account": "cy" }),
    );
    assert_eq!(
        code(&mut t, "cy", "deleteComment", json!({ "commentId": c2 })),
        "Forbidden"
    );
    assert_eq!(
        view(&mut t, "owner", "listComments", json!({ "postId": id }))
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

// ── v1's merge tests, under one log ──────────────────────────────────────────

/// v1 merged a post's content and its triage on separate axes so a typo fix
/// could not undo "answered". Under one log the later write simply holds, and
/// an edit never touches the status.
#[test]
fn an_edit_and_a_status_change_are_independent() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let ask = first_ask(&mut t, &id);
    call(
        &mut t,
        "owner",
        "setAskStatus",
        json!({ "askId": ask, "status": "resolved" }),
    );
    let mut input = update_input("June (typo fixed)");
    input["asks"][0]["id"] = json!(ask);
    call(
        &mut t,
        "owner",
        "editUpdate",
        json!({ "postId": id, "input": input }),
    );
    let p = post(&mut t, "bob", &id);
    assert_eq!(p["card"]["title"], json!("June (typo fixed)"));
    assert_eq!(p["asks"][0]["status"], json!("resolved"));
}

/// Two teammates writing the settings leave one value: the later write.
#[test]
fn concurrent_team_writes_hold_the_later_one() {
    let mut t = app();
    call(&mut t, "owner", "addTeammate", json!({ "account": "cy" }));
    call(
        &mut t,
        "owner",
        "setSettings",
        json!({ "companyName": "Acme", "cadenceDays": 30 }),
    );
    call(
        &mut t,
        "cy",
        "setSettings",
        json!({ "companyName": "Acme Inc", "cadenceDays": 7 }),
    );
    let s = view(&mut t, "bob", "getSettings", json!({}));
    assert_eq!(
        (s["companyName"].clone(), s["cadenceDays"].clone()),
        (json!("Acme Inc"), json!(7))
    );
}

/// Timestamps are the log entry's milliseconds, as decimal strings.
#[test]
fn timestamps_are_milliseconds_as_decimal_strings() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let at = post(&mut t, "bob", &id)["card"]["createdAt"].clone();
    assert_eq!(at, json!("1700000000000"));
}

// ── access and the wire ──────────────────────────────────────────────────────

#[test]
fn outsiders_and_anonymous_callers_never_reach_the_app() {
    let mut t = common::app(Org::new().members(["bob"]));
    assert!(matches!(
        t.anonymous().view("getMe", json!({})),
        Err(Failure::Refused { status: 401, .. })
    ));
    assert!(matches!(
        t.anonymous().call(
            "askQuestion",
            json!({ "title": "x", "body": "", "categoryId": null })
        ),
        Err(Failure::Refused { status: 401, .. })
    ));
    assert!(matches!(
        t.as_("mallory").view(
            "listPosts",
            json!({ "kind": null, "categoryId": null, "cursor": null, "limit": 0 })
        ),
        Err(Failure::Refused { status: 404, .. })
    ));
    assert!(matches!(
        t.as_("mallory")
            .call("setProfile", json!({ "name": "x", "firm": "" })),
        Err(Failure::Refused { status: 404, .. })
    ));
    // A member removed from the organization is an outsider from then on.
    call(
        &mut t,
        "bob",
        "setProfile",
        json!({ "name": "Ben", "firm": "" }),
    );
    t.remove_member("bob");
    assert!(matches!(
        t.as_("bob").view("getMe", json!({})),
        Err(Failure::Refused { status: 404, .. })
    ));
}

#[test]
fn a_guest_is_a_reader() {
    let mut t = app();
    let id = publish(&mut t, "June");
    let q = call(
        &mut t,
        "gus",
        "askQuestion",
        json!({ "title": "Hi", "body": "", "categoryId": null }),
    );
    call(
        &mut t,
        "gus",
        "addComment",
        json!({ "postId": id, "parentId": null, "body": "Nice" }),
    );
    call(
        &mut t,
        "gus",
        "react",
        json!({ "postId": id, "emoji": "👍", "on": true }),
    );
    assert_eq!(
        post(&mut t, "owner", q.as_str().unwrap())["card"]["author"],
        json!("gus")
    );
    assert_eq!(
        code(
            &mut t,
            "gus",
            "publishUpdate",
            json!({ "input": update_input("x") })
        ),
        "Forbidden"
    );
    // Every event reaches a guest too (`Audience::All`); they carry ids only.
    assert_eq!(
        events(&t, "gus"),
        ["UpdatePublished", "QuestionAsked", "Commented", "Reacted"]
    );
}

#[test]
fn bad_args_unknown_methods_and_writes_as_views() {
    let mut t = app();
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setSettings",
            json!({ "companyName": "x" })
        ),
        "BadArgs"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setSettings",
            json!({ "companyName": "x", "cadenceDays": "30" })
        ),
        "BadArgs"
    );
    assert_eq!(
        code(&mut t, "owner", "listContributions", json!({ "since": 0 })),
        "BadArgs"
    );
    assert_eq!(code(&mut t, "owner", "get_me", json!({})), "UnknownMethod");
    match t
        .as_("owner")
        .view("setProfile", json!({ "name": "x", "firm": "" }))
    {
        Err(Failure::App { code, .. }) => assert_eq!(code, "NotAView"),
        other => panic!("{other:?}"),
    }
    let mut input = update_input("x");
    input["category_id"] = json!("");
    assert_eq!(
        code(&mut t, "owner", "publishUpdate", json!({ "input": input })),
        "BadArgs"
    );
    // A view may run as a call.
    assert_eq!(
        call(&mut t, "owner", "getMe", json!({}))["isAdmin"],
        json!(true)
    );
}
