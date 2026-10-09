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
        chain: String::new(),
        ask: Ask::default(),
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
        chain: String::new(),
        ask: Ask::default(),
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
        .call(|s| s.resolve_action(item.id.clone(), "keep".to_owned(), String::new()))
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
        .call(|s| s.resolve_action(item.id.clone(), "approve".to_owned(), String::new()))
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
        .call(|s| s.resolve_action(item.id.clone(), "approve".to_owned(), String::new()))
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
        .call(|s| s.resolve_action(item.id.clone(), "decline".to_owned(), String::new()))
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
        .call(|s| s.resolve_action(item.id.clone(), "undo".to_owned(), String::new()))
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
        .call(|s| s.resolve_action(fixed.id.clone(), "undo".to_owned(), String::new()))
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

/// Core's state-change event names the context's new ROOT HASH, which depends
/// only on the state's contents. A context that returns to an earlier state
/// (a value set A, then B, then A again) produces the same key a second time,
/// for a change that really happened. Found against a real node: the third
/// write never reached the feed.
#[test]
fn the_same_key_after_the_window_is_a_new_occurrence() {
    let mut app = TestHost::new(Hyperfeed::init);
    let first = app
        .call(|s| s.record_notification(notification("ctx:root-a:0", "kv", false)))
        .unwrap();
    // Age the first sighting past the window: what a later return to the
    // same state looks like.
    app.call(|s| {
        let mut n = s.notifications.get(&first.id)?.expect("recorded").clone();
        n.created_at -= DEDUPE_WINDOW_MS + 1;
        // Remove first: an insert over a live key merges, and the merge keeps
        // the stored `created_at`.
        s.notifications.remove(&first.id)?;
        s.notifications.insert(first.id.clone(), n).map(|_| ())
    })
    .unwrap();
    let second = app
        .call(|s| s.record_notification(notification("ctx:root-a:0", "kv", false)))
        .unwrap();
    assert_ne!(second.id, first.id);
    assert_eq!(second.id, "ctx:root-a:0#1");
    // Another device reporting that same second change inside the window
    // still lands on the same row.
    let again = app
        .call(|s| s.record_notification(notification("ctx:root-a:0", "kv", false)))
        .unwrap();
    assert_eq!(again.id, second.id);
    assert_eq!(feed(&app, "notifications").items.len(), 2);
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
    assert!(
        s.guards
            .iter()
            .find(|g| g.category == "sign")
            .unwrap()
            .enabled
    );
    assert!(
        !s.guards
            .iter()
            .find(|g| g.category == "secret")
            .unwrap()
            .enabled
    );
    assert_eq!(s.owner, AccountId::from(app.account_id()).to_string());
    app.call(|s| s.set_guard("secret".to_owned(), true))
        .unwrap();
    let s = app.view(|s| s.settings()).unwrap();
    assert!(
        s.guards
            .iter()
            .find(|g| g.category == "secret")
            .unwrap()
            .enabled
    );
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
    app.call(|s| s.resolve_action(item.id, "approve".to_owned(), String::new()))
        .unwrap();
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["ActionChanged".to_owned()]);
    app.call(|s| s.set_guard("invite".to_owned(), true))
        .unwrap();
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["SettingsChanged".to_owned()]);
}

// ── chains, histories and answers ───────────────────────────────────────────

fn ask(kind: &str, prompt: &str, options: &[&str], draft: &str) -> Ask {
    Ask {
        kind: kind.to_owned(),
        prompt: prompt.to_owned(),
        options: options.iter().map(|o| (*o).to_owned()).collect(),
        draft: draft.to_owned(),
    }
}

/// A mention arrives; the agent continues its chain with two actions; you
/// approve one. The feed shows ONE row for all of it, led by what needs you.
#[test]
fn a_chain_is_one_row_led_by_what_needs_you() {
    let mut app = acting_in("sheets");
    let mention = app
        .call(|s| s.record_notification(notification("chat:a>b:0", "chat", true)))
        .unwrap();
    let mut kpis = action("sheets", "done");
    kpis.chain = mention.id.clone();
    let kpis = app.call(|s| s.record_action(kpis)).unwrap();
    let mut nda = action("sign", "proposed");
    nda.category = "sign".to_owned();
    nda.chain = mention.id.clone();
    let nda = app.call(|s| s.record_action(nda)).unwrap();
    // An unrelated action is a chain of its own.
    app.call(|s| s.record_action(action("sheets", "done")))
        .unwrap();

    let page = feed(&app, "all");
    assert_eq!(page.counts.all, 2, "two chains");
    let row = page
        .items
        .iter()
        .find(|r| r.chain == mention.id)
        .expect("the mention's chain");
    assert_eq!(row.chain_len, 3);
    assert!(row.needs_you);
    assert_eq!(row.id, nda.id, "the newest step that needs you leads");

    let flow = app.view(|s| s.chain(mention.id.clone())).unwrap();
    let ids: Vec<&str> = flow.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![mention.id.as_str(), kpis.id.as_str(), nda.id.as_str()]
    );
    assert!(flow.iter().all(|i| i.chain_len == 3));
}

#[test]
fn needs_you_and_agent_filters_work_on_chains() {
    let mut app = acting_in("sheets");
    let mention = app
        .call(|s| s.record_notification(notification("chat:a>b:0", "chat", false)))
        .unwrap();
    let mut kpis = action("sheets", "done");
    kpis.chain = mention.id.clone();
    app.call(|s| s.record_action(kpis)).unwrap();
    let page = feed(&app, "agent");
    assert_eq!(
        page.items.len(),
        1,
        "a chain holding an action counts as agent"
    );
    assert_eq!(page.counts.notifications, 1);
    assert_eq!(feed(&app, "needs_you").items.len(), 0);
    let by_app = app
        .view(|s| s.feed("all".to_owned(), "chat".to_owned(), 0, 0))
        .unwrap();
    assert_eq!(by_app.items.len(), 1, "the chain touches chat");
}

#[test]
fn every_step_stays_in_the_history() {
    let mut app = TestHost::new(Hyperfeed::init);
    let item = app
        .call(|s| s.record_action(action("chat", "proposed")))
        .unwrap();
    app.call(|s| s.resolve_action(item.id.clone(), "approve".to_owned(), String::new()))
        .unwrap();
    let done = app
        .call(|s| s.complete_action(item.id.clone(), "done".to_owned(), "sent".to_owned()))
        .unwrap();
    let steps: Vec<&str> = done.history.iter().map(|s| s.status.as_str()).collect();
    assert_eq!(steps, vec![STATUS_PENDING, STATUS_APPROVED, STATUS_DONE]);
    assert!(done.history.windows(2).all(|w| w[0].at < w[1].at));
    assert_eq!(done.note, "sent");
}

#[test]
fn histories_merge_to_the_same_order_everywhere() {
    let a = Step {
        status: "pending".to_owned(),
        note: String::new(),
        at: 1,
    };
    let b = Step {
        status: "approved".to_owned(),
        note: "Fri 10:00".to_owned(),
        at: 5,
    };
    let c = Step {
        status: "done".to_owned(),
        note: "booked".to_owned(),
        at: 9,
    };
    let mut left = vec![a.clone(), c.clone()];
    let mut right = vec![a.clone(), b.clone()];
    merge_history(&mut left, &[a.clone(), b.clone()]);
    merge_history(&mut right, &[a.clone(), c.clone()]);
    assert_eq!(left, right);
    assert_eq!(left, vec![a, b, c]);
}

#[test]
fn a_reply_is_answered_in_the_feed_and_delivered_by_the_agent() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mut input = notification("chat:c>d:0", "chat", true);
    input.ask = ask("reply", "Reply in #launch", &["On it", "After 2pm"], "");
    let n = app.call(|s| s.record_notification(input)).unwrap();
    assert!(n.needs_you);
    assert_eq!(n.status, STATUS_RECEIVED);

    // Seeing it is not answering it.
    app.call(|s| s.mark_seen(vec![n.id.clone()])).unwrap();
    assert!(
        app.view(|s| s.item(n.id.clone()))
            .unwrap()
            .unwrap()
            .needs_you
    );

    assert!(
        app.call(|s| s.answer_notification(n.id.clone(), String::new()))
            .is_err(),
        "a reply needs text"
    );
    let answered = app
        .call(|s| s.answer_notification(n.id.clone(), "Numbers are in the deck.".to_owned()))
        .unwrap();
    assert_eq!(answered.status, STATUS_ANSWERED);
    assert_eq!(answered.note, "Numbers are in the deck.");
    assert!(!answered.needs_you);
    assert!(
        app.call(|s| s.answer_notification(n.id.clone(), "again".to_owned()))
            .is_err(),
        "answered once"
    );

    let delivered = app
        .call(|s| {
            s.complete_answer(
                n.id.clone(),
                "delivered".to_owned(),
                "Sent in #launch".to_owned(),
            )
        })
        .unwrap();
    let steps: Vec<&str> = delivered
        .history
        .iter()
        .map(|s| s.status.as_str())
        .collect();
    assert_eq!(
        steps,
        vec![STATUS_RECEIVED, STATUS_ANSWERED, STATUS_DELIVERED]
    );
}

#[test]
fn a_failed_delivery_needs_you_and_can_be_answered_again() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mut input = notification("vote:e>f:0", "vote", false);
    input.ask = ask(
        "choose",
        "Offsite location",
        &["Lisbon", "Berlin", "Remote"],
        "",
    );
    let n = app.call(|s| s.record_notification(input)).unwrap();
    assert!(
        n.needs_you,
        "an ask needs you whether or not it was flagged"
    );
    assert!(
        app.call(|s| s.answer_notification(n.id.clone(), "Paris".to_owned()))
            .is_err(),
        "not an option"
    );
    app.call(|s| s.answer_notification(n.id.clone(), "Lisbon".to_owned()))
        .unwrap();
    let failed = app
        .call(|s| s.complete_answer(n.id.clone(), "failed".to_owned(), "poll closed".to_owned()))
        .unwrap();
    assert!(failed.needs_you);
    let again = app
        .call(|s| s.answer_notification(n.id.clone(), "Remote".to_owned()))
        .unwrap();
    assert_eq!(again.status, STATUS_ANSWERED);
}

#[test]
fn a_notification_without_an_ask_cannot_be_answered() {
    let mut app = TestHost::new(Hyperfeed::init);
    let n = app
        .call(|s| s.record_notification(notification("kv:a>b:0", "kv", false)))
        .unwrap();
    assert!(app
        .call(|s| s.answer_notification(n.id.clone(), String::new()))
        .is_err());
    assert!(
        app.call(|s| s.complete_answer(n.id.clone(), "delivered".to_owned(), String::new()))
            .is_err(),
        "nothing is waiting on the agent"
    );
}

#[test]
fn a_confirm_takes_no_text() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mut input = notification("cal:a>b:0", "calendar", true);
    input.ask = ask("confirm", "Accept the invite", &[], "");
    let n = app.call(|s| s.record_notification(input)).unwrap();
    assert!(app
        .call(|s| s.answer_notification(n.id.clone(), "yes".to_owned()))
        .is_err());
    let ok = app
        .call(|s| s.answer_notification(n.id.clone(), String::new()))
        .unwrap();
    assert_eq!(ok.status, STATUS_ANSWERED);
}

#[test]
fn a_proposal_with_options_is_approved_with_one_of_them() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mut input = action("calendar", "proposed");
    input.ask = ask("choose", "Pick a slot", &["Thu 15:00", "Fri 10:00"], "");
    let p = app.call(|s| s.record_action(input)).unwrap();
    assert!(
        app.call(|s| s.resolve_action(p.id.clone(), "approve".to_owned(), String::new()))
            .is_err(),
        "pick one"
    );
    let ok = app
        .call(|s| s.resolve_action(p.id.clone(), "approve".to_owned(), "Fri 10:00".to_owned()))
        .unwrap();
    assert_eq!(ok.status, STATUS_APPROVED);
    assert_eq!(ok.note, "Fri 10:00");
}

#[test]
fn a_drafted_reply_is_approved_as_edited() {
    let mut app = acting_in("chat");
    let mut input = action("chat", "proposed");
    input.ask = ask("reply", "Send to Maya", &[], "Numbers are in the deck.");
    let p = app.call(|s| s.record_action(input)).unwrap();
    let ok = app
        .call(|s| {
            s.resolve_action(
                p.id.clone(),
                "approve".to_owned(),
                "Numbers are in the deck, slide 4.".to_owned(),
            )
        })
        .unwrap();
    assert_eq!(ok.note, "Numbers are in the deck, slide 4.");
    // Declining never carries an answer.
    let mut other = action("chat", "proposed");
    other.ask = ask("reply", "Send", &[], "draft");
    let other = app.call(|s| s.record_action(other)).unwrap();
    assert!(app
        .call(|s| s.resolve_action(other.id.clone(), "decline".to_owned(), "no".to_owned()))
        .is_err());
}

#[test]
fn asks_are_validated() {
    let mut app = TestHost::new(Hyperfeed::init);
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
        let mut input = notification("k", "chat", false);
        input.ask = a.clone();
        assert!(app.call(|s| s.record_notification(input)).is_err(), "{a:?}");
    }
    let mut done = action("chat", "done");
    done.ask = ask("confirm", "Go", &[], "");
    assert!(
        app.call(|s| s.record_action(done)).is_err(),
        "asks belong on proposals"
    );
}

#[test]
fn keeping_a_breach_is_stamped() {
    let mut app = TestHost::new(Hyperfeed::init);
    let item = app
        .call(|s| s.record_action(action("chat", "done")))
        .unwrap();
    assert_eq!(item.reviewed_at, 0);
    let kept = app
        .call(|s| s.resolve_action(item.id.clone(), "keep".to_owned(), String::new()))
        .unwrap();
    assert!(kept.reviewed_at > 0);
}
