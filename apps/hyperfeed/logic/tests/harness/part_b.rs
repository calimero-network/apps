//! v1's tests from answers checked against the question through one thread
//! per task: talking to your agent, headlines, typed notifications and
//! lenses, archive and presence, session grants, what leads a chain, stale
//! questions, standing rules and chain leases.

use calimero_sdk::testing::{Failure, TestApp};
use serde_json::{json, Value};

use crate::support::*;

// The contract's limits, as v1's tests read them.
const MAX_TITLE: usize = 200;
const MAX_FIELDS: usize = 4_000;
const MAX_MESSAGE: usize = 2_000;
const MAX_HEADLINE: usize = 80;
const MAX_LONG_MESSAGE: usize = 32_000;
const MIN_LEASE_MS: u64 = 1_000;
const MAX_LEASE_MS: u64 = 10 * 60 * 1_000;
const MAX_RULE: usize = 280;
const MAX_RULES: usize = 30;
const MAX_ARCHIVE: usize = 200;
const GRANT_WINDOW_MS: u64 = 12 * 60 * 60 * 1_000;
const SESSION_GRANT: &str = "Allow for this session";

// ── helpers ──────────────────────────────────────────────────────────────────

/// v1's `ask(kind, prompt, options, draft)`.
fn ask(kind: &str, prompt: &str, options: &[&str], draft: &str) -> Value {
    json!({ "kind": kind, "prompt": prompt, "options": options, "draft": draft })
}

/// v1's `choose(options)`.
fn choose(options: &[&str]) -> Value {
    ask("choose", "Delete the duplicate?", options, "")
}

/// v1's `image(blob_id)`.
fn image(blob_id: &str) -> Value {
    json!({ "blob_id": blob_id, "name": "screenshot.png", "mime": "image/png", "size": 48_213 })
}

/// v1's `say(app, chain, text)`.
fn say(t: &mut TestApp, chain: &str, text: &str) -> Value {
    call(t, "say", json!({ "chain": chain, "text": text }))
}

fn agent_say(
    t: &mut TestApp,
    chain: &str,
    reply_to: &str,
    text: &str,
    headline: Option<&str>,
) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "agentSay",
        json!({ "chain": chain, "replyTo": reply_to, "text": text, "headline": headline }),
    )
}

fn agent_ack(t: &mut TestApp, id: &str, status: &str) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "agentAck",
        json!({ "id": id, "status": status, "note": "" }),
    )
}

/// v1's `agent_say_long(app, q, text, headline)`.
fn agent_say_long(
    t: &mut TestApp,
    q: &Value,
    text: &str,
    headline: Option<&str>,
) -> Result<Value, Failure> {
    agent_say(t, s(&q["chain"]), s(&q["id"]), text, headline)
}

fn record_notification(t: &mut TestApp, input: Value) -> Value {
    call(t, "recordNotification", json!({ "input": input }))
}

fn record_action(t: &mut TestApp, input: Value) -> Value {
    call(t, "recordAction", json!({ "input": input }))
}

fn item(t: &mut TestApp, id: &str) -> Value {
    let v = view(t, "item", json!({ "id": id }));
    assert!(!v.is_null(), "no item {id}");
    v
}

fn settings(t: &mut TestApp) -> Value {
    view(t, "settings", json!({}))
}

fn items(page: &Value) -> &Vec<Value> {
    page["items"].as_array().expect("items")
}

/// The names of the events `owner` received after the first `from`.
fn events_since(t: &TestApp, from: usize) -> Vec<String> {
    event_names(t).into_iter().skip(from).collect()
}

/// A view reads the clock of the last logged call: log one that changes
/// nothing (an archive into the past is refused) so views see `t`'s clock.
fn catch_up(t: &mut TestApp) {
    fail(t, "archive", json!({ "chains": [], "until": "1" }));
}

// ── talking to your agent ────────────────────────────────────────────────────

#[test]
fn answers_are_checked_against_the_question() {
    let mut t = app();
    let q = say(&mut t, "", "first");
    let other = say(&mut t, "", "second");
    // Wrong chain for that question.
    let f = agent_say(&mut t, s(&other["chain"]), s(&q["id"]), "hi", None).unwrap_err();
    assert_invalid(&f, "");
    // An agent message is not a question.
    let a = agent_say(&mut t, s(&q["chain"]), s(&q["id"]), "hi", None).unwrap();
    let f = agent_say(&mut t, s(&q["chain"]), s(&a["id"]), "hi", None).unwrap_err();
    assert_invalid(&f, "");
    let f = agent_ack(&mut t, s(&a["id"]), "thinking").unwrap_err();
    assert_invalid(&f, "");
    // An unprompted note needs a chain that exists.
    let f = agent_say(&mut t, "nope", "", "hi", None).unwrap_err();
    assert_invalid(&f, "");
    let note = agent_say(&mut t, s(&q["chain"]), "", "Done, booked it.", None).unwrap();
    assert_eq!(note["reply_to"], "");
}

#[test]
fn a_proposal_from_a_conversation_lands_in_its_chain() {
    let mut t = app();
    let q = say(&mut t, "", "Set up a call with Maya");
    let mut proposal = action("calendar", "proposed");
    proposal["chain"] = q["chain"].clone();
    proposal["ask"] = ask("choose", "Pick a slot", &["12:30", "13:15"], "");
    record_action(&mut t, proposal);
    agent_say(&mut t, s(&q["chain"]), s(&q["id"]), "Two slots work.", None).unwrap();
    let page = feed(&mut t, "needs_you");
    assert_eq!(items(&page).len(), 1);
    assert_eq!(page["items"][0]["kind"], "action", "the proposal leads");
    assert_eq!(page["items"][0]["chain_len"], 3);
}

#[test]
fn only_the_owner_talks_to_the_agent() {
    let mut t = app();
    let q = say(&mut t, "", "hello");
    let f = fail_as(
        &mut t,
        STRANGER,
        "say",
        json!({ "chain": "", "text": "hi" }),
    );
    assert_forbidden(&f);
    let f = fail_as(
        &mut t,
        STRANGER,
        "agentSay",
        json!({ "chain": q["chain"], "replyTo": q["id"], "text": "hi" }),
    );
    assert_forbidden(&f);
    let f = fail_as(
        &mut t,
        STRANGER,
        "agentAck",
        json!({ "id": q["id"], "status": "thinking", "note": "" }),
    );
    assert_forbidden(&f);
}

#[test]
fn messages_emit_posted_and_changed() {
    let mut t = app();
    let n = event_names(&t).len();
    let q = say(&mut t, "", "hello");
    assert_eq!(events_since(&t, n), ["MessagePosted"]);
    let n = event_names(&t).len();
    agent_ack(&mut t, s(&q["id"]), "thinking").unwrap();
    assert_eq!(events_since(&t, n), ["MessageChanged"]);
    let n = event_names(&t).len();
    agent_say(&mut t, s(&q["chain"]), s(&q["id"]), "hi", None).unwrap();
    assert_eq!(events_since(&t, n), ["MessageChanged", "MessagePosted"]);
}

#[test]
fn a_long_message_is_titled_by_its_first_line() {
    // v1 called the private `headline` directly; here it is read through the
    // title a message gets.
    let mut t = app();
    assert_eq!(say(&mut t, "", "Hi\nmore")["title"], "Hi");
    let long = "é".repeat(150); // 300 bytes
    let said = say(&mut t, "", &long);
    let h = s(&said["title"]);
    assert!(h.len() <= MAX_TITLE);
    assert!(h.ends_with('…'));
}

// ── headlines for long answers ───────────────────────────────────────────────

#[test]
fn a_headline_lets_an_answer_run_long_and_titles_its_row() {
    let mut t = app();
    let q = say(&mut t, "", "Give me ten ideas for the feed");
    let body = "An idea worth having.\n".repeat(1_400); // ~30 KB
    assert!(body.len() > MAX_MESSAGE && body.len() <= MAX_LONG_MESSAGE);
    let said = agent_say_long(&mut t, &q, &body, Some("Ten ideas for the feed")).unwrap();
    assert_eq!(said["headline"], "Ten ideas for the feed");
    assert_eq!(
        said["title"], "Ten ideas for the feed",
        "the row shows the headline"
    );
    assert_eq!(said["body"], body.as_str(), "the whole answer is kept");

    // Read back anywhere: the item, the chain and the feed carry it.
    let row = item(&mut t, s(&said["id"]));
    assert_eq!(row["headline"], "Ten ideas for the feed");
    assert_eq!(s(&row["body"]).len(), body.len());
    let flow = view(&mut t, "chain", json!({ "chain": q["chain"] }));
    let flow = flow.as_array().unwrap();
    assert_eq!(flow.last().unwrap()["headline"], "Ten ideas for the feed");
    let page = feed(&mut t, "all");
    assert_eq!(page["items"][0]["title"], "Ten ideas for the feed");
}

#[test]
fn a_headline_has_its_own_limits() {
    let mut t = app();
    let q = say(&mut t, "", "hi");
    let h80 = "é".repeat(MAX_HEADLINE); // 80 characters, 160 bytes
    assert!(agent_say_long(&mut t, &q, "ok", Some(&h80)).is_ok());
    let h81 = "a".repeat(MAX_HEADLINE + 1);
    let f = agent_say_long(&mut t, &q, "ok", Some(&h81)).unwrap_err();
    assert_invalid(&f, ""); // a headline is at most 80 characters
    let f = agent_say_long(&mut t, &q, "ok", Some("two\nlines")).unwrap_err();
    assert_invalid(&f, ""); // a headline is one line
    let too_long = "x".repeat(MAX_LONG_MESSAGE + 1);
    let f = agent_say_long(&mut t, &q, &too_long, Some("Report")).unwrap_err();
    assert_invalid(&f, ""); // a long answer still has a limit
    let f = agent_say_long(&mut t, &q, "", Some("Only a headline")).unwrap_err();
    assert_invalid(&f, ""); // an answer still needs text
}

#[test]
fn without_a_headline_the_old_limit_and_title_hold() {
    let mut t = app();
    let q = say(&mut t, "", "hi");
    let over = "x".repeat(MAX_MESSAGE + 1);
    let f = agent_say_long(&mut t, &q, &over, None).unwrap_err();
    assert_invalid(&f, ""); // no headline, no long text
    let f = agent_say_long(&mut t, &q, &over, Some("  ")).unwrap_err();
    assert_invalid(&f, ""); // a blank headline is no headline
    let said = agent_say_long(&mut t, &q, "First line.\nSecond line.", Some("")).unwrap();
    assert_eq!(said["headline"], "", "a blank headline is not kept");
    assert_eq!(
        said["title"], "First line.",
        "titled by its first line, as before"
    );
    let exact = "x".repeat(MAX_MESSAGE);
    assert!(agent_say_long(&mut t, &q, &exact, None).is_ok());
}

#[test]
fn your_message_and_an_agent_question_take_a_headline_too() {
    let mut t = app();
    let log = "error: something broke\n".repeat(200); // ~4.6 KB
    let q = call(
        &mut t,
        "say",
        json!({ "chain": "", "text": log, "headline": "The CI log" }),
    );
    assert_eq!(q["title"], "The CI log");
    let f = fail(&mut t, "say", json!({ "chain": "", "text": log }));
    assert_invalid(&f, "");
    let with_image = call(
        &mut t,
        "sayWith",
        json!({
            "chain": q["chain"],
            "text": log,
            "attachments": [image(&"ab".repeat(32))],
            "headline": "The log, and a screenshot",
        }),
    );
    assert_eq!(with_image["headline"], "The log, and a screenshot");

    let asked = call(
        &mut t,
        "agentAsk",
        json!({
            "chain": q["chain"],
            "replyTo": q["id"],
            "text": "Here is what failed and why.\n".repeat(150),
            "ask": choose(&["Fix it", "Leave it"]),
            "headline": "Two tests fail: fix them?",
        }),
    );
    assert_eq!(asked["title"], "Two tests fail: fix them?");
    assert_eq!(asked["status"], "asked");
}

#[test]
fn a_long_answer_streams_as_a_long_draft() {
    let mut t = app();
    let q = say(&mut t, "", "Write me a report");
    agent_ack(&mut t, s(&q["id"]), "thinking").unwrap();
    let draft = "A paragraph of the report.\n".repeat(400); // ~10 KB
    let row = call(
        &mut t,
        "agentWork",
        json!({ "id": q["id"], "steps": [], "draft": draft }),
    );
    assert_eq!(row["draft"], draft.as_str());
    let f = fail(
        &mut t,
        "agentWork",
        json!({ "id": q["id"], "steps": [], "draft": "x".repeat(MAX_LONG_MESSAGE + 1) }),
    );
    assert_invalid(&f, "");
}

// ── typed notifications and lenses ───────────────────────────────────────────

fn typed(item_type: &str, fields: &str, reply_call: &str) -> Value {
    let mut n = notification("chat-ctx:a>b:0", "chat", true);
    n["item_type"] = json!(item_type);
    n["fields"] = json!(fields);
    n["reply_call"] = json!(reply_call);
    n
}

const REPLY: &str =
    r#"{"method":"send_message","args":{"message":"=$answer","parent_message":null}}"#;

#[test]
fn a_typed_notification_carries_its_type_fields_and_reply_call() {
    let mut t = app();
    let fields = r#"{"from":"Maya","text":"numbers?","is_dm":false}"#;
    let n = record_notification(&mut t, typed("message", fields, REPLY));
    assert_eq!(
        (s(&n["item_type"]), s(&n["fields"]), s(&n["reply_call"])),
        ("message", fields, REPLY)
    );
    let row = item(&mut t, s(&n["id"]));
    assert_eq!(row["item_type"], "message");
    let page = view(
        &mut t,
        "feed",
        json!({ "filter": "all", "appKey": "", "limit": 10, "before": "0" }),
    );
    assert_eq!(page["items"][0]["reply_call"], REPLY);
    // Answering keeps them.
    let f = fail(
        &mut t,
        "answerNotification",
        json!({ "id": n["id"], "answer": "" }),
    );
    // an untyped ask still decides what an answer is
    assert_invalid(&f, "nothing to answer");
}

#[test]
fn an_untyped_notification_reads_as_before() {
    let mut t = app();
    let n = record_notification(&mut t, notification("k", "chat", false));
    assert_eq!((s(&n["item_type"]), s(&n["fields"])), ("", ""));
}

#[test]
fn an_older_client_may_leave_the_typed_fields_out() {
    // v1 deserialized the input directly; here the node takes it on the wire.
    let mut t = app();
    let input = json!({
        "key": "k", "app": "chat", "source_context": "", "source_label": "", "from": "",
        "title": "t", "body": "", "event": "", "needs_you": false, "chain": "",
        "ask": { "kind": "", "prompt": "", "options": [], "draft": "" },
    });
    let n = record_notification(&mut t, input);
    assert_eq!(n["item_type"], "");
}

#[test]
fn typed_parts_are_checked() {
    let mut t = app();
    for (ty, f, r, why) in [
        ("tweet", "{}", "", "item_type"),
        ("message", "[1]", "", "fields must be a JSON object"),
        ("message", "{}", r#"{"args":{}}"#, "reply_call must be"),
        (
            "message",
            "{}",
            r#"{"method":"x","args":[]}"#,
            "reply_call must be",
        ),
        ("", r#"{"a":1}"#, "", "need an item_type"),
    ] {
        let err = fail(
            &mut t,
            "recordNotification",
            json!({ "input": typed(ty, f, r) }),
        );
        assert_invalid(&err, why);
    }
    let big = format!(r#"{{"text":"{}"}}"#, "x".repeat(MAX_FIELDS));
    let err = fail(
        &mut t,
        "recordNotification",
        json!({ "input": typed("message", &big, "") }),
    );
    assert_invalid(&err, "");
}

fn propose(t: &mut TestApp, spec: &str) -> Value {
    call(
        t,
        "proposeLens",
        json!({
            "appKey": "chat",
            "applicationId": "app-1",
            "spec": spec,
            "summary": "DMs and mentions of you; answers with send_message",
        }),
    )
}

fn decide_lens(app_id: &str, decision: &str) -> Value {
    json!({ "appKey": "chat", "applicationId": app_id, "decision": decision })
}

#[test]
fn a_lens_waits_for_you_then_is_approved() {
    let mut t = app();
    let n = event_names(&t).len();
    let l = propose(&mut t, r#"{"events":{}}"#);
    assert_eq!(l["status"], "proposed");
    assert_eq!(events_since(&t, n), ["LensChanged"]);
    let l = call(&mut t, "decideLens", decide_lens("app-1", "approve"));
    assert_eq!(l["status"], "approved");
    // Proposing the same lens again changes nothing.
    assert_eq!(propose(&mut t, r#"{"events":{}}"#)["status"], "approved");
    // A different one waits for you again.
    assert_eq!(
        propose(&mut t, r#"{"events":{"X":"ignore"}}"#)["status"],
        "proposed"
    );
    let all = view(&mut t, "lenses", json!({}));
    assert_eq!(all.as_array().unwrap().len(), 1);
    assert_eq!(all[0]["spec"], r#"{"events":{"X":"ignore"}}"#);
}

#[test]
fn each_app_version_has_its_own_lens() {
    let mut t = app();
    propose(&mut t, "{}");
    call(
        &mut t,
        "proposeLens",
        json!({ "appKey": "chat", "applicationId": "app-2", "spec": "{}", "summary": "v2" }),
    );
    assert_eq!(
        view(&mut t, "lenses", json!({})).as_array().unwrap().len(),
        2
    );
    let f = fail(&mut t, "decideLens", decide_lens("app-9", "approve"));
    assert_invalid(&f, "no lens");
}

#[test]
fn a_lens_is_checked_and_only_the_owner_handles_lenses() {
    let mut t = app();
    let f = fail(
        &mut t,
        "proposeLens",
        json!({ "appKey": "chat", "applicationId": "app-1", "spec": "not json", "summary": "x" }),
    );
    assert_invalid(&f, "spec must be a JSON object");
    propose(&mut t, "{}");
    let f = fail(&mut t, "decideLens", decide_lens("app-1", "maybe"));
    assert_invalid(&f, "");
    let f = fail_as(
        &mut t,
        STRANGER,
        "decideLens",
        decide_lens("app-1", "approve"),
    );
    assert_forbidden(&f);
    let f = fail_as(
        &mut t,
        STRANGER,
        "proposeLens",
        json!({ "appKey": "chat", "applicationId": "app-1", "spec": "{}", "summary": "x" }),
    );
    assert_forbidden(&f);
}

// ── Archive and presence ─────────────────────────────────────────────────────

#[test]
fn an_archived_chain_leaves_the_feed_until_something_new_happens_in_it() {
    let mut t = app();
    let n = record_notification(&mut t, notification("k1", "chat", true));
    record_notification(&mut t, notification("k2", "chat", false));
    assert_eq!(items(&feed(&mut t, "all")).len(), 2);

    let archived = call(
        &mut t,
        "archive",
        json!({ "chains": [n["chain"]], "until": "0" }),
    );
    assert_eq!(archived, 1);
    let page = feed(&mut t, "all");
    assert_eq!(items(&page).len(), 1, "the archived chain is gone");
    assert_eq!(page["counts"]["needs_you"], 0, "and counts for nothing");
    assert_eq!(page["counts"]["archived"], 1);
    let archived = feed(&mut t, "archived");
    assert_eq!(items(&archived).len(), 1);
    assert_eq!(archived["items"][0]["chain"], n["chain"]);

    // You say something in it: it is back.
    say(&mut t, s(&n["chain"]), "About this…");
    assert_eq!(items(&feed(&mut t, "all")).len(), 2);
    assert!(items(&feed(&mut t, "archived")).is_empty());
}

#[test]
fn unarchiving_brings_a_chain_back_and_the_last_decision_wins() {
    let mut t = app();
    let n = record_notification(&mut t, notification("k1", "chat", true));
    let archive = json!({ "chains": [n["chain"]], "until": "0" });
    call(&mut t, "archive", archive.clone());
    call(&mut t, "unarchive", json!({ "chains": [n["chain"]] }));
    assert_eq!(items(&feed(&mut t, "needs_you")).len(), 1);
    call(&mut t, "archive", archive);
    assert!(items(&feed(&mut t, "needs_you")).is_empty());
}

#[test]
fn later_returns_a_chain_when_its_time_comes() {
    let mut t = app();
    let n = record_notification(&mut t, notification("k1", "chat", true));
    call(
        &mut t,
        "archive",
        json!({ "chains": [n["chain"]], "until": (T0 + 150).to_string() }),
    );
    assert!(items(&feed(&mut t, "all")).is_empty());
    t.advance(250);
    catch_up(&mut t);
    assert_eq!(items(&feed(&mut t, "all")).len(), 1, "back after its time");
}

#[test]
fn archive_refuses_strangers_unknown_chains_and_the_past() {
    let mut t = app();
    let n = record_notification(&mut t, notification("k1", "chat", true));
    let f = fail_as(
        &mut t,
        STRANGER,
        "archive",
        json!({ "chains": [n["chain"]], "until": "0" }),
    );
    assert_forbidden(&f);
    let f = fail(
        &mut t,
        "archive",
        json!({ "chains": ["nope"], "until": "0" }),
    );
    assert_invalid(&f, "");
    let f = fail(
        &mut t,
        "archive",
        json!({ "chains": [n["chain"]], "until": "1" }),
    );
    assert_invalid(&f, "");
    let f = fail(
        &mut t,
        "archive",
        json!({ "chains": vec![n["chain"].clone(); MAX_ARCHIVE + 1], "until": "0" }),
    );
    assert_invalid(&f, "");
    assert_eq!(items(&feed(&mut t, "all")).len(), 1);
}

#[test]
fn an_agent_reporting_in_shows_in_settings() {
    let mut t = app();
    assert!(settings(&mut t)["agents"].as_array().unwrap().is_empty());
    t.advance(5);
    let before = T0 + 5;
    call(&mut t, "agentSeen", json!({ "name": "mero-bot@laptop" }));
    let agents = settings(&mut t)["agents"].clone();
    assert_eq!(agents.as_array().unwrap().len(), 1);
    assert_eq!(agents[0]["name"], "mero-bot@laptop");
    assert!(agents[0]["seen_at"].as_u64().unwrap() >= before);
    let f = fail_as(&mut t, STRANGER, "agentSeen", json!({ "name": "x" }));
    assert_forbidden(&f);
}

// ── Allow for this session ───────────────────────────────────────────────────

/// A tool on your computer the agent proposed, answered with `answer`.
fn allowed(t: &mut TestApp, app_key: &str, answer: &str) -> Value {
    let mut input = action(app_key, "proposed");
    input["method"] = json!("Bash");
    input["ask"] = choose(&["Allow once", SESSION_GRANT]);
    let proposal = record_action(t, input);
    call(
        t,
        "resolveAction",
        json!({ "id": proposal["id"], "decision": "approve", "answer": answer }),
    )
}

/// What the agent ran afterwards, carrying `grant`.
fn ran_under(t: &mut TestApp, app_key: &str, grant: &str) -> Value {
    let mut input = action(app_key, "done");
    input["grant"] = json!(grant);
    record_action(t, input)
}

fn breach(item: &Value) -> &str {
    s(&item["breach"])
}

#[test]
fn a_session_you_allowed_is_not_acting_without_asking() {
    let mut t = app(); // "mero-bot" defaults to ask
    let grant = allowed(&mut t, "mero-bot", SESSION_GRANT);
    let grant_id = s(&grant["id"]).to_owned();

    let ran = ran_under(&mut t, "mero-bot", &grant_id);
    assert_eq!(ran["status"], "done");
    assert!(breach(&ran).is_empty(), "{}", breach(&ran));
    assert_eq!(ran["needs_you"], false);

    // The grant still counts once the proposal itself is done.
    call(
        &mut t,
        "completeAction",
        json!({ "id": grant_id, "outcome": "done", "note": "" }),
    );
    assert!(breach(&ran_under(&mut t, "mero-bot", &grant_id)).is_empty());

    // A failure is recorded as one, without a breach: it needs you as a failure.
    let mut failed = action("mero-bot", "failed");
    failed["grant"] = json!(grant_id);
    let failed = record_action(&mut t, failed);
    assert_eq!(failed["status"], "failed");
    assert!(breach(&failed).is_empty());

    // Without the grant it is what it always was.
    let bare = ran_under(&mut t, "mero-bot", "");
    assert!(breach(&bare).starts_with("acted without asking"));
}

#[test]
fn a_grant_counts_only_in_its_app_for_the_session_and_once_allowed() {
    let mut t = app();
    let grant = allowed(&mut t, "mero-bot", SESSION_GRANT);
    let grant_id = s(&grant["id"]).to_owned();

    // Another app: the session was allowed for tools on this computer only.
    assert!(!breach(&ran_under(&mut t, "chat", &grant_id)).is_empty());

    // "Allow once" is one command, not a session.
    let once = allowed(&mut t, "mero-bot", "Allow once");
    assert!(!breach(&ran_under(&mut t, "mero-bot", s(&once["id"]))).is_empty());

    // A proposal still waiting on you, or one that does not exist.
    let mut waiting = action("mero-bot", "proposed");
    waiting["ask"] = choose(&["Allow once", SESSION_GRANT]);
    let waiting = record_action(&mut t, waiting);
    assert!(!breach(&ran_under(&mut t, "mero-bot", s(&waiting["id"]))).is_empty());
    assert!(!breach(&ran_under(&mut t, "mero-bot", "nope")).is_empty());

    // Allowed more than 12 hours ago. (v1 backdated the grant's history in
    // state; here the clock moves past the window instead, counted from the
    // approval's own step.)
    let approved_at = grant["history"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["status"] == "approved")
        .and_then(|step| step["at"].as_u64())
        .expect("approved");
    t.set_time(approved_at + GRANT_WINDOW_MS + 1);
    let stale = ran_under(&mut t, "mero-bot", &grant_id);
    assert!(
        breach(&stale).starts_with("acted without asking"),
        "{stale}"
    );
}

#[test]
fn a_grant_does_not_lift_a_pause_a_guard_read_only_or_off() {
    let mut t = app();
    let grant = allowed(&mut t, "mero-bot", SESSION_GRANT);
    let grant_id = s(&grant["id"]).to_owned();

    call(&mut t, "setPaused", json!({ "paused": true }));
    let paused = ran_under(&mut t, "mero-bot", &grant_id);
    assert!(breach(&paused).contains("paused"), "{}", breach(&paused));
    call(&mut t, "setPaused", json!({ "paused": false }));

    let mut guarded = action("mero-bot", "done");
    guarded["category"] = json!("delete");
    guarded["grant"] = json!(grant_id);
    let guarded = record_action(&mut t, guarded);
    assert!(
        breach(&guarded).contains("always needs you"),
        "{}",
        breach(&guarded)
    );

    for mode in ["read", "off"] {
        call(
            &mut t,
            "setPolicy",
            json!({ "appKey": "mero-bot", "agent": mode, "notifications": "feed" }),
        );
        let ran = ran_under(&mut t, "mero-bot", &grant_id);
        assert!(
            breach(&ran).starts_with("acted where it may not"),
            "{}",
            breach(&ran)
        );
    }
}

#[test]
fn a_grant_belongs_on_an_outcome() {
    let mut t = app();
    let grant = allowed(&mut t, "mero-bot", SESSION_GRANT);
    let mut proposal = action("mero-bot", "proposed");
    proposal["grant"] = grant["id"].clone();
    let f = fail(&mut t, "recordAction", json!({ "input": proposal }));
    assert_invalid(&f, "grant");
}

// ── A chain is settled only when everything in it is ─────────────────────────

/// Rows are ordered by the millisecond they were made in: move to the next.
fn next_ms(t: &mut TestApp) {
    t.advance(2);
}

/// A step in `chain` that settled at once.
fn done_in(t: &mut TestApp, chain: &str) -> Value {
    next_ms(t);
    let mut input = action("sheets", "done");
    input["chain"] = json!(chain);
    record_action(t, input)
}

fn lead(t: &mut TestApp, chain: &str) -> Value {
    items(&feed(t, "all"))
        .iter()
        .find(|r| r["chain"] == chain)
        .expect("the chain")
        .clone()
}

fn resolve(t: &mut TestApp, id: &str, decision: &str, answer: &str) -> Value {
    call(
        t,
        "resolveAction",
        json!({ "id": id, "decision": decision, "answer": answer }),
    )
}

fn complete(t: &mut TestApp, id: &str, outcome: &str) -> Value {
    call(
        t,
        "completeAction",
        json!({ "id": id, "outcome": outcome, "note": "" }),
    )
}

#[test]
fn an_approved_action_leads_its_chain_until_it_settles() {
    let mut t = acting_in("sheets"); // "chat" still asks
    let proposal = record_action(&mut t, action("chat", "proposed"));
    let (id, chain) = (
        s(&proposal["id"]).to_owned(),
        s(&proposal["chain"]).to_owned(),
    );
    resolve(&mut t, &id, "approve", "");
    let later = done_in(&mut t, &chain);

    let row = lead(&mut t, &chain);
    assert_eq!(
        row["id"], id,
        "what is still running leads, not {}",
        later["id"]
    );
    assert_eq!(row["status"], "approved");
    assert_eq!(row["needs_you"], false);

    // It fails: now it needs you, and still leads.
    complete(&mut t, &id, "failed");
    assert_eq!(lead(&mut t, &chain)["needs_you"], true);

    // A retry is underway again; once it is done, the latest row leads.
    resolve(&mut t, &id, "approve", "");
    let row = lead(&mut t, &chain);
    assert_eq!(
        (s(&row["id"]), s(&row["status"])),
        (id.as_str(), "retrying")
    );
    complete(&mut t, &id, "done");
    assert_eq!(lead(&mut t, &chain)["id"], later["id"]);
}

#[test]
fn an_undo_being_done_leads_its_chain() {
    let mut t = acting_in("sheets");
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "chat", "agent": "act", "notifications": "feed" }),
    );
    let posted = record_action(&mut t, action("sheets", "done"));
    resolve(&mut t, s(&posted["id"]), "undo", "");
    done_in(&mut t, s(&posted["chain"]));
    let row = lead(&mut t, s(&posted["chain"]));
    assert_eq!(
        (s(&row["id"]), s(&row["status"])),
        (s(&posted["id"]), "undo_requested")
    );
}

#[test]
fn your_message_leads_its_chain_until_it_is_answered() {
    let mut t = acting_in("sheets");
    let q = say(&mut t, "", "Pull the numbers into a sheet");
    let chain = s(&q["chain"]).to_owned();
    let step = done_in(&mut t, &chain);
    assert_eq!(lead(&mut t, &chain)["id"], q["id"], "waiting");

    agent_ack(&mut t, s(&q["id"]), "thinking").unwrap();
    assert_eq!(lead(&mut t, &chain)["id"], q["id"], "thinking");

    next_ms(&mut t);
    let a = agent_say(&mut t, &chain, s(&q["id"]), "Done.", None).unwrap();
    assert_ne!(a["id"], step["id"]);
    assert_eq!(
        lead(&mut t, &chain)["id"],
        a["id"],
        "answered: the latest row leads"
    );
}

#[test]
fn an_answer_being_delivered_leads_its_chain() {
    let mut t = acting_in("sheets");
    let mut input = notification("chat:a>b:0", "chat", true);
    input["ask"] = ask("reply", "Reply in #launch", &[], "");
    let mention = record_notification(&mut t, input);
    call(
        &mut t,
        "answerNotification",
        json!({ "id": mention["id"], "answer": "On it" }),
    );
    done_in(&mut t, s(&mention["chain"]));
    let row = lead(&mut t, s(&mention["chain"]));
    assert_eq!(
        (s(&row["id"]), s(&row["status"])),
        (s(&mention["id"]), "answered")
    );
}

// ── stale questions ──────────────────────────────────────────────────────────

fn agent_asks(t: &mut TestApp, chain: &str, text: &str, options: &[&str]) -> Value {
    call(
        t,
        "agentAsk",
        json!({ "chain": chain, "replyTo": "", "text": text, "ask": choose(options) }),
    )
}

fn answer_ask(t: &mut TestApp, who: &str, id: &Value, text: &str) -> Result<Value, Failure> {
    t.as_(who)
        .call("answerAsk", json!({ "id": id, "text": text }))
}

#[test]
fn a_new_question_replaces_the_open_ones_in_its_chain() {
    let mut t = app();
    let q = say(&mut t, "", "Tidy up #launch");
    let chain = s(&q["chain"]).to_owned();
    let first = agent_asks(&mut t, &chain, "Delete the duplicate?", &["Delete", "Keep"]);
    assert_eq!(first["superseded_by"], "");
    let second = agent_asks(
        &mut t,
        &chain,
        "Archive the channel?",
        &["Archive", "Leave it"],
    );

    let old = item(&mut t, s(&first["id"]));
    assert_eq!(
        old["superseded_by"], second["id"],
        "the newer question replaced it"
    );
    assert_eq!(
        old["needs_you"], false,
        "a replaced question no longer waits on you"
    );
    assert_eq!(old["status"], "asked", "it was never answered");
    let new = item(&mut t, s(&second["id"]));
    assert_eq!(new["superseded_by"], "");
    assert_eq!(new["needs_you"], true);

    // One question waits on you, and it leads the chain.
    let page = feed(&mut t, "needs_you");
    assert_eq!(page["counts"]["needs_you"], 1);
    assert_eq!(page["items"][0]["id"], second["id"]);

    // A plain answer in the chain answers the question in front of you, not the old one.
    say(&mut t, &chain, "Archive");
    assert_eq!(item(&mut t, s(&second["id"]))["status"], "answered");
    assert_eq!(item(&mut t, s(&first["id"]))["status"], "asked");
    assert_eq!(feed(&mut t, "needs_you")["counts"]["needs_you"], 0);
}

#[test]
fn a_question_elsewhere_or_already_answered_is_not_replaced() {
    let mut t = app();
    let a = say(&mut t, "", "one");
    let b = say(&mut t, "", "two");
    let in_a = agent_asks(&mut t, s(&a["chain"]), "A?", &["Yes", "No"]);
    say(&mut t, s(&a["chain"]), "Yes");
    let in_b = agent_asks(&mut t, s(&b["chain"]), "B?", &["Yes", "No"]);
    agent_asks(&mut t, s(&a["chain"]), "A again?", &["Yes", "No"]);
    assert_eq!(
        item(&mut t, s(&in_a["id"]))["superseded_by"],
        "",
        "answered before the new one"
    );
    assert_eq!(
        item(&mut t, s(&in_b["id"]))["superseded_by"],
        "",
        "another chain"
    );
    // A plain answer replaces nothing.
    let note = agent_say(&mut t, s(&b["chain"]), "", "FYI", None).unwrap();
    assert_eq!(note["superseded_by"], "");
    assert_eq!(item(&mut t, s(&in_b["id"]))["superseded_by"], "");
}

#[test]
fn a_notification_with_a_question_replaces_and_is_replaced() {
    let mut t = app();
    let mut poll = notification("poll-1", "chat", true);
    poll["ask"] = choose(&["Tue", "Wed"]);
    let poll = record_notification(&mut t, poll);
    assert_eq!(poll["needs_you"], true);

    // Your agent asks in the same chain: the poll's buttons go.
    let asked = agent_asks(
        &mut t,
        s(&poll["chain"]),
        "Want me to vote Wed?",
        &["Yes", "No"],
    );
    let old = item(&mut t, s(&poll["id"]));
    assert_eq!(old["superseded_by"], asked["id"]);
    assert_eq!(old["needs_you"], false);

    // A newer notification with a question in the chain replaces your agent's.
    let mut again = notification("poll-2", "chat", true);
    again["chain"] = poll["chain"].clone();
    again["ask"] = choose(&["Thu", "Fri"]);
    let again = record_notification(&mut t, again);
    assert_eq!(item(&mut t, s(&asked["id"]))["superseded_by"], again["id"]);
    assert_eq!(
        item(&mut t, s(&poll["id"]))["superseded_by"],
        asked["id"],
        "the first replacement stands"
    );

    // An answer that still reaches the replaced poll is taken, and shows it was replaced.
    let answered = call(
        &mut t,
        "answerNotification",
        json!({ "id": poll["id"], "answer": "Wed" }),
    );
    assert_eq!(answered["status"], "answered");
    assert_eq!(answered["superseded_by"], asked["id"]);
}

#[test]
fn answering_a_question_from_its_buttons_goes_to_your_agent() {
    let mut t = app();
    let q = say(&mut t, "", "Tidy up #launch");
    let chain = s(&q["chain"]).to_owned();
    let asked = agent_asks(&mut t, &chain, "Delete the duplicate?", &["Delete", "Keep"]);
    let answer = answer_ask(&mut t, OWNER, &asked["id"], "Delete").unwrap();
    assert_eq!(answer["from"], "you");
    assert_eq!(answer["status"], "waiting");
    assert_eq!(answer["chain"], q["chain"]);
    assert_eq!(answer["answers"], asked["id"]);
    assert_eq!(answer["answers_superseded"], false);
    assert_eq!(item(&mut t, s(&asked["id"]))["status"], "answered");
    assert_eq!(item(&mut t, s(&asked["id"]))["note"], "Delete");
    let open = view(&mut t, "openQuestions", json!({}));
    assert!(open
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == answer["id"]));

    // Answered once is answered.
    let f = answer_ask(&mut t, OWNER, &asked["id"], "Keep").unwrap_err();
    assert_invalid(&f, "");
    // Only your agent's questions, only by you.
    let f = answer_ask(&mut t, OWNER, &q["id"], "x").unwrap_err();
    assert_invalid(&f, "");
    let plain = agent_say(&mut t, &chain, "", "FYI", None).unwrap();
    let f = answer_ask(&mut t, OWNER, &plain["id"], "x").unwrap_err();
    assert_invalid(&f, "");
    let open = agent_asks(&mut t, &chain, "Again?", &["Yes", "No"]);
    let f = answer_ask(&mut t, STRANGER, &open["id"], "Yes").unwrap_err();
    assert_forbidden(&f);
}

// ── standing rules ───────────────────────────────────────────────────────────

fn rules(t: &mut TestApp) -> Vec<String> {
    settings(t)["rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| s(&r["text"]).to_owned())
        .collect()
}

fn add_rule(t: &mut TestApp, who: &str, text: &str) -> Result<Value, Failure> {
    t.as_(who).call("addRule", json!({ "text": text }))
}

fn propose_rule(
    t: &mut TestApp,
    who: &str,
    text: &str,
    why: &str,
    chain: &str,
) -> Result<Value, Failure> {
    t.as_(who).call(
        "proposeRule",
        json!({ "text": text, "why": why, "chain": chain }),
    )
}

#[test]
fn a_new_feed_has_no_standing_rules() {
    let mut t = app();
    let settings = settings(&mut t);
    assert!(
        settings["rules"].as_array().unwrap().is_empty(),
        "nothing is seeded"
    );
    assert!(settings["rule_proposals"].as_array().unwrap().is_empty());
}

#[test]
fn you_add_and_remove_standing_rules() {
    let mut t = app();
    let first = add_rule(&mut t, OWNER, "  Never push to main  ").unwrap();
    assert_eq!(first["text"], "Never push to main", "trimmed");
    add_rule(&mut t, OWNER, "Answer in English").unwrap();
    assert_eq!(rules(&mut t), ["Never push to main", "Answer in English"]);
    // The same rule twice is kept once.
    let again = add_rule(&mut t, OWNER, "never push to MAIN").unwrap();
    assert_eq!(again["id"], first["id"]);
    assert_eq!(rules(&mut t).len(), 2);

    call(&mut t, "removeRule", json!({ "id": first["id"] }));
    assert_eq!(rules(&mut t), ["Answer in English"]);
    let f = fail(&mut t, "removeRule", json!({ "id": first["id"] }));
    assert_invalid(&f, ""); // already removed
    let f = fail(&mut t, "removeRule", json!({ "id": "nope" }));
    assert_invalid(&f, "");
}

#[test]
fn a_rule_is_one_short_line() {
    let mut t = app();
    assert_invalid(&add_rule(&mut t, OWNER, "   ").unwrap_err(), "");
    assert_invalid(&add_rule(&mut t, OWNER, "two\nlines").unwrap_err(), "");
    assert_invalid(
        &add_rule(&mut t, OWNER, &"x".repeat(MAX_RULE + 1)).unwrap_err(),
        "",
    );
    assert!(add_rule(&mut t, OWNER, &"x".repeat(MAX_RULE)).is_ok());
    for i in 1..MAX_RULES {
        add_rule(&mut t, OWNER, &format!("rule {i}")).unwrap();
    }
    // every rule goes into every prompt, so they stay few
    assert_invalid(&add_rule(&mut t, OWNER, "one too many").unwrap_err(), "");
}

#[test]
fn only_the_owner_changes_standing_rules() {
    let mut t = app();
    let rule = add_rule(&mut t, OWNER, "Never push to main").unwrap();
    assert_forbidden(&add_rule(&mut t, STRANGER, "Push anywhere").unwrap_err());
    let f = fail_as(&mut t, STRANGER, "removeRule", json!({ "id": rule["id"] }));
    assert_forbidden(&f);
    let proposal = propose_rule(&mut t, OWNER, "Ask before deleting", "", "").unwrap();
    assert_forbidden(&propose_rule(&mut t, STRANGER, "Be loud", "", "").unwrap_err());
    let f = fail_as(
        &mut t,
        STRANGER,
        "approveRule",
        json!({ "id": proposal["id"] }),
    );
    assert_forbidden(&f);
    let f = fail_as(
        &mut t,
        STRANGER,
        "dismissRule",
        json!({ "id": proposal["id"] }),
    );
    assert_forbidden(&f);
    assert_eq!(rules(&mut t), ["Never push to main"]);
}

fn agent_rules(t: &mut TestApp) -> Vec<(String, String)> {
    settings(t)["agent_rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (s(&r["agent"]).to_owned(), s(&r["text"]).to_owned()))
        .collect()
}

fn add_agent_rule(t: &mut TestApp, who: &str, agent: &str, text: &str) -> Result<Value, Failure> {
    t.as_(who)
        .call("addAgentRule", json!({ "agent": agent, "text": text }))
}

fn pair(a: &str, b: &str) -> (String, String) {
    (a.to_owned(), b.to_owned())
}

#[test]
fn you_add_and_remove_rules_for_one_agent() {
    let mut t = app();
    add_rule(&mut t, OWNER, "Never push to main").unwrap();
    let first =
        add_agent_rule(&mut t, OWNER, " mero-bot@studio ", "  Run the tests first ").unwrap();
    assert_eq!(first["agent"], "mero-bot@studio", "trimmed");
    assert_eq!(first["text"], "Run the tests first", "trimmed");
    add_agent_rule(&mut t, OWNER, "mero-bot@phone", "Keep answers short").unwrap();
    // The same line for another agent is that agent's own.
    add_agent_rule(&mut t, OWNER, "mero-bot@phone", "Run the tests first").unwrap();
    assert_eq!(
        agent_rules(&mut t),
        vec![
            pair("mero-bot@phone", "Keep answers short"),
            pair("mero-bot@phone", "Run the tests first"),
            pair("mero-bot@studio", "Run the tests first"),
        ]
    );
    // The general rules are untouched: every agent keeps them.
    assert_eq!(rules(&mut t), ["Never push to main"]);
    // The same rule twice for one agent is kept once.
    let again = add_agent_rule(&mut t, OWNER, "mero-bot@studio", "run the TESTS first").unwrap();
    assert_eq!(again["id"], first["id"]);

    call(&mut t, "removeAgentRule", json!({ "id": first["id"] }));
    assert_eq!(agent_rules(&mut t).len(), 2);
    let f = fail(&mut t, "removeAgentRule", json!({ "id": first["id"] }));
    assert_invalid(&f, ""); // already removed
    let f = fail(&mut t, "removeAgentRule", json!({ "id": "nope" }));
    assert_invalid(&f, "");
}

#[test]
fn an_agent_rule_is_one_short_line_for_a_named_agent() {
    let mut t = app();
    let a = "mero-bot@studio";
    assert_invalid(
        &add_agent_rule(&mut t, OWNER, "  ", "Be brief").unwrap_err(),
        "",
    );
    assert_invalid(&add_agent_rule(&mut t, OWNER, a, "   ").unwrap_err(), "");
    assert_invalid(
        &add_agent_rule(&mut t, OWNER, a, "two\nlines").unwrap_err(),
        "",
    );
    assert_invalid(
        &add_agent_rule(&mut t, OWNER, a, &"x".repeat(MAX_RULE + 1)).unwrap_err(),
        "",
    );
    for i in 0..MAX_RULES {
        add_agent_rule(&mut t, OWNER, a, &format!("rule {i}")).unwrap();
    }
    assert_invalid(
        &add_agent_rule(&mut t, OWNER, a, "one too many").unwrap_err(),
        "",
    );
    // The limit is per agent.
    assert!(add_agent_rule(&mut t, OWNER, "mero-bot@phone", "Be brief").is_ok());
}

#[test]
fn only_the_owner_changes_agent_rules() {
    let mut t = app();
    let rule = add_agent_rule(&mut t, OWNER, "mero-bot@studio", "Never push to main").unwrap();
    assert_forbidden(
        &add_agent_rule(&mut t, STRANGER, "mero-bot@studio", "Push anywhere").unwrap_err(),
    );
    let f = fail_as(
        &mut t,
        STRANGER,
        "removeAgentRule",
        json!({ "id": rule["id"] }),
    );
    assert_forbidden(&f);
    assert_eq!(
        agent_rules(&mut t),
        vec![pair("mero-bot@studio", "Never push to main")]
    );
}

#[test]
fn a_suggested_rule_waits_until_you_approve_it() {
    let mut t = app();
    let q = say(&mut t, "", "Push the fix");
    let proposal = propose_rule(
        &mut t,
        OWNER,
        "Open a PR instead of pushing to main",
        "You told me not to push to main.",
        s(&q["chain"]),
    )
    .unwrap();
    assert_eq!(proposal["status"], "proposed");
    assert_eq!(proposal["chain"], q["chain"]);
    let st = settings(&mut t);
    assert!(
        st["rules"].as_array().unwrap().is_empty(),
        "a suggestion changes nothing"
    );
    assert_eq!(st["rule_proposals"], json!([proposal]));
    // Suggested twice, it waits once.
    let again = propose_rule(
        &mut t,
        OWNER,
        "open a PR instead of pushing to main",
        "",
        "",
    )
    .unwrap();
    assert_eq!(again["id"], proposal["id"]);

    let rule = call(&mut t, "approveRule", json!({ "id": proposal["id"] }));
    assert_eq!(rule["text"], "Open a PR instead of pushing to main");
    let st = settings(&mut t);
    assert_eq!(rules(&mut t), ["Open a PR instead of pushing to main"]);
    assert!(st["rule_proposals"].as_array().unwrap().is_empty());
    let f = fail(&mut t, "approveRule", json!({ "id": proposal["id"] }));
    assert_invalid(&f, ""); // approved once
                            // A rule you already have is not suggested.
    let f = propose_rule(
        &mut t,
        OWNER,
        "Open a PR instead of pushing to main",
        "",
        "",
    )
    .unwrap_err();
    assert_invalid(&f, "");
}

#[test]
fn an_answer_that_reaches_a_replaced_question_is_flagged() {
    let mut t = app();
    let q = say(&mut t, "", "Tidy up #launch");
    let chain = s(&q["chain"]).to_owned();
    let first = agent_asks(&mut t, &chain, "Delete the duplicate?", &["Delete", "Keep"]);
    let second = agent_asks(
        &mut t,
        &chain,
        "Archive the channel?",
        &["Archive", "Leave it"],
    );

    // A screen that had not caught up taps the old question's button.
    let late = answer_ask(&mut t, OWNER, &first["id"], "Delete").unwrap();
    assert_eq!(late["answers"], first["id"]);
    assert_eq!(
        late["answers_superseded"], true,
        "your agent is told it answers an old question"
    );
    assert_eq!(
        item(&mut t, s(&late["id"]))["answers_superseded"],
        true,
        "and reads it so later too"
    );
    assert_eq!(item(&mut t, s(&first["id"]))["status"], "answered");
    let current = item(&mut t, s(&second["id"]));
    assert_eq!(current["status"], "asked", "the newer question stays open");
    assert_eq!(current["needs_you"], true);
}

// ── chain leases ─────────────────────────────────────────────────────────────

fn claim(t: &mut TestApp, chain: &str, session: &str, ttl_ms: u64) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "claimChain",
        json!({
            "chain": chain,
            "session": session,
            "ttlMs": ttl_ms.to_string(),
            "agent": format!("mero-bot@{session}"),
        }),
    )
}

fn renew(t: &mut TestApp, chain: &str, session: &str) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "renewChain",
        json!({ "chain": chain, "session": session, "ttlMs": "60000" }),
    )
}

fn release(t: &mut TestApp, who: &str, chain: &str, session: &str) -> Result<Value, Failure> {
    t.as_(who).call(
        "releaseChain",
        json!({ "chain": chain, "session": session }),
    )
}

fn lease_of(t: &mut TestApp, chain: &str) -> Value {
    view(t, "chainLease", json!({ "chain": chain }))
}

#[test]
fn a_second_session_is_refused_a_chain_another_holds() {
    let mut t = app();
    let q = say(&mut t, "", "Fix the digest card");
    let chain = s(&q["chain"]).to_owned();
    let lease = claim(&mut t, &chain, "studio", 60_000).unwrap();
    assert_eq!(lease["session"], "studio");
    assert_eq!(lease["agent"], "mero-bot@studio");
    assert!(lease["expires_at"].as_u64() > lease["claimed_at"].as_u64());

    let refused = claim(&mut t, &chain, "laptop", 60_000).unwrap_err();
    assert_invalid(&refused, "held by mero-bot@studio");
    assert_invalid(&renew(&mut t, &chain, "laptop").unwrap_err(), "");
    assert_eq!(
        release(&mut t, OWNER, &chain, "laptop").unwrap(),
        false,
        "letting go of what it does not hold changes nothing"
    );
    // Another chain is free.
    let other = say(&mut t, "", "Something else");
    assert!(claim(&mut t, s(&other["chain"]), "laptop", 60_000).is_ok());

    // The chat shows who is on it.
    let row = item(&mut t, s(&q["id"]));
    assert_eq!(row["held_by"], "mero-bot@studio");
    assert_eq!(row["held_since"], lease["claimed_at"]);
}

#[test]
fn the_holder_renews_and_releases_and_then_another_session_may_claim() {
    let mut t = app();
    let q = say(&mut t, "", "Fix the digest card");
    let chain = s(&q["chain"]).to_owned();
    let first = claim(&mut t, &chain, "studio", 60_000).unwrap();
    next_ms(&mut t);
    let renewed = renew(&mut t, &chain, "studio").unwrap();
    assert!(renewed["expires_at"].as_u64() > first["expires_at"].as_u64());
    assert_eq!(
        renewed["claimed_at"], first["claimed_at"],
        "held since the claim"
    );
    // Claiming again is renewing.
    let again = claim(&mut t, &chain, "studio", 60_000).unwrap();
    assert_eq!(again["claimed_at"], first["claimed_at"]);

    assert_eq!(release(&mut t, OWNER, &chain, "studio").unwrap(), true);
    assert!(lease_of(&mut t, &chain).is_null());
    assert_eq!(item(&mut t, s(&q["id"]))["held_by"], "");
    // released is released: claim it again
    assert_invalid(&renew(&mut t, &chain, "studio").unwrap_err(), "");
    let taken = claim(&mut t, &chain, "laptop", 60_000).unwrap();
    assert_eq!(taken["session"], "laptop");
    assert_eq!(lease_of(&mut t, &chain), taken);
}

#[test]
fn an_expired_lease_can_be_reclaimed() {
    let mut t = app();
    let q = say(&mut t, "", "Fix the digest card");
    let chain = s(&q["chain"]).to_owned();
    claim(&mut t, &chain, "studio", MIN_LEASE_MS).unwrap();
    assert!(claim(&mut t, &chain, "laptop", 60_000).is_err());
    // The studio's session died: its lease runs out.
    t.advance(MIN_LEASE_MS + 50);
    catch_up(&mut t);
    assert!(lease_of(&mut t, &chain).is_null());
    assert_eq!(item(&mut t, s(&q["id"]))["held_by"], "");
    let taken = claim(&mut t, &chain, "laptop", 60_000).unwrap();
    assert_eq!(taken["session"], "laptop");
    // The dead session cannot carry on beside it.
    assert_invalid(&renew(&mut t, &chain, "studio").unwrap_err(), "");
}

#[test]
fn leases_are_checked_and_owner_only() {
    let mut t = app();
    let q = say(&mut t, "", "hi");
    let chain = s(&q["chain"]).to_owned();
    assert_invalid(&claim(&mut t, "", "studio", 60_000).unwrap_err(), "");
    assert_invalid(&claim(&mut t, &chain, "", 60_000).unwrap_err(), "");
    assert_invalid(
        &claim(&mut t, &chain, "studio", MIN_LEASE_MS - 1).unwrap_err(),
        "",
    );
    assert_invalid(
        &claim(&mut t, &chain, "studio", MAX_LEASE_MS + 1).unwrap_err(),
        "",
    );
    let f = fail_as(
        &mut t,
        STRANGER,
        "claimChain",
        json!({ "chain": chain, "session": "x", "ttlMs": "60000" }),
    );
    assert_forbidden(&f);
    claim(&mut t, &chain, "studio", 60_000).unwrap();
    assert_forbidden(&release(&mut t, STRANGER, &chain, "studio").unwrap_err());
    // An older agent names nothing: the lease still holds.
    let other = say(&mut t, "", "other");
    let lease = call(
        &mut t,
        "claimChain",
        json!({ "chain": other["chain"], "session": "old", "ttlMs": "60000" }),
    );
    assert_eq!(lease["agent"], "");
    assert!(claim(&mut t, s(&other["chain"]), "studio", 60_000).is_err());
}

#[test]
fn a_suggested_rule_can_be_dismissed() {
    let mut t = app();
    let proposal = propose_rule(&mut t, OWNER, "Use emoji", "", "").unwrap();
    let dismissed = call(&mut t, "dismissRule", json!({ "id": proposal["id"] }));
    assert_eq!(dismissed["status"], "dismissed");
    let st = settings(&mut t);
    assert!(st["rules"].as_array().unwrap().is_empty());
    assert!(st["rule_proposals"].as_array().unwrap().is_empty());
    let f = fail(&mut t, "approveRule", json!({ "id": proposal["id"] }));
    assert_invalid(&f, "");
    assert_invalid(
        &propose_rule(&mut t, OWNER, "x", "", "no-chain").unwrap_err(),
        "",
    );
}

// ── one thread per task ──────────────────────────────────────────────────────

/// A teammate's comment on an issue, as the issue tracker's lens records it.
fn comment_on(issue: &str, key: &str) -> Value {
    let mut n = notification(key, "issue-tracker", false);
    n["source_context"] = json!("repo-ctx");
    n["event"] = json!("CommentAdded");
    n["item_type"] = json!("message");
    n["fields"] = json!(r#"{"text":"Looks good"}"#);
    n["reply_call"] = json!(format!(
        r#"{{"method":"add_comment","args":{{"issue_id":"{issue}","body":"=answer"}}}}"#
    ));
    n
}

/// The agent's write on an issue, in the task's chain.
fn touched(t: &mut TestApp, chain: &str, issue: &str) -> Value {
    let mut a = action("issue-tracker", "done");
    a["source_context"] = json!("repo-ctx");
    a["method"] = json!("set_status");
    a["chain"] = json!(chain);
    // v1's `subject_key("issue-tracker", "repo-ctx", issue)`.
    a["subject"] = json!(format!("issue-tracker:repo-ctx:{issue}"));
    record_action(t, a)
}

/// The subject a typed notification in `app`'s `context` gets from its reply call.
fn reply_subject(t: &mut TestApp, app: &str, context: &str, reply_call: &str) -> String {
    let mut n = notification(&format!("subject-{}", event_names(t).len()), app, false);
    n["source_context"] = json!(context);
    n["item_type"] = json!("message");
    n["fields"] = json!("{}");
    n["reply_call"] = json!(reply_call);
    s(&record_notification(t, n)["subject"]).to_owned()
}

#[test]
fn a_subject_key_names_the_app_the_context_and_the_thing() {
    // v1 called the private `subject_key` and `reply_subject` directly; here
    // they are read through the subject a typed notification is given.
    let mut t = app();
    let comment = |id: &str| {
        format!(r#"{{"method":"add_comment","args":{{"issue_id":"{id}","body":"=answer"}}}}"#)
    };
    assert_eq!(
        reply_subject(&mut t, "issue-tracker", "ctx", &comment("issue-1")),
        "issue-tracker:ctx:issue-1"
    );
    // No id among the args: the whole context (a chat, a board).
    assert_eq!(reply_subject(&mut t, "chat", "ctx", REPLY), "chat:ctx");
    // No context, no subject.
    assert_eq!(reply_subject(&mut t, "chat", "", &comment("x")), "");
    // A key that would not fit is no key.
    assert_eq!(
        reply_subject(&mut t, "chat", "ctx", &comment(&"x".repeat(300))),
        ""
    );
    assert_eq!(reply_subject(&mut t, "chat", "ctx", ""), "");
}

#[test]
fn a_comment_on_an_issue_a_task_touched_joins_the_tasks_chain() {
    let mut t = acting_in("issue-tracker");
    let task = record_notification(&mut t, notification("mero-bot:task", "mero-bot", false));
    let chain = s(&task["chain"]).to_owned();
    let write = touched(&mut t, &chain, "issue-7");
    assert_eq!(write["subject"], "issue-tracker:repo-ctx:issue-7");

    let comment = record_notification(&mut t, comment_on("issue-7", "repo-ctx:a>b:0"));
    assert_eq!(comment["chain"], task["chain"], "joined the task");
    assert_eq!(comment["subject"], "issue-tracker:repo-ctx:issue-7");

    let flow = view(&mut t, "chain", json!({ "chain": chain }));
    let flow = flow.as_array().unwrap();
    assert_eq!(flow.len(), 3);
    assert!(flow.iter().any(|i| i["id"] == comment["id"]));
    // The task is one row in the feed, not two.
    let page = feed(&mut t, "all");
    assert_eq!(
        items(&page)
            .iter()
            .filter(|i| i["chain"] == task["chain"])
            .count(),
        1
    );
    // And the write keeps what it touched when read back.
    let read = item(&mut t, s(&write["id"]));
    assert_eq!(read["subject"], write["subject"]);
}
