//! What every harness test shares: the feed in an org, calls as named
//! accounts, and v1's input builders as JSON.
//!
//! The org: `owner` (the feed's owner), `agentbot` (a member the owner adds as
//! an agent in the tests that need one), `bob` (a member the owner never
//! added: a stranger to the feed) and `guest` (an org guest).

#![allow(dead_code)]

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

pub use crate::common::T0;

pub const OWNER: &str = "owner";
pub const AGENT: &str = "agentbot";
pub const STRANGER: &str = "bob";
pub const GUEST: &str = "guest";

pub fn app() -> TestApp {
    crate::common::app(Org::new().members([AGENT, STRANGER]).guests([GUEST]))
}

/// A call as the owner; panics with the failure.
pub fn call(t: &mut TestApp, method: &str, args: Value) -> Value {
    call_as(t, OWNER, method, args)
}

pub fn call_as(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{method} as {who}: {e:?}"))
}

/// A call as the owner that must fail; the failure.
pub fn fail(t: &mut TestApp, method: &str, args: Value) -> Failure {
    fail_as(t, OWNER, method, args)
}

pub fn fail_as(t: &mut TestApp, who: &str, method: &str, args: Value) -> Failure {
    match t.as_(who).call(method, args) {
        Ok(v) => panic!("{method} as {who} should fail, answered {v}"),
        Err(e) => e,
    }
}

/// A view as the owner; panics with the failure.
pub fn view(t: &mut TestApp, method: &str, args: Value) -> Value {
    view_as(t, OWNER, method, args)
}

pub fn view_as(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .view(method, args)
        .unwrap_or_else(|e| panic!("{method} as {who}: {e:?}"))
}

/// The failure's code and message: `("Invalid", "…")`.
pub fn err(f: &Failure) -> (String, String) {
    match f {
        Failure::App { code, fields } => (
            code.clone(),
            fields
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        ),
        other => panic!("not an app error: {other:?}"),
    }
}

/// Asserts an `Invalid` error whose message contains `needle`.
pub fn assert_invalid(f: &Failure, needle: &str) {
    let (code, message) = err(f);
    assert_eq!(code, "Invalid", "{message}");
    assert!(message.contains(needle), "{message:?} lacks {needle:?}");
}

/// Asserts a `Forbidden` error.
pub fn assert_forbidden(f: &Failure) {
    let (code, message) = err(f);
    assert_eq!(code, "Forbidden", "{message}");
}

/// v1's `action(app, outcome)` builder.
pub fn action(app: &str, outcome: &str) -> Value {
    json!({
        "app": app,
        "source_context": "ctx-1",
        "source_label": "#launch",
        "method": "send_message",
        "category": "",
        "writes": true,
        "undoable": true,
        "title": "Posted your stand-up",
        "body": "",
        "why": "Daily routine you set up.",
        "outcome": outcome,
        "intent_hash": "a91f3c07",
        "executor": "relay-account",
        "note": "",
        "chain": "",
        "ask": ask_none(),
        "grant": "",
        "subject": "",
        "send_call": "",
    })
}

/// v1's `notification(key, app, needs_you)` builder.
pub fn notification(key: &str, app: &str, needs_you: bool) -> Value {
    json!({
        "key": key,
        "app": app,
        "source_context": "ctx-2",
        "source_label": "#launch",
        "from": "Maya",
        "title": "Mentioned you",
        "body": "Can your agent pull the numbers?",
        "event": "MessageSent",
        "needs_you": needs_you,
        "chain": "",
        "ask": ask_none(),
        "item_type": "",
        "fields": "",
        "reply_call": "",
    })
}

/// `Ask::default()`.
pub fn ask_none() -> Value {
    json!({ "kind": "", "prompt": "", "options": [], "draft": "" })
}

/// v1's `acting_in(app)`: a feed where the agent may act in `app`.
pub fn acting_in(app_key: &str) -> TestApp {
    let mut t = app();
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": app_key, "agent": "act", "notifications": "feed" }),
    );
    t
}

/// v1's `feed(app, filter)`: the first page.
pub fn feed(t: &mut TestApp, filter: &str) -> Value {
    view(
        t,
        "feed",
        json!({ "filter": filter, "appKey": "", "limit": 0, "before": "0" }),
    )
}

/// The ids of a page's items.
pub fn ids(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|i| i["id"].as_str().expect("id").to_owned())
        .collect()
}

/// Every event `owner` received, by name.
pub fn event_names(t: &TestApp) -> Vec<String> {
    t.events_for(OWNER).into_iter().map(|(n, _)| n).collect()
}

/// Adds `agentbot` as an agent named `name`.
pub fn add_agent(t: &mut TestApp, name: &str) {
    call(
        t,
        "addAgentAccount",
        json!({ "account": AGENT, "name": name }),
    );
}

pub fn s(v: &Value) -> &str {
    v.as_str().unwrap_or_else(|| panic!("not a string: {v}"))
}
