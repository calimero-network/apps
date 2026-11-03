//! v1's `tests.rs` from `a_comment_on_another_issue_starts_its_own_chain`
//! on: one thread per task, a task's links, push, agents with accounts of
//! their own, drafts you send, actions, situations and defaults.

use calimero_app_sdk::testing::{Failure, TestApp};
use serde_json::{json, Value};

use crate::support::*;

const MAX_KEY: usize = 200;
const MAX_TITLE: usize = 200;
const MAX_LINKS: usize = 30;
const TASK_SUBJECT: &str = "hyperfeed:task:";
const MAX_PUSH_DEVICES: usize = 10;
const SESSION_GRANT: &str = "Allow for this session";
const MAX_SITUATION_SCORE: u32 = 100;
const MAX_AUTORUN_AHEAD_MS: u64 = 7 * 24 * 60 * 60 * 1000;

fn record_action(t: &mut TestApp, input: Value) -> Value {
    call(t, "recordAction", json!({ "input": input }))
}

fn record_notification(t: &mut TestApp, input: Value) -> Value {
    call(t, "recordNotification", json!({ "input": input }))
}

/// A task: a notification from mero-bot, opening its own chain.
fn task_note(t: &mut TestApp, key: &str) -> Value {
    record_notification(t, notification(key, "mero-bot", false))
}

/// v1's `subject_key` for a whole subject.
fn subject_key(app: &str, context: &str, item: &str) -> String {
    format!("{app}:{context}:{item}")
}

fn chain_of(t: &mut TestApp, chain: &Value) -> Vec<Value> {
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

/// `choose(options)` from v1's earlier tests.
fn choose(options: &[&str]) -> Value {
    json!({
        "kind": "choose",
        "prompt": "Delete the duplicate?",
        "options": options,
        "draft": "",
    })
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
fn touched(t: &mut TestApp, chain: &Value, issue: &str) -> Value {
    let mut a = action("issue-tracker", "done");
    a["source_context"] = json!("repo-ctx");
    a["method"] = json!("set_status");
    a["chain"] = chain.clone();
    a["subject"] = json!(subject_key("issue-tracker", "repo-ctx", issue));
    record_action(t, a)
}

#[test]
fn a_comment_on_another_issue_starts_its_own_chain() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    touched(&mut t, &task["chain"], "issue-7");
    let other = record_notification(&mut t, comment_on("issue-8", "repo-ctx:a>b:0"));
    assert_eq!(other["chain"], other["id"]);
    // Nor does one the lens did not make (no reply to tell what it is about).
    let mut plain = comment_on("issue-7", "repo-ctx:b>c:0");
    plain["item_type"] = json!("");
    plain["fields"] = json!("");
    plain["reply_call"] = json!("");
    let plain = record_notification(&mut t, plain);
    assert_eq!(plain["chain"], plain["id"]);
}

#[test]
fn the_latest_task_to_touch_a_subject_gets_its_notifications() {
    let mut t = acting_in("issue-tracker");
    let first = task_note(&mut t, "mero-bot:one");
    let second = task_note(&mut t, "mero-bot:two");
    touched(&mut t, &first["chain"], "issue-7");
    touched(&mut t, &second["chain"], "issue-7");
    let comment = record_notification(&mut t, comment_on("issue-7", "repo-ctx:a>b:0"));
    assert_eq!(comment["chain"], second["chain"]);
}

#[test]
fn a_chain_named_by_the_client_wins_and_a_put_away_task_is_not_reopened() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    let elsewhere = task_note(&mut t, "mero-bot:else");
    touched(&mut t, &task["chain"], "issue-7");

    let mut named = comment_on("issue-7", "repo-ctx:a>b:0");
    named["chain"] = elsewhere["chain"].clone();
    let named = record_notification(&mut t, named);
    assert_eq!(named["chain"], elsewhere["chain"]);

    call(
        &mut t,
        "archive",
        json!({ "chains": [task["chain"]], "until": "0" }),
    );
    let later = record_notification(&mut t, comment_on("issue-7", "repo-ctx:b>c:0"));
    assert_eq!(
        later["chain"], later["id"],
        "a chain you put away stays away"
    );
}

#[test]
fn a_subject_that_does_not_fit_is_refused() {
    let mut t = acting_in("issue-tracker");
    let mut a = action("issue-tracker", "done");
    a["subject"] = json!("x".repeat(MAX_KEY + 1));
    let f = fail(&mut t, "recordAction", json!({ "input": a }));
    assert_invalid(&f, "subject");
}

#[test]
fn a_step_of_a_turn_touches_a_subject_without_a_row() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    let subject = subject_key("issue-tracker", "repo-ctx", "issue-7");
    call(
        &mut t,
        "touchSubject",
        json!({ "chain": task["chain"], "subject": subject }),
    );
    assert_eq!(chain_of(&mut t, &task["chain"]).len(), 1, "no row");
    let comment = record_notification(&mut t, comment_on("issue-7", "repo-ctx:a>b:0"));
    assert_eq!(comment["chain"], task["chain"]);
    // Only into a chain that exists, and only from the owner.
    let f = fail(
        &mut t,
        "touchSubject",
        json!({ "chain": "no-such-chain", "subject": subject }),
    );
    assert_invalid(&f, "");
    let f = fail(
        &mut t,
        "touchSubject",
        json!({ "chain": task["chain"], "subject": "" }),
    );
    assert_invalid(&f, "");
    let f = fail_as(
        &mut t,
        STRANGER,
        "touchSubject",
        json!({ "chain": task["chain"], "subject": subject }),
    );
    assert_forbidden(&f);
}

// ── a task's links ───────────────────────────────────────────────────────────

fn add(
    t: &mut TestApp,
    chain: &Value,
    subject: &str,
    label: &str,
    by: &str,
) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "addLink",
        json!({
            "chain": chain,
            "input": { "subject": subject, "label": label, "by": by },
        }),
    )
}

fn links_of(t: &mut TestApp, chain: &Value) -> Vec<Value> {
    view(t, "links", json!({ "chain": chain }))
        .as_array()
        .expect("links")
        .clone()
}

#[test]
fn what_the_agent_touches_is_linked_to_the_task() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    touched(&mut t, &task["chain"], "issue-7");
    // Links list in the order they were added (then by subject): v1's clock
    // moved between calls, the harness clock moves only when told.
    t.advance(1);
    call(
        &mut t,
        "touchSubject",
        json!({ "chain": task["chain"], "subject": "chat:launch" }),
    );
    // Touching it again keeps one link.
    touched(&mut t, &task["chain"], "issue-7");

    let links = links_of(&mut t, &task["chain"]);
    assert_eq!(links.len(), 2);
    assert_eq!(
        (
            s(&links[0]["app"]),
            s(&links[0]["context"]),
            s(&links[0]["item"]),
            s(&links[0]["by"])
        ),
        ("issue-tracker", "repo-ctx", "issue-7", "agent")
    );
    assert_eq!((s(&links[1]["app"]), s(&links[1]["item"])), ("chat", ""));
    assert_eq!(links[0]["activity"], 0);
}

#[test]
fn a_link_counts_what_teammates_did_there() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    touched(&mut t, &task["chain"], "issue-7");
    let first = record_notification(&mut t, comment_on("issue-7", "repo-ctx:a>b:0"));
    record_notification(&mut t, comment_on("issue-7", "repo-ctx:b>c:0"));
    let link = links_of(&mut t, &task["chain"])[0].clone();
    assert_eq!(link["activity"], 2);
    assert!(link["last_at"].as_u64().unwrap() >= first["at"].as_u64().unwrap());
}

#[test]
fn you_link_a_thing_by_hand_and_what_happens_there_joins_the_task() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    let subject = subject_key("issue-tracker", "repo-ctx", "issue-9");
    let link = add(&mut t, &task["chain"], &subject, "Flaky CI", "you").unwrap();
    assert_eq!(
        (s(&link["label"]), s(&link["by"]), s(&link["item"])),
        ("Flaky CI", "you", "issue-9")
    );
    let comment = record_notification(&mut t, comment_on("issue-9", "repo-ctx:a>b:0"));
    assert_eq!(comment["chain"], task["chain"]);
    // Adding it again relabels it, still one link.
    add(
        &mut t,
        &task["chain"],
        &subject,
        "Flaky CI on main",
        "agent",
    )
    .unwrap();
    let links = links_of(&mut t, &task["chain"]);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["label"], "Flaky CI on main");
}

#[test]
fn a_link_you_take_off_stays_off() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    touched(&mut t, &task["chain"], "issue-7");
    let subject = subject_key("issue-tracker", "repo-ctx", "issue-7");
    call(
        &mut t,
        "removeLink",
        json!({ "chain": task["chain"], "subject": subject }),
    );
    assert!(links_of(&mut t, &task["chain"]).is_empty());

    // Nothing new about it joins the task, and the agent touching it does not bring it back.
    let comment = record_notification(&mut t, comment_on("issue-7", "repo-ctx:a>b:0"));
    assert_eq!(comment["chain"], comment["id"]);
    touched(&mut t, &task["chain"], "issue-7");
    call(
        &mut t,
        "touchSubject",
        json!({ "chain": task["chain"], "subject": subject }),
    );
    assert!(links_of(&mut t, &task["chain"]).is_empty());
    let later = record_notification(&mut t, comment_on("issue-7", "repo-ctx:b>c:0"));
    assert_eq!(later["chain"], later["id"]);

    // Only you bring it back.
    assert_invalid(
        &add(&mut t, &task["chain"], &subject, "", "agent").unwrap_err(),
        "",
    );
    assert!(links_of(&mut t, &task["chain"]).is_empty());
    add(&mut t, &task["chain"], &subject, "", "you").unwrap();
    assert_eq!(links_of(&mut t, &task["chain"]).len(), 1);
}

#[test]
fn a_link_needs_a_real_chain_a_whole_subject_and_the_owner() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    let chain = task["chain"].clone();
    let refused = |t: &mut TestApp, chain: &Value, subject: &str, label: &str, by: &str| {
        add(t, chain, subject, label, by).expect_err("refused")
    };
    assert_invalid(
        &refused(&mut t, &json!("no-such-chain"), "chat:launch", "", "you"),
        "",
    );
    // No context.
    assert_invalid(&refused(&mut t, &chain, "chat", "", "you"), "");
    assert_invalid(&refused(&mut t, &chain, "chat:", "", "you"), "");
    assert_invalid(&refused(&mut t, &chain, "chat:launch", "", "someone"), "");
    assert_invalid(
        &refused(
            &mut t,
            &chain,
            "chat:launch",
            &"x".repeat(MAX_TITLE + 1),
            "you",
        ),
        "",
    );
    let f = fail(
        &mut t,
        "removeLink",
        json!({ "chain": chain, "subject": "chat:launch" }),
    );
    assert_invalid(&f, ""); // not linked
    let f = fail_as(
        &mut t,
        STRANGER,
        "addLink",
        json!({
            "chain": chain,
            "input": { "subject": "chat:launch", "label": "", "by": "you" },
        }),
    );
    assert_forbidden(&f);
}

#[test]
fn a_task_takes_a_bounded_number_of_links() {
    let mut t = acting_in("issue-tracker");
    let task = task_note(&mut t, "mero-bot:task");
    for n in 0..MAX_LINKS {
        add(&mut t, &task["chain"], &format!("chat:ctx-{n}"), "", "you").unwrap();
    }
    assert_invalid(
        &add(&mut t, &task["chain"], "chat:one-more", "", "you").unwrap_err(),
        "",
    );
    // The agent touching one more is not an error: it is just not linked.
    call(
        &mut t,
        "touchSubject",
        json!({ "chain": task["chain"], "subject": "chat:agent-more" }),
    );
    assert_eq!(links_of(&mut t, &task["chain"]).len(), MAX_LINKS);
}

#[test]
fn a_task_started_from_a_chat_gets_its_own_chain_and_both_link_each_other() {
    let mut t = acting_in("issue-tracker");
    let chat = call(
        &mut t,
        "say",
        json!({ "chain": "", "text": "Plan the roadmap\nwatches, safe merge, checkpoints" }),
    );
    let task = call(
        &mut t,
        "startTask",
        json!({
            "from": chat["chain"],
            "text": "Build safe merge: merge only green PRs on main.",
            "headline": "Safe merge",
        }),
    );
    // Your message opens a chain of its own, waiting for your agent.
    assert_eq!(task["chain"], task["id"]);
    assert_ne!(task["chain"], chat["chain"]);
    assert_eq!((s(&task["from"]), s(&task["status"])), ("you", "waiting"));
    let open = open_questions(&mut t);
    assert!(open.iter().any(|m| m["id"] == task["id"]));

    let on_chat = links_of(&mut t, &chat["chain"]);
    assert_eq!(on_chat.len(), 1);
    assert_eq!(
        (
            s(&on_chat[0]["subject"]),
            s(&on_chat[0]["app"]),
            s(&on_chat[0]["context"]),
            s(&on_chat[0]["label"])
        ),
        (
            format!("{TASK_SUBJECT}{}", s(&task["chain"])).as_str(),
            "hyperfeed",
            "task",
            "Safe merge"
        )
    );
    let on_task = links_of(&mut t, &task["chain"]);
    assert_eq!(on_task.len(), 1);
    assert_eq!(
        (
            s(&on_task[0]["context"]),
            s(&on_task[0]["item"]),
            s(&on_task[0]["label"])
        ),
        ("from", s(&chat["chain"]), "Plan the roadmap")
    );

    // Without a headline the task is named by its first line.
    let second = call(
        &mut t,
        "startTask",
        json!({ "from": chat["chain"], "text": "Checkpoints\nper task" }),
    );
    let on_chat = links_of(&mut t, &chat["chain"]);
    assert_eq!(on_chat.len(), 2);
    assert!(on_chat
        .iter()
        .any(|l| l["item"] == second["chain"] && l["label"] == "Checkpoints"));
}

#[test]
fn a_task_needs_a_real_chat_a_message_and_the_owner() {
    let mut t = acting_in("issue-tracker");
    let chat = call(&mut t, "say", json!({ "chain": "", "text": "Plan" }));
    let f = fail(
        &mut t,
        "startTask",
        json!({ "from": "no-such-chain", "text": "X" }),
    );
    assert_invalid(&f, "");
    let f = fail(
        &mut t,
        "startTask",
        json!({ "from": chat["chain"], "text": "" }),
    );
    assert_invalid(&f, "");
    let f = fail(
        &mut t,
        "startTask",
        json!({ "from": chat["chain"], "text": "X", "headline": "a\nb" }),
    );
    assert_invalid(&f, "");
    let f = fail_as(
        &mut t,
        STRANGER,
        "startTask",
        json!({ "from": chat["chain"], "text": "X" }),
    );
    assert_forbidden(&f);
    // A chat full of links starts no task, and writes nothing.
    for n in 0..MAX_LINKS {
        add(&mut t, &chat["chain"], &format!("chat:ctx-{n}"), "", "you").unwrap();
    }
    let before = open_questions(&mut t).len();
    let f = fail(
        &mut t,
        "startTask",
        json!({ "from": chat["chain"], "text": "One more" }),
    );
    assert_invalid(&f, "");
    assert_eq!(open_questions(&mut t).len(), before);
}

// ── push to your phone ───────────────────────────────────────────────────────

const VAPID: &str =
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const VAPID_2: &str =
    "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

fn phone(endpoint: &str, key: &str) -> Value {
    json!({
        "endpoint": endpoint,
        "p256dh": "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oQhFpFHw3Lvo",
        "auth": "8eDyX_uCN0XRhSbY5hs7Hg",
        "name": "Sandi's phone",
        "quiet": false,
        "key": key,
    })
}

fn set_push_key(t: &mut TestApp, key: &str, by: &str) -> Value {
    call(t, "setPushKey", json!({ "publicKey": key, "by": by }))
}

fn add_device(t: &mut TestApp, device: Value) -> Result<Value, Failure> {
    t.as_(OWNER)
        .call("addPushDevice", json!({ "input": device }))
}

fn devices(t: &mut TestApp) -> Vec<Value> {
    view(t, "pushDevices", json!({}))
        .as_array()
        .expect("devices")
        .clone()
}

#[test]
fn a_phone_subscribes_with_the_runtimes_key_and_is_listed() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "pushKey", json!({})),
        json!({ "public_key": "", "by": "", "updated_at": 0 })
    );
    // No key yet: nothing to subscribe with.
    let f = add_device(
        &mut t,
        phone("https://fcm.googleapis.com/fcm/send/a", VAPID),
    )
    .unwrap_err();
    assert_invalid(&f, "");

    let key = set_push_key(&mut t, VAPID, "mero-bot@laptop");
    assert_eq!(key["public_key"], VAPID);
    let d = add_device(
        &mut t,
        phone("https://fcm.googleapis.com/fcm/send/a", VAPID),
    )
    .unwrap();
    assert_eq!(d["name"], "Sandi's phone");
    // Adding it again updates it; still one device.
    t.advance(1_000);
    let mut quiet = phone("https://fcm.googleapis.com/fcm/send/a", VAPID);
    quiet["quiet"] = json!(true);
    add_device(&mut t, quiet).unwrap();
    let list = devices(&mut t);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["quiet"], true);
    assert_eq!(list[0]["added_at"], d["added_at"]);
}

#[test]
fn a_subscription_made_with_an_old_key_is_refused_and_a_new_key_drops_devices() {
    let mut t = app();
    set_push_key(&mut t, VAPID, "a");
    add_device(&mut t, phone("https://web.push.apple.com/x", VAPID)).unwrap();
    set_push_key(&mut t, VAPID_2, "b");
    assert!(devices(&mut t).is_empty());
    let f = add_device(&mut t, phone("https://web.push.apple.com/x", VAPID)).unwrap_err();
    assert_invalid(&f, "old push key");
    add_device(&mut t, phone("https://web.push.apple.com/x", VAPID_2)).unwrap();
    assert_eq!(devices(&mut t).len(), 1);
}

#[test]
fn a_device_comes_off_and_bad_subscriptions_are_refused() {
    let mut t = app();
    set_push_key(&mut t, VAPID, "a");
    add_device(&mut t, phone("https://push.example/1", VAPID)).unwrap();
    call(
        &mut t,
        "removePushDevice",
        json!({ "endpoint": "https://push.example/1" }),
    );
    assert!(devices(&mut t).is_empty());
    // Taking off one that is not there is fine.
    call(
        &mut t,
        "removePushDevice",
        json!({ "endpoint": "https://push.example/none" }),
    );

    let f = add_device(&mut t, phone("http://push.example/plain", VAPID)).unwrap_err();
    assert_invalid(&f, "");
    let mut bad = phone("https://push.example/2", VAPID);
    bad["auth"] = json!("not base64!");
    assert_invalid(&add_device(&mut t, bad).unwrap_err(), "base64url");
    let f = fail(
        &mut t,
        "setPushKey",
        json!({ "publicKey": "has spaces", "by": "a" }),
    );
    assert_invalid(&f, "");
}

#[test]
fn only_the_owner_sets_the_key_or_adds_devices() {
    let mut t = app();
    let f = fail_as(
        &mut t,
        STRANGER,
        "setPushKey",
        json!({ "publicKey": VAPID, "by": "a" }),
    );
    assert_forbidden(&f);
    set_push_key(&mut t, VAPID, "a");
    let f = fail_as(
        &mut t,
        STRANGER,
        "addPushDevice",
        json!({ "input": phone("https://push.example/s", VAPID) }),
    );
    assert_forbidden(&f);
    // The owner's phone is the owner: v1's second device of the owner's
    // account is an API key acting for it.
    t.api_key("phone", OWNER)
        .call(
            "addPushDevice",
            json!({ "input": phone("https://push.example/p", VAPID) }),
        )
        .expect("the owner's phone adds itself");
}

#[test]
fn at_most_ten_devices_the_oldest_makes_room() {
    let mut t = app();
    set_push_key(&mut t, VAPID, "a");
    for i in 0..=MAX_PUSH_DEVICES {
        t.advance(1);
        add_device(&mut t, phone(&format!("https://push.example/{i}"), VAPID)).unwrap();
    }
    let list = devices(&mut t);
    assert_eq!(list.len(), MAX_PUSH_DEVICES);
    assert!(!list
        .iter()
        .any(|d| d["endpoint"] == "https://push.example/0"));
}

// ── agents with accounts of their own, and drafts you send ──────────────────

// v1's CLOUD account (signing from its CLOUD_DEVICE) is `agentbot`, added
// under the name "cloud".
const CLOUD: &str = AGENT;

fn with_cloud_agent() -> TestApp {
    let mut t = acting_in("chat");
    add_agent(&mut t, "cloud");
    t
}

#[test]
fn an_agent_you_did_not_add_cannot_write_to_your_feed() {
    let mut t = acting_in("chat");
    // A member of the context is not an agent of the feed.
    let f = fail_as(
        &mut t,
        CLOUD,
        "recordAction",
        json!({ "input": action("chat", "done") }),
    );
    assert_forbidden(&f);
    let f = fail_as(&mut t, CLOUD, "agentSeen", json!({ "name": "cloud" }));
    assert_forbidden(&f);
}

#[test]
fn an_agent_you_added_works_the_agents_side_as_itself() {
    let mut t = with_cloud_agent();
    let item = call_as(
        &mut t,
        CLOUD,
        "recordAction",
        json!({ "input": action("chat", "done") }),
    );
    assert_eq!(item["status"], "done");
    // It reports in under its own name.
    call_as(&mut t, CLOUD, "agentSeen", json!({ "name": "cloud" }));
    // It speaks only as the name you added it under.
    let f = fail_as(
        &mut t,
        CLOUD,
        "agentSeen",
        json!({ "name": "mero-bot@laptop" }),
    );
    assert_forbidden(&f);

    let settings = view(&mut t, "settings", json!({}));
    let accounts = settings["agent_accounts"].as_array().unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0]["account"], CLOUD);
    assert_eq!(accounts[0]["name"], "cloud");
}

#[test]
fn what_decides_for_you_stays_yours() {
    let mut t = with_cloud_agent();
    let proposal = call_as(
        &mut t,
        CLOUD,
        "recordAction",
        json!({ "input": action("chat", "proposed") }),
    );
    // It cannot approve its own proposal.
    let f = fail_as(
        &mut t,
        CLOUD,
        "resolveAction",
        json!({ "id": proposal["id"], "decision": "approve", "answer": "" }),
    );
    assert_forbidden(&f);
    // It cannot set its own mode.
    let f = fail_as(
        &mut t,
        CLOUD,
        "setPolicy",
        json!({ "appKey": "chat", "agent": "act", "notifications": "feed" }),
    );
    assert_forbidden(&f);
    // It cannot add agents.
    let f = fail_as(
        &mut t,
        CLOUD,
        "addAgentAccount",
        json!({ "account": STRANGER, "name": "friend" }),
    );
    assert_forbidden(&f);
    // It cannot write as you.
    let f = fail_as(&mut t, CLOUD, "say", json!({ "chain": "", "text": "hi" }));
    assert_forbidden(&f);
}

#[test]
fn a_removed_agent_is_refused_and_its_name_is_free_again() {
    let mut t = with_cloud_agent();
    call(&mut t, "removeAgentAccount", json!({ "account": CLOUD }));
    let f = fail_as(
        &mut t,
        CLOUD,
        "recordAction",
        json!({ "input": action("chat", "done") }),
    );
    assert_forbidden(&f);
    let settings = view(&mut t, "settings", json!({}));
    assert!(settings["agent_accounts"].as_array().unwrap().is_empty());
    // The name is free.
    call(
        &mut t,
        "addAgentAccount",
        json!({ "account": STRANGER, "name": "cloud" }),
    );
}

#[test]
fn two_agent_accounts_cannot_share_a_name() {
    let mut t = with_cloud_agent();
    let f = fail(
        &mut t,
        "addAgentAccount",
        json!({ "account": STRANGER, "name": "cloud" }),
    );
    assert_invalid(&f, "");
    // Your own account is not an agent account.
    let f = fail(
        &mut t,
        "addAgentAccount",
        json!({ "account": OWNER, "name": "me" }),
    );
    assert_invalid(&f, "your own account");
}

fn draft(app: &str) -> Value {
    let mut a = action(app, "proposed");
    a["title"] = json!("Reply to Maya");
    a["ask"] = json!({
        "kind": "reply",
        "prompt": "Send this?",
        "options": [],
        "draft": "Numbers are in the sheet.",
    });
    a["send_call"] = json!(r#"{"method":"send_message","args":{"message":"=answer"}}"#);
    a
}

#[test]
fn a_draft_you_send_is_yours_to_send_and_report() {
    let mut t = with_cloud_agent();
    // Read only: the agent may not write in chat, and may still draft for you.
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "chat", "agent": "read", "notifications": "feed" }),
    );
    let item = call_as(
        &mut t,
        CLOUD,
        "recordAction",
        json!({ "input": draft("chat") }),
    );
    assert_eq!(item["status"], "pending");
    assert!(s(&item["reply_call"]).contains("send_message"));
    assert_eq!(
        item["undoable"], false,
        "the agent undoes what it did, and it did not send this"
    );
    let row = view(&mut t, "item", json!({ "id": item["id"] }));
    assert_eq!(
        row["reply_call"], item["reply_call"],
        "the row carries the call your client makes"
    );

    call(
        &mut t,
        "resolveAction",
        json!({ "id": item["id"], "decision": "approve", "answer": "Sent you the numbers." }),
    );
    // The agent never reports a send it did not make.
    let f = fail_as(
        &mut t,
        CLOUD,
        "completeAction",
        json!({ "id": item["id"], "outcome": "done", "note": "" }),
    );
    assert!(
        matches!(err(&f).0.as_str(), "Invalid" | "Forbidden"),
        "{f:?}"
    );
    // Your client reports it.
    let done = call(
        &mut t,
        "completeAction",
        json!({ "id": item["id"], "outcome": "done", "note": "Sent in #launch" }),
    );
    assert_eq!(done["status"], "done");
}

#[test]
fn a_send_call_must_be_a_call_on_a_proposal() {
    let mut t = with_cloud_agent();
    let mut done = draft("chat");
    done["outcome"] = json!("done");
    done["ask"] = ask_none();
    assert_invalid(&fail(&mut t, "recordAction", json!({ "input": done })), "");
    for bad in [
        "not json",
        r#"{"args":{}}"#,
        r#"{"method":"send_message","args":[]}"#,
    ] {
        let mut d = draft("chat");
        d["send_call"] = json!(bad);
        let f = fail(&mut t, "recordAction", json!({ "input": d }));
        assert_eq!(err(&f).0, "Invalid", "{bad}");
    }
}

// ── Actions ──────────────────────────────────────────────────────────────────

fn act_def(id: &str, label: &str, category: &str, writes: bool, methods: &[&str]) -> Value {
    json!({
        "id": id,
        "label": label,
        "description": "",
        "category": category,
        "writes": writes,
        "methods": methods,
    })
}

/// Chat's actions, as an agent would learn them from its ABI.
fn chat_actions() -> Vec<Value> {
    vec![
        act_def(
            "read",
            "Read messages",
            "",
            false,
            &["get_messages", "search"],
        ),
        act_def(
            "send",
            "Send messages",
            "",
            true,
            &["send_message", "reply"],
        ),
        act_def("edit", "Edit your messages", "", true, &["edit_message"]),
        act_def(
            "delete",
            "Delete your messages",
            "delete",
            true,
            &["delete_message"],
        ),
    ]
}

fn propose_actions(
    t: &mut TestApp,
    app_key: &str,
    version: &str,
    actions: Vec<Value>,
    summary: &str,
) -> Result<Value, Failure> {
    t.as_(OWNER).call(
        "proposeActions",
        json!({
            "appKey": app_key,
            "applicationId": version,
            "actions": actions,
            "summary": summary,
        }),
    )
}

fn decide_actions(t: &mut TestApp, app_key: &str, version: &str, decision: &str) {
    call(
        t,
        "decideActions",
        json!({ "appKey": app_key, "applicationId": version, "decision": decision }),
    );
}

fn approve_actions(t: &mut TestApp, version: &str, actions: Vec<Value>) {
    propose_actions(t, "chat", version, actions, "Chat").unwrap();
    decide_actions(t, "chat", version, "approve");
}

fn check(t: &mut TestApp, method: &str, category: &str, writes: bool) -> Value {
    view(
        t,
        "checkAction",
        json!({ "appKey": "chat", "category": category, "writes": writes, "method": method }),
    )
}

fn set_action_mode(t: &mut TestApp, action: &str, mode: &str) {
    call(
        t,
        "setActionMode",
        json!({ "appKey": "chat", "action": action, "mode": mode }),
    );
}

#[test]
fn approved_actions_decide_what_a_call_is() {
    let mut t = acting_in("chat");
    // Before you approve anything, the agent's word is taken.
    assert_eq!(check(&mut t, "delete_message", "", true)["decision"], "act");

    propose_actions(&mut t, "chat", "app-1", chat_actions(), "Chat").unwrap();
    // A proposal changes nothing until you approve it.
    assert_eq!(check(&mut t, "delete_message", "", true)["decision"], "act");

    decide_actions(&mut t, "chat", "app-1", "approve");
    // The action's guard applies, whatever category the agent named.
    let v = check(&mut t, "delete_message", "", true);
    assert_eq!(v["decision"], "ask");
    assert!(s(&v["reason"]).contains("\"delete\""), "{}", v["reason"]);
    // An action with no guard of its own keeps the one the agent names: only
    // the agent knows the person is new.
    assert_eq!(
        check(&mut t, "send_message", "new_contact", true)["decision"],
        "ask"
    );
    assert_eq!(check(&mut t, "send_message", "", true)["decision"], "act");
    // A reading action runs, even when the agent says it writes.
    assert_eq!(check(&mut t, "search", "", true)["decision"], "act");
    // A method no action names asks every time, even when said to only read.
    let v = check(&mut t, "drop_channel", "", false);
    assert_eq!(v["decision"], "ask");
    assert!(
        s(&v["reason"]).contains("isn't one of chat's actions"),
        "{}",
        v["reason"]
    );
    // An agent that names no method is judged by what it says.
    let v = view(
        &mut t,
        "checkAction",
        json!({ "appKey": "chat", "category": "", "writes": true, "method": null }),
    );
    assert_eq!(v["decision"], "act");

    // Doing an undescribed thing without asking is a breach, and the row
    // records what the actions say it was.
    let mut input = action("chat", "done");
    input["method"] = json!("drop_channel");
    let item = record_action(&mut t, input);
    assert!(
        s(&item["breach"]).starts_with("acted without asking"),
        "{}",
        item["breach"]
    );
    let mut input = action("chat", "done");
    input["method"] = json!("delete_message");
    let item = record_action(&mut t, input);
    assert_eq!(item["category"], "delete");
    assert_ne!(item["breach"], "");
}

#[test]
fn each_action_can_be_set_apart_from_its_app() {
    let mut t = app(); // "chat" defaults to ask
    approve_actions(&mut t, "app-1", chat_actions());
    assert_eq!(check(&mut t, "edit_message", "", true)["decision"], "ask");

    set_action_mode(&mut t, "edit", "act");
    let v = check(&mut t, "edit_message", "", true);
    assert_eq!(v["decision"], "act");
    assert!(
        s(&v["reason"]).contains("Edit your messages"),
        "{}",
        v["reason"]
    );
    // The others still follow the app.
    assert_eq!(check(&mut t, "send_message", "", true)["decision"], "ask");

    // A guard still wins over an action you let act.
    set_action_mode(&mut t, "delete", "act");
    assert_eq!(check(&mut t, "delete_message", "", true)["decision"], "ask");

    // Off refuses, so a proposal for it is an error.
    set_action_mode(&mut t, "send", "off");
    assert_eq!(
        check(&mut t, "send_message", "", true)["decision"],
        "refuse"
    );
    let f = fail(
        &mut t,
        "recordAction",
        json!({ "input": action("chat", "proposed") }),
    );
    assert_invalid(&f, "you turned off");

    // Ask on an app that acts.
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "chat", "agent": "act", "notifications": "feed" }),
    );
    set_action_mode(&mut t, "send", "ask");
    assert_eq!(check(&mut t, "send_message", "", true)["decision"], "ask");
    assert_eq!(check(&mut t, "reply", "", true)["decision"], "ask");

    // Empty follows the app again, and settings lists only what you set.
    set_action_mode(&mut t, "send", "");
    assert_eq!(check(&mut t, "send_message", "", true)["decision"], "act");
    let settings = view(&mut t, "settings", json!({}));
    let set: Vec<(String, String)> = settings["action_modes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (s(&m["action"]).to_owned(), s(&m["mode"]).to_owned()))
        .collect();
    assert_eq!(
        set,
        vec![
            ("delete".to_owned(), "act".to_owned()),
            ("edit".to_owned(), "act".to_owned())
        ]
    );
}

#[test]
fn the_newest_approved_actions_stay_in_force_while_new_ones_wait() {
    let mut t = acting_in("chat");
    approve_actions(&mut t, "app-1", chat_actions());

    // Version 2 moves delete_message out of any action.
    let mut v2 = chat_actions();
    v2.pop();
    propose_actions(&mut t, "chat", "app-2", v2, "v2").unwrap();
    assert_eq!(check(&mut t, "delete_message", "", true)["decision"], "ask");
    assert!(s(&check(&mut t, "delete_message", "", true)["reason"]).contains("\"delete\""));

    decide_actions(&mut t, "chat", "app-2", "reject");
    assert!(s(&check(&mut t, "delete_message", "", true)["reason"]).contains("\"delete\""));

    decide_actions(&mut t, "chat", "app-2", "approve");
    let v = check(&mut t, "delete_message", "", true);
    assert!(
        s(&v["reason"]).contains("isn't one of chat's actions"),
        "{}",
        v["reason"]
    );

    let sets = view(&mut t, "actionSets", json!({}));
    let sets = sets.as_array().unwrap();
    assert_eq!(sets.len(), 2);
    assert_eq!(sets[0]["application_id"], "app-2");
}

#[test]
fn actions_are_checked_and_only_the_owner_handles_them() {
    let mut t = app();
    let propose =
        |t: &mut TestApp, actions: Vec<Value>| propose_actions(t, "chat", "app-1", actions, "x");
    let twice = vec![
        act_def("a", "A", "", true, &["m"]),
        act_def("b", "B", "", true, &["m"]),
    ];
    assert_invalid(&propose(&mut t, twice).unwrap_err(), "is in two actions");
    let bad_guard = vec![act_def("a", "A", "lunch", true, &["m"])];
    assert_invalid(&propose(&mut t, bad_guard).unwrap_err(), "");
    assert_invalid(&propose(&mut t, Vec::new()).unwrap_err(), "");
    let no_methods = vec![act_def("a", "A", "", true, &[])];
    assert_invalid(&propose(&mut t, no_methods).unwrap_err(), "");

    propose(&mut t, chat_actions()).unwrap();
    let f = fail(
        &mut t,
        "setActionMode",
        json!({ "appKey": "chat", "action": "send", "mode": "read" }),
    );
    assert_invalid(&f, "");
    let f = fail_as(
        &mut t,
        STRANGER,
        "decideActions",
        json!({ "appKey": "chat", "applicationId": "app-1", "decision": "approve" }),
    );
    assert_forbidden(&f);
    let f = fail_as(
        &mut t,
        STRANGER,
        "setActionMode",
        json!({ "appKey": "chat", "action": "send", "mode": "act" }),
    );
    assert_forbidden(&f);
    let f = fail_as(
        &mut t,
        STRANGER,
        "proposeActions",
        json!({
            "appKey": "chat",
            "applicationId": "app-1",
            "actions": chat_actions(),
            "summary": "x",
        }),
    );
    assert_forbidden(&f);
}

#[test]
fn a_session_grant_covers_one_action() {
    let mut t = app(); // "chat" defaults to ask
    approve_actions(&mut t, "app-1", chat_actions());
    let mut input = action("chat", "proposed");
    input["ask"] = choose(&["Allow once", SESSION_GRANT]);
    let proposal = record_action(&mut t, input);
    call(
        &mut t,
        "resolveAction",
        json!({ "id": proposal["id"], "decision": "approve", "answer": SESSION_GRANT }),
    );

    // Sending again under it is fine; editing is another action.
    let mut send = action("chat", "done");
    send["method"] = json!("reply");
    send["grant"] = proposal["id"].clone();
    assert_eq!(record_action(&mut t, send)["breach"], "");
    let mut edit = action("chat", "done");
    edit["method"] = json!("edit_message");
    edit["grant"] = proposal["id"].clone();
    assert_ne!(record_action(&mut t, edit)["breach"], "");

    // A grant also covers an action you set to ask in an app that acts.
    call(
        &mut t,
        "setPolicy",
        json!({ "appKey": "chat", "agent": "act", "notifications": "feed" }),
    );
    set_action_mode(&mut t, "send", "ask");
    let mut send = action("chat", "done");
    send["grant"] = proposal["id"].clone();
    assert_eq!(record_action(&mut t, send)["breach"], "");
}

#[test]
fn a_guard_covers_reads_too() {
    let mut t = acting_in("pass");
    let read_secret = |t: &mut TestApp| {
        view(
            t,
            "checkAction",
            json!({ "appKey": "pass", "category": "secret", "writes": false }),
        )
    };
    // Off by default: reading a secret is a read like any other.
    assert_eq!(read_secret(&mut t)["decision"], "act");

    call(
        &mut t,
        "setGuard",
        json!({ "category": "secret", "enabled": true }),
    );
    let v = read_secret(&mut t);
    assert_eq!(v["decision"], "ask");
    assert!(s(&v["reason"]).contains("\"secret\""), "{}", v["reason"]);

    // The same through an action that only reads but names the guard.
    propose_actions(
        &mut t,
        "pass",
        "pass-1",
        vec![act_def(
            "secrets",
            "Read secrets",
            "secret",
            false,
            &["get_secret"],
        )],
        "Pass",
    )
    .unwrap();
    decide_actions(&mut t, "pass", "pass-1", "approve");
    let v = view(
        &mut t,
        "checkAction",
        json!({ "appKey": "pass", "category": "", "writes": false, "method": "get_secret" }),
    );
    assert_eq!(v["decision"], "ask");

    // Other reads still run.
    let v = view(
        &mut t,
        "checkAction",
        json!({ "appKey": "pass", "category": "", "writes": false }),
    );
    assert_eq!(v["decision"], "act");
}

// ── situations and defaults ──────────────────────────────────────────────────

fn situation(headline: &str) -> Value {
    json!({
        "headline": headline,
        "summary": "Ronit, Maya and two others agreed to ship Thursday.",
        "recommend": "Confirm Thursday and move the review to Friday 10:00.",
        "reason": "Ronit needs your yes before the memo at 16:00.",
        "score": 90,
        "due_at": 1_800_000_000_000_u64,
        "sources": 7,
        "apps": 3,
        "author": "mero-bot@studio",
    })
}

fn set_situation(t: &mut TestApp, chain: &Value, input: Value) -> Result<Value, Failure> {
    t.as_(OWNER)
        .call("setSituation", json!({ "chain": chain, "input": input }))
}

fn situations(t: &mut TestApp) -> Vec<Value> {
    view(t, "situations", json!({}))
        .as_array()
        .expect("situations")
        .clone()
}

#[test]
fn a_situation_tells_a_chain_as_one_card_and_the_next_one_replaces_it() {
    let mut t = app();
    let n = record_notification(&mut t, notification("k1", "chat", true));
    let first = set_situation(&mut t, &n["chain"], situation("Launch date: Thursday")).unwrap();
    assert_eq!(first["chain"], n["chain"]);
    assert_eq!(first["score"], 90);
    let second = set_situation(&mut t, &n["chain"], situation("Launch date: settled")).unwrap();
    assert!(second["updated_at"].as_u64() > first["updated_at"].as_u64());
    let all = situations(&mut t);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0]["headline"], "Launch date: settled");
    assert_eq!(
        call(&mut t, "clearSituation", json!({ "chain": n["chain"] })),
        true
    );
    assert!(situations(&mut t).is_empty());
}

#[test]
fn a_situation_needs_a_chain_a_headline_and_a_summary_within_the_limits() {
    let mut t = app();
    let n = record_notification(&mut t, notification("k1", "chat", true));
    let chain = n["chain"].clone();
    assert_invalid(
        &set_situation(&mut t, &json!("no-such-chain"), situation("x")).unwrap_err(),
        "",
    );
    let mut empty = situation("Launch");
    empty["summary"] = json!(" ");
    assert_invalid(&set_situation(&mut t, &chain, empty).unwrap_err(), "");
    let mut loud = situation("Launch");
    loud["score"] = json!(MAX_SITUATION_SCORE + 1);
    assert_invalid(&set_situation(&mut t, &chain, loud).unwrap_err(), "");
    let two_lines = situation("Launch\ndate");
    assert_invalid(&set_situation(&mut t, &chain, two_lines).unwrap_err(), "");
    let f = fail_as(
        &mut t,
        STRANGER,
        "setSituation",
        json!({ "chain": chain, "input": situation("Launch") }),
    );
    assert_forbidden(&f);
}

fn reply_proposal() -> Value {
    let mut input = action("chat", "proposed");
    input["title"] = json!("Reply to Jordan with the contract terms");
    input["ask"] = json!({
        "kind": "reply",
        "prompt": "Send to Jordan",
        "options": [],
        "draft": "Hi Jordan, terms are attached.",
    });
    input
}

fn schedule(t: &mut TestApp, id: &Value, at: u64) -> Result<Value, Failure> {
    t.as_(OWNER)
        .call("scheduleAutorun", json!({ "id": id, "at": at.to_string() }))
}

fn fire(t: &mut TestApp, id: &Value) -> Result<Value, Failure> {
    t.as_(OWNER).call("fireAutorun", json!({ "id": id }))
}

fn autoruns(t: &mut TestApp) -> Vec<Value> {
    view(t, "autoruns", json!({}))
        .as_array()
        .expect("autoruns")
        .clone()
}

fn status_of(t: &mut TestApp, id: &Value) -> Value {
    view(t, "item", json!({ "id": id }))["status"].clone()
}

// v1 slept on the wall clock (`wait_past`); the harness clock is moved
// instead. Every test starts at `T0`, which is v1's `now(&app)`.

#[test]
fn a_default_goes_ahead_at_its_time_with_its_draft_as_the_answer() {
    let mut t = app();
    let p = record_action(&mut t, reply_proposal());
    let at = T0 + 40;
    let v = schedule(&mut t, &p["id"], at).unwrap();
    assert_eq!(v["status"], "waiting");
    assert_eq!(v["chain"], p["chain"]);
    // Not before its time.
    assert_invalid(
        &fire(&mut t, &p["id"]).unwrap_err(),
        "its time has not come",
    );
    t.set_time(at + 5);
    let fired = fire(&mut t, &p["id"]).unwrap();
    assert_eq!(fired["status"], "approved");
    assert_eq!(fired["note"], "Hi Jordan, terms are attached.");
    assert_eq!(autoruns(&mut t)[0]["status"], "fired");
    // Once.
    assert_invalid(&fire(&mut t, &p["id"]).unwrap_err(), "");
}

#[test]
fn a_default_you_stopped_never_goes_ahead() {
    let mut t = app();
    let p = record_action(&mut t, reply_proposal());
    let at = T0 + 30;
    schedule(&mut t, &p["id"], at).unwrap();
    let f = fail_as(&mut t, STRANGER, "stopAutorun", json!({ "id": p["id"] }));
    assert_forbidden(&f);
    let stopped = call(&mut t, "stopAutorun", json!({ "id": p["id"] }));
    assert_eq!(stopped["status"], "stopped");
    t.set_time(at + 5);
    assert_invalid(&fire(&mut t, &p["id"]).unwrap_err(), "");
    // Setting it again does not undo your stop.
    let later = at + 5 + 60_000;
    assert_invalid(
        &schedule(&mut t, &p["id"], later).unwrap_err(),
        "you stopped",
    );
    assert_eq!(status_of(&mut t, &p["id"]), "pending");
}

#[test]
fn a_default_is_only_for_what_could_be_undone_with_no_guard() {
    let mut t = app();
    let later = T0 + 60_000;
    let mut signing = reply_proposal();
    signing["category"] = json!("sign");
    let signing = record_action(&mut t, signing);
    assert_invalid(&schedule(&mut t, &signing["id"], later).unwrap_err(), "");
    let mut final_one = reply_proposal();
    final_one["undoable"] = json!(false);
    let final_one = record_action(&mut t, final_one);
    assert_invalid(&schedule(&mut t, &final_one["id"], later).unwrap_err(), "");
    let mut choice = action("chat", "proposed");
    choice["ask"] = json!({
        "kind": "choose",
        "prompt": "Pick a slot",
        "options": ["12:30", "13:15"],
        "draft": "",
    });
    let choice = record_action(&mut t, choice);
    assert_invalid(&schedule(&mut t, &choice["id"], later).unwrap_err(), "");
    let ok = record_action(&mut t, reply_proposal());
    assert_invalid(&schedule(&mut t, &ok["id"], T0).unwrap_err(), "");
    assert_invalid(
        &schedule(&mut t, &ok["id"], T0 + MAX_AUTORUN_AHEAD_MS + 60_000).unwrap_err(),
        "",
    );
    schedule(&mut t, &ok["id"], later).unwrap();
}

#[test]
fn a_default_checks_the_rules_again_when_its_time_comes() {
    let mut t = app();
    let p = record_action(&mut t, reply_proposal());
    let at = T0 + 30;
    schedule(&mut t, &p["id"], at).unwrap();
    call(&mut t, "setPaused", json!({ "paused": true }));
    t.set_time(at + 5);
    assert_invalid(&fire(&mut t, &p["id"]).unwrap_err(), "paused");
    assert_eq!(status_of(&mut t, &p["id"]), "pending");
    // You deciding first settles it.
    call(&mut t, "setPaused", json!({ "paused": false }));
    call(
        &mut t,
        "resolveAction",
        json!({ "id": p["id"], "decision": "decline", "answer": "" }),
    );
    assert_eq!(autoruns(&mut t)[0]["status"], "settled");
    assert_invalid(&fire(&mut t, &p["id"]).unwrap_err(), "");
}

/// Replaces v1's `a_stop_wins_over_a_later_schedule_when_copies_merge`: under
/// one log the stop comes first and the later schedule is refused, so the
/// default stays stopped.
#[test]
fn a_stop_wins_over_a_later_schedule() {
    let mut t = app();
    let p = record_action(&mut t, reply_proposal());
    schedule(&mut t, &p["id"], T0 + 100).unwrap();
    t.advance(10);
    call(&mut t, "stopAutorun", json!({ "id": p["id"] }));
    t.advance(10);
    assert_invalid(
        &schedule(&mut t, &p["id"], T0 + 500).unwrap_err(),
        "you stopped",
    );
    let all = autoruns(&mut t);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0]["at"], T0 + 100);
    assert_eq!(all[0]["status"], "stopped");
}
