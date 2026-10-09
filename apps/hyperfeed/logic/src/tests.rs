//! These drive `Hyperfeed` through `TestHost`: real CRDT state, no node.

use calimero_sdk::testing::TestHost;

use super::*;

const STRANGER: [u8; 32] = [0xE0; 32];
const PHONE: [u8; 32] = [0xA2; 32];

fn action(app: &str, outcome: &str) -> ActionInput {
    ActionInput {
        app: app.to_owned(),
        source_context: "ctx-1".to_owned(),
        source_label: "#launch".to_owned(),
        method: "send_message".to_owned(),
        category: String::new(),
        writes: true,
        undoable: true,
        title: "Posted your stand-up".to_owned(),
        body: String::new(),
        why: "Daily routine you set up.".to_owned(),
        outcome: outcome.to_owned(),
        intent_hash: "a91f3c07".to_owned(),
        executor: "relay-account".to_owned(),
        note: String::new(),
    }
}

fn notification(key: &str, app: &str, needs_you: bool) -> NotificationInput {
    NotificationInput {
        key: key.to_owned(),
        app: app.to_owned(),
        source_context: "ctx-2".to_owned(),
        source_label: "#launch".to_owned(),
        from: "Maya".to_owned(),
        title: "Mentioned you".to_owned(),
        body: "Can your agent pull the numbers?".to_owned(),
        event: "MessageSent".to_owned(),
        needs_you,
    }
}

fn acting_in(app_key: &str) -> TestHost<Hyperfeed> {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.set_policy(app_key.to_owned(), "act".to_owned(), "feed".to_owned()))
        .expect("set policy");
    app
}

fn feed(app: &TestHost<Hyperfeed>, filter: &str) -> FeedPage {
    app.view(|s| s.feed(filter.to_owned(), String::new(), 0, 0))
        .expect("feed")
}

#[test]
fn an_unknown_app_asks_first() {
    let app = TestHost::new(Hyperfeed::init);
    let v = app
        .view(|s| s.check_action("chat".to_owned(), String::new(), true))
        .unwrap();
    assert_eq!(v.decision, "ask");
    // Reading is fine anywhere the agent is not switched off.
    let v = app
        .view(|s| s.check_action("chat".to_owned(), String::new(), false))
        .unwrap();
    assert_eq!(v.decision, "act");
}

#[test]
fn an_action_the_rules_allow_is_recorded_done() {
    let mut app = acting_in("chat");
    let item = app
        .call(|s| s.record_action(action("chat", "done")))
        .unwrap();
    assert_eq!(item.status, STATUS_DONE);
    assert!(item.breach.is_empty());
    assert!(!item.needs_you);
    assert_eq!(item.intent_hash, "a91f3c07");
}

#[test]
fn a_guard_turns_act_into_ask() {
    let mut app = acting_in("sign");
    let mut input = action("sign", "proposed");
    input.category = "sign".to_owned();
    let v = app
        .view(|s| s.check_action("sign".to_owned(), "sign".to_owned(), true))
        .unwrap();
    assert_eq!(v.decision, "ask");
    let item = app.call(|s| s.record_action(input)).unwrap();
    assert_eq!(item.status, STATUS_PENDING);
    assert!(item.needs_you);

    // With the guard off, the same app's mode decides.
    app.call(|s| s.set_guard("sign".to_owned(), false)).unwrap();
    let v = app
        .view(|s| s.check_action("sign".to_owned(), "sign".to_owned(), true))
        .unwrap();
    assert_eq!(v.decision, "act");
}

#[test]
fn acting_without_asking_is_recorded_as_a_breach_until_kept() {
    let mut app = TestHost::new(Hyperfeed::init); // "chat" defaults to ask
    let item = app
        .call(|s| s.record_action(action("chat", "done")))
        .unwrap();
    assert_eq!(item.status, STATUS_DONE);
    assert!(item.breach.starts_with("acted without asking"));
    assert!(item.needs_you);
    assert_eq!(feed(&app, "needs_you").items.len(), 1);

    let kept = app
        .call(|s| s.resolve_action(item.id.clone(), "keep".to_owned()))
        .unwrap();
    assert!(kept.breach.is_empty());
    assert!(!kept.needs_you);
    assert_eq!(feed(&app, "needs_you").items.len(), 0);
}

#[test]
fn a_proposal_where_the_agent_is_off_is_refused() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.set_policy("crm".to_owned(), "off".to_owned(), "feed".to_owned()))
        .unwrap();
    let err = app
        .call(|s| s.record_action(action("crm", "proposed")))
        .unwrap_err();
    assert!(format!("{err:?}").contains("off in crm"), "{err:?}");
    // But an outcome is never dropped: it is the one you most need to see.
    let item = app
        .call(|s| s.record_action(action("crm", "done")))
        .unwrap();
    assert!(item.breach.starts_with("acted where it may not"));
}

#[test]
fn read_only_refuses_writes_but_not_reads() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.set_policy("pass".to_owned(), "read".to_owned(), "feed".to_owned()))
        .unwrap();
    let mut read = action("pass", "done");
    read.writes = false;
    read.category = "secret".to_owned();
    let item = app.call(|s| s.record_action(read)).unwrap();
    assert!(item.breach.is_empty());
    assert!(app
        .call(|s| s.record_action(action("pass", "proposed")))
        .is_err());
}

#[test]
fn pausing_makes_every_write_a_proposal() {
    let mut app = acting_in("chat");
    app.call(|s| s.set_paused(true)).unwrap();
    let v = app
        .view(|s| s.check_action("chat".to_owned(), String::new(), true))
        .unwrap();
    assert_eq!(
        v,
        Verdict {
            decision: "ask".to_owned(),
            reason: "your agent is paused".to_owned()
        }
    );
    assert!(app.view(|s| s.settings()).unwrap().paused);
    app.call(|s| s.set_paused(false)).unwrap();
    let v = app
        .view(|s| s.check_action("chat".to_owned(), String::new(), true))
        .unwrap();
    assert_eq!(v.decision, "act");
}

#[test]
fn approve_then_the_agent_completes() {
    let mut app = TestHost::new(Hyperfeed::init);
    let item = app
        .call(|s| s.record_action(action("chat", "proposed")))
        .unwrap();
    // Nothing is waiting on the agent until you decide.
    assert!(app
        .call(|s| s.complete_action(item.id.clone(), "done".to_owned(), String::new()))
        .is_err());

    let approved = app
        .call(|s| s.resolve_action(item.id.clone(), "approve".to_owned()))
        .unwrap();
    assert_eq!(approved.status, STATUS_APPROVED);
    assert!(!approved.needs_you);

    let done = app
        .call(|s| s.complete_action(item.id.clone(), "done".to_owned(), "sent".to_owned()))
        .unwrap();
    assert_eq!(done.status, STATUS_DONE);
    assert_eq!(done.note, "sent");
}

#[test]
fn a_failure_can_be_retried_or_declined() {
    let mut app = acting_in("crm");
    let mut input = action("crm", "failed");
    input.note = "no write grant in Sales".to_owned();
    let item = app.call(|s| s.record_action(input)).unwrap();
    assert_eq!(item.status, STATUS_FAILED);
    assert!(item.needs_you);

    let retrying = app
        .call(|s| s.resolve_action(item.id.clone(), "approve".to_owned()))
        .unwrap();
    assert_eq!(retrying.status, STATUS_RETRYING);
    let failed = app
        .call(|s| {
            s.complete_action(
                item.id.clone(),
                "failed".to_owned(),
                "still no grant".to_owned(),
            )
        })
        .unwrap();
    assert_eq!(failed.status, STATUS_FAILED);
    let declined = app
        .call(|s| s.resolve_action(item.id.clone(), "decline".to_owned()))
        .unwrap();
    assert_eq!(declined.status, STATUS_DECLINED);
    assert!(!declined.needs_you);
}

#[test]
fn undo_is_requested_and_only_for_undoable_actions() {
    let mut app = acting_in("chat");
    let item = app
        .call(|s| s.record_action(action("chat", "done")))
        .unwrap();
    let asked = app
        .call(|s| s.resolve_action(item.id.clone(), "undo".to_owned()))
        .unwrap();
    assert_eq!(asked.status, STATUS_UNDO_REQUESTED);
    let undone = app
        .call(|s| s.complete_action(item.id.clone(), "done".to_owned(), String::new()))
        .unwrap();
    assert_eq!(undone.status, STATUS_UNDONE);

    let mut fixed = action("chat", "done");
    fixed.undoable = false;
    let fixed = app.call(|s| s.record_action(fixed)).unwrap();
    assert!(app
        .call(|s| s.resolve_action(fixed.id.clone(), "undo".to_owned()))
        .is_err());
}

#[test]
fn a_notification_is_recorded_once_per_key() {
    let mut app = TestHost::new(Hyperfeed::init);
    let _ = app.take_events();
    app.call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    assert_eq!(app.take_events().len(), 1);
    app.call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    assert!(app.take_events().is_empty(), "a repeat is silent");
    let page = feed(&app, "all");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.counts.needs_you, 1);
}

#[test]
fn seen_notifications_stop_needing_you() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    app.call(|s| s.record_notification(notification("k2", "issues", false)))
        .unwrap();
    assert_eq!(
        app.call(|s| s.mark_seen(vec!["k1".to_owned(), "nope".to_owned()]))
            .unwrap(),
        1
    );
    assert_eq!(feed(&app, "needs_you").items.len(), 0);
    assert_eq!(app.call(|s| s.mark_all_seen()).unwrap(), 1);
    assert_eq!(app.call(|s| s.mark_all_seen()).unwrap(), 0);
    let seen = app.view(|s| s.item("k2".to_owned())).unwrap().unwrap();
    assert!(seen.seen);
}

#[test]
fn a_muted_app_drops_out_of_the_feed_and_comes_back() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.record_notification(notification("k1", "vote", false)))
        .unwrap();
    app.call(|s| s.set_policy("vote".to_owned(), "off".to_owned(), "mute".to_owned()))
        .unwrap();
    assert_eq!(feed(&app, "all").counts.all, 0);
    app.call(|s| s.set_policy("vote".to_owned(), "off".to_owned(), "feed".to_owned()))
        .unwrap();
    assert_eq!(feed(&app, "all").counts.all, 1);
}

#[test]
fn the_feed_filters_counts_and_pages() {
    let mut app = acting_in("chat");
    for i in 0..3 {
        app.call(|s| s.record_notification(notification(&format!("k{i}"), "issues", false)))
            .unwrap();
    }
    app.call(|s| s.record_action(action("chat", "done")))
        .unwrap();

    let page = feed(&app, "all");
    assert_eq!(page.counts.all, 4);
    assert_eq!(page.counts.agent, 1);
    assert_eq!(page.counts.notifications, 3);
    assert_eq!(
        page.apps[0],
        AppCount {
            app: "issues".to_owned(),
            count: 3
        }
    );
    assert_eq!(feed(&app, "agent").items.len(), 1);
    assert_eq!(feed(&app, "notifications").items.len(), 3);

    let only_chat = app
        .view(|s| s.feed("all".to_owned(), "chat".to_owned(), 0, 0))
        .unwrap();
    assert_eq!(only_chat.items.len(), 1);
    // Counts describe the whole feed, not the narrowed view.
    assert_eq!(only_chat.counts.all, 4);

    assert!(app
        .view(|s| s.feed("everything".to_owned(), String::new(), 0, 0))
        .is_err());
}

#[test]
fn only_the_owner_writes() {
    let mut app = acting_in("chat");
    let refused = app.call_as_account(STRANGER, STRANGER, |s| {
        s.record_action(action("chat", "done"))
    });
    assert!(refused.is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.set_paused(true))
        .is_err());
    // The owner's second device is the owner.
    let r = app.call_as(PHONE, |s| s.record_action(action("chat", "done")));
    assert!(r.is_ok(), "{r:?}");
}

#[test]
fn inputs_are_validated() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mut bad = action("Chat App", "done");
    assert!(app.call(|s| s.record_action(bad.clone())).is_err());
    bad.app = "chat".to_owned();
    bad.outcome = "maybe".to_owned();
    assert!(app.call(|s| s.record_action(bad.clone())).is_err());
    bad.outcome = "done".to_owned();
    bad.category = "everything".to_owned();
    assert!(app.call(|s| s.record_action(bad.clone())).is_err());
    bad.category = String::new();
    bad.title = "x".repeat(MAX_TITLE + 1);
    assert!(app.call(|s| s.record_action(bad)).is_err());
    assert!(app
        .call(|s| s.set_policy("chat".to_owned(), "sometimes".to_owned(), "feed".to_owned()))
        .is_err());
}

#[test]
fn settings_list_policies_and_every_guard() {
    let mut app = acting_in("chat");
    let s = app.view(|s| s.settings()).unwrap();
    assert_eq!(s.policies.len(), 1);
    assert_eq!(s.guards.len(), GUARDS.len());
    assert!(s.guards.iter().find(|g| g.category == "sign").unwrap().on);
    assert!(!s.guards.iter().find(|g| g.category == "secret").unwrap().on);
    assert_eq!(s.owner, AccountId::from(app.account_id()).to_string());
    app.call(|s| s.set_guard("secret".to_owned(), true))
        .unwrap();
    let s = app.view(|s| s.settings()).unwrap();
    assert!(s.guards.iter().find(|g| g.category == "secret").unwrap().on);
}

#[test]
fn every_change_emits_one_event() {
    let mut app = TestHost::new(Hyperfeed::init);
    let _ = app.take_events();
    let item = app
        .call(|s| s.record_action(action("chat", "proposed")))
        .unwrap();
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["ActionRecorded".to_owned()]);
    app.call(|s| s.resolve_action(item.id, "approve".to_owned()))
        .unwrap();
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["ActionChanged".to_owned()]);
    app.call(|s| s.set_guard("invite".to_owned(), true))
        .unwrap();
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["SettingsChanged".to_owned()]);
}
