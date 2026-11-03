//! The access and wire checks: who reaches the feed at all, and what the node
//! refuses before a method runs.

use calimero_app_sdk::testing::Failure;
use serde_json::json;

use crate::support::*;

#[test]
fn the_owner_records_and_reads_back() {
    let mut t = acting_in("chat");
    let item = call(
        &mut t,
        "recordAction",
        json!({ "input": action("chat", "done") }),
    );
    assert_eq!(item["status"], "done");
    assert_eq!(item["breach"], "");
    assert_eq!(item["needs_you"], false);
    // Plain records keep v1's shapes: numbers stay numbers, fields snake_case.
    assert!(item["at"].is_u64(), "{item}");
    let page = feed(&mut t, "all");
    assert_eq!(ids(&page), [s(&item["id"])]);
    assert_eq!(event_names(&t), ["SettingsChanged", "ActionRecorded"]);
}

#[test]
fn optional_arguments_may_be_left_out() {
    let mut t = app();
    let v = view(
        &mut t,
        "checkAction",
        json!({ "appKey": "chat", "category": "", "writes": true }),
    );
    assert_eq!(v["decision"], "ask");
}

#[test]
fn anonymous_and_outsiders_are_refused_before_the_app_runs() {
    let mut t = app();
    assert_eq!(
        t.anonymous().view("settings", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        t.as_("mallory").view("settings", json!({})),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
}

#[test]
fn a_guest_reaches_the_feed_but_writes_nothing() {
    let mut t = app();
    // The org lets a guest reach the app; the feed's own rule refuses its writes.
    let f = fail_as(&mut t, GUEST, "setPaused", json!({ "paused": true }));
    assert_forbidden(&f);
    let f = fail_as(
        &mut t,
        GUEST,
        "recordAction",
        json!({ "input": action("chat", "done") }),
    );
    assert_forbidden(&f);
    assert_eq!(view(&mut t, "settings", json!({}))["paused"], false);
}

#[test]
fn the_node_checks_names_kinds_and_arguments_first() {
    let mut t = app();
    let code = |r: Result<serde_json::Value, Failure>| match r {
        Err(Failure::App { code, .. }) => code,
        other => panic!("not an app error: {other:?}"),
    };
    assert_eq!(
        code(t.as_(OWNER).call("record_action", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(t.as_(OWNER).view("setPaused", json!({ "paused": true }))),
        "NotAView"
    );
    // v1's snake_case argument names are refused: they are camelCase now.
    assert_eq!(
        code(t.as_(OWNER).call(
            "setPolicy",
            json!({ "app_key": "chat", "agent": "act", "notifications": "feed" })
        )),
        "BadArgs"
    );
    // A u64 argument is a decimal string; a JSON number is refused.
    assert_eq!(
        code(t.as_(OWNER).view(
            "feed",
            json!({ "filter": "all", "appKey": "", "limit": 0, "before": 0 })
        )),
        "BadArgs"
    );
}

/// A history is stored inside its row and rewritten whole with it, so it is
/// capped: the first step and the latest, 64 in all. A delivery that keeps
/// failing and is answered again each time would otherwise grow it for ever.
#[test]
fn a_history_keeps_its_first_step_and_the_latest_sixty_three() {
    let mut t = app();
    let mut input = notification("vote:e>f:0", "vote", false);
    input["ask"] = json!({ "kind": "reply", "prompt": "Answer", "options": [], "draft": "" });
    let n = call(&mut t, "recordNotification", json!({ "input": input }));
    let id = n["id"].clone();
    for i in 0..40 {
        t.advance(1);
        call(
            &mut t,
            "answerNotification",
            json!({ "id": id, "answer": format!("try {i}") }),
        );
        t.advance(1);
        call(
            &mut t,
            "completeAnswer",
            json!({ "id": id, "outcome": "failed", "note": format!("failed {i}") }),
        );
    }
    let item = view(&mut t, "item", json!({ "id": id }));
    let history = item["history"].as_array().expect("history");
    assert_eq!(history.len(), 64, "1 + 80 steps, capped");
    assert_eq!(history[0]["status"], "received", "the first step stays");
    assert_eq!(history[63]["note"], "failed 39", "the latest step stays");
    assert_eq!(
        history[1]["note"], "failed 8",
        "the oldest after the first go"
    );
}
