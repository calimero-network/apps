//! The pipeline on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method, v1's storage-level write rules (`Authored`,
//! `WriteOnce` creation stamps) as the same calls made by another account, and
//! the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

const DAY_MS: u64 = 86_400_000;

/// The owner and one member, `bob`, who hears every event.
fn app() -> TestApp {
    common::app(Org::new().members(["bob"]))
}

fn call_as(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{method} as {who}: {e:?}"))
}

fn call(t: &mut TestApp, method: &str, args: Value) -> Value {
    call_as(t, "owner", method, args)
}

fn view(t: &mut TestApp, method: &str, args: Value) -> Value {
    t.as_("owner")
        .view(method, args)
        .unwrap_or_else(|e| panic!("{method}: {e:?}"))
}

fn id_of(v: Value) -> String {
    v.as_str().expect("an id").to_owned()
}

fn names(t: &TestApp) -> Vec<String> {
    t.events_for("bob").into_iter().map(|(n, _)| n).collect()
}

fn app_error(code: &str) -> impl Fn(&Result<Value, Failure>) -> bool + '_ {
    move |r| matches!(r, Err(Failure::App { code: c, .. }) if c == code)
}

fn deal_args(title: &str, value: u64, stage: &str) -> Value {
    json!({
        "title": title,
        "value": value.to_string(),
        "organization": "Acme",
        "contactId": null,
        "stageId": stage,
        "owner": "alice",
        "expectedClose": null,
        "source": "referral",
    })
}

/// v1's `deal` helper: owned by `alice`, from `Acme`, a referral.
fn deal_as(t: &mut TestApp, who: &str, title: &str, value: u64, stage: &str) -> String {
    id_of(call_as(
        t,
        who,
        "createDeal",
        deal_args(title, value, stage),
    ))
}

fn deal(t: &mut TestApp, title: &str, value: u64, stage: &str) -> String {
    deal_as(t, "owner", title, value, stage)
}

fn get_deal(t: &mut TestApp, id: &str) -> Value {
    view(t, "getDeal", json!({ "dealId": id }))
}

fn list_deals(t: &mut TestApp, status: Value, stage: Value, owner: Value) -> Vec<Value> {
    view(
        t,
        "listDeals",
        json!({ "status": status, "stageId": stage, "owner": owner }),
    )["items"]
        .as_array()
        .expect("a list")
        .clone()
}

fn activity_args(deal: Option<&str>, kind: &str, subject: &str, due: u64) -> Value {
    json!({
        "dealId": deal,
        "contactId": null,
        "kind": kind,
        "subject": subject,
        "dueAt": due.to_string(),
        "owner": null,
        "note": "",
    })
}

fn contact_args(name: &str, email: &str, phone: &str, org: &str, job: &str) -> Value {
    json!({
        "name": name, "email": email, "phone": phone,
        "organization": org, "jobTitle": job,
    })
}

/// How many rows a list answers: a page's `items`, or a plain list.
fn list_len(t: &mut TestApp, method: &str, args: Value) -> usize {
    let v = view(t, method, args);
    v.get("items").unwrap_or(&v).as_array().map_or(0, Vec::len)
}

// ── v1's TestHost tests ──────────────────────────────────────────────────────

#[test]
fn init_seeds_ordered_default_stages_and_settings() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "listStages", json!({})),
        json!([
            { "id": "stage-lead", "name": "Lead in", "probability": 10, "position": 0 },
            { "id": "stage-qualified", "name": "Qualified", "probability": 25, "position": 1 },
            { "id": "stage-meeting", "name": "Meeting", "probability": 40, "position": 2 },
            { "id": "stage-proposal", "name": "Proposal", "probability": 60, "position": 3 },
            { "id": "stage-negotiation", "name": "Negotiation", "probability": 80, "position": 4 },
        ])
    );
    assert_eq!(
        view(&mut t, "getSettings", json!({})),
        json!({ "currency": "USD", "rotting_days": 14 })
    );
}

#[test]
fn create_deal_lists_open_with_stage_probability() {
    let mut t = app();
    let id = deal(&mut t, "Big one", 12_000, "stage-proposal");
    assert!(id.starts_with(&format!("deal-{}-", common::T0)), "{id}");
    // The whole view, as the wire carries it: v1's snake_case fields, u64s as
    // decimal strings.
    assert_eq!(
        list_deals(&mut t, json!(null), json!(null), json!(null)),
        [json!({
            "id": id,
            "title": "Big one",
            "value": "12000",
            "organization": "Acme",
            "contact_id": null,
            "contact_name": null,
            "owner": "alice",
            "stage_id": "stage-proposal",
            "status": "open",
            "lost_reason": "",
            "expected_close": null,
            "source": "referral",
            "probability": 60,
            "stage_entered_at": common::T0.to_string(),
            "closed_at": null,
            "next_activity": null,
            "open_activities": 0,
            "last_touch_at": null,
            "created_by": "owner",
            "created_at": common::T0.to_string(),
        })]
    );
    assert_eq!(
        t.events_for("bob"),
        [(
            "DealCreated".to_owned(),
            json!({ "id": id, "stageId": "stage-proposal" })
        )]
    );
}

#[test]
fn create_deal_rejects_unknown_stage_contact_and_blank_title() {
    let mut t = app();
    let mut unknown_contact = deal_args("x", 1, "stage-lead");
    unknown_contact["contactId"] = json!("contact-nope");
    assert_eq!(
        t.as_("owner")
            .call("createDeal", deal_args("x", 1, "stage-nope")),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "what": "stage", "id": "stage-nope" }),
        })
    );
    assert!(app_error("NotFound")(
        &t.as_("owner").call("createDeal", unknown_contact)
    ));
    assert_eq!(
        t.as_("owner")
            .call("createDeal", deal_args("   ", 1, "stage-lead")),
        Err(Failure::App {
            code: "Invalid".to_owned(),
            fields: json!({ "message": "title must not be empty" }),
        })
    );
    assert!(app_error("Invalid")(&t.as_("owner").call(
        "createDeal",
        deal_args(&"t".repeat(121), 1, "stage-lead")
    )));
    assert!(names(&t).is_empty(), "refused creates emit nothing");
}

#[test]
fn move_close_and_reopen_deal() {
    let mut t = app();
    let id = deal(&mut t, "D", 500, "stage-lead");
    call(
        &mut t,
        "moveDeal",
        json!({ "dealId": id, "stageId": "stage-negotiation" }),
    );
    let d = get_deal(&mut t, &id)["deal"].clone();
    assert_eq!(d["stage_id"], json!("stage-negotiation"));
    assert_eq!(d["probability"], json!(80));

    call(
        &mut t,
        "markLost",
        json!({ "dealId": id, "reason": "Price" }),
    );
    let d = get_deal(&mut t, &id)["deal"].clone();
    assert_eq!(
        (d["status"].clone(), d["probability"].clone()),
        (json!("lost"), json!(0))
    );
    assert_eq!(d["lost_reason"], json!("Price"));
    assert!(d["closed_at"].is_string());
    // A closed deal can't be dragged around the board.
    assert!(app_error("Invalid")(&t.as_("owner").call(
        "moveDeal",
        json!({ "dealId": id, "stageId": "stage-lead" })
    )));

    call(&mut t, "reopenDeal", json!({ "dealId": id }));
    let d = get_deal(&mut t, &id)["deal"].clone();
    assert_eq!(d["status"], json!("open"));
    assert_eq!(d["stage_id"], json!("stage-negotiation"));
    assert_eq!(d["lost_reason"], json!(""));
    assert_eq!(d["closed_at"], json!(null));

    call(&mut t, "markWon", json!({ "dealId": id }));
    let won = list_deals(&mut t, json!("won"), json!(null), json!(null));
    assert_eq!(won.len(), 1);
    assert_eq!(won[0]["probability"], json!(100));
    assert_eq!(
        names(&t),
        [
            "DealCreated",
            "DealMoved",
            "DealStatusChanged",
            "DealStatusChanged",
            "DealStatusChanged"
        ]
    );
    // Moving into the stage it is in is a no-op; reopening an open deal too.
    call(&mut t, "reopenDeal", json!({ "dealId": id }));
    call(&mut t, "reopenDeal", json!({ "dealId": id }));
    call(
        &mut t,
        "moveDeal",
        json!({ "dealId": id, "stageId": "stage-negotiation" }),
    );
    assert_eq!(names(&t).len(), 6);
}

#[test]
fn list_deals_filters_and_is_newest_first() {
    let mut t = app();
    let a = deal(&mut t, "A", 1, "stage-lead");
    t.advance(1);
    let b = deal(&mut t, "B", 2, "stage-meeting");
    let mut args = deal_args("A", 1, "stage-lead");
    args.as_object_mut().expect("an object").remove("stageId");
    args["dealId"] = json!(a);
    args["owner"] = json!("bob");
    call(&mut t, "updateDeal", args);

    let ids = |v: Vec<Value>| -> Vec<String> {
        v.iter()
            .map(|d| d["id"].as_str().expect("an id").to_owned())
            .collect()
    };
    assert_eq!(
        ids(list_deals(&mut t, json!(null), json!(null), json!(null))),
        [b.clone(), a.clone()]
    );
    assert_eq!(
        ids(list_deals(
            &mut t,
            json!(null),
            json!("stage-lead"),
            json!(null)
        )),
        std::slice::from_ref(&a)
    );
    assert_eq!(
        ids(list_deals(&mut t, json!(null), json!(null), json!("bob"))),
        std::slice::from_ref(&a)
    );
    assert_eq!(
        ids(list_deals(
            &mut t,
            json!("open"),
            json!("stage-meeting"),
            json!("alice")
        )),
        [b]
    );
    assert!(list_deals(&mut t, json!("won"), json!(null), json!(null)).is_empty());
}

#[test]
fn update_deal_edits_fields_and_links_contact() {
    let mut t = app();
    let id = deal(&mut t, "Old", 10, "stage-lead");
    let c = id_of(call(
        &mut t,
        "createContact",
        contact_args("Ada Lovelace", "ada@example.com", "", "Analytical", "CTO"),
    ));
    call(
        &mut t,
        "updateDeal",
        json!({
            "dealId": id, "title": "New", "value": "99", "organization": "Analytical",
            "contactId": c, "owner": null, "expectedClose": "1800000000000", "source": "",
        }),
    );
    let detail = get_deal(&mut t, &id);
    assert_eq!(detail["deal"]["title"], json!("New"));
    assert_eq!(detail["deal"]["value"], json!("99"));
    assert_eq!(detail["deal"]["owner"], json!(null));
    assert_eq!(detail["deal"]["contact_name"], json!("Ada Lovelace"));
    assert_eq!(detail["deal"]["expected_close"], json!("1800000000000"));
    assert_eq!(detail["contact"]["open_deals"], json!(1));
    assert_eq!(detail["contact"]["job_title"], json!("CTO"));
    assert!(app_error("NotFound")(&t.as_("owner").call(
        "updateDeal",
        json!({
            "dealId": "deal-nope", "title": "x", "value": "1", "organization": "",
            "contactId": null, "owner": null, "expectedClose": null, "source": "",
        })
    )));
}

#[test]
fn activities_drive_next_step_and_last_touch() {
    let mut t = app();
    let id = deal(&mut t, "D", 1, "stage-lead");
    let later = id_of(call(
        &mut t,
        "addActivity",
        activity_args(Some(&id), "meeting", "Demo", 2_000),
    ));
    let sooner = id_of(call(
        &mut t,
        "addActivity",
        activity_args(Some(&id), "call", "Intro call", 1_000),
    ));
    let d = get_deal(&mut t, &id)["deal"].clone();
    assert_eq!(d["open_activities"], json!(2));
    assert_eq!(
        d["next_activity"],
        json!({ "id": sooner, "kind": "call", "subject": "Intro call", "due_at": "1000" })
    );
    assert_eq!(d["last_touch_at"], json!(null));

    call(
        &mut t,
        "setActivityDone",
        json!({ "activityId": sooner, "done": true }),
    );
    let d = get_deal(&mut t, &id)["deal"].clone();
    assert_eq!(d["open_activities"], json!(1));
    assert_eq!(d["next_activity"]["id"], json!(later));
    assert!(d["last_touch_at"].is_string());

    call(
        &mut t,
        "rescheduleActivity",
        json!({ "activityId": later, "dueAt": "5000" }),
    );
    let open = view(
        &mut t,
        "listActivities",
        json!({ "dealId": null, "done": false }),
    )["items"]
        .clone();
    assert_eq!(open.as_array().map(Vec::len), Some(1));
    assert_eq!(open[0]["due_at"], json!("5000"));
    assert_eq!(open[0]["deal_title"], json!("D"));
    assert_eq!(open[0]["created_by"], json!("owner"));

    call(&mut t, "deleteActivity", json!({ "activityId": later }));
    assert_eq!(
        list_len(
            &mut t,
            "listActivities",
            json!({ "dealId": null, "done": null })
        ),
        1
    );
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("addActivity", activity_args(None, "fax", "x", 0))
    ));
    assert!(app_error("NotFound")(&t.as_("owner").call(
        "addActivity",
        activity_args(Some("deal-nope"), "task", "x", 0)
    )));
    assert!(app_error("NotFound")(
        &t.as_("owner")
            .call("deleteActivity", json!({ "activityId": later }))
    ));
}

#[test]
fn automation_schedules_follow_up_on_stage_entry() {
    let mut t = app();
    let rule = id_of(call(
        &mut t,
        "addAutomation",
        json!({ "stageId": "stage-proposal", "kind": "email", "subject": "Send proposal", "dueInDays": 2 }),
    ));
    let id = deal(&mut t, "D", 1, "stage-lead");
    assert_eq!(get_deal(&mut t, &id)["activities"], json!([]));

    call_as(
        &mut t,
        "bob",
        "moveDeal",
        json!({ "dealId": id, "stageId": "stage-proposal" }),
    );
    let acts = get_deal(&mut t, &id)["activities"].clone();
    assert_eq!(acts.as_array().map(Vec::len), Some(1));
    assert_eq!(acts[0]["subject"], json!("Send proposal"));
    assert_eq!(acts[0]["kind"], json!("email"));
    assert_eq!(acts[0]["automation_id"], json!(rule));
    assert_eq!(acts[0]["owner"], json!("alice"));
    assert_eq!(acts[0]["created_by"], json!("bob"));
    assert_eq!(
        acts[0]["due_at"],
        json!((common::T0 + 2 * DAY_MS).to_string())
    );
    assert_eq!(
        t.events_for("bob")[2..],
        [
            (
                "DealMoved".to_owned(),
                json!({ "id": id, "stageId": "stage-proposal" })
            ),
            (
                "AutomationFired".to_owned(),
                json!({ "automationId": rule, "dealId": id })
            ),
        ]
    );

    // Created directly in the stage also fires; a disabled rule does not.
    deal(&mut t, "E", 1, "stage-proposal");
    call(
        &mut t,
        "setAutomationEnabled",
        json!({ "automationId": rule, "enabled": false }),
    );
    assert_eq!(
        view(&mut t, "listAutomations", json!({}))[0]["enabled"],
        json!(false)
    );
    deal(&mut t, "F", 1, "stage-proposal");
    assert_eq!(
        list_len(
            &mut t,
            "listActivities",
            json!({ "dealId": null, "done": null })
        ),
        2
    );

    call(&mut t, "deleteAutomation", json!({ "automationId": rule }));
    assert_eq!(view(&mut t, "listAutomations", json!({})), json!([]));
    assert!(app_error("Invalid")(&t.as_("owner").call(
        "addAutomation",
        json!({ "stageId": "stage-lead", "kind": "task", "subject": "t", "dueInDays": 366 })
    )));
    assert!(app_error("NotFound")(&t.as_("owner").call(
        "addAutomation",
        json!({ "stageId": "stage-nope", "kind": "task", "subject": "t", "dueInDays": 1 })
    )));
}

#[test]
fn stages_add_update_reorder_delete() {
    let mut t = app();
    let won_soon = id_of(call(
        &mut t,
        "addStage",
        json!({ "name": "Contract sent", "probability": 90 }),
    ));
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("addStage", json!({ "name": "x", "probability": 101 }))
    ));
    call(
        &mut t,
        "updateStage",
        json!({ "stageId": won_soon, "name": "Contract out", "probability": 95 }),
    );
    let stages = view(&mut t, "listStages", json!({}));
    let stages = stages.as_array().expect("a list");
    let last = stages.last().expect("a stage");
    assert_eq!(
        (last["name"].clone(), last["probability"].clone()),
        (json!("Contract out"), json!(95))
    );

    let mut ids: Vec<Value> = stages.iter().map(|s| s["id"].clone()).collect();
    ids.reverse();
    call(&mut t, "reorderStages", json!({ "stageIds": ids }));
    assert_eq!(
        view(&mut t, "listStages", json!({}))[0]["id"],
        json!(won_soon)
    );
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("reorderStages", json!({ "stageIds": ["stage-lead"] }))
    ));

    // Occupied stages can't be removed; empty ones can, with their rules.
    let d = deal(&mut t, "D", 1, "stage-lead");
    assert_eq!(
        t.as_("owner")
            .call("deleteStage", json!({ "stageId": "stage-lead" })),
        Err(Failure::App {
            code: "Invalid".to_owned(),
            fields: json!({ "message": "move the open deals out of this stage first" }),
        })
    );
    call(&mut t, "markWon", json!({ "dealId": d }));
    call(
        &mut t,
        "addAutomation",
        json!({ "stageId": "stage-lead", "kind": "task", "subject": "t", "dueInDays": 0 }),
    );
    call(&mut t, "deleteStage", json!({ "stageId": "stage-lead" }));
    assert_eq!(view(&mut t, "listAutomations", json!({})), json!([]));
    assert_eq!(list_len(&mut t, "listStages", json!({})), 5);
}

#[test]
fn a_pipeline_keeps_at_least_one_and_at_most_twelve_stages() {
    let mut t = app();
    for i in 0..7 {
        call(
            &mut t,
            "addStage",
            json!({ "name": format!("S{i}"), "probability": 50 }),
        );
    }
    assert_eq!(
        t.as_("owner")
            .call("addStage", json!({ "name": "13th", "probability": 50 })),
        Err(Failure::App {
            code: "Invalid".to_owned(),
            fields: json!({ "message": "a pipeline can have at most 12 stages" }),
        })
    );
    let stages = view(&mut t, "listStages", json!({}));
    let ids: Vec<String> = stages
        .as_array()
        .expect("a list")
        .iter()
        .map(|s| s["id"].as_str().expect("an id").to_owned())
        .collect();
    for id in &ids[1..] {
        call(&mut t, "deleteStage", json!({ "stageId": id }));
    }
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("deleteStage", json!({ "stageId": ids[0] }))
    ));
    assert!(app_error("NotFound")(
        &t.as_("owner")
            .call("deleteStage", json!({ "stageId": ids[1] }))
    ));
}

#[test]
fn settings_validate() {
    let mut t = app();
    call(&mut t, "setCurrency", json!({ "currency": "eur" }));
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("setCurrency", json!({ "currency": "EURO" }))
    ));
    call(&mut t, "setRottingDays", json!({ "days": 7 }));
    assert!(app_error("Invalid")(
        &t.as_("owner").call("setRottingDays", json!({ "days": 0 }))
    ));
    assert_eq!(
        view(&mut t, "getSettings", json!({})),
        json!({ "currency": "EUR", "rotting_days": 7 })
    );
    assert_eq!(names(&t), ["SettingsChanged", "SettingsChanged"]);
}

#[test]
fn contacts_crud_and_delete_unlinks_deals() {
    let mut t = app();
    assert!(app_error("Invalid")(&t.as_("owner").call(
        "createContact",
        contact_args("X", "not-an-email", "", "", "")
    )));
    let c = id_of(call(
        &mut t,
        "createContact",
        contact_args("Grace", "", "+1 555", "Navy", ""),
    ));
    let mut edit = contact_args("Grace Hopper", "g@navy.mil", "+1 555", "Navy", "RADM");
    edit["contactId"] = json!(c);
    call(&mut t, "updateContact", edit);
    let mut args = deal_args("D", 7, "stage-lead");
    args["contactId"] = json!(c);
    let d = id_of(call(&mut t, "createDeal", args));
    call(&mut t, "markWon", json!({ "dealId": d }));
    let contacts = view(&mut t, "listContacts", json!({}))["items"].clone();
    assert_eq!(contacts[0]["name"], json!("Grace Hopper"));
    assert_eq!(contacts[0]["won_value"], json!("7"));
    assert_eq!(contacts[0]["open_deals"], json!(0));
    assert_eq!(contacts[0]["created_by"], json!("owner"));

    assert_eq!(
        t.as_("bob")
            .call("deleteContact", json!({ "contactId": c })),
        Err(Failure::App {
            code: "Forbidden".to_owned(),
            fields: json!({ "message": "only the creator may delete this contact" }),
        })
    );
    call(&mut t, "deleteContact", json!({ "contactId": c }));
    assert_eq!(
        view(&mut t, "listContacts", json!({})),
        json!({ "items": [], "next": null })
    );
    assert_eq!(get_deal(&mut t, &d)["deal"]["contact_id"], json!(null));
    assert_eq!(get_deal(&mut t, &d)["contact"], json!(null));
}

#[test]
fn contacts_list_by_name() {
    let mut t = app();
    for name in ["bea", "Ann", "carl"] {
        call(&mut t, "createContact", contact_args(name, "", "", "", ""));
    }
    let got: Vec<Value> = view(&mut t, "listContacts", json!({}))["items"]
        .as_array()
        .expect("a list")
        .iter()
        .map(|c| c["name"].clone())
        .collect();
    assert_eq!(got, [json!("Ann"), json!("bea"), json!("carl")]);
}

#[test]
fn notes_are_author_gated() {
    let mut t = app();
    let d = deal(&mut t, "D", 1, "stage-lead");
    let n = id_of(call(
        &mut t,
        "addNote",
        json!({ "dealId": d, "body": "Budget approved" }),
    ));
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("addNote", json!({ "dealId": d, "body": " " }))
    ));
    let detail = get_deal(&mut t, &d);
    assert_eq!(detail["notes"][0]["body"], json!("Budget approved"));
    assert_eq!(detail["notes"][0]["author"], json!("owner"));
    assert!(detail["deal"]["last_touch_at"].is_string());
    assert_eq!(
        t.as_("bob").call("deleteNote", json!({ "noteId": n })),
        Err(Failure::App {
            code: "Forbidden".to_owned(),
            fields: json!({ "message": "only the author may delete this note" }),
        })
    );
    call(&mut t, "deleteNote", json!({ "noteId": n }));
    assert_eq!(get_deal(&mut t, &d)["notes"], json!([]));
    assert_eq!(
        t.as_("owner").call("deleteNote", json!({ "noteId": n })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "what": "note", "id": n }),
        })
    );
}

#[test]
fn notes_are_newest_first() {
    let mut t = app();
    let d = deal(&mut t, "D", 1, "stage-lead");
    call(&mut t, "addNote", json!({ "dealId": d, "body": "first" }));
    t.advance(1);
    call_as(
        &mut t,
        "bob",
        "addNote",
        json!({ "dealId": d, "body": "second" }),
    );
    let notes = get_deal(&mut t, &d)["notes"].clone();
    assert_eq!(notes[0]["body"], json!("second"));
    assert_eq!(notes[0]["author"], json!("bob"));
    assert_eq!(notes[1]["body"], json!("first"));
}

#[test]
fn delete_deal_is_creator_gated_and_cascades() {
    let mut t = app();
    let d = deal(&mut t, "D", 1, "stage-lead");
    let a = id_of(call(
        &mut t,
        "addActivity",
        activity_args(Some(&d), "task", "t", 0),
    ));
    call(&mut t, "addNote", json!({ "dealId": d, "body": "n" }));
    call_as(
        &mut t,
        "bob",
        "addNote",
        json!({ "dealId": d, "body": "bob's" }),
    );
    assert_eq!(
        t.as_("bob").call("deleteDeal", json!({ "dealId": d })),
        Err(Failure::App {
            code: "Forbidden".to_owned(),
            fields: json!({ "message": "only the creator may delete this deal" }),
        })
    );
    call(&mut t, "deleteDeal", json!({ "dealId": d }));
    assert!(app_error("NotFound")(
        &t.as_("owner").view("getDeal", json!({ "dealId": d }))
    ));
    assert!(app_error("NotFound")(
        &t.as_("owner")
            .call("deleteActivity", json!({ "activityId": a }))
    ));
    assert_eq!(
        list_len(
            &mut t,
            "listActivities",
            json!({ "dealId": null, "done": null })
        ),
        0
    );
    assert_eq!(names(&t).last().map(String::as_str), Some("DealDeleted"));
}

// ── v1's storage-level write rules, as calls by another account ─────────────

#[test]
fn a_records_creator_is_the_caller_and_teammates_still_work_the_deal() {
    let mut t = app();
    let d = deal_as(&mut t, "bob", "Bob's", 1, "stage-lead");
    assert_eq!(get_deal(&mut t, &d)["deal"]["created_by"], json!("bob"));
    // The app owner is not the creator either.
    assert!(app_error("Forbidden")(
        &t.as_("owner").call("deleteDeal", json!({ "dealId": d }))
    ));
    // Teammates still edit the shared deal itself: that is the board.
    call(
        &mut t,
        "moveDeal",
        json!({ "dealId": d, "stageId": "stage-meeting" }),
    );
    call(&mut t, "markWon", json!({ "dealId": d }));
    call_as(&mut t, "bob", "deleteDeal", json!({ "dealId": d }));
}

#[test]
fn a_stage_runs_at_most_ten_automations() {
    let mut t = app();
    for i in 0..10 {
        call(
            &mut t,
            "addAutomation",
            json!({ "stageId": "stage-proposal", "kind": "task", "subject": format!("t{i}"), "dueInDays": 1 }),
        );
    }
    assert_eq!(
        t.as_("owner").call(
            "addAutomation",
            json!({ "stageId": "stage-proposal", "kind": "task", "subject": "x", "dueInDays": 1 })
        ),
        Err(Failure::App {
            code: "Invalid".to_owned(),
            fields: json!({ "message": "a stage can have at most 10 automations" }),
        })
    );
    let d = deal(&mut t, "D", 1, "stage-lead");
    call(
        &mut t,
        "moveDeal",
        json!({ "dealId": d, "stageId": "stage-proposal" }),
    );
    assert_eq!(
        get_deal(&mut t, &d)["activities"].as_array().map(Vec::len),
        Some(10)
    );
}

#[test]
fn a_reopened_deal_whose_stage_was_deleted_shows_in_the_first_stage() {
    let mut t = app();
    let d = deal(&mut t, "D", 1, "stage-meeting");
    call(&mut t, "markLost", json!({ "dealId": d, "reason": "" }));
    call(&mut t, "deleteStage", json!({ "stageId": "stage-meeting" }));
    call(&mut t, "reopenDeal", json!({ "dealId": d }));
    let view = get_deal(&mut t, &d)["deal"].clone();
    assert_eq!(view["stage_id"], json!("stage-lead"));
    assert_eq!(view["probability"], json!(10));
}

/// v1's convergence test under one log: two members edit the same deal, the
/// later write holds, and every member's records survive.
#[test]
fn every_members_writes_survive_and_the_later_edit_holds() {
    let mut t = app();
    let a = deal(&mut t, "Owner's", 1, "stage-lead");
    let b = deal_as(&mut t, "bob", "Bob's", 2, "stage-lead");
    call(
        &mut t,
        "moveDeal",
        json!({ "dealId": a, "stageId": "stage-meeting" }),
    );
    call_as(
        &mut t,
        "bob",
        "moveDeal",
        json!({ "dealId": a, "stageId": "stage-proposal" }),
    );
    assert_eq!(
        get_deal(&mut t, &a)["deal"]["stage_id"],
        json!("stage-proposal")
    );
    assert_eq!(
        list_len(
            &mut t,
            "listDeals",
            json!({ "status": null, "stageId": null, "owner": null })
        ),
        2
    );
    assert_eq!(get_deal(&mut t, &b)["deal"]["title"], json!("Bob's"));
}

// ── access and wire ─────────────────────────────────────────────────────────

/// The org decides who reaches the pipeline: owner, admins, members and
/// guests. Nobody else, and nobody anonymous.
#[test]
fn who_reaches_the_pipeline() {
    let mut t = common::app(Org::new().members(["bob"]).guests(["gus"]));
    let id = deal_as(&mut t, "gus", "Gus's", 1, "stage-lead");
    assert_eq!(get_deal(&mut t, &id)["deal"]["created_by"], json!("gus"));

    let unauthenticated = Err(Failure::Refused {
        status: 401,
        code: "UNAUTHENTICATED".to_owned(),
    });
    let not_found = Err(Failure::Refused {
        status: 404,
        code: "NOT_FOUND".to_owned(),
    });
    assert_eq!(t.anonymous().view("listStages", json!({})), unauthenticated);
    assert_eq!(
        t.anonymous()
            .call("createDeal", deal_args("x", 1, "stage-lead")),
        unauthenticated
    );
    assert_eq!(
        t.as_("mallory").view("getDeal", json!({ "dealId": id })),
        not_found
    );
    assert_eq!(
        t.as_("mallory").call("deleteDeal", json!({ "dealId": id })),
        not_found
    );
    // The system caller (timers) is no account: it cannot create anything.
    assert!(matches!(
        t.system()
            .call("createDeal", deal_args("x", 1, "stage-lead")),
        Err(Failure::App { .. })
    ));
    assert_eq!(
        list_len(
            &mut t,
            "listDeals",
            json!({ "status": null, "stageId": null, "owner": null })
        ),
        1
    );
}

/// An API key acting for an account creates as that account.
#[test]
fn an_api_key_acts_as_its_account() {
    let mut t = app();
    let id = t
        .api_key("key-1", "bob")
        .call("createDeal", deal_args("From the agent", 5, "stage-lead"))
        .expect("create");
    let id = id_of(id);
    assert_eq!(get_deal(&mut t, &id)["deal"]["created_by"], json!("bob"));
    t.api_key("key-1", "bob")
        .call("deleteDeal", json!({ "dealId": id }))
        .expect("bob's key deletes bob's deal");
}

/// Arguments are a JSON object of exactly the method's camelCase parameters,
/// a u64 as a decimal string.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = app();
    let id = deal(&mut t, "D", 1, "stage-lead");
    for (method, args) in [
        ("moveDeal", json!({ "dealId": id })),
        (
            "moveDeal",
            json!({ "deal_id": id, "stageId": "stage-meeting" }),
        ),
        (
            "moveDeal",
            json!({ "dealId": id, "stageId": "stage-meeting", "extra": 1 }),
        ),
        (
            "moveDeal",
            json!({ "dealId": 7, "stageId": "stage-meeting" }),
        ),
        ("createDeal", {
            let mut a = deal_args("x", 1, "stage-lead");
            a["value"] = json!(1);
            a
        }),
        (
            "rescheduleActivity",
            json!({ "activityId": "a", "dueAt": "01" }),
        ),
        ("listDeals", json!({ "status": 3 })),
    ] {
        let got = if method == "listDeals" {
            t.as_("owner").view(method, args.clone())
        } else {
            t.as_("owner").call(method, args.clone())
        };
        assert!(app_error("BadArgs")(&got), "{method} {args}: {got:?}");
    }
    assert_eq!(
        get_deal(&mut t, &id)["deal"]["stage_id"],
        json!("stage-lead")
    );
    assert_eq!(names(&t), ["DealCreated"]);
    // Left-out optional parameters are null: no filter.
    assert_eq!(list_len(&mut t, "listDeals", json!({})), 1);
}

/// v1's snake_case names are not methods any more, and a write is not a view.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = app();
    assert!(app_error("UnknownMethod")(
        &t.as_("owner").view("list_stages", json!({}))
    ));
    assert!(app_error("NotAView")(
        &t.as_("owner")
            .view("createDeal", deal_args("t", 1, "stage-lead"))
    ));
    // A view may run as a call.
    assert!(t.as_("owner").call("listStages", json!({})).is_ok());
}

/// A list is one page: 100 rows unless the caller asks for up to 1,000, and
/// `next` reads on from where it stopped.
#[test]
fn lists_are_pages_with_a_cursor() {
    let mut t = app();
    for _ in 0..1001 {
        deal(&mut t, "D", 1, "stage-lead");
        t.advance(1);
    }
    let first = view(&mut t, "listDeals", json!({ "limit": 1000 }));
    let items = first["items"].as_array().expect("a list");
    assert_eq!(items.len(), 1000);
    assert_eq!(
        items[0]["created_at"],
        json!((common::T0 + 1000).to_string())
    );
    assert_eq!(
        items[999]["created_at"],
        json!((common::T0 + 1).to_string())
    );
    let rest = view(
        &mut t,
        "listDeals",
        json!({ "limit": 1000, "cursor": first["next"] }),
    );
    assert_eq!(rest["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        rest["items"][0]["created_at"],
        json!(common::T0.to_string())
    );
    assert_eq!(rest["next"], json!(null));

    assert_eq!(list_len(&mut t, "listDeals", json!({})), 100);
    for limit in [0, 1001] {
        assert!(app_error("Invalid")(
            &t.as_("owner").view("listDeals", json!({ "limit": limit }))
        ));
    }
    // The stage's open deals, one seek, paged the same way.
    let open = view(
        &mut t,
        "listDeals",
        json!({ "status": "open", "stageId": "stage-lead", "limit": 2 }),
    );
    assert_eq!(open["items"].as_array().map(Vec::len), Some(2));
    assert!(open["next"].is_string());
}

// ── rc.8: search and the hand-off from other apps ───────────────────────────

fn lead_args(source_ref: &str, name: &str, email: &str) -> Value {
    json!({
        "sourceRef": source_ref,
        "stageId": "stage-lead",
        "name": name,
        "email": email,
        "phone": "+1 555 0100",
        "organization": "Initech",
        "jobTitle": "",
        "title": "",
        "source": "Mero Forms · Contact us",
        "note": "From the form \"Contact us\":\n\nMessage: call me",
    })
}

/// v1 searched in the browser over everything it had read; now the host's
/// index answers, a page at a time.
#[test]
fn deals_and_people_are_searched_by_their_text_fields() {
    let mut t = app();
    deal(&mut t, "Initech renewal", 5, "stage-lead");
    let mut other = deal_args("Globex rollout", 9, "stage-lead");
    other["organization"] = json!("Globex");
    other["source"] = json!("inbound");
    let globex = id_of(call(&mut t, "createDeal", other));
    call(
        &mut t,
        "createContact",
        contact_args(
            "Ada Lovelace",
            "ada@analytical.org",
            "",
            "Analytical",
            "CTO",
        ),
    );
    call(
        &mut t,
        "createContact",
        contact_args("Grace Hopper", "g@navy.mil", "", "Navy", "RADM"),
    );

    let hits = view(&mut t, "searchDeals", json!({ "text": "globex" }));
    assert_eq!(hits["total"], json!("1"));
    assert_eq!(hits["items"][0]["id"], json!(globex));
    assert_eq!(hits["items"][0]["probability"], json!(10));
    let hits = view(&mut t, "searchDeals", json!({ "text": "inbound" }));
    assert_eq!(hits["items"][0]["id"], json!(globex));

    let people = view(&mut t, "searchContacts", json!({ "text": "navy" }));
    assert_eq!(people["total"], json!("1"));
    assert_eq!(people["items"][0]["name"], json!("Grace Hopper"));
    let people = view(&mut t, "searchContacts", json!({ "text": "cto" }));
    assert_eq!(people["items"][0]["name"], json!("Ada Lovelace"));
    assert_eq!(
        view(&mut t, "searchContacts", json!({ "text": "nobody" }))["items"],
        json!([])
    );
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .view("searchDeals", json!({ "text": "x", "limit": 101 }))
    ));
    // Search runs on the host's index, which calls cannot read.
    assert!(t
        .as_("owner")
        .call("searchDeals", json!({ "text": "x" }))
        .is_err());
}

#[test]
fn a_person_is_found_by_email_in_any_case() {
    let mut t = app();
    let c = id_of(call(
        &mut t,
        "createContact",
        contact_args("Ada", " Ada@Analytical.org ", "", "", ""),
    ));
    let found = view(
        &mut t,
        "findContactByEmail",
        json!({ "email": "ada@ANALYTICAL.org" }),
    );
    assert_eq!(found["id"], json!(c));
    assert_eq!(
        view(&mut t, "findContactByEmail", json!({ "email": "" })),
        json!(null)
    );
    // An edit moves the person to the new address.
    let mut edit = contact_args("Ada", "ada@lovelace.dev", "", "", "");
    edit["contactId"] = json!(c);
    call(&mut t, "updateContact", edit);
    assert_eq!(
        view(
            &mut t,
            "findContactByEmail",
            json!({ "email": "ada@analytical.org" })
        ),
        json!(null)
    );
}

/// Mero Forms' "Send to CRM" on rc.8: an xcall from the forms app.
#[test]
fn another_app_hands_over_a_lead_once() {
    let mut t = common::app(Org::new().members(["bob"]).admins(["ada"]));
    let rule = id_of(call(
        &mut t,
        "addAutomation",
        json!({ "stageId": "stage-lead", "kind": "call", "subject": "Call back", "dueInDays": 1 }),
    ));

    let first = t
        .deliver(
            "forms-app",
            "submitLead",
            lead_args("resp-1", "Grace", "G@navy.mil"),
        )
        .expect("delivered");
    assert_eq!(first["contact_created"], json!(true));
    assert_eq!(first["duplicate"], json!(false));
    let deal_id = first["deal_id"].as_str().expect("a deal").to_owned();
    let contact_id = first["contact_id"].as_str().expect("a person").to_owned();

    let d = get_deal(&mut t, &deal_id);
    assert_eq!(d["deal"]["title"], json!("Grace"));
    assert_eq!(d["deal"]["value"], json!("0"));
    assert_eq!(d["deal"]["owner"], json!(null));
    assert_eq!(d["deal"]["organization"], json!("Initech"));
    assert_eq!(d["deal"]["source"], json!("Mero Forms · Contact us"));
    assert_eq!(d["deal"]["created_by"], json!("app:forms-app"));
    assert_eq!(d["contact"]["email"], json!("G@navy.mil"));
    assert_eq!(d["contact"]["created_by"], json!("app:forms-app"));
    assert_eq!(d["notes"][0]["author"], json!("app:forms-app"));
    assert_eq!(
        d["notes"][0]["body"],
        json!("From the form \"Contact us\":\n\nMessage: call me")
    );
    // The stage's automation ran for the handed-over deal.
    assert_eq!(d["activities"][0]["automation_id"], json!(rule));
    assert_eq!(
        names(&t)[names(&t).len() - 5..],
        [
            "ContactChanged",
            "DealCreated",
            "NoteChanged",
            "AutomationFired",
            "LeadReceived"
        ]
    );
    assert_eq!(
        t.events_for("bob").last().map(|(_, d)| d.clone()),
        Some(json!({
            "dealId": deal_id,
            "contactId": contact_id,
            "source": "app:forms-app",
            "sourceRef": "resp-1",
        }))
    );

    // The platform retries a delivery: nothing is written twice.
    let events = names(&t).len();
    let again = t
        .deliver(
            "forms-app",
            "submitLead",
            lead_args("resp-1", "Grace", "G@navy.mil"),
        )
        .expect("delivered");
    assert_eq!(again["deal_id"], json!(deal_id));
    assert_eq!(again["duplicate"], json!(true));
    assert_eq!(names(&t).len(), events);
    assert_eq!(list_len(&mut t, "listDeals", json!({})), 1);

    // A second response from the same address is the same person.
    let second = t
        .deliver(
            "forms-app",
            "submitLead",
            lead_args("resp-2", "Grace H.", "g@NAVY.mil"),
        )
        .expect("delivered");
    assert_eq!(second["contact_id"], json!(contact_id));
    assert_eq!(second["contact_created"], json!(false));
    assert_eq!(list_len(&mut t, "listContacts", json!({})), 1);
    let person = view(&mut t, "listContacts", json!({}))["items"][0].clone();
    assert_eq!(person["open_deals"], json!(2));

    // The same sourceRef from ANOTHER sender is another lead.
    let other = t
        .deliver(
            "crm-importer",
            "submitLead",
            lead_args("resp-1", "Grace", ""),
        )
        .expect("delivered");
    assert_eq!(other["duplicate"], json!(false));
    assert_ne!(other["deal_id"], json!(deal_id));

    // Records an app made have no account behind them: a member may not
    // delete them, an admin may.
    let second_deal = second["deal_id"].as_str().expect("a deal").to_owned();
    assert!(app_error("Forbidden")(
        &t.as_("bob")
            .call("deleteDeal", json!({ "dealId": second_deal }))
    ));
    let note = get_deal(&mut t, &deal_id)["notes"][0]["id"].clone();
    assert!(app_error("Forbidden")(
        &t.as_("bob").call("deleteNote", json!({ "noteId": note }))
    ));
    call_as(&mut t, "ada", "deleteNote", json!({ "noteId": note }));
    call_as(
        &mut t,
        "ada",
        "deleteDeal",
        json!({ "dealId": second_deal }),
    );
    call(&mut t, "deleteDeal", json!({ "dealId": deal_id }));
    call(&mut t, "deleteContact", json!({ "contactId": contact_id }));
    // A deal a member created stays theirs alone, admins included.
    let bobs = deal_as(&mut t, "bob", "Mine", 1, "stage-lead");
    assert!(app_error("Forbidden")(
        &t.as_("ada").call("deleteDeal", json!({ "dealId": bobs }))
    ));
}

#[test]
fn a_lead_is_checked_like_the_records_it_makes() {
    let mut t = app();
    let mut bad_stage = lead_args("r", "Grace", "");
    bad_stage["stageId"] = json!("stage-gone");
    let mut bad_email = lead_args("r", "Grace", "not an email");
    bad_email["email"] = json!("not an email");
    for (args, code) in [
        (lead_args("", "Grace", ""), "Invalid"),
        (lead_args("r", " ", ""), "Invalid"),
        (bad_email, "Invalid"),
        (bad_stage, "NotFound"),
    ] {
        let got = t.deliver("forms-app", "submitLead", args.clone());
        assert!(app_error(code)(&got), "{args}: {got:?}");
    }
    assert_eq!(list_len(&mut t, "listDeals", json!({})), 0);
    assert_eq!(list_len(&mut t, "listContacts", json!({})), 0);

    // A member may hand over a lead too (the forms frontend's fallback); the
    // records are theirs, and idempotency is per account.
    let mine = call_as(&mut t, "bob", "submitLead", lead_args("r", "Grace", ""));
    assert_eq!(
        get_deal(&mut t, mine["deal_id"].as_str().expect("a deal"))["deal"]["created_by"],
        json!("bob")
    );
    let again = call_as(&mut t, "bob", "submitLead", lead_args("r", "Grace", ""));
    assert_eq!(again["duplicate"], json!(true));
    // Only `submitLead` takes other apps; every other write refuses them.
    assert!(app_error("Forbidden")(&t.deliver(
        "forms-app",
        "createDeal",
        deal_args("x", 1, "stage-lead")
    )));
    assert!(matches!(
        t.anonymous()
            .call("submitLead", lead_args("r2", "Grace", "")),
        Err(Failure::Refused { status: 401, .. })
    ));
    assert!(matches!(
        t.as_("mallory")
            .call("submitLead", lead_args("r2", "Grace", "")),
        Err(Failure::Refused { status: 404, .. })
    ));
}
