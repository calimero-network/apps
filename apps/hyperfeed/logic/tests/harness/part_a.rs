//! v1's `TestHost` tests from `an_unknown_app_asks_first` through
//! `the_agent_can_give_up_on_a_question`: the rules, actions, notifications,
//! chains, answers and talking to your agent.

use calimero_sdk::testing::{Failure, TestApp};
use serde_json::{json, Value};

use crate::support::*;

/// `DEDUPE_WINDOW_MS`: how long a repeated notification key is the same event.
const DEDUPE_WINDOW_MS: u64 = 10_000;
const MAX_TITLE: usize = 200;
const MAX_MESSAGE: usize = 2_000;
const MAX_FOLDERS: usize = 20;
const MAX_HISTORY: usize = 64;
const MAX_ATTACHMENTS: usize = 4;
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// `GUARDS.len()`.
const GUARDS: usize = 6;
const STOPPED_BY_YOU: &str = "Stopped by you";

/// A call as the owner that must fail with `Invalid`; the failure.
fn refused(t: &mut TestApp, method: &str, args: Value) -> Failure {
    let f = fail(t, method, args);
    assert_invalid(&f, "");
    f
}

/// A view as the owner that must fail with `Invalid`.
fn view_refused(t: &mut TestApp, method: &str, args: Value) {
    match t.as_(OWNER).view(method, args) {
        Ok(v) => panic!("{method} should fail, answered {v}"),
        Err(f) => assert_invalid(&f, ""),
    }
}

fn check(t: &mut TestApp, app_key: &str, category: &str, writes: bool) -> Value {
    view(
        t,
        "checkAction",
        json!({ "appKey": app_key, "category": category, "writes": writes, "method": null }),
    )
}

fn record(t: &mut TestApp, input: Value) -> Value {
    call(t, "recordAction", json!({ "input": input }))
}

fn notify(t: &mut TestApp, input: Value) -> Value {
    call(t, "recordNotification", json!({ "input": input }))
}

fn resolve(t: &mut TestApp, id: &Value, decision: &str, answer: &str) -> Value {
    call(
        t,
        "resolveAction",
        json!({ "id": id, "decision": decision, "answer": answer }),
    )
}

fn complete(t: &mut TestApp, id: &Value, outcome: &str, note: &str) -> Value {
    call(
        t,
        "completeAction",
        json!({ "id": id, "outcome": outcome, "note": note }),
    )
}

fn item(t: &mut TestApp, id: &Value) -> Value {
    let v = view(t, "item", json!({ "id": id }));
    assert!(v.is_object(), "no item {id}: {v}");
    v
}

fn chain(t: &mut TestApp, chain: &Value) -> Vec<Value> {
    view(t, "chain", json!({ "chain": chain }))
        .as_array()
        .expect("chain")
        .clone()
}

fn open_questions(t: &mut TestApp) -> Vec<Value> {
    view(t, "openQuestions", json!({}))
        .as_array()
        .expect("open questions")
        .clone()
}

fn settings(t: &mut TestApp) -> Value {
    view(t, "settings", json!({}))
}

fn items(page: &Value) -> &Vec<Value> {
    page["items"].as_array().expect("items")
}

fn statuses(history: &Value) -> Vec<String> {
    history
        .as_array()
        .expect("history")
        .iter()
        .map(|s| s["status"].as_str().expect("status").to_owned())
        .collect()
}

fn guard<'a>(settings: &'a Value, category: &str) -> &'a Value {
    settings["guards"]
        .as_array()
        .expect("guards")
        .iter()
        .find(|g| g["category"] == category)
        .unwrap_or_else(|| panic!("no guard {category}"))
}

fn with(mut input: Value, fields: Value) -> Value {
    for (k, v) in fields.as_object().expect("fields") {
        input[k] = v.clone();
    }
    input
}

fn ask(kind: &str, prompt: &str, options: &[&str], draft: &str) -> Value {
    json!({ "kind": kind, "prompt": prompt, "options": options, "draft": draft })
}

fn choose(options: &[&str]) -> Value {
    ask("choose", "Delete the duplicate?", options, "")
}

fn image(blob_id: &str) -> Value {
    json!({ "blob_id": blob_id, "name": "screenshot.png", "mime": "image/png", "size": 48_213 })
}

fn turn_step(id: &str, title: &str, status: &str) -> Value {
    json!({ "id": id, "title": title, "status": status, "at": 1 })
}

fn say(t: &mut TestApp, chain: &str, text: &str) -> Value {
    call(
        t,
        "say",
        json!({ "chain": chain, "text": text, "headline": null, "mode": null }),
    )
}

fn say_with(t: &mut TestApp, text: &str, attachments: Value) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "sayWith",
        json!({ "chain": "", "text": text, "attachments": attachments, "headline": null, "mode": null }),
    )
}

fn agent_say(t: &mut TestApp, chain: &Value, reply_to: &Value, text: &str) -> Value {
    call(
        t,
        "agentSay",
        json!({ "chain": chain, "replyTo": reply_to, "text": text, "headline": null }),
    )
}

fn ack(t: &mut TestApp, id: &Value, status: &str, note: &str) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "agentAck",
        json!({ "id": id, "status": status, "note": note }),
    )
}

fn events(t: &TestApp) -> usize {
    t.events_for(OWNER).len()
}

#[test]
fn an_unknown_app_asks_first() {
    let mut t = app();
    assert_eq!(check(&mut t, "chat", "", true)["decision"], "ask");
    // Reading is fine anywhere the agent is not switched off.
    assert_eq!(check(&mut t, "chat", "", false)["decision"], "act");
}

#[test]
fn an_action_the_rules_allow_is_recorded_done() {
    let mut t = acting_in("chat");
    let item = record(&mut t, action("chat", "done"));
    assert_eq!(item["status"], "done");
    assert_eq!(item["breach"], "");
    assert_eq!(item["needs_you"], false);
    assert_eq!(item["intent_hash"], "a91f3c07");
}

#[test]
fn a_guard_turns_act_into_ask() {
    let mut t = acting_in("sign");
    let input = with(action("sign", "proposed"), json!({ "category": "sign" }));
    assert_eq!(check(&mut t, "sign", "sign", true)["decision"], "ask");
    let item = record(&mut t, input);
    assert_eq!(item["status"], "pending");
    assert_eq!(item["needs_you"], true);

    // With the guard off, the same app's mode decides.
    call(
        &mut t,
        "setGuard",
        json!({ "category": "sign", "enabled": false }),
    );
    assert_eq!(check(&mut t, "sign", "sign", true)["decision"], "act");
}

#[test]
fn acting_without_asking_is_recorded_as_a_breach_until_kept() {
    let mut t = app(); // "chat" defaults to ask
    let item = record(&mut t, action("chat", "done"));
    assert_eq!(item["status"], "done");
    assert!(s(&item["breach"]).starts_with("acted without asking"));
    assert_eq!(item["needs_you"], true);
    assert_eq!(items(&feed(&mut t, "needs_you")).len(), 1);

    let kept = resolve(&mut t, &item["id"], "keep", "");
    assert_eq!(kept["breach"], "");
    assert_eq!(kept["needs_you"], false);
    assert_eq!(items(&feed(&mut t, "needs_you")).len(), 0);
}

#[test]
fn a_proposal_where_the_agent_is_off_is_refused() {
    let mut t = app();
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "crm", "agent": "off", "notifications": "feed" }),
    );
    let f = fail(
        &mut t,
        "recordAction",
        json!({ "input": action("crm", "proposed") }),
    );
    assert_invalid(&f, "off in crm");
    // But an outcome is never dropped: it is the one you most need to see.
    let item = record(&mut t, action("crm", "done"));
    assert!(s(&item["breach"]).starts_with("acted where it may not"));
}

#[test]
fn read_only_refuses_writes_but_not_reads() {
    let mut t = app();
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "pass", "agent": "read", "notifications": "feed" }),
    );
    let read = with(
        action("pass", "done"),
        json!({ "writes": false, "category": "secret" }),
    );
    let item = record(&mut t, read);
    assert_eq!(item["breach"], "");
    refused(
        &mut t,
        "recordAction",
        json!({ "input": action("pass", "proposed") }),
    );
}

#[test]
fn pausing_makes_every_write_a_proposal() {
    let mut t = acting_in("chat");
    call(&mut t, "setPaused", json!({ "paused": true }));
    assert_eq!(
        check(&mut t, "chat", "", true),
        json!({ "decision": "ask", "reason": "your agent is paused" })
    );
    assert_eq!(settings(&mut t)["paused"], true);
    call(&mut t, "setPaused", json!({ "paused": false }));
    assert_eq!(check(&mut t, "chat", "", true)["decision"], "act");
}

#[test]
fn approve_then_the_agent_completes() {
    let mut t = app();
    let item = record(&mut t, action("chat", "proposed"));
    // Nothing is waiting on the agent until you decide.
    refused(
        &mut t,
        "completeAction",
        json!({ "id": item["id"], "outcome": "done", "note": "" }),
    );

    let approved = resolve(&mut t, &item["id"], "approve", "");
    assert_eq!(approved["status"], "approved");
    assert_eq!(approved["needs_you"], false);

    let done = complete(&mut t, &item["id"], "done", "sent");
    assert_eq!(done["status"], "done");
    assert_eq!(done["note"], "sent");
}

#[test]
fn a_failure_can_be_retried_or_declined() {
    let mut t = acting_in("crm");
    let input = with(
        action("crm", "failed"),
        json!({ "note": "no write grant in Sales" }),
    );
    let item = record(&mut t, input);
    assert_eq!(item["status"], "failed");
    assert_eq!(item["needs_you"], true);

    let retrying = resolve(&mut t, &item["id"], "approve", "");
    assert_eq!(retrying["status"], "retrying");
    let failed = complete(&mut t, &item["id"], "failed", "still no grant");
    assert_eq!(failed["status"], "failed");
    let declined = resolve(&mut t, &item["id"], "decline", "");
    assert_eq!(declined["status"], "declined");
    assert_eq!(declined["needs_you"], false);
}

#[test]
fn undo_is_requested_and_only_for_undoable_actions() {
    let mut t = acting_in("chat");
    let item = record(&mut t, action("chat", "done"));
    let asked = resolve(&mut t, &item["id"], "undo", "");
    assert_eq!(asked["status"], "undo_requested");
    let undone = complete(&mut t, &item["id"], "done", "");
    assert_eq!(undone["status"], "undone");

    let fixed = record(
        &mut t,
        with(action("chat", "done"), json!({ "undoable": false })),
    );
    refused(
        &mut t,
        "resolveAction",
        json!({ "id": fixed["id"], "decision": "undo", "answer": "" }),
    );
}

#[test]
fn a_notification_is_recorded_once_per_key() {
    let mut t = app();
    let before = events(&t);
    notify(&mut t, notification("k1", "chat", true));
    assert_eq!(events(&t) - before, 1);
    notify(&mut t, notification("k1", "chat", true));
    assert_eq!(events(&t) - before, 1, "a repeat is silent");
    let page = feed(&mut t, "all");
    assert_eq!(items(&page).len(), 1);
    assert_eq!(page["counts"]["needs_you"], 1);
}

/// Core's state-change event names the context's new ROOT HASH, which depends
/// only on the state's contents. A context that returns to an earlier state
/// (a value set A, then B, then A again) produces the same key a second time,
/// for a change that really happened. Found against a real node: the third
/// write never reached the feed.
#[test]
fn the_same_key_after_the_window_is_a_new_occurrence() {
    let mut t = app();
    let first = notify(&mut t, notification("ctx:root-a:0", "kv", false));
    // Move past the window: what a later return to the same state looks like.
    // (v1 aged the stored row's `created_at` instead.)
    t.advance(DEDUPE_WINDOW_MS + 1);
    let second = notify(&mut t, notification("ctx:root-a:0", "kv", false));
    assert_ne!(second["id"], first["id"]);
    assert_eq!(second["id"], "ctx:root-a:0#1");
    // Another device reporting that same second change inside the window
    // still lands on the same row.
    let again = notify(&mut t, notification("ctx:root-a:0", "kv", false));
    assert_eq!(again["id"], second["id"]);
    assert_eq!(items(&feed(&mut t, "notifications")).len(), 2);
}

#[test]
fn seen_notifications_stop_needing_you() {
    let mut t = app();
    notify(&mut t, notification("k1", "chat", true));
    notify(&mut t, notification("k2", "issues", false));
    assert_eq!(
        call(&mut t, "markSeen", json!({ "ids": ["k1", "nope"] })),
        json!(1)
    );
    assert_eq!(items(&feed(&mut t, "needs_you")).len(), 0);
    assert_eq!(call(&mut t, "markAllSeen", json!({})), json!(1));
    assert_eq!(call(&mut t, "markAllSeen", json!({})), json!(0));
    let seen = item(&mut t, &json!("k2"));
    assert_eq!(seen["seen"], true);
}

#[test]
fn a_muted_app_drops_out_of_the_feed_and_comes_back() {
    let mut t = app();
    notify(&mut t, notification("k1", "vote", false));
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "vote", "agent": "off", "notifications": "mute" }),
    );
    assert_eq!(feed(&mut t, "all")["counts"]["all"], 0);
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "vote", "agent": "off", "notifications": "feed" }),
    );
    assert_eq!(feed(&mut t, "all")["counts"]["all"], 1);
}

#[test]
fn the_feed_filters_counts_and_pages() {
    let mut t = acting_in("chat");
    for i in 0..3 {
        notify(&mut t, notification(&format!("k{i}"), "issues", false));
    }
    record(&mut t, action("chat", "done"));

    let page = feed(&mut t, "all");
    assert_eq!(page["counts"]["all"], 4);
    assert_eq!(page["counts"]["agent"], 1);
    assert_eq!(page["counts"]["notifications"], 3);
    assert_eq!(page["apps"][0], json!({ "app": "issues", "count": 3 }));
    assert_eq!(items(&feed(&mut t, "agent")).len(), 1);
    assert_eq!(items(&feed(&mut t, "notifications")).len(), 3);

    let only_chat = view(
        &mut t,
        "feed",
        json!({ "filter": "all", "appKey": "chat", "limit": 0, "before": "0" }),
    );
    assert_eq!(items(&only_chat).len(), 1);
    // Counts describe the whole feed, not the narrowed view.
    assert_eq!(only_chat["counts"]["all"], 4);

    view_refused(
        &mut t,
        "feed",
        json!({ "filter": "everything", "appKey": "", "limit": 0, "before": "0" }),
    );
}

#[test]
fn only_the_owner_writes() {
    let mut t = acting_in("chat");
    let f = fail_as(
        &mut t,
        STRANGER,
        "recordAction",
        json!({ "input": action("chat", "done") }),
    );
    assert_forbidden(&f);
    let f = fail_as(&mut t, STRANGER, "setPaused", json!({ "paused": true }));
    assert_forbidden(&f);
    // The owner's second device is the owner: the same account, another
    // credential (v1 called from another executor key).
    let r = t
        .api_key("phone", OWNER)
        .call("recordAction", json!({ "input": action("chat", "done") }));
    assert!(r.is_ok(), "{r:?}");
}

#[test]
fn inputs_are_validated() {
    let mut t = app();
    let bad = action("Chat App", "done");
    refused(&mut t, "recordAction", json!({ "input": bad }));
    let bad = with(bad, json!({ "app": "chat", "outcome": "maybe" }));
    refused(&mut t, "recordAction", json!({ "input": bad }));
    let bad = with(bad, json!({ "outcome": "done", "category": "everything" }));
    refused(&mut t, "recordAction", json!({ "input": bad }));
    let bad = with(
        bad,
        json!({ "category": "", "title": "x".repeat(MAX_TITLE + 1) }),
    );
    refused(&mut t, "recordAction", json!({ "input": bad }));
    refused(
        &mut t,
        "setPolicy",
        json!({ "appKey": "chat", "agent": "sometimes", "notifications": "feed" }),
    );
}

#[test]
fn settings_list_policies_and_every_guard() {
    let mut t = acting_in("chat");
    let set = settings(&mut t);
    assert_eq!(set["policies"].as_array().unwrap().len(), 1);
    assert_eq!(set["guards"].as_array().unwrap().len(), GUARDS);
    assert_eq!(guard(&set, "sign")["enabled"], true);
    assert_eq!(guard(&set, "secret")["enabled"], false);
    assert_eq!(set["owner"], OWNER);
    call(
        &mut t,
        "setGuard",
        json!({ "category": "secret", "enabled": true }),
    );
    let set = settings(&mut t);
    assert_eq!(guard(&set, "secret")["enabled"], true);
}

#[test]
fn every_change_emits_one_event() {
    let mut t = app();
    let mut seen = event_names(&t).len();
    let mut take = |t: &TestApp| {
        let names = event_names(t);
        let new = names[seen..].to_vec();
        seen = names.len();
        new
    };
    let item = record(&mut t, action("chat", "proposed"));
    assert_eq!(take(&t), ["ActionRecorded"]);
    resolve(&mut t, &item["id"], "approve", "");
    assert_eq!(take(&t), ["ActionChanged"]);
    call(
        &mut t,
        "setGuard",
        json!({ "category": "invite", "enabled": true }),
    );
    assert_eq!(take(&t), ["SettingsChanged"]);
}

// ── chains, histories and answers ───────────────────────────────────────────

/// A mention arrives; the agent continues its chain with two actions; you
/// approve one. The feed shows ONE row for all of it, led by what needs you.
#[test]
fn a_chain_is_one_row_led_by_what_needs_you() {
    let mut t = acting_in("sheets");
    // v1 ran on the wall clock, so each step came a little later; here the
    // clock moves only when told, and the lead is the newest by time.
    let mention = notify(&mut t, notification("chat:a>b:0", "chat", true));
    t.advance(1);
    let kpis = record(
        &mut t,
        with(action("sheets", "done"), json!({ "chain": mention["id"] })),
    );
    t.advance(1);
    let nda = record(
        &mut t,
        with(
            action("sign", "proposed"),
            json!({ "category": "sign", "chain": mention["id"] }),
        ),
    );
    // An unrelated action is a chain of its own.
    record(&mut t, action("sheets", "done"));

    let page = feed(&mut t, "all");
    assert_eq!(page["counts"]["all"], 2, "two chains");
    let row = items(&page)
        .iter()
        .find(|r| r["chain"] == mention["id"])
        .expect("the mention's chain");
    assert_eq!(row["chain_len"], 3);
    assert_eq!(row["needs_you"], true);
    assert_eq!(row["id"], nda["id"], "the newest step that needs you leads");

    let flow = chain(&mut t, &mention["id"]);
    let flow_ids: Vec<&Value> = flow.iter().map(|i| &i["id"]).collect();
    assert_eq!(flow_ids, [&mention["id"], &kpis["id"], &nda["id"]]);
    assert!(flow.iter().all(|i| i["chain_len"] == 3));
}

#[test]
fn needs_you_and_agent_filters_work_on_chains() {
    let mut t = acting_in("sheets");
    let mention = notify(&mut t, notification("chat:a>b:0", "chat", false));
    record(
        &mut t,
        with(action("sheets", "done"), json!({ "chain": mention["id"] })),
    );
    let page = feed(&mut t, "agent");
    assert_eq!(
        items(&page).len(),
        1,
        "a chain holding an action counts as agent"
    );
    assert_eq!(page["counts"]["notifications"], 1);
    assert_eq!(items(&feed(&mut t, "needs_you")).len(), 0);
    let by_app = view(
        &mut t,
        "feed",
        json!({ "filter": "all", "appKey": "chat", "limit": 0, "before": "0" }),
    );
    assert_eq!(items(&by_app).len(), 1, "the chain touches chat");
}

#[test]
fn every_step_stays_in_the_history() {
    let mut t = app();
    let item = record(&mut t, action("chat", "proposed"));
    resolve(&mut t, &item["id"], "approve", "");
    let done = complete(&mut t, &item["id"], "done", "sent");
    assert_eq!(statuses(&done["history"]), ["pending", "approved", "done"]);
    let at: Vec<u64> = done["history"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["at"].as_u64().expect("at"))
        .collect();
    assert!(at.windows(2).all(|w| w[0] < w[1]), "{at:?}");
    assert_eq!(done["note"], "sent");
}

/// Replaces v1's `histories_merge_to_the_same_order_everywhere` (two replicas'
/// histories merged): under one log the steps land in the order they were
/// written, whatever the clock says, and none is lost.
#[test]
fn histories_keep_every_step_in_log_order() {
    let mut t = app();
    let item = record(&mut t, action("calendar", "proposed"));
    // The clock going back does not reorder the history.
    t.set_time(T0 - 5_000);
    resolve(&mut t, &item["id"], "approve", "");
    t.set_time(T0 - 10_000);
    let done = complete(&mut t, &item["id"], "done", "booked");
    assert_eq!(statuses(&done["history"]), ["pending", "approved", "done"]);
    let notes: Vec<&str> = done["history"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["note"].as_str().unwrap())
        .collect();
    assert_eq!(notes.last(), Some(&"booked"));
    let at: Vec<u64> = done["history"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["at"].as_u64().expect("at"))
        .collect();
    assert!(at.windows(2).all(|w| w[0] < w[1]), "{at:?}");
}

#[test]
fn a_reply_is_answered_in_the_feed_and_delivered_by_the_agent() {
    let mut t = app();
    let input = with(
        notification("chat:c>d:0", "chat", true),
        json!({ "ask": ask("reply", "Reply in #launch", &["On it", "After 2pm"], "") }),
    );
    let n = notify(&mut t, input);
    assert_eq!(n["needs_you"], true);
    assert_eq!(n["status"], "received");

    // Seeing it is not answering it.
    call(&mut t, "markSeen", json!({ "ids": [n["id"]] }));
    assert_eq!(item(&mut t, &n["id"])["needs_you"], true);

    // A reply needs text.
    refused(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "" }),
    );
    let answered = call(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "Numbers are in the deck." }),
    );
    assert_eq!(answered["status"], "answered");
    assert_eq!(answered["note"], "Numbers are in the deck.");
    assert_eq!(answered["needs_you"], false);
    // Answered once.
    refused(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "again" }),
    );

    let delivered = call(
        &mut t,
        "completeAnswer",
        json!({ "id": n["id"], "outcome": "delivered", "note": "Sent in #launch" }),
    );
    assert_eq!(
        statuses(&delivered["history"]),
        ["received", "answered", "delivered"]
    );
}

#[test]
fn a_failed_delivery_needs_you_and_can_be_answered_again() {
    let mut t = app();
    let input = with(
        notification("vote:e>f:0", "vote", false),
        json!({ "ask": ask("choose", "Offsite location", &["Lisbon", "Berlin", "Remote"], "") }),
    );
    let n = notify(&mut t, input);
    assert_eq!(
        n["needs_you"], true,
        "an ask needs you whether or not it was flagged"
    );
    // Not an option.
    refused(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "Paris" }),
    );
    call(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "Lisbon" }),
    );
    let failed = call(
        &mut t,
        "completeAnswer",
        json!({ "id": n["id"], "outcome": "failed", "note": "poll closed" }),
    );
    assert_eq!(failed["needs_you"], true);
    let again = call(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "Remote" }),
    );
    assert_eq!(again["status"], "answered");
}

#[test]
fn a_notification_without_an_ask_cannot_be_answered() {
    let mut t = app();
    let n = notify(&mut t, notification("kv:a>b:0", "kv", false));
    refused(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "" }),
    );
    // Nothing is waiting on the agent.
    refused(
        &mut t,
        "completeAnswer",
        json!({ "id": n["id"], "outcome": "delivered", "note": "" }),
    );
}

#[test]
fn a_confirm_takes_no_text() {
    let mut t = app();
    let input = with(
        notification("cal:a>b:0", "calendar", true),
        json!({ "ask": ask("confirm", "Accept the invite", &[], "") }),
    );
    let n = notify(&mut t, input);
    refused(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "yes" }),
    );
    let ok = call(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "" }),
    );
    assert_eq!(ok["status"], "answered");
}

#[test]
fn a_proposal_with_options_is_approved_with_one_of_them() {
    let mut t = app();
    let input = with(
        action("calendar", "proposed"),
        json!({ "ask": ask("choose", "Pick a slot", &["Thu 15:00", "Fri 10:00"], "") }),
    );
    let p = record(&mut t, input);
    // Pick one.
    refused(
        &mut t,
        "resolveAction",
        json!({ "id": p["id"], "decision": "approve", "answer": "" }),
    );
    let ok = resolve(&mut t, &p["id"], "approve", "Fri 10:00");
    assert_eq!(ok["status"], "approved");
    assert_eq!(ok["note"], "Fri 10:00");
}

#[test]
fn a_drafted_reply_is_approved_as_edited() {
    let mut t = acting_in("chat");
    let input = with(
        action("chat", "proposed"),
        json!({ "ask": ask("reply", "Send to Maya", &[], "Numbers are in the deck.") }),
    );
    let p = record(&mut t, input);
    let ok = resolve(
        &mut t,
        &p["id"],
        "approve",
        "Numbers are in the deck, slide 4.",
    );
    assert_eq!(ok["note"], "Numbers are in the deck, slide 4.");
    // Declining never carries an answer.
    let other = record(
        &mut t,
        with(
            action("chat", "proposed"),
            json!({ "ask": ask("reply", "Send", &[], "draft") }),
        ),
    );
    refused(
        &mut t,
        "resolveAction",
        json!({ "id": other["id"], "decision": "decline", "answer": "no" }),
    );
}

#[test]
fn asks_are_validated() {
    let mut t = app();
    let bad = [
        ask("choose", "One", &["only"], ""),
        ask("confirm", "Go", &["a"], ""),
        ask("", "stray prompt", &[], ""),
        ask("pick", "?", &[], ""),
        ask(
            "reply",
            "Too many",
            &["1", "2", "3", "4", "5", "6", "7", "8", "9"],
            "",
        ),
    ];
    for a in bad {
        let input = with(notification("k", "chat", false), json!({ "ask": a }));
        refused(&mut t, "recordNotification", json!({ "input": input }));
    }
    // Asks belong on proposals.
    let done = with(
        action("chat", "done"),
        json!({ "ask": ask("confirm", "Go", &[], "") }),
    );
    refused(&mut t, "recordAction", json!({ "input": done }));
}

#[test]
fn keeping_a_breach_is_stamped() {
    let mut t = app();
    let item = record(&mut t, action("chat", "done"));
    assert_eq!(item["reviewed_at"], 0);
    let kept = resolve(&mut t, &item["id"], "keep", "");
    assert!(kept["reviewed_at"].as_u64().unwrap() > 0);
}

// ── talking to your agent ───────────────────────────────────────────────────

#[test]
fn a_question_about_a_row_joins_its_chain_and_waits() {
    let mut t = app();
    let mention = notify(&mut t, notification("k1", "chat", true));
    let q = say(&mut t, s(&mention["chain"]), "What numbers does Maya mean?");
    assert_eq!(q["kind"], "message");
    assert_eq!(q["from"], "you");
    assert_eq!(q["chain"], mention["chain"]);
    assert_eq!(q["status"], "waiting");
    assert_eq!(q["needs_you"], false, "your own question never needs you");

    let flow = chain(&mut t, &mention["chain"]);
    assert_eq!(flow.len(), 2);
    assert_eq!(flow[1]["id"], q["id"]);
    assert_eq!(
        open_questions(&mut t).len(),
        1,
        "an unanswered question is open"
    );
}

#[test]
fn a_question_from_nowhere_starts_its_own_chain() {
    let mut t = app();
    let q = say(&mut t, "", "What happened in #launch today?");
    assert_eq!(q["chain"], q["id"]);
    let page = feed(&mut t, "agent");
    assert_eq!(items(&page).len(), 1, "a conversation is agent activity");
    assert_eq!(page["apps"], json!([]), "a message names no app");
}

#[test]
fn a_question_into_a_chain_that_does_not_exist_is_refused() {
    let mut t = app();
    refused(&mut t, "say", json!({ "chain": "nope", "text": "hi" }));
    // An empty message is refused.
    refused(&mut t, "say", json!({ "chain": "", "text": "  " }));
    // An oversized message is refused.
    refused(
        &mut t,
        "say",
        json!({ "chain": "", "text": "x".repeat(MAX_MESSAGE + 1) }),
    );
}

#[test]
fn a_message_says_how_private_it_is() {
    let mut t = app();
    let public = call(
        &mut t,
        "say",
        json!({ "chain": "", "text": "Fix the flaky test", "headline": null, "mode": "public" }),
    );
    assert_eq!(public["mode"], "public");
    let next = call(
        &mut t,
        "say",
        json!({ "chain": public["chain"], "text": "And open a PR", "mode": "private" }),
    );
    assert_eq!(next["mode"], "private", "each message keeps its own");

    let plain = say(&mut t, "", "What happened today?");
    assert_eq!(plain["mode"], "", "a message sent without a mode has none");
    let empty = call(
        &mut t,
        "say",
        json!({ "chain": "", "text": "Hi", "mode": "" }),
    );
    assert_eq!(empty["mode"], "", "an empty mode is none");

    let flow = chain(&mut t, &public["chain"]);
    let modes: Vec<&Value> = flow.iter().map(|i| &i["mode"]).collect();
    assert_eq!(
        modes,
        [&json!("public"), &json!("private")],
        "read back the same in the chain"
    );
    assert_eq!(
        settings(&mut t)["message_modes"],
        json!([]),
        "no mode is offered: which agent takes your work is set per app"
    );

    // A mode outside MESSAGE_MODES is refused.
    refused(
        &mut t,
        "say",
        json!({ "chain": "", "text": "Hi", "mode": "act" }),
    );
    // Modes are exact.
    refused(
        &mut t,
        "sayWith",
        json!({
            "chain": "",
            "text": "look",
            "attachments": [image(&"ab".repeat(32))],
            "mode": "PRIVATE",
        }),
    );
}

#[test]
fn you_set_what_an_agent_reaches_and_it_reports_what_it_can() {
    let mut t = app();
    let agent = "mero-bot@laptop";
    let work = json!({ "path": "~/workspace/calimero", "write": true });
    let docs = json!({ "path": "/Users/me/Documents", "write": false });
    call(
        &mut t,
        "setAccess",
        json!({ "agent": agent, "folders": [work, docs], "shell": true, "web": false }),
    );
    let set = settings(&mut t)["access"].clone();
    assert_eq!(set.as_array().unwrap().len(), 1);
    assert_eq!(set[0]["agent"], agent);
    assert_eq!(set[0]["folders"], json!([work, docs]));
    assert!(set[0]["shell"] == true && set[0]["web"] == false);

    // The latest write wins: narrowing replaces the folders.
    call(
        &mut t,
        "setAccess",
        json!({ "agent": agent, "folders": [work], "shell": false, "web": false }),
    );
    let set = settings(&mut t)["access"].clone();
    assert_eq!(set[0]["folders"], json!([work]));
    assert_eq!(set[0]["shell"], false);

    for bad in ["relative/path", "~user/x", "/a/../b", ""] {
        let f = fail(
            &mut t,
            "setAccess",
            json!({
                "agent": agent,
                "folders": [{ "path": bad, "write": false }],
                "shell": false,
                "web": false,
            }),
        );
        let (code, _) = err(&f);
        assert_eq!(code, "Invalid", "{bad:?} is refused");
    }
    let many: Vec<Value> = (0..=MAX_FOLDERS)
        .map(|i| json!({ "path": format!("/f{i}"), "write": false }))
        .collect();
    refused(
        &mut t,
        "setAccess",
        json!({ "agent": agent, "folders": many, "shell": false, "web": false }),
    );

    let line = json!({
        "serves": "public",
        "profile": "claude",
        "model": "",
        "attested": false,
        "folders": [work],
        "shell": false,
        "web": false,
    });
    call(
        &mut t,
        "agentReach",
        json!({ "name": agent, "lines": [line] }),
    );
    let reach = settings(&mut t)["reach"].clone();
    assert_eq!(reach.as_array().unwrap().len(), 1);
    assert_eq!(reach[0]["lines"], json!([line]));

    // Only the owner sets what an agent reaches.
    let f = fail_as(
        &mut t,
        STRANGER,
        "setAccess",
        json!({ "agent": agent, "folders": [], "shell": true, "web": true }),
    );
    assert_forbidden(&f);
}

#[test]
fn you_assign_an_app_to_an_agent_and_can_give_it_back() {
    let mut t = app();
    assert_eq!(
        settings(&mut t)["assignments"],
        json!([]),
        "a new feed assigns nothing: every app is the default agent's"
    );
    let laptop = "mero-bot@laptop";
    call(
        &mut t,
        "setAssignment",
        json!({ "appKey": "mero-bot", "agent": laptop }),
    );
    call(
        &mut t,
        "setAssignment",
        json!({ "appKey": "chat", "agent": laptop }),
    );
    let set = settings(&mut t)["assignments"].clone();
    let apps: Vec<(&str, &str)> = set
        .as_array()
        .unwrap()
        .iter()
        .map(|a| (s(&a["app"]), s(&a["agent"])))
        .collect();
    assert_eq!(apps, [("chat", laptop), ("mero-bot", laptop)]);

    // The latest write wins, and an empty agent gives the app back.
    call(
        &mut t,
        "setAssignment",
        json!({ "appKey": "chat", "agent": "" }),
    );
    let set = settings(&mut t)["assignments"].clone();
    assert_eq!(set.as_array().unwrap().len(), 1);
    assert_eq!(set[0]["app"], "mero-bot");

    // An app key is checked like a policy's.
    refused(
        &mut t,
        "setAssignment",
        json!({ "appKey": "Not An App", "agent": laptop }),
    );
    // Only the owner assigns an app.
    let f = fail_as(
        &mut t,
        STRANGER,
        "setAssignment",
        json!({ "appKey": "chat", "agent": "mero-bot@theirs" }),
    );
    assert_forbidden(&f);
}

#[test]
fn an_agent_question_needs_you_until_you_answer_it_in_the_chain() {
    let mut t = app();
    let q = say(&mut t, "", "Say hello in #calimero");
    let asked = call(
        &mut t,
        "agentAsk",
        json!({
            "chain": q["chain"],
            "replyTo": q["id"],
            "text": "Posted. There are two hellos now: delete the duplicate?",
            "ask": choose(&["Delete the duplicate", "Keep both"]),
            "headline": null,
        }),
    );
    assert_eq!(asked["status"], "asked");
    assert_eq!(
        asked["needs_you"], true,
        "an open question is yours to answer"
    );
    assert_eq!(
        asked["ask"]["options"],
        json!(["Delete the duplicate", "Keep both"])
    );
    assert_eq!(
        item(&mut t, &q["id"])["status"],
        "answered",
        "your message is answered, even though you are asked back"
    );

    // The chain is not done: its question leads it, in what needs you.
    let page = feed(&mut t, "needs_you");
    assert_eq!(items(&page).len(), 1);
    assert_eq!(page["items"][0]["id"], asked["id"]);
    assert_eq!(page["counts"]["needs_you"], 1);

    // Your answer is a message in the chain: it settles the question and goes to your agent.
    let answer = say(&mut t, s(&q["chain"]), "Delete the duplicate");
    assert_eq!(answer["status"], "waiting");
    let settled = item(&mut t, &asked["id"]);
    assert_eq!(settled["status"], "answered");
    assert_eq!(settled["note"], "Delete the duplicate");
    assert_eq!(settled["needs_you"], false);
    assert_eq!(feed(&mut t, "needs_you")["counts"]["needs_you"], 0);
    assert_eq!(
        open_questions(&mut t).len(),
        1,
        "your answer waits for your agent"
    );
}

#[test]
fn an_agent_question_is_a_reply_or_a_choice() {
    let mut t = app();
    let q = say(&mut t, "", "hi");
    let args = |ask: Value| json!({ "chain": q["chain"], "replyTo": "", "text": "?", "ask": ask, "headline": null });
    // Asking needs a way to answer.
    refused(&mut t, "agentAsk", args(ask_none()));
    // A confirm has no way to say no.
    refused(&mut t, "agentAsk", args(ask("confirm", "", &[], "")));
    // A choice needs two options.
    refused(&mut t, "agentAsk", args(choose(&["only one"])));
    let reply = ask("reply", "Which channel?", &[], "");
    assert_eq!(call(&mut t, "agentAsk", args(reply))["status"], "asked");
}

#[test]
fn a_plain_answer_is_finished_work() {
    let mut t = app();
    let q = say(&mut t, "", "What time is it in Tokyo?");
    let said = agent_say(&mut t, &q["chain"], &q["id"], "03:12.");
    assert_eq!(said["status"], "said");
    assert_eq!(said["needs_you"], false);
    assert_eq!(items(&feed(&mut t, "needs_you")).len(), 0);
}

#[test]
fn your_agent_shows_its_latest_step_while_it_works_without_adding_rows() {
    let mut t = app();
    let q = say(&mut t, "", "Fix the chat list");
    // Nothing to show before your agent has taken it up.
    refused(
        &mut t,
        "agentProgress",
        json!({ "id": q["id"], "doing": "Reading ChatView.tsx" }),
    );

    ack(&mut t, &q["id"], "thinking", "").unwrap();
    call(
        &mut t,
        "agentProgress",
        json!({ "id": q["id"], "doing": "Reading ChatView.tsx" }),
    );
    let row = call(
        &mut t,
        "agentProgress",
        json!({ "id": q["id"], "doing": "Running the tests" }),
    );
    assert_eq!(
        row["doing"], "Running the tests",
        "the latest step replaces the last"
    );
    assert!(row["doing_at"].as_u64().unwrap() > 0);
    assert_eq!(
        row["history"].as_array().unwrap().len(),
        2,
        "steps are not history: waiting, thinking"
    );
    let open = open_questions(&mut t);
    assert_eq!(open[0]["doing"], "Running the tests");

    agent_say(&mut t, &q["chain"], &q["id"], "Fixed.");
    let answered = item(&mut t, &q["id"]);
    assert_eq!(answered["doing"], "", "an answered message shows no step");
    refused(
        &mut t,
        "agentProgress",
        json!({ "id": q["id"], "doing": "Still going" }),
    );
    refused(
        &mut t,
        "agentProgress",
        json!({ "id": q["id"], "doing": " " }),
    );
}

#[test]
fn a_message_carries_its_images_wherever_it_is_read() {
    let mut t = app();
    let q = say_with(
        &mut t,
        "What is this error?",
        json!([image(&"ab".repeat(32)), image(&"cd".repeat(32))]),
    )
    .unwrap();
    assert_eq!(q["attachments"].as_array().unwrap().len(), 2);
    assert_eq!(q["attachments"][0]["blob_id"], "ab".repeat(32));

    let read = item(&mut t, &q["id"]);
    assert_eq!(read["attachments"], q["attachments"]);
    let open = open_questions(&mut t);
    assert_eq!(
        open[0]["attachments"], q["attachments"],
        "the agent sees the images it is asked about"
    );
    let flow = chain(&mut t, &q["chain"]);
    assert_eq!(flow[0]["attachments"], q["attachments"]);

    // The agent picking it up keeps the images on the row.
    let thinking = ack(&mut t, &q["id"], "thinking", "").unwrap();
    assert_eq!(thinking["attachments"], q["attachments"]);
}

#[test]
fn an_image_alone_is_a_message() {
    let mut t = app();
    let q = say_with(&mut t, "", json!([image(&"ab".repeat(32))])).unwrap();
    assert_eq!(q["title"], "Sent an image");
    assert_eq!(q["body"], "");
    // No text and no image is still empty.
    let f = say_with(&mut t, "", json!([])).unwrap_err();
    assert_invalid(&f, "");
}

#[test]
fn attachments_outside_their_limits_are_refused() {
    let mut t = app();
    let mut try_one = |a: Value, why: &str| {
        let f = say_with(&mut t, "look", json!([a])).expect_err(why);
        let (code, _) = err(&f);
        assert_eq!(code, "Invalid", "{why}");
    };
    try_one(
        with(image("ab"), json!({ "mime": "application/pdf" })),
        "only images",
    );
    try_one(
        with(image("ab"), json!({ "size": MAX_IMAGE_BYTES + 1 })),
        "at most 10 MiB",
    );
    try_one(
        with(image("ab"), json!({ "size": 0 })),
        "an empty file is no image",
    );
    try_one(image("../etc"), "a blob id is letters and digits");
    try_one(image(""), "a blob id is required");
    let five: Vec<Value> = (0..=MAX_ATTACHMENTS).map(|_| image("ab")).collect();
    let f = say_with(&mut t, "look", json!(five)).expect_err("at most four");
    assert_invalid(&f, "");
}

#[test]
fn your_agent_attaches_its_steps_and_draft_to_your_message_without_adding_rows() {
    let mut t = app();
    let q = say(&mut t, "", "Fix the chat list");
    // Nothing to attach before it is taken up.
    refused(
        &mut t,
        "agentWork",
        json!({ "id": q["id"], "steps": [], "draft": "" }),
    );

    ack(&mut t, &q["id"], "thinking", "").unwrap();
    call(
        &mut t,
        "agentWork",
        json!({
            "id": q["id"],
            "steps": [turn_step("t1", "Reading ChatView.tsx", "running")],
            "draft": "",
        }),
    );
    let row = call(
        &mut t,
        "agentWork",
        json!({
            "id": q["id"],
            "steps": [
                turn_step("t1", "Reading ChatView.tsx", "done"),
                turn_step("t2", "Running the tests", "running"),
            ],
            "draft": "The list now",
        }),
    );
    assert_eq!(
        row["steps"].as_array().unwrap().len(),
        2,
        "each report replaces the last"
    );
    assert_eq!(row["steps"][0]["status"], "done");
    assert_eq!(row["draft"], "The list now");
    assert_eq!(
        row["history"].as_array().unwrap().len(),
        2,
        "steps are not history"
    );
    assert_eq!(
        items(&feed(&mut t, "all")).len(),
        1,
        "the turn adds no rows to the feed"
    );

    agent_say(&mut t, &q["chain"], &q["id"], "Fixed.");
    let answered = item(&mut t, &q["id"]);
    assert_eq!(
        answered["steps"].as_array().unwrap().len(),
        2,
        "the steps stay with the message"
    );
    assert_eq!(answered["draft"], "", "the answer replaces the draft");

    refused(
        &mut t,
        "agentWork",
        json!({ "id": q["id"], "steps": [turn_step("t9", "Something", "sleeping")], "draft": "" }),
    );
    let too_many: Vec<Value> = (0..=MAX_HISTORY)
        .map(|i| turn_step(&format!("t{i}"), "Step", "done"))
        .collect();
    refused(
        &mut t,
        "agentWork",
        json!({ "id": q["id"], "steps": too_many, "draft": "" }),
    );
}

#[test]
fn you_stop_a_turn_your_agent_is_working_on() {
    let mut t = app();
    let q = say(&mut t, "", "Refactor everything");
    ack(&mut t, &q["id"], "thinking", "").unwrap();
    let asked = call(&mut t, "stop", json!({ "id": q["id"] }));
    assert_eq!(asked["status"], "thinking", "your agent ends the turn");
    assert!(asked["stop_at"].as_u64().unwrap() > 0);
    let again = call(&mut t, "stop", json!({ "id": q["id"] }));
    assert_eq!(
        again["stop_at"], asked["stop_at"],
        "asking twice changes nothing"
    );

    let stopped = ack(&mut t, &q["id"], "failed", STOPPED_BY_YOU).unwrap();
    assert_eq!(stopped["status"], "failed");
    assert_eq!(stopped["note"], STOPPED_BY_YOU);
    // Nothing left to stop.
    refused(&mut t, "stop", json!({ "id": q["id"] }));
}

#[test]
fn stopping_a_message_not_taken_up_yet_closes_it() {
    let mut t = app();
    let q = say(&mut t, "", "Never mind");
    let row = call(&mut t, "stop", json!({ "id": q["id"] }));
    assert_eq!(row["status"], "failed");
    assert_eq!(row["note"], STOPPED_BY_YOU);
    assert!(row["stop_at"].as_u64().unwrap() > 0);
    assert!(open_questions(&mut t).is_empty());

    let note = agent_say(&mut t, &q["chain"], &json!(""), "Okay.");
    // Only your own messages.
    refused(&mut t, "stop", json!({ "id": note["id"] }));
}

#[test]
fn the_agent_picks_a_question_up_and_answers_it() {
    let mut t = app();
    let mention = notify(&mut t, notification("k1", "chat", true));
    let q = say(&mut t, s(&mention["chain"]), "Make the reply more formal");

    let thinking = ack(&mut t, &q["id"], "thinking", "").unwrap();
    assert_eq!(thinking["status"], "thinking");

    let answer = agent_say(
        &mut t,
        &mention["chain"],
        &q["id"],
        "Here is a more formal draft.",
    );
    assert_eq!(answer["from"], "agent");
    assert_eq!(answer["reply_to"], q["id"]);
    assert_eq!(answer["status"], "said");

    let asked = item(&mut t, &q["id"]);
    assert_eq!(
        statuses(&asked["history"]),
        ["waiting", "thinking", "answered"]
    );
    assert!(open_questions(&mut t).is_empty());

    // The mention still waits on your reply, so it keeps leading the chain;
    // the conversation adds to the chain without hiding what needs you.
    let page = feed(&mut t, "all");
    assert_eq!(items(&page).len(), 1);
    assert_eq!(
        page["items"][0]["id"], mention["id"],
        "what needs you still leads"
    );
    assert_eq!(page["items"][0]["chain_len"], 3);

    // A second answer to the same question is fine and keeps it answered.
    agent_say(&mut t, &mention["chain"], &q["id"], "One more thing.");
    let asked = item(&mut t, &q["id"]);
    assert_eq!(asked["status"], "answered");
}

#[test]
fn an_answer_leads_a_chain_that_needs_nothing() {
    let mut t = app();
    let q = say(&mut t, "", "Summarise my morning");
    let a = agent_say(&mut t, &q["chain"], &q["id"], "Quiet morning.");
    let page = feed(&mut t, "all");
    assert_eq!(page["items"][0]["id"], a["id"]);
}

#[test]
fn the_agent_can_give_up_on_a_question() {
    let mut t = app();
    let q = say(&mut t, "", "Book the offsite");
    let failed = ack(&mut t, &q["id"], "failed", "no calendar access").unwrap();
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["note"], "no calendar access");
    assert!(open_questions(&mut t).is_empty());
    // Nothing more to pick up.
    let f = ack(&mut t, &q["id"], "thinking", "").unwrap_err();
    assert_invalid(&f, "");
}
