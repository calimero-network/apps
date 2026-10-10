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
        item_type: String::new(),
        fields: String::new(),
        reply_call: String::new(),
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

// ── talking to your agent ───────────────────────────────────────────────────

fn say(app: &mut TestHost<Hyperfeed>, chain: &str, text: &str) -> FeedItem {
    app.call(|s| s.say(chain.to_owned(), text.to_owned()))
        .expect("say")
}

#[test]
fn a_question_about_a_row_joins_its_chain_and_waits() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mention = app
        .call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    let q = say(&mut app, &mention.chain, "What numbers does Maya mean?");
    assert_eq!(q.kind, KIND_MESSAGE);
    assert_eq!(q.from, FROM_YOU);
    assert_eq!(q.chain, mention.chain);
    assert_eq!(q.status, STATUS_WAITING);
    assert!(!q.needs_you, "your own question never needs you");

    let flow = app.view(|s| s.chain(mention.chain.clone())).unwrap();
    assert_eq!(flow.len(), 2);
    assert_eq!(flow[1].id, q.id);
    assert_eq!(
        app.view(|s| s.open_questions()).unwrap().len(),
        1,
        "an unanswered question is open"
    );
}

#[test]
fn a_question_from_nowhere_starts_its_own_chain() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "What happened in #launch today?");
    assert_eq!(q.chain, q.id);
    let page = feed(&app, "agent");
    assert_eq!(page.items.len(), 1, "a conversation is agent activity");
    assert!(page.apps.is_empty(), "a message names no app");
}

#[test]
fn a_question_into_a_chain_that_does_not_exist_is_refused() {
    let mut app = TestHost::new(Hyperfeed::init);
    let r = app.call(|s| s.say("nope".to_owned(), "hi".to_owned()));
    assert!(r.is_err());
    let r = app.call(|s| s.say(String::new(), "  ".to_owned()));
    assert!(r.is_err(), "an empty message is refused");
    let r = app.call(|s| s.say(String::new(), "x".repeat(MAX_MESSAGE + 1)));
    assert!(r.is_err(), "an oversized message is refused");
}

fn choose(options: &[&str]) -> Ask {
    Ask {
        kind: "choose".to_owned(),
        prompt: "Delete the duplicate?".to_owned(),
        options: options.iter().map(|o| (*o).to_owned()).collect(),
        draft: String::new(),
    }
}

#[test]
fn an_agent_question_needs_you_until_you_answer_it_in_the_chain() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Say hello in #calimero");
    let asked = app
        .call(|s| {
            s.agent_ask(
                q.chain.clone(),
                q.id.clone(),
                "Posted. There are two hellos now: delete the duplicate?".to_owned(),
                choose(&["Delete the duplicate", "Keep both"]),
            )
        })
        .unwrap();
    assert_eq!(asked.status, STATUS_ASKED);
    assert!(asked.needs_you, "an open question is yours to answer");
    assert_eq!(asked.ask.options, vec!["Delete the duplicate", "Keep both"]);
    assert_eq!(
        app.view(|s| s.item(q.id.clone())).unwrap().unwrap().status,
        STATUS_ANSWERED,
        "your message is answered, even though you are asked back"
    );

    // The chain is not done: its question leads it, in what needs you.
    let page = feed(&app, "needs_you");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, asked.id);
    assert_eq!(page.counts.needs_you, 1);

    // Your answer is a message in the chain: it settles the question and goes to your agent.
    let answer = say(&mut app, &q.chain, "Delete the duplicate");
    assert_eq!(answer.status, STATUS_WAITING);
    let settled = app.view(|s| s.item(asked.id.clone())).unwrap().unwrap();
    assert_eq!(settled.status, STATUS_ANSWERED);
    assert_eq!(settled.note, "Delete the duplicate");
    assert!(!settled.needs_you);
    assert_eq!(feed(&app, "needs_you").counts.needs_you, 0);
    assert_eq!(
        app.view(|s| s.open_questions()).unwrap().len(),
        1,
        "your answer waits for your agent"
    );
}

#[test]
fn an_agent_question_is_a_reply_or_a_choice() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "hi");
    let ask_with = |app: &mut TestHost<Hyperfeed>, ask: Ask| {
        app.call(|s| s.agent_ask(q.chain.clone(), String::new(), "?".to_owned(), ask))
    };
    assert!(
        ask_with(&mut app, Ask::default()).is_err(),
        "asking needs a way to answer"
    );
    let confirm = Ask {
        kind: "confirm".to_owned(),
        ..Ask::default()
    };
    assert!(
        ask_with(&mut app, confirm).is_err(),
        "a confirm has no way to say no"
    );
    assert!(
        ask_with(&mut app, choose(&["only one"])).is_err(),
        "a choice needs two options"
    );
    let reply = Ask {
        kind: "reply".to_owned(),
        prompt: "Which channel?".to_owned(),
        ..Ask::default()
    };
    assert_eq!(ask_with(&mut app, reply).unwrap().status, STATUS_ASKED);
}

#[test]
fn a_plain_answer_is_finished_work() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "What time is it in Tokyo?");
    let said = app
        .call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "03:12.".to_owned()))
        .unwrap();
    assert_eq!(said.status, STATUS_SAID);
    assert!(!said.needs_you);
    assert_eq!(feed(&app, "needs_you").items.len(), 0);
}

#[test]
fn the_agent_picks_a_question_up_and_answers_it() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mention = app
        .call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    let q = say(&mut app, &mention.chain, "Make the reply more formal");

    let thinking = app
        .call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    assert_eq!(thinking.status, STATUS_THINKING);

    let answer = app
        .call(|s| {
            s.agent_say(
                mention.chain.clone(),
                q.id.clone(),
                "Here is a more formal draft.".to_owned(),
            )
        })
        .unwrap();
    assert_eq!(answer.from, FROM_AGENT);
    assert_eq!(answer.reply_to, q.id);
    assert_eq!(answer.status, STATUS_SAID);

    let asked = app.view(|s| s.item(q.id.clone())).unwrap().unwrap();
    assert_eq!(
        asked
            .history
            .iter()
            .map(|s| s.status.as_str())
            .collect::<Vec<_>>(),
        vec![STATUS_WAITING, STATUS_THINKING, STATUS_ANSWERED]
    );
    assert!(app.view(|s| s.open_questions()).unwrap().is_empty());

    // The mention still waits on your reply, so it keeps leading the chain;
    // the conversation adds to the chain without hiding what needs you.
    let page = feed(&app, "all");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, mention.id, "what needs you still leads");
    assert_eq!(page.items[0].chain_len, 3);

    // A second answer to the same question is fine and keeps it answered.
    app.call(|s| {
        s.agent_say(
            mention.chain.clone(),
            q.id.clone(),
            "One more thing.".to_owned(),
        )
    })
    .unwrap();
    let asked = app.view(|s| s.item(q.id.clone())).unwrap().unwrap();
    assert_eq!(asked.status, STATUS_ANSWERED);
}

#[test]
fn an_answer_leads_a_chain_that_needs_nothing() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Summarise my morning");
    let a = app
        .call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "Quiet morning.".to_owned()))
        .unwrap();
    let page = feed(&app, "all");
    assert_eq!(page.items[0].id, a.id);
}

#[test]
fn the_agent_can_give_up_on_a_question() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Book the offsite");
    let failed = app
        .call(|s| {
            s.agent_ack(
                q.id.clone(),
                STATUS_FAILED.to_owned(),
                "no calendar access".to_owned(),
            )
        })
        .unwrap();
    assert_eq!(failed.status, STATUS_FAILED);
    assert_eq!(failed.note, "no calendar access");
    assert!(app.view(|s| s.open_questions()).unwrap().is_empty());
    // Nothing more to pick up.
    assert!(app
        .call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .is_err());
}

#[test]
fn answers_are_checked_against_the_question() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "first");
    let other = say(&mut app, "", "second");
    // Wrong chain for that question.
    assert!(app
        .call(|s| s.agent_say(other.chain.clone(), q.id.clone(), "hi".to_owned()))
        .is_err());
    // An agent message is not a question.
    let a = app
        .call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "hi".to_owned()))
        .unwrap();
    assert!(app
        .call(|s| s.agent_say(q.chain.clone(), a.id.clone(), "hi".to_owned()))
        .is_err());
    assert!(app
        .call(|s| s.agent_ack(a.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .is_err());
    // An unprompted note needs a chain that exists.
    assert!(app
        .call(|s| s.agent_say("nope".to_owned(), String::new(), "hi".to_owned()))
        .is_err());
    let note = app
        .call(|s| {
            s.agent_say(
                q.chain.clone(),
                String::new(),
                "Done, booked it.".to_owned(),
            )
        })
        .unwrap();
    assert!(note.reply_to.is_empty());
}

#[test]
fn a_proposal_from_a_conversation_lands_in_its_chain() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Set up a call with Maya");
    let mut proposal = action("calendar", "proposed");
    proposal.chain = q.chain.clone();
    proposal.ask = ask("choose", "Pick a slot", &["12:30", "13:15"], "");
    app.call(|s| s.record_action(proposal)).unwrap();
    app.call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "Two slots work.".to_owned()))
        .unwrap();
    let page = feed(&app, "needs_you");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].kind, KIND_ACTION, "the proposal leads");
    assert_eq!(page.items[0].chain_len, 3);
}

#[test]
fn only_the_owner_talks_to_the_agent() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "hello");
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .say(String::new(), "hi".to_owned()))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.agent_say(q.chain.clone(), q.id.clone(), "hi".to_owned())
        })
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new())
        })
        .is_err());
}

#[test]
fn messages_emit_posted_and_changed() {
    let mut app = TestHost::new(Hyperfeed::init);
    let _ = app.take_events();
    let q = say(&mut app, "", "hello");
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["MessagePosted".to_owned()]);
    app.call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec!["MessageChanged".to_owned()]);
    app.call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "hi".to_owned()))
        .unwrap();
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(
        kinds,
        vec!["MessageChanged".to_owned(), "MessagePosted".to_owned()]
    );
}

#[test]
fn a_long_message_is_titled_by_its_first_line() {
    assert_eq!(headline("Hi\nmore"), "Hi");
    let long = "é".repeat(150); // 300 bytes
    let h = headline(&long);
    assert!(h.len() <= MAX_TITLE);
    assert!(h.ends_with('…'));
}

// ── typed notifications and lenses ───────────────────────────────────────────

fn typed(item_type: &str, fields: &str, reply_call: &str) -> NotificationInput {
    let mut n = notification("chat-ctx:a>b:0", "chat", true);
    n.item_type = item_type.to_owned();
    n.fields = fields.to_owned();
    n.reply_call = reply_call.to_owned();
    n
}

const REPLY: &str =
    r#"{"method":"send_message","args":{"message":"=$answer","parent_message":null}}"#;

#[test]
fn a_typed_notification_carries_its_type_fields_and_reply_call() {
    let mut app = TestHost::new(Hyperfeed::init);
    let fields = r#"{"from":"Maya","text":"numbers?","is_dm":false}"#;
    let n = app
        .call(|s| s.record_notification(typed("message", fields, REPLY)))
        .unwrap();
    assert_eq!(
        (
            n.item_type.as_str(),
            n.fields.as_str(),
            n.reply_call.as_str()
        ),
        ("message", fields, REPLY)
    );
    let row = app.view(|s| s.item(n.id.clone())).unwrap().unwrap();
    assert_eq!(row.item_type, "message");
    let page = app
        .view(|s| s.feed("all".to_owned(), String::new(), 10, 0))
        .unwrap();
    assert_eq!(page.items[0].reply_call, REPLY);
    // Answering keeps them.
    let answered = app
        .call(|s| s.answer_notification(n.id.clone(), String::new()))
        .err();
    assert!(
        answered.is_some(),
        "an untyped ask still decides what an answer is"
    );
}

#[test]
fn an_untyped_notification_reads_as_before() {
    let mut app = TestHost::new(Hyperfeed::init);
    let n = app
        .call(|s| s.record_notification(notification("k", "chat", false)))
        .unwrap();
    assert_eq!((n.item_type.as_str(), n.fields.as_str()), ("", ""));
}

#[test]
fn an_older_client_may_leave_the_typed_fields_out() {
    let input: NotificationInput = calimero_sdk::serde_json::from_str(
        r#"{"key":"k","app":"chat","source_context":"","source_label":"","from":"","title":"t",
            "body":"","event":"","needs_you":false,"chain":"",
            "ask":{"kind":"","prompt":"","options":[],"draft":""}}"#,
    )
    .unwrap();
    assert_eq!(input.item_type, "");
}

#[test]
fn typed_parts_are_checked() {
    let mut app = TestHost::new(Hyperfeed::init);
    for (t, f, r, why) in [
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
        let err = app
            .call(|s| s.record_notification(typed(t, f, r)))
            .unwrap_err();
        let err = format!("{err:?}");
        assert!(err.contains(why), "{t} {f} {r}: {err}");
    }
    let big = format!(r#"{{"text":"{}"}}"#, "x".repeat(MAX_FIELDS));
    assert!(app
        .call(|s| s.record_notification(typed("message", &big, "")))
        .is_err());
}

fn propose(app: &mut TestHost<Hyperfeed>, spec: &str) -> LensView {
    app.call(|s| {
        s.propose_lens(
            "chat".to_owned(),
            "app-1".to_owned(),
            spec.to_owned(),
            "DMs and mentions of you; answers with send_message".to_owned(),
        )
    })
    .unwrap()
}

#[test]
fn a_lens_waits_for_you_then_is_approved() {
    let mut app = TestHost::new(Hyperfeed::init);
    let _ = app.take_events();
    let l = propose(&mut app, r#"{"events":{}}"#);
    assert_eq!(l.status, LENS_PROPOSED);
    let kinds: Vec<String> = app.take_events().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds, ["LensChanged"]);
    let l = app
        .call(|s| s.decide_lens("chat".to_owned(), "app-1".to_owned(), "approve".to_owned()))
        .unwrap();
    assert_eq!(l.status, LENS_APPROVED);
    // Proposing the same lens again changes nothing.
    assert_eq!(propose(&mut app, r#"{"events":{}}"#).status, LENS_APPROVED);
    // A different one waits for you again.
    assert_eq!(
        propose(&mut app, r#"{"events":{"X":"ignore"}}"#).status,
        LENS_PROPOSED
    );
    let all = app.view(|s| s.lenses()).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].spec, r#"{"events":{"X":"ignore"}}"#);
}

#[test]
fn each_app_version_has_its_own_lens() {
    let mut app = TestHost::new(Hyperfeed::init);
    propose(&mut app, "{}");
    app.call(|s| {
        s.propose_lens(
            "chat".to_owned(),
            "app-2".to_owned(),
            "{}".to_owned(),
            "v2".to_owned(),
        )
    })
    .unwrap();
    assert_eq!(app.view(|s| s.lenses()).unwrap().len(), 2);
    let err = app
        .call(|s| s.decide_lens("chat".to_owned(), "app-9".to_owned(), "approve".to_owned()))
        .unwrap_err();
    let err = format!("{err:?}");
    assert!(err.contains("no lens"), "{err}");
}

#[test]
fn a_lens_is_checked_and_only_the_owner_handles_lenses() {
    let mut app = TestHost::new(Hyperfeed::init);
    let err = app
        .call(|s| {
            s.propose_lens(
                "chat".to_owned(),
                "app-1".to_owned(),
                "not json".to_owned(),
                "x".to_owned(),
            )
        })
        .unwrap_err();
    let err = format!("{err:?}");
    assert!(err.contains("spec must be a JSON object"), "{err}");
    propose(&mut app, "{}");
    assert!(app
        .call(|s| s.decide_lens("chat".to_owned(), "app-1".to_owned(), "maybe".to_owned()))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.decide_lens("chat".to_owned(), "app-1".to_owned(), "approve".to_owned())
        })
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.propose_lens(
                "chat".to_owned(),
                "app-1".to_owned(),
                "{}".to_owned(),
                "x".to_owned(),
            )
        })
        .is_err());
}

// ── Archive and presence ─────────────────────────────────────────────────────

fn ms_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[test]
fn an_archived_chain_leaves_the_feed_until_something_new_happens_in_it() {
    let mut app = TestHost::new(Hyperfeed::init);
    let n = app
        .call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    app.call(|s| s.record_notification(notification("k2", "chat", false)))
        .unwrap();
    assert_eq!(feed(&app, "all").items.len(), 2);

    assert_eq!(
        app.call(|s| s.archive(vec![n.chain.clone()], 0)).unwrap(),
        1
    );
    let page = feed(&app, "all");
    assert_eq!(page.items.len(), 1, "the archived chain is gone");
    assert_eq!(page.counts.needs_you, 0, "and counts for nothing");
    assert_eq!(page.counts.archived, 1);
    let archived = feed(&app, "archived");
    assert_eq!(archived.items.len(), 1);
    assert_eq!(archived.items[0].chain, n.chain);

    // You say something in it: it is back.
    app.call(|s| s.say(n.chain.clone(), "About this…".to_owned()))
        .unwrap();
    assert_eq!(feed(&app, "all").items.len(), 2);
    assert!(feed(&app, "archived").items.is_empty());
}

#[test]
fn unarchiving_brings_a_chain_back_and_the_last_decision_wins() {
    let mut app = TestHost::new(Hyperfeed::init);
    let n = app
        .call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    app.call(|s| s.archive(vec![n.chain.clone()], 0)).unwrap();
    app.call(|s| s.unarchive(vec![n.chain.clone()])).unwrap();
    assert_eq!(feed(&app, "needs_you").items.len(), 1);
    app.call(|s| s.archive(vec![n.chain.clone()], 0)).unwrap();
    assert!(feed(&app, "needs_you").items.is_empty());
}

#[test]
fn later_returns_a_chain_when_its_time_comes() {
    let mut app = TestHost::new(Hyperfeed::init);
    let n = app
        .call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    app.call(|s| s.archive(vec![n.chain.clone()], ms_now() + 150))
        .unwrap();
    assert!(feed(&app, "all").items.is_empty());
    std::thread::sleep(std::time::Duration::from_millis(250));
    assert_eq!(feed(&app, "all").items.len(), 1, "back after its time");
}

#[test]
fn archive_refuses_strangers_unknown_chains_and_the_past() {
    let mut app = TestHost::new(Hyperfeed::init);
    let n = app
        .call(|s| s.record_notification(notification("k1", "chat", true)))
        .unwrap();
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.archive(vec![n.chain.clone()], 0))
        .is_err());
    assert!(app.call(|s| s.archive(vec!["nope".to_owned()], 0)).is_err());
    assert!(app.call(|s| s.archive(vec![n.chain.clone()], 1)).is_err());
    assert!(app
        .call(|s| s.archive(vec![n.chain.clone(); MAX_ARCHIVE + 1], 0))
        .is_err());
    assert_eq!(feed(&app, "all").items.len(), 1);
}

#[test]
fn an_agent_reporting_in_shows_in_settings() {
    let mut app = TestHost::new(Hyperfeed::init);
    assert!(app.view(|s| s.settings()).unwrap().agents.is_empty());
    let before = ms_now();
    app.call(|s| s.agent_seen("mero-bot@laptop".to_owned()))
        .unwrap();
    let agents = app.view(|s| s.settings()).unwrap().agents;
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].name, "mero-bot@laptop");
    assert!(agents[0].seen_at >= before);
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.agent_seen("x".to_owned()))
        .is_err());
}
