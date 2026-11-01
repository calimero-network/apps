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
