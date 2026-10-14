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
        grant: String::new(),
        subject: String::new(),
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
        .view(|s| s.check_action("chat".to_owned(), String::new(), true, None))
        .unwrap();
    assert_eq!(v.decision, "ask");
    // Reading is fine anywhere the agent is not switched off.
    let v = app
        .view(|s| s.check_action("chat".to_owned(), String::new(), false, None))
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
        .view(|s| s.check_action("sign".to_owned(), "sign".to_owned(), true, None))
        .unwrap();
    assert_eq!(v.decision, "ask");
    let item = app.call(|s| s.record_action(input)).unwrap();
    assert_eq!(item.status, STATUS_PENDING);
    assert!(item.needs_you);

    // With the guard off, the same app's mode decides.
    app.call(|s| s.set_guard("sign".to_owned(), false)).unwrap();
    let v = app
        .view(|s| s.check_action("sign".to_owned(), "sign".to_owned(), true, None))
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
        .view(|s| s.check_action("chat".to_owned(), String::new(), true, None))
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
        .view(|s| s.check_action("chat".to_owned(), String::new(), true, None))
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
    app.call(|s| s.say(chain.to_owned(), text.to_owned(), None, None))
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
    let r = app.call(|s| s.say("nope".to_owned(), "hi".to_owned(), None, None));
    assert!(r.is_err());
    let r = app.call(|s| s.say(String::new(), "  ".to_owned(), None, None));
    assert!(r.is_err(), "an empty message is refused");
    let r = app.call(|s| s.say(String::new(), "x".repeat(MAX_MESSAGE + 1), None, None));
    assert!(r.is_err(), "an oversized message is refused");
}

#[test]
fn a_message_says_how_private_it_is() {
    let mut app = TestHost::new(Hyperfeed::init);
    let public = app
        .call(|s| {
            s.say(
                String::new(),
                "Fix the flaky test".to_owned(),
                None,
                Some("public".to_owned()),
            )
        })
        .unwrap();
    assert_eq!(public.mode, "public");
    let next = app
        .call(|s| {
            s.say(
                public.chain.clone(),
                "And open a PR".to_owned(),
                None,
                Some("private".to_owned()),
            )
        })
        .unwrap();
    assert_eq!(next.mode, "private", "each message keeps its own");

    let plain = say(&mut app, "", "What happened today?");
    assert_eq!(plain.mode, "", "a message sent without a mode has none");
    let empty = app
        .call(|s| s.say(String::new(), "Hi".to_owned(), None, Some(String::new())))
        .unwrap();
    assert_eq!(empty.mode, "", "an empty mode is none");

    let flow = app.view(|s| s.chain(public.chain.clone())).unwrap();
    let modes: Vec<&str> = flow.iter().map(|i| i.mode.as_str()).collect();
    assert_eq!(
        modes,
        ["public", "private"],
        "read back the same in the chain"
    );
    assert!(
        app.view(|s| s.settings()).unwrap().message_modes.is_empty(),
        "no mode is offered: which agent takes your work is set per app"
    );

    let r = app.call(|s| s.say(String::new(), "Hi".to_owned(), None, Some("act".to_owned())));
    assert!(r.is_err(), "a mode outside MESSAGE_MODES is refused");
    let r = app.call(|s| {
        s.say_with(
            String::new(),
            "look".to_owned(),
            vec![image(&"ab".repeat(32))],
            None,
            Some("PRIVATE".to_owned()),
        )
    });
    assert!(r.is_err(), "modes are exact");
}

#[test]
fn you_set_what_an_agent_reaches_and_it_reports_what_it_can() {
    let mut app = TestHost::new(Hyperfeed::init);
    let agent = "mero-bot@laptop".to_owned();
    let work = Folder {
        path: "~/workspace/calimero".to_owned(),
        write: true,
    };
    let docs = Folder {
        path: "/Users/me/Documents".to_owned(),
        write: false,
    };
    app.call(|s| s.set_access(agent.clone(), vec![work.clone(), docs.clone()], true, false))
        .unwrap();
    let set = app.view(|s| s.settings()).unwrap().access;
    assert_eq!(set.len(), 1);
    assert_eq!(set[0].agent, agent);
    assert_eq!(set[0].folders, [work.clone(), docs]);
    assert!(set[0].shell && !set[0].web);

    // The latest write wins: narrowing replaces the folders.
    app.call(|s| s.set_access(agent.clone(), vec![work.clone()], false, false))
        .unwrap();
    let set = app.view(|s| s.settings()).unwrap().access;
    assert_eq!(set[0].folders, std::slice::from_ref(&work));
    assert!(!set[0].shell);

    for bad in ["relative/path", "~user/x", "/a/../b", ""] {
        let f = Folder {
            path: bad.to_owned(),
            write: false,
        };
        let r = app.call(|s| s.set_access(agent.clone(), vec![f], false, false));
        assert!(r.is_err(), "{bad:?} is refused");
    }
    let many = (0..=MAX_FOLDERS)
        .map(|i| Folder {
            path: format!("/f{i}"),
            write: false,
        })
        .collect();
    assert!(app
        .call(|s| s.set_access(agent.clone(), many, false, false))
        .is_err());

    let line = ReachLine {
        serves: "public".to_owned(),
        profile: "claude".to_owned(),
        model: String::new(),
        attested: false,
        folders: vec![work],
        shell: false,
        web: false,
    };
    app.call(|s| s.agent_reach(agent.clone(), vec![line.clone()]))
        .unwrap();
    let reach = app.view(|s| s.settings()).unwrap().reach;
    assert_eq!(reach.len(), 1);
    assert_eq!(reach[0].lines, [line]);

    let r = app.call_as_account(STRANGER, STRANGER, |s| {
        s.set_access(agent.clone(), Vec::new(), true, true)
    });
    assert!(r.is_err(), "only the owner sets what an agent reaches");
}

#[test]
fn you_assign_an_app_to_an_agent_and_can_give_it_back() {
    let mut app = TestHost::new(Hyperfeed::init);
    assert!(
        app.view(|s| s.settings()).unwrap().assignments.is_empty(),
        "a new feed assigns nothing: every app is the default agent's"
    );
    let laptop = "mero-bot@laptop".to_owned();
    app.call(|s| s.set_assignment("mero-bot".to_owned(), laptop.clone()))
        .unwrap();
    app.call(|s| s.set_assignment("chat".to_owned(), laptop.clone()))
        .unwrap();
    let set = app.view(|s| s.settings()).unwrap().assignments;
    let apps: Vec<(&str, &str)> = set
        .iter()
        .map(|a| (a.app.as_str(), a.agent.as_str()))
        .collect();
    assert_eq!(
        apps,
        [("chat", laptop.as_str()), ("mero-bot", laptop.as_str())]
    );

    // The latest write wins, and an empty agent gives the app back.
    app.call(|s| s.set_assignment("chat".to_owned(), String::new()))
        .unwrap();
    let set = app.view(|s| s.settings()).unwrap().assignments;
    assert_eq!(set.len(), 1);
    assert_eq!(set[0].app, "mero-bot");

    assert!(
        app.call(|s| s.set_assignment("Not An App".to_owned(), laptop.clone()))
            .is_err(),
        "an app key is checked like a policy's"
    );
    let r = app.call_as_account(STRANGER, STRANGER, |s| {
        s.set_assignment("chat".to_owned(), "mero-bot@theirs".to_owned())
    });
    assert!(r.is_err(), "only the owner assigns an app");
}

fn choose(options: &[&str]) -> Ask {
    Ask {
        kind: "choose".to_owned(),
        prompt: "Delete the duplicate?".to_owned(),
        options: options.iter().map(|o| (*o).to_owned()).collect(),
        draft: String::new(),
    }
}

fn image(blob_id: &str) -> Attachment {
    Attachment {
        blob_id: blob_id.to_owned(),
        name: "screenshot.png".to_owned(),
        mime: "image/png".to_owned(),
        size: 48_213,
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
                None,
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
        app.call(|s| s.agent_ask(q.chain.clone(), String::new(), "?".to_owned(), ask, None))
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
        .call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "03:12.".to_owned(), None))
        .unwrap();
    assert_eq!(said.status, STATUS_SAID);
    assert!(!said.needs_you);
    assert_eq!(feed(&app, "needs_you").items.len(), 0);
}

#[test]
fn your_agent_shows_its_latest_step_while_it_works_without_adding_rows() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Fix the chat list");
    let early = app.call(|s| s.agent_progress(q.id.clone(), "Reading ChatView.tsx".to_owned()));
    assert!(
        early.is_err(),
        "nothing to show before your agent has taken it up"
    );

    app.call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    app.call(|s| s.agent_progress(q.id.clone(), "Reading ChatView.tsx".to_owned()))
        .unwrap();
    let row = app
        .call(|s| s.agent_progress(q.id.clone(), "Running the tests".to_owned()))
        .unwrap();
    assert_eq!(
        row.doing, "Running the tests",
        "the latest step replaces the last"
    );
    assert!(row.doing_at > 0);
    assert_eq!(
        row.history.len(),
        2,
        "steps are not history: waiting, thinking"
    );
    let open = app.view(|s| s.open_questions()).unwrap();
    assert_eq!(open[0].doing, "Running the tests");

    app.call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "Fixed.".to_owned(), None))
        .unwrap();
    let answered = app.view(|s| s.item(q.id.clone())).unwrap().unwrap();
    assert_eq!(answered.doing, "", "an answered message shows no step");
    assert!(app
        .call(|s| s.agent_progress(q.id.clone(), "Still going".to_owned()))
        .is_err());
    assert!(app
        .call(|s| s.agent_progress(q.id.clone(), " ".to_owned()))
        .is_err());
}

#[test]
fn a_message_carries_its_images_wherever_it_is_read() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = app
        .call(|s| {
            s.say_with(
                String::new(),
                "What is this error?".to_owned(),
                vec![image(&"ab".repeat(32)), image(&"cd".repeat(32))],
                None,
                None,
            )
        })
        .unwrap();
    assert_eq!(q.attachments.len(), 2);
    assert_eq!(q.attachments[0].blob_id, "ab".repeat(32));

    let read = app.view(|s| s.item(q.id.clone())).unwrap().unwrap();
    assert_eq!(read.attachments, q.attachments);
    let open = app.view(|s| s.open_questions()).unwrap();
    assert_eq!(
        open[0].attachments, q.attachments,
        "the agent sees the images it is asked about"
    );
    let flow = app.view(|s| s.chain(q.chain.clone())).unwrap();
    assert_eq!(flow[0].attachments, q.attachments);

    // The agent picking it up keeps the images on the row.
    let thinking = app
        .call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    assert_eq!(thinking.attachments, q.attachments);
}

#[test]
fn an_image_alone_is_a_message() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = app
        .call(|s| {
            s.say_with(
                String::new(),
                String::new(),
                vec![image(&"ab".repeat(32))],
                None,
                None,
            )
        })
        .unwrap();
    assert_eq!(q.title, "Sent an image");
    assert_eq!(q.body, "");
    let r = app.call(|s| s.say_with(String::new(), String::new(), Vec::new(), None, None));
    assert!(r.is_err(), "no text and no image is still empty");
}

#[test]
fn attachments_outside_their_limits_are_refused() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mut try_one = |a: Attachment| {
        app.call(|s| s.say_with(String::new(), "look".to_owned(), vec![a], None, None))
    };
    let pdf = Attachment {
        mime: "application/pdf".to_owned(),
        ..image("ab")
    };
    assert!(try_one(pdf).is_err(), "only images");
    let huge = Attachment {
        size: MAX_IMAGE_BYTES + 1,
        ..image("ab")
    };
    assert!(try_one(huge).is_err(), "at most 10 MiB");
    let empty = Attachment {
        size: 0,
        ..image("ab")
    };
    assert!(try_one(empty).is_err(), "an empty file is no image");
    assert!(
        try_one(image("../etc")).is_err(),
        "a blob id is letters and digits"
    );
    assert!(try_one(image("")).is_err(), "a blob id is required");
    let r = app.call(|s| {
        s.say_with(
            String::new(),
            "look".to_owned(),
            vec![image("ab"); MAX_ATTACHMENTS + 1],
            None,
            None,
        )
    });
    assert!(r.is_err(), "at most four");
}

fn turn_step(id: &str, title: &str, status: &str) -> TurnStep {
    TurnStep {
        id: id.to_owned(),
        title: title.to_owned(),
        status: status.to_owned(),
        at: 1,
    }
}

#[test]
fn your_agent_attaches_its_steps_and_draft_to_your_message_without_adding_rows() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Fix the chat list");
    let early = app.call(|s| s.agent_work(q.id.clone(), vec![], String::new()));
    assert!(early.is_err(), "nothing to attach before it is taken up");

    app.call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    app.call(|s| {
        s.agent_work(
            q.id.clone(),
            vec![turn_step("t1", "Reading ChatView.tsx", "running")],
            String::new(),
        )
    })
    .unwrap();
    let row = app
        .call(|s| {
            s.agent_work(
                q.id.clone(),
                vec![
                    turn_step("t1", "Reading ChatView.tsx", "done"),
                    turn_step("t2", "Running the tests", "running"),
                ],
                "The list now".to_owned(),
            )
        })
        .unwrap();
    assert_eq!(row.steps.len(), 2, "each report replaces the last");
    assert_eq!(row.steps[0].status, "done");
    assert_eq!(row.draft, "The list now");
    assert_eq!(row.history.len(), 2, "steps are not history");
    assert_eq!(
        feed(&app, "all").items.len(),
        1,
        "the turn adds no rows to the feed"
    );

    app.call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "Fixed.".to_owned(), None))
        .unwrap();
    let answered = app.view(|s| s.item(q.id.clone())).unwrap().unwrap();
    assert_eq!(answered.steps.len(), 2, "the steps stay with the message");
    assert_eq!(answered.draft, "", "the answer replaces the draft");

    let odd = vec![turn_step("t9", "Something", "sleeping")];
    assert!(app
        .call(|s| s.agent_work(q.id.clone(), odd.clone(), String::new()))
        .is_err());
    let too_many: Vec<TurnStep> = (0..=MAX_HISTORY)
        .map(|i| turn_step(&format!("t{i}"), "Step", "done"))
        .collect();
    assert!(app
        .call(|s| s.agent_work(q.id.clone(), too_many.clone(), String::new()))
        .is_err());
}

#[test]
fn you_stop_a_turn_your_agent_is_working_on() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Refactor everything");
    app.call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    let asked = app.call(|s| s.stop(q.id.clone())).unwrap();
    assert_eq!(asked.status, STATUS_THINKING, "your agent ends the turn");
    assert!(asked.stop_at > 0);
    let again = app.call(|s| s.stop(q.id.clone())).unwrap();
    assert_eq!(again.stop_at, asked.stop_at, "asking twice changes nothing");

    let stopped = app
        .call(|s| {
            s.agent_ack(
                q.id.clone(),
                STATUS_FAILED.to_owned(),
                STOPPED_BY_YOU.to_owned(),
            )
        })
        .unwrap();
    assert_eq!(stopped.status, STATUS_FAILED);
    assert_eq!(stopped.note, STOPPED_BY_YOU);
    assert!(
        app.call(|s| s.stop(q.id.clone())).is_err(),
        "nothing left to stop"
    );
}

#[test]
fn stopping_a_message_not_taken_up_yet_closes_it() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Never mind");
    let row = app.call(|s| s.stop(q.id.clone())).unwrap();
    assert_eq!(row.status, STATUS_FAILED);
    assert_eq!(row.note, STOPPED_BY_YOU);
    assert!(row.stop_at > 0);
    assert!(app.view(|s| s.open_questions()).unwrap().is_empty());

    let note = app
        .call(|s| s.agent_say(q.chain.clone(), String::new(), "Okay.".to_owned(), None))
        .unwrap();
    assert!(
        app.call(|s| s.stop(note.id.clone())).is_err(),
        "only your own messages"
    );
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
                None,
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
            None,
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
        .call(|s| {
            s.agent_say(
                q.chain.clone(),
                q.id.clone(),
                "Quiet morning.".to_owned(),
                None,
            )
        })
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
        .call(|s| s.agent_say(other.chain.clone(), q.id.clone(), "hi".to_owned(), None))
        .is_err());
    // An agent message is not a question.
    let a = app
        .call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "hi".to_owned(), None))
        .unwrap();
    assert!(app
        .call(|s| s.agent_say(q.chain.clone(), a.id.clone(), "hi".to_owned(), None))
        .is_err());
    assert!(app
        .call(|s| s.agent_ack(a.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .is_err());
    // An unprompted note needs a chain that exists.
    assert!(app
        .call(|s| s.agent_say("nope".to_owned(), String::new(), "hi".to_owned(), None))
        .is_err());
    let note = app
        .call(|s| {
            s.agent_say(
                q.chain.clone(),
                String::new(),
                "Done, booked it.".to_owned(),
                None,
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
    app.call(|s| {
        s.agent_say(
            q.chain.clone(),
            q.id.clone(),
            "Two slots work.".to_owned(),
            None,
        )
    })
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
        .call_as_account(STRANGER, STRANGER, |s| s.say(
            String::new(),
            "hi".to_owned(),
            None,
            None
        ))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.agent_say(q.chain.clone(), q.id.clone(), "hi".to_owned(), None)
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
    app.call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "hi".to_owned(), None))
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

// ── headlines for long answers ───────────────────────────────────────────────

fn agent_say_long(
    app: &mut TestHost<Hyperfeed>,
    q: &FeedItem,
    text: &str,
    headline: Option<&str>,
) -> app::Result<FeedItem> {
    app.call(|s| {
        s.agent_say(
            q.chain.clone(),
            q.id.clone(),
            text.to_owned(),
            headline.map(str::to_owned),
        )
    })
}

#[test]
fn a_headline_lets_an_answer_run_long_and_titles_its_row() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Give me ten ideas for the feed");
    let body = "An idea worth having.\n".repeat(1_400); // ~30 KB
    assert!(body.len() > MAX_MESSAGE && body.len() <= MAX_LONG_MESSAGE);
    let said = agent_say_long(&mut app, &q, &body, Some("Ten ideas for the feed")).unwrap();
    assert_eq!(said.headline, "Ten ideas for the feed");
    assert_eq!(
        said.title, "Ten ideas for the feed",
        "the row shows the headline"
    );
    assert_eq!(said.body, body, "the whole answer is kept");

    // Read back anywhere: the item, the chain and the feed carry it.
    let item = app.view(|s| s.item(said.id.clone())).unwrap().unwrap();
    assert_eq!(item.headline, "Ten ideas for the feed");
    assert_eq!(item.body.len(), body.len());
    let flow = app.view(|s| s.chain(q.chain.clone())).unwrap();
    assert_eq!(flow.last().unwrap().headline, "Ten ideas for the feed");
    let lead = &feed(&app, "all").items[0];
    assert_eq!(lead.title, "Ten ideas for the feed");
}

#[test]
fn a_headline_has_its_own_limits() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "hi");
    let h80 = "é".repeat(MAX_HEADLINE); // 80 characters, 160 bytes
    assert!(agent_say_long(&mut app, &q, "ok", Some(&h80)).is_ok());
    let h81 = "a".repeat(MAX_HEADLINE + 1);
    assert!(
        agent_say_long(&mut app, &q, "ok", Some(&h81)).is_err(),
        "a headline is at most 80 characters"
    );
    assert!(
        agent_say_long(&mut app, &q, "ok", Some("two\nlines")).is_err(),
        "a headline is one line"
    );
    let too_long = "x".repeat(MAX_LONG_MESSAGE + 1);
    assert!(
        agent_say_long(&mut app, &q, &too_long, Some("Report")).is_err(),
        "a long answer still has a limit"
    );
    assert!(
        agent_say_long(&mut app, &q, "", Some("Only a headline")).is_err(),
        "an answer still needs text"
    );
}

#[test]
fn without_a_headline_the_old_limit_and_title_hold() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "hi");
    let over = "x".repeat(MAX_MESSAGE + 1);
    assert!(
        agent_say_long(&mut app, &q, &over, None).is_err(),
        "no headline, no long text"
    );
    assert!(
        agent_say_long(&mut app, &q, &over, Some("  ")).is_err(),
        "a blank headline is no headline"
    );
    let said = agent_say_long(&mut app, &q, "First line.\nSecond line.", Some("")).unwrap();
    assert_eq!(said.headline, "", "a blank headline is not kept");
    assert_eq!(
        said.title, "First line.",
        "titled by its first line, as before"
    );
    let exact = "x".repeat(MAX_MESSAGE);
    assert!(agent_say_long(&mut app, &q, &exact, None).is_ok());
}

#[test]
fn your_message_and_an_agent_question_take_a_headline_too() {
    let mut app = TestHost::new(Hyperfeed::init);
    let log = "error: something broke\n".repeat(200); // ~4.6 KB
    let q = app
        .call(|s| {
            s.say(
                String::new(),
                log.clone(),
                Some("The CI log".to_owned()),
                None,
            )
        })
        .unwrap();
    assert_eq!(q.title, "The CI log");
    assert!(app
        .call(|s| s.say(String::new(), log.clone(), None, None))
        .is_err());
    let with_image = app
        .call(|s| {
            s.say_with(
                q.chain.clone(),
                log.clone(),
                vec![image(&"ab".repeat(32))],
                Some("The log, and a screenshot".to_owned()),
                None,
            )
        })
        .unwrap();
    assert_eq!(with_image.headline, "The log, and a screenshot");

    let asked = app
        .call(|s| {
            s.agent_ask(
                q.chain.clone(),
                q.id.clone(),
                "Here is what failed and why.\n".repeat(150),
                choose(&["Fix it", "Leave it"]),
                Some("Two tests fail: fix them?".to_owned()),
            )
        })
        .unwrap();
    assert_eq!(asked.title, "Two tests fail: fix them?");
    assert_eq!(asked.status, STATUS_ASKED);
}

#[test]
fn a_long_answer_streams_as_a_long_draft() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Write me a report");
    app.call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    let draft = "A paragraph of the report.\n".repeat(400); // ~10 KB
    let row = app
        .call(|s| s.agent_work(q.id.clone(), Vec::new(), draft.clone()))
        .unwrap();
    assert_eq!(row.draft, draft);
    assert!(app
        .call(|s| s.agent_work(q.id.clone(), Vec::new(), "x".repeat(MAX_LONG_MESSAGE + 1)))
        .is_err());
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
    app.call(|s| s.say(n.chain.clone(), "About this…".to_owned(), None, None))
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

// ── Allow for this session ───────────────────────────────────────────────────

/// A tool on your computer the agent proposed, answered with `answer`.
fn allowed(app: &mut TestHost<Hyperfeed>, app_key: &str, answer: &str) -> FeedItem {
    let mut input = action(app_key, "proposed");
    input.method = "Bash".to_owned();
    input.ask = choose(&["Allow once", SESSION_GRANT]);
    let proposal = app.call(|s| s.record_action(input)).unwrap();
    app.call(|s| s.resolve_action(proposal.id.clone(), "approve".to_owned(), answer.to_owned()))
        .unwrap()
}

/// What the agent ran afterwards, carrying `grant`.
fn ran_under(app: &mut TestHost<Hyperfeed>, app_key: &str, grant: &str) -> FeedItem {
    let mut input = action(app_key, "done");
    input.grant = grant.to_owned();
    app.call(|s| s.record_action(input)).unwrap()
}

#[test]
fn a_session_you_allowed_is_not_acting_without_asking() {
    let mut app = TestHost::new(Hyperfeed::init); // "mero-bot" defaults to ask
    let grant = allowed(&mut app, "mero-bot", SESSION_GRANT);

    let ran = ran_under(&mut app, "mero-bot", &grant.id);
    assert_eq!(ran.status, STATUS_DONE);
    assert!(ran.breach.is_empty(), "{}", ran.breach);
    assert!(!ran.needs_you);

    // The grant still counts once the proposal itself is done.
    app.call(|s| s.complete_action(grant.id.clone(), "done".to_owned(), String::new()))
        .unwrap();
    assert!(ran_under(&mut app, "mero-bot", &grant.id).breach.is_empty());

    // A failure is recorded as one, without a breach: it needs you as a failure.
    let mut failed = action("mero-bot", "failed");
    failed.grant = grant.id.clone();
    let failed = app.call(|s| s.record_action(failed)).unwrap();
    assert_eq!(failed.status, STATUS_FAILED);
    assert!(failed.breach.is_empty());

    // Without the grant it is what it always was.
    let bare = ran_under(&mut app, "mero-bot", "");
    assert!(bare.breach.starts_with("acted without asking"));
}

#[test]
fn a_grant_counts_only_in_its_app_for_the_session_and_once_allowed() {
    let mut app = TestHost::new(Hyperfeed::init);
    let grant = allowed(&mut app, "mero-bot", SESSION_GRANT);

    // Another app: the session was allowed for tools on this computer only.
    assert!(!ran_under(&mut app, "chat", &grant.id).breach.is_empty());

    // "Allow once" is one command, not a session.
    let once = allowed(&mut app, "mero-bot", "Allow once");
    assert!(!ran_under(&mut app, "mero-bot", &once.id).breach.is_empty());

    // A proposal still waiting on you, or one that does not exist.
    let mut waiting = action("mero-bot", "proposed");
    waiting.ask = choose(&["Allow once", SESSION_GRANT]);
    let waiting = app.call(|s| s.record_action(waiting)).unwrap();
    assert!(!ran_under(&mut app, "mero-bot", &waiting.id)
        .breach
        .is_empty());
    assert!(!ran_under(&mut app, "mero-bot", "nope").breach.is_empty());

    // Allowed more than 12 hours ago.
    app.call(|s| {
        let mut a = s.actions.get(&grant.id)?.expect("recorded").clone();
        for step in &mut a.history {
            step.at -= GRANT_WINDOW_MS + 1;
        }
        // Remove first: an insert over a live key merges the histories.
        s.actions.remove(&grant.id)?;
        s.actions.insert(grant.id.clone(), a).map(|_| ())
    })
    .unwrap();
    let stale = ran_under(&mut app, "mero-bot", &grant.id);
    assert!(stale.breach.starts_with("acted without asking"));
}

#[test]
fn a_grant_does_not_lift_a_pause_a_guard_read_only_or_off() {
    let mut app = TestHost::new(Hyperfeed::init);
    let grant = allowed(&mut app, "mero-bot", SESSION_GRANT);

    app.call(|s| s.set_paused(true)).unwrap();
    let paused = ran_under(&mut app, "mero-bot", &grant.id);
    assert!(paused.breach.contains("paused"), "{}", paused.breach);
    app.call(|s| s.set_paused(false)).unwrap();

    let mut guarded = action("mero-bot", "done");
    guarded.category = "delete".to_owned();
    guarded.grant = grant.id.clone();
    let guarded = app.call(|s| s.record_action(guarded)).unwrap();
    assert!(
        guarded.breach.contains("always needs you"),
        "{}",
        guarded.breach
    );

    for mode in ["read", "off"] {
        app.call(|s| s.set_policy("mero-bot".to_owned(), mode.to_owned(), "feed".to_owned()))
            .unwrap();
        let ran = ran_under(&mut app, "mero-bot", &grant.id);
        assert!(
            ran.breach.starts_with("acted where it may not"),
            "{}",
            ran.breach
        );
    }
}

#[test]
fn a_grant_belongs_on_an_outcome() {
    let mut app = TestHost::new(Hyperfeed::init);
    let grant = allowed(&mut app, "mero-bot", SESSION_GRANT);
    let mut proposal = action("mero-bot", "proposed");
    proposal.grant = grant.id.clone();
    let err = app.call(|s| s.record_action(proposal)).unwrap_err();
    assert!(format!("{err:?}").contains("grant"), "{err:?}");
}

// ── A chain is settled only when everything in it is ─────────────────────────

/// Rows are ordered by the millisecond they were made in: wait for the next.
fn next_ms() {
    std::thread::sleep(std::time::Duration::from_millis(2));
}

/// A step in `chain` that settled at once.
fn done_in(app: &mut TestHost<Hyperfeed>, chain: &str) -> FeedItem {
    next_ms();
    let mut input = action("sheets", "done");
    input.chain = chain.to_owned();
    app.call(|s| s.record_action(input)).unwrap()
}

fn lead(app: &TestHost<Hyperfeed>, chain: &str) -> FeedItem {
    feed(app, "all")
        .items
        .into_iter()
        .find(|r| r.chain == chain)
        .expect("the chain")
}

#[test]
fn an_approved_action_leads_its_chain_until_it_settles() {
    let mut app = acting_in("sheets"); // "chat" still asks
    let proposal = app
        .call(|s| s.record_action(action("chat", "proposed")))
        .unwrap();
    let chain = proposal.chain.clone();
    app.call(|s| s.resolve_action(proposal.id.clone(), "approve".to_owned(), String::new()))
        .unwrap();
    let later = done_in(&mut app, &chain);

    let row = lead(&app, &chain);
    assert_eq!(
        row.id, proposal.id,
        "what is still running leads, not {}",
        later.id
    );
    assert_eq!(row.status, STATUS_APPROVED);
    assert!(!row.needs_you);

    // It fails: now it needs you, and still leads.
    app.call(|s| s.complete_action(proposal.id.clone(), "failed".to_owned(), String::new()))
        .unwrap();
    assert!(lead(&app, &chain).needs_you);

    // A retry is underway again; once it is done, the latest row leads.
    app.call(|s| s.resolve_action(proposal.id.clone(), "approve".to_owned(), String::new()))
        .unwrap();
    let row = lead(&app, &chain);
    assert_eq!(
        (row.id.as_str(), row.status.as_str()),
        (proposal.id.as_str(), STATUS_RETRYING)
    );
    app.call(|s| s.complete_action(proposal.id.clone(), "done".to_owned(), String::new()))
        .unwrap();
    assert_eq!(lead(&app, &chain).id, later.id);
}

#[test]
fn an_undo_being_done_leads_its_chain() {
    let mut app = acting_in("sheets");
    app.call(|s| s.set_policy("chat".to_owned(), "act".to_owned(), "feed".to_owned()))
        .unwrap();
    let posted = app
        .call(|s| s.record_action(action("sheets", "done")))
        .unwrap();
    app.call(|s| s.resolve_action(posted.id.clone(), "undo".to_owned(), String::new()))
        .unwrap();
    done_in(&mut app, &posted.chain);
    let row = lead(&app, &posted.chain);
    assert_eq!(
        (row.id.as_str(), row.status.as_str()),
        (posted.id.as_str(), STATUS_UNDO_REQUESTED)
    );
}

#[test]
fn your_message_leads_its_chain_until_it_is_answered() {
    let mut app = acting_in("sheets");
    let q = say(&mut app, "", "Pull the numbers into a sheet");
    let step = done_in(&mut app, &q.chain);
    assert_eq!(lead(&app, &q.chain).id, q.id, "waiting");

    app.call(|s| s.agent_ack(q.id.clone(), STATUS_THINKING.to_owned(), String::new()))
        .unwrap();
    assert_eq!(lead(&app, &q.chain).id, q.id, "thinking");

    next_ms();
    let a = app
        .call(|s| s.agent_say(q.chain.clone(), q.id.clone(), "Done.".to_owned(), None))
        .unwrap();
    assert_ne!(a.id, step.id);
    assert_eq!(
        lead(&app, &q.chain).id,
        a.id,
        "answered: the latest row leads"
    );
}

#[test]
fn an_answer_being_delivered_leads_its_chain() {
    let mut app = acting_in("sheets");
    let mut input = notification("chat:a>b:0", "chat", true);
    input.ask = ask("reply", "Reply in #launch", &[], "");
    let mention = app.call(|s| s.record_notification(input)).unwrap();
    app.call(|s| s.answer_notification(mention.id.clone(), "On it".to_owned()))
        .unwrap();
    done_in(&mut app, &mention.chain);
    let row = lead(&app, &mention.chain);
    assert_eq!(
        (row.id.as_str(), row.status.as_str()),
        (mention.id.as_str(), STATUS_ANSWERED)
    );
}

// ── stale questions ──────────────────────────────────────────────────────────

fn agent_asks(
    app: &mut TestHost<Hyperfeed>,
    chain: &str,
    text: &str,
    options: &[&str],
) -> FeedItem {
    app.call(|s| {
        s.agent_ask(
            chain.to_owned(),
            String::new(),
            text.to_owned(),
            choose(options),
            None,
        )
    })
    .unwrap()
}

fn row(app: &TestHost<Hyperfeed>, id: &str) -> FeedItem {
    app.view(|s| s.item(id.to_owned())).unwrap().unwrap()
}

#[test]
fn a_new_question_replaces_the_open_ones_in_its_chain() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Tidy up #launch");
    let first = agent_asks(
        &mut app,
        &q.chain,
        "Delete the duplicate?",
        &["Delete", "Keep"],
    );
    assert!(first.superseded_by.is_empty());
    let second = agent_asks(
        &mut app,
        &q.chain,
        "Archive the channel?",
        &["Archive", "Leave it"],
    );

    let old = row(&app, &first.id);
    assert_eq!(
        old.superseded_by, second.id,
        "the newer question replaced it"
    );
    assert!(!old.needs_you, "a replaced question no longer waits on you");
    assert_eq!(old.status, STATUS_ASKED, "it was never answered");
    let new = row(&app, &second.id);
    assert!(new.superseded_by.is_empty());
    assert!(new.needs_you);

    // One question waits on you, and it leads the chain.
    let page = feed(&app, "needs_you");
    assert_eq!(page.counts.needs_you, 1);
    assert_eq!(page.items[0].id, second.id);

    // A plain answer in the chain answers the question in front of you, not the old one.
    say(&mut app, &q.chain, "Archive");
    assert_eq!(row(&app, &second.id).status, STATUS_ANSWERED);
    assert_eq!(row(&app, &first.id).status, STATUS_ASKED);
    assert_eq!(feed(&app, "needs_you").counts.needs_you, 0);
}

#[test]
fn a_question_elsewhere_or_already_answered_is_not_replaced() {
    let mut app = TestHost::new(Hyperfeed::init);
    let a = say(&mut app, "", "one");
    let b = say(&mut app, "", "two");
    let in_a = agent_asks(&mut app, &a.chain, "A?", &["Yes", "No"]);
    say(&mut app, &a.chain, "Yes");
    let in_b = agent_asks(&mut app, &b.chain, "B?", &["Yes", "No"]);
    agent_asks(&mut app, &a.chain, "A again?", &["Yes", "No"]);
    assert!(
        row(&app, &in_a.id).superseded_by.is_empty(),
        "answered before the new one"
    );
    assert!(
        row(&app, &in_b.id).superseded_by.is_empty(),
        "another chain"
    );
    // A plain answer replaces nothing.
    let note = app
        .call(|s| s.agent_say(b.chain.clone(), String::new(), "FYI".to_owned(), None))
        .unwrap();
    assert!(note.superseded_by.is_empty());
    assert!(row(&app, &in_b.id).superseded_by.is_empty());
}

#[test]
fn a_notification_with_a_question_replaces_and_is_replaced() {
    let mut app = TestHost::new(Hyperfeed::init);
    let mut poll = notification("poll-1", "chat", true);
    poll.ask = choose(&["Tue", "Wed"]);
    let poll = app.call(|s| s.record_notification(poll)).unwrap();
    assert!(poll.needs_you);

    // Your agent asks in the same chain: the poll's buttons go.
    let asked = agent_asks(
        &mut app,
        &poll.chain,
        "Want me to vote Wed?",
        &["Yes", "No"],
    );
    let old = row(&app, &poll.id);
    assert_eq!(old.superseded_by, asked.id);
    assert!(!old.needs_you);

    // A newer notification with a question in the chain replaces your agent's.
    let mut again = notification("poll-2", "chat", true);
    again.chain = poll.chain.clone();
    again.ask = choose(&["Thu", "Fri"]);
    let again = app.call(|s| s.record_notification(again)).unwrap();
    assert_eq!(row(&app, &asked.id).superseded_by, again.id);
    assert_eq!(
        row(&app, &poll.id).superseded_by,
        asked.id,
        "the first replacement stands"
    );

    // An answer that still reaches the replaced poll is taken, and shows it was replaced.
    let answered = app
        .call(|s| s.answer_notification(poll.id.clone(), "Wed".to_owned()))
        .unwrap();
    assert_eq!(answered.status, STATUS_ANSWERED);
    assert_eq!(answered.superseded_by, asked.id);
}

#[test]
fn answering_a_question_from_its_buttons_goes_to_your_agent() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Tidy up #launch");
    let asked = agent_asks(
        &mut app,
        &q.chain,
        "Delete the duplicate?",
        &["Delete", "Keep"],
    );
    let answer = app
        .call(|s| s.answer_ask(asked.id.clone(), "Delete".to_owned()))
        .unwrap();
    assert_eq!(answer.from, FROM_YOU);
    assert_eq!(answer.status, STATUS_WAITING);
    assert_eq!(answer.chain, q.chain);
    assert_eq!(answer.answers, asked.id);
    assert!(!answer.answers_superseded);
    assert_eq!(row(&app, &asked.id).status, STATUS_ANSWERED);
    assert_eq!(row(&app, &asked.id).note, "Delete");
    assert!(app
        .view(|s| s.open_questions())
        .unwrap()
        .iter()
        .any(|m| m.id == answer.id));

    // Answered once is answered.
    assert!(app
        .call(|s| s.answer_ask(asked.id.clone(), "Keep".to_owned()))
        .is_err());
    // Only your agent's questions, only by you.
    assert!(app
        .call(|s| s.answer_ask(q.id.clone(), "x".to_owned()))
        .is_err());
    let plain = app
        .call(|s| s.agent_say(q.chain.clone(), String::new(), "FYI".to_owned(), None))
        .unwrap();
    assert!(app
        .call(|s| s.answer_ask(plain.id.clone(), "x".to_owned()))
        .is_err());
    let open = agent_asks(&mut app, &q.chain, "Again?", &["Yes", "No"]);
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .answer_ask(open.id.clone(), "Yes".to_owned()))
        .is_err());
}

// ── standing rules ───────────────────────────────────────────────────────────

fn rules(app: &TestHost<Hyperfeed>) -> Vec<String> {
    app.view(|s| s.settings())
        .unwrap()
        .rules
        .into_iter()
        .map(|r| r.text)
        .collect()
}

#[test]
fn a_new_feed_has_no_standing_rules() {
    let app = TestHost::new(Hyperfeed::init);
    let settings = app.view(|s| s.settings()).unwrap();
    assert!(settings.rules.is_empty(), "nothing is seeded");
    assert!(settings.rule_proposals.is_empty());
}

#[test]
fn you_add_and_remove_standing_rules() {
    let mut app = TestHost::new(Hyperfeed::init);
    let first = app
        .call(|s| s.add_rule("  Never push to main  ".to_owned()))
        .unwrap();
    assert_eq!(first.text, "Never push to main", "trimmed");
    app.call(|s| s.add_rule("Answer in English".to_owned()))
        .unwrap();
    assert_eq!(rules(&app), vec!["Never push to main", "Answer in English"]);
    // The same rule twice is kept once.
    let again = app
        .call(|s| s.add_rule("never push to MAIN".to_owned()))
        .unwrap();
    assert_eq!(again.id, first.id);
    assert_eq!(rules(&app).len(), 2);

    app.call(|s| s.remove_rule(first.id.clone())).unwrap();
    assert_eq!(rules(&app), vec!["Answer in English"]);
    assert!(
        app.call(|s| s.remove_rule(first.id.clone())).is_err(),
        "already removed"
    );
    assert!(app.call(|s| s.remove_rule("nope".to_owned())).is_err());
}

#[test]
fn a_rule_is_one_short_line() {
    let mut app = TestHost::new(Hyperfeed::init);
    assert!(app.call(|s| s.add_rule("   ".to_owned())).is_err());
    assert!(app.call(|s| s.add_rule("two\nlines".to_owned())).is_err());
    assert!(app.call(|s| s.add_rule("x".repeat(MAX_RULE + 1))).is_err());
    assert!(app.call(|s| s.add_rule("x".repeat(MAX_RULE))).is_ok());
    for i in 1..MAX_RULES {
        app.call(|s| s.add_rule(format!("rule {i}"))).unwrap();
    }
    assert!(
        app.call(|s| s.add_rule("one too many".to_owned())).is_err(),
        "every rule goes into every prompt, so they stay few"
    );
}

#[test]
fn only_the_owner_changes_standing_rules() {
    let mut app = TestHost::new(Hyperfeed::init);
    let rule = app
        .call(|s| s.add_rule("Never push to main".to_owned()))
        .unwrap();
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .add_rule("Push anywhere".to_owned()))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.remove_rule(rule.id.clone()))
        .is_err());
    let proposal = app
        .call(|s| {
            s.propose_rule(
                "Ask before deleting".to_owned(),
                String::new(),
                String::new(),
            )
        })
        .unwrap();
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.propose_rule(
            "Be loud".to_owned(),
            String::new(),
            String::new()
        ))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.approve_rule(proposal.id.clone()))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.dismiss_rule(proposal.id.clone()))
        .is_err());
    assert_eq!(rules(&app), vec!["Never push to main"]);
}

fn agent_rules(app: &TestHost<Hyperfeed>) -> Vec<(String, String)> {
    app.view(|s| s.settings())
        .unwrap()
        .agent_rules
        .into_iter()
        .map(|r| (r.agent, r.text))
        .collect()
}

#[test]
fn you_add_and_remove_rules_for_one_agent() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.add_rule("Never push to main".to_owned()))
        .unwrap();
    let first = app
        .call(|s| {
            s.add_agent_rule(
                " mero-bot@studio ".to_owned(),
                "  Run the tests first ".to_owned(),
            )
        })
        .unwrap();
    assert_eq!(first.agent, "mero-bot@studio", "trimmed");
    assert_eq!(first.text, "Run the tests first", "trimmed");
    app.call(|s| s.add_agent_rule("mero-bot@phone".to_owned(), "Keep answers short".to_owned()))
        .unwrap();
    // The same line for another agent is that agent's own.
    app.call(|s| {
        s.add_agent_rule(
            "mero-bot@phone".to_owned(),
            "Run the tests first".to_owned(),
        )
    })
    .unwrap();
    assert_eq!(
        agent_rules(&app),
        vec![
            ("mero-bot@phone".to_owned(), "Keep answers short".to_owned()),
            (
                "mero-bot@phone".to_owned(),
                "Run the tests first".to_owned()
            ),
            (
                "mero-bot@studio".to_owned(),
                "Run the tests first".to_owned()
            ),
        ]
    );
    // The general rules are untouched: every agent keeps them.
    assert_eq!(rules(&app), vec!["Never push to main"]);
    // The same rule twice for one agent is kept once.
    let again = app
        .call(|s| {
            s.add_agent_rule(
                "mero-bot@studio".to_owned(),
                "run the TESTS first".to_owned(),
            )
        })
        .unwrap();
    assert_eq!(again.id, first.id);

    app.call(|s| s.remove_agent_rule(first.id.clone())).unwrap();
    assert_eq!(agent_rules(&app).len(), 2);
    assert!(
        app.call(|s| s.remove_agent_rule(first.id.clone())).is_err(),
        "already removed"
    );
    assert!(app
        .call(|s| s.remove_agent_rule("nope".to_owned()))
        .is_err());
}

#[test]
fn an_agent_rule_is_one_short_line_for_a_named_agent() {
    let mut app = TestHost::new(Hyperfeed::init);
    let a = || "mero-bot@studio".to_owned();
    assert!(app
        .call(|s| s.add_agent_rule("  ".to_owned(), "Be brief".to_owned()))
        .is_err());
    assert!(app
        .call(|s| s.add_agent_rule(a(), "   ".to_owned()))
        .is_err());
    assert!(app
        .call(|s| s.add_agent_rule(a(), "two\nlines".to_owned()))
        .is_err());
    assert!(app
        .call(|s| s.add_agent_rule(a(), "x".repeat(MAX_RULE + 1)))
        .is_err());
    for i in 0..MAX_RULES {
        app.call(|s| s.add_agent_rule(a(), format!("rule {i}")))
            .unwrap();
    }
    assert!(app
        .call(|s| s.add_agent_rule(a(), "one too many".to_owned()))
        .is_err());
    // The limit is per agent.
    assert!(app
        .call(|s| s.add_agent_rule("mero-bot@phone".to_owned(), "Be brief".to_owned()))
        .is_ok());
}

#[test]
fn only_the_owner_changes_agent_rules() {
    let mut app = TestHost::new(Hyperfeed::init);
    let rule = app
        .call(|s| {
            s.add_agent_rule(
                "mero-bot@studio".to_owned(),
                "Never push to main".to_owned(),
            )
        })
        .unwrap();
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .add_agent_rule("mero-bot@studio".to_owned(), "Push anywhere".to_owned()))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.remove_agent_rule(rule.id.clone()))
        .is_err());
    assert_eq!(
        agent_rules(&app),
        vec![(
            "mero-bot@studio".to_owned(),
            "Never push to main".to_owned()
        )]
    );
}

#[test]
fn a_suggested_rule_waits_until_you_approve_it() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Push the fix");
    let proposal = app
        .call(|s| {
            s.propose_rule(
                "Open a PR instead of pushing to main".to_owned(),
                "You told me not to push to main.".to_owned(),
                q.chain.clone(),
            )
        })
        .unwrap();
    assert_eq!(proposal.status, RULE_PROPOSED);
    assert_eq!(proposal.chain, q.chain);
    let settings = app.view(|s| s.settings()).unwrap();
    assert!(settings.rules.is_empty(), "a suggestion changes nothing");
    assert_eq!(settings.rule_proposals, vec![proposal.clone()]);
    // Suggested twice, it waits once.
    let again = app
        .call(|s| {
            s.propose_rule(
                "open a PR instead of pushing to main".to_owned(),
                String::new(),
                String::new(),
            )
        })
        .unwrap();
    assert_eq!(again.id, proposal.id);

    let rule = app.call(|s| s.approve_rule(proposal.id.clone())).unwrap();
    assert_eq!(rule.text, "Open a PR instead of pushing to main");
    let settings = app.view(|s| s.settings()).unwrap();
    assert_eq!(rules(&app), vec!["Open a PR instead of pushing to main"]);
    assert!(settings.rule_proposals.is_empty());
    assert!(
        app.call(|s| s.approve_rule(proposal.id.clone())).is_err(),
        "approved once"
    );
    // A rule you already have is not suggested.
    assert!(app
        .call(|s| s.propose_rule(
            "Open a PR instead of pushing to main".to_owned(),
            String::new(),
            String::new()
        ))
        .is_err());
}

#[test]
fn an_answer_that_reaches_a_replaced_question_is_flagged() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Tidy up #launch");
    let first = agent_asks(
        &mut app,
        &q.chain,
        "Delete the duplicate?",
        &["Delete", "Keep"],
    );
    let second = agent_asks(
        &mut app,
        &q.chain,
        "Archive the channel?",
        &["Archive", "Leave it"],
    );

    // A screen that had not caught up taps the old question's button.
    let late = app
        .call(|s| s.answer_ask(first.id.clone(), "Delete".to_owned()))
        .unwrap();
    assert_eq!(late.answers, first.id);
    assert!(
        late.answers_superseded,
        "your agent is told it answers an old question"
    );
    assert!(
        row(&app, &late.id).answers_superseded,
        "and reads it so later too"
    );
    assert_eq!(row(&app, &first.id).status, STATUS_ANSWERED);
    let current = row(&app, &second.id);
    assert_eq!(
        current.status, STATUS_ASKED,
        "the newer question stays open"
    );
    assert!(current.needs_you);
}

// ── chain leases ─────────────────────────────────────────────────────────────

fn claim(
    app: &mut TestHost<Hyperfeed>,
    chain: &str,
    session: &str,
    ttl_ms: u64,
) -> app::Result<LeaseView> {
    app.call(|s| {
        s.claim_chain(
            chain.to_owned(),
            session.to_owned(),
            ttl_ms,
            Some(format!("mero-bot@{session}")),
        )
    })
}

#[test]
fn a_second_session_is_refused_a_chain_another_holds() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Fix the digest card");
    let lease = claim(&mut app, &q.chain, "studio", 60_000).unwrap();
    assert_eq!(lease.session, "studio");
    assert_eq!(lease.agent, "mero-bot@studio");
    assert!(lease.expires_at > lease.claimed_at);

    let refused = claim(&mut app, &q.chain, "laptop", 60_000).unwrap_err();
    assert!(
        format!("{refused:?}").contains("held by mero-bot@studio"),
        "{refused:?}"
    );
    assert!(app
        .call(|s| s.renew_chain(q.chain.clone(), "laptop".to_owned(), 60_000))
        .is_err());
    assert!(
        !app.call(|s| s.release_chain(q.chain.clone(), "laptop".to_owned()))
            .unwrap(),
        "letting go of what it does not hold changes nothing"
    );
    // Another chain is free.
    let other = say(&mut app, "", "Something else");
    assert!(claim(&mut app, &other.chain, "laptop", 60_000).is_ok());

    // The chat shows who is on it.
    let row = app.view(|s| s.item(q.id.clone())).unwrap().unwrap();
    assert_eq!(row.held_by, "mero-bot@studio");
    assert_eq!(row.held_since, lease.claimed_at);
}

#[test]
fn the_holder_renews_and_releases_and_then_another_session_may_claim() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Fix the digest card");
    let first = claim(&mut app, &q.chain, "studio", 60_000).unwrap();
    next_ms();
    let renewed = app
        .call(|s| s.renew_chain(q.chain.clone(), "studio".to_owned(), 60_000))
        .unwrap();
    assert!(renewed.expires_at > first.expires_at);
    assert_eq!(renewed.claimed_at, first.claimed_at, "held since the claim");
    // Claiming again is renewing.
    let again = claim(&mut app, &q.chain, "studio", 60_000).unwrap();
    assert_eq!(again.claimed_at, first.claimed_at);

    assert!(app
        .call(|s| s.release_chain(q.chain.clone(), "studio".to_owned()))
        .unwrap());
    assert_eq!(app.view(|s| s.chain_lease(q.chain.clone())).unwrap(), None);
    let row = app.view(|s| s.item(q.id.clone())).unwrap().unwrap();
    assert_eq!(row.held_by, "");
    assert!(
        app.call(|s| s.renew_chain(q.chain.clone(), "studio".to_owned(), 60_000))
            .is_err(),
        "released is released: claim it again"
    );
    let taken = claim(&mut app, &q.chain, "laptop", 60_000).unwrap();
    assert_eq!(taken.session, "laptop");
    assert_eq!(
        app.view(|s| s.chain_lease(q.chain.clone())).unwrap(),
        Some(taken)
    );
}

#[test]
fn an_expired_lease_can_be_reclaimed() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "Fix the digest card");
    claim(&mut app, &q.chain, "studio", MIN_LEASE_MS).unwrap();
    assert!(claim(&mut app, &q.chain, "laptop", 60_000).is_err());
    // The studio's session died: its lease runs out.
    std::thread::sleep(std::time::Duration::from_millis(MIN_LEASE_MS + 50));
    assert_eq!(app.view(|s| s.chain_lease(q.chain.clone())).unwrap(), None);
    assert_eq!(
        app.view(|s| s.item(q.id.clone())).unwrap().unwrap().held_by,
        ""
    );
    let taken = claim(&mut app, &q.chain, "laptop", 60_000).unwrap();
    assert_eq!(taken.session, "laptop");
    // The dead session cannot carry on beside it.
    assert!(app
        .call(|s| s.renew_chain(q.chain.clone(), "studio".to_owned(), 60_000))
        .is_err());
}

#[test]
fn leases_are_checked_and_owner_only() {
    let mut app = TestHost::new(Hyperfeed::init);
    let q = say(&mut app, "", "hi");
    assert!(claim(&mut app, "", "studio", 60_000).is_err());
    assert!(claim(&mut app, &q.chain, "", 60_000).is_err());
    assert!(claim(&mut app, &q.chain, "studio", MIN_LEASE_MS - 1).is_err());
    assert!(claim(&mut app, &q.chain, "studio", MAX_LEASE_MS + 1).is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.claim_chain(
            q.chain.clone(),
            "x".to_owned(),
            60_000,
            None
        ))
        .is_err());
    claim(&mut app, &q.chain, "studio", 60_000).unwrap();
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .release_chain(q.chain.clone(), "studio".to_owned()))
        .is_err());
    // An older agent names nothing: the lease still holds.
    let other = say(&mut app, "", "other");
    let lease = app
        .call(|s| s.claim_chain(other.chain.clone(), "old".to_owned(), 60_000, None))
        .unwrap();
    assert_eq!(lease.agent, "");
    assert!(claim(&mut app, &other.chain, "studio", 60_000).is_err());
}

#[test]
fn a_suggested_rule_can_be_dismissed() {
    let mut app = TestHost::new(Hyperfeed::init);
    let proposal = app
        .call(|s| s.propose_rule("Use emoji".to_owned(), String::new(), String::new()))
        .unwrap();
    let dismissed = app.call(|s| s.dismiss_rule(proposal.id.clone())).unwrap();
    assert_eq!(dismissed.status, RULE_DISMISSED);
    let settings = app.view(|s| s.settings()).unwrap();
    assert!(settings.rules.is_empty());
    assert!(settings.rule_proposals.is_empty());
    assert!(app.call(|s| s.approve_rule(proposal.id.clone())).is_err());
    assert!(app
        .call(|s| s.propose_rule("x".to_owned(), String::new(), "no-chain".to_owned()))
        .is_err());
}

// ── one thread per task ──────────────────────────────────────────────────────

/// A teammate's comment on an issue, as the issue tracker's lens records it.
fn comment_on(issue: &str, key: &str) -> NotificationInput {
    let mut n = notification(key, "issue-tracker", false);
    n.source_context = "repo-ctx".to_owned();
    n.event = "CommentAdded".to_owned();
    n.item_type = "message".to_owned();
    n.fields = r#"{"text":"Looks good"}"#.to_owned();
    n.reply_call =
        format!(r#"{{"method":"add_comment","args":{{"issue_id":"{issue}","body":"=answer"}}}}"#);
    n
}

/// The agent's write on an issue, in the task's chain.
fn touched(app: &mut TestHost<Hyperfeed>, chain: &str, issue: &str) -> FeedItem {
    let mut a = action("issue-tracker", "done");
    a.source_context = "repo-ctx".to_owned();
    a.method = "set_status".to_owned();
    a.chain = chain.to_owned();
    a.subject = subject_key("issue-tracker", "repo-ctx", issue);
    app.call(|s| s.record_action(a)).unwrap()
}

#[test]
fn a_subject_key_names_the_app_the_context_and_the_thing() {
    assert_eq!(
        subject_key("issue-tracker", "ctx", "issue-1"),
        "issue-tracker:ctx:issue-1"
    );
    assert_eq!(subject_key("chat", "ctx", ""), "chat:ctx");
    assert_eq!(subject_key("chat", "", "x"), "");
    assert_eq!(subject_key("chat", "ctx", &"x".repeat(300)), "");
    assert_eq!(
        reply_subject(
            "issue-tracker",
            "ctx",
            r#"{"method":"add_comment","args":{"issue_id":"issue-1","body":"=answer"}}"#
        ),
        "issue-tracker:ctx:issue-1"
    );
    // No id among the args: the whole context (a chat, a board).
    assert_eq!(reply_subject("chat", "ctx", REPLY), "chat:ctx");
    assert_eq!(reply_subject("chat", "ctx", ""), "");
}

#[test]
fn a_comment_on_an_issue_a_task_touched_joins_the_tasks_chain() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    let write = touched(&mut app, &task.chain, "issue-7");
    assert_eq!(write.subject, "issue-tracker:repo-ctx:issue-7");

    let comment = app
        .call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:a>b:0")))
        .unwrap();
    assert_eq!(comment.chain, task.chain, "joined the task");
    assert_eq!(comment.subject, "issue-tracker:repo-ctx:issue-7");

    let flow = app.view(|s| s.chain(task.chain.clone())).unwrap();
    assert_eq!(flow.len(), 3);
    assert!(flow.iter().any(|i| i.id == comment.id));
    // The task is one row in the feed, not two.
    let page = feed(&app, "all");
    assert_eq!(
        page.items.iter().filter(|i| i.chain == task.chain).count(),
        1
    );
    // And the write keeps what it touched when read back.
    let read = app.view(|s| s.item(write.id.clone())).unwrap().unwrap();
    assert_eq!(read.subject, write.subject);
}

#[test]
fn a_comment_on_another_issue_starts_its_own_chain() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    touched(&mut app, &task.chain, "issue-7");
    let other = app
        .call(|s| s.record_notification(comment_on("issue-8", "repo-ctx:a>b:0")))
        .unwrap();
    assert_eq!(other.chain, other.id);
    // Nor does one the lens did not make (no reply to tell what it is about).
    let mut plain = comment_on("issue-7", "repo-ctx:b>c:0");
    plain.item_type = String::new();
    plain.fields = String::new();
    plain.reply_call = String::new();
    let plain = app.call(|s| s.record_notification(plain)).unwrap();
    assert_eq!(plain.chain, plain.id);
}

#[test]
fn the_latest_task_to_touch_a_subject_gets_its_notifications() {
    let mut app = acting_in("issue-tracker");
    let first = app
        .call(|s| s.record_notification(notification("mero-bot:one", "mero-bot", false)))
        .unwrap();
    let second = app
        .call(|s| s.record_notification(notification("mero-bot:two", "mero-bot", false)))
        .unwrap();
    touched(&mut app, &first.chain, "issue-7");
    touched(&mut app, &second.chain, "issue-7");
    let comment = app
        .call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:a>b:0")))
        .unwrap();
    assert_eq!(comment.chain, second.chain);
}

#[test]
fn a_chain_named_by_the_client_wins_and_a_put_away_task_is_not_reopened() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    let elsewhere = app
        .call(|s| s.record_notification(notification("mero-bot:else", "mero-bot", false)))
        .unwrap();
    touched(&mut app, &task.chain, "issue-7");

    let mut named = comment_on("issue-7", "repo-ctx:a>b:0");
    named.chain = elsewhere.chain.clone();
    let named = app.call(|s| s.record_notification(named)).unwrap();
    assert_eq!(named.chain, elsewhere.chain);

    app.call(|s| s.archive(vec![task.chain.clone()], 0))
        .unwrap();
    let later = app
        .call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:b>c:0")))
        .unwrap();
    assert_eq!(later.chain, later.id, "a chain you put away stays away");
}

#[test]
fn a_subject_that_does_not_fit_is_refused() {
    let mut app = acting_in("issue-tracker");
    let mut a = action("issue-tracker", "done");
    a.subject = "x".repeat(MAX_KEY + 1);
    assert!(app.call(|s| s.record_action(a)).is_err());
}

#[test]
fn a_step_of_a_turn_touches_a_subject_without_a_row() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    let subject = subject_key("issue-tracker", "repo-ctx", "issue-7");
    app.call(|s| s.touch_subject(task.chain.clone(), subject.clone()))
        .unwrap();
    assert_eq!(
        app.view(|s| s.chain(task.chain.clone())).unwrap().len(),
        1,
        "no row"
    );
    let comment = app
        .call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:a>b:0")))
        .unwrap();
    assert_eq!(comment.chain, task.chain);
    // Only into a chain that exists, and only from the owner.
    assert!(app
        .call(|s| s.touch_subject("no-such-chain".to_owned(), subject.clone()))
        .is_err());
    assert!(app
        .call(|s| s.touch_subject(task.chain.clone(), String::new()))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .touch_subject(task.chain.clone(), subject.clone()))
        .is_err());
}

// ── a task's links ───────────────────────────────────────────────────────────

fn add(
    app: &mut TestHost<Hyperfeed>,
    chain: &str,
    subject: &str,
    label: &str,
    by: &str,
) -> app::Result<LinkView> {
    let input = LinkInput {
        subject: subject.to_owned(),
        label: label.to_owned(),
        by: by.to_owned(),
    };
    app.call(|s| s.add_link(chain.to_owned(), input))
}

fn links_of(app: &TestHost<Hyperfeed>, chain: &str) -> Vec<LinkView> {
    app.view(|s| s.links(chain.to_owned())).unwrap()
}

#[test]
fn what_the_agent_touches_is_linked_to_the_task() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    touched(&mut app, &task.chain, "issue-7");
    app.call(|s| s.touch_subject(task.chain.clone(), "chat:launch".to_owned()))
        .unwrap();
    // Touching it again keeps one link.
    touched(&mut app, &task.chain, "issue-7");

    let links = links_of(&app, &task.chain);
    assert_eq!(links.len(), 2);
    assert_eq!(
        (
            links[0].app.as_str(),
            links[0].context.as_str(),
            links[0].item.as_str(),
            links[0].by.as_str()
        ),
        ("issue-tracker", "repo-ctx", "issue-7", "agent")
    );
    assert_eq!(
        (links[1].app.as_str(), links[1].item.as_str()),
        ("chat", "")
    );
    assert_eq!(links[0].activity, 0);
}

#[test]
fn a_link_counts_what_teammates_did_there() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    touched(&mut app, &task.chain, "issue-7");
    let first = app
        .call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:a>b:0")))
        .unwrap();
    app.call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:b>c:0")))
        .unwrap();
    let link = &links_of(&app, &task.chain)[0];
    assert_eq!(link.activity, 2);
    assert!(link.last_at >= first.at);
}

#[test]
fn you_link_a_thing_by_hand_and_what_happens_there_joins_the_task() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    let subject = subject_key("issue-tracker", "repo-ctx", "issue-9");
    let link = add(&mut app, &task.chain, &subject, "Flaky CI", "you").unwrap();
    assert_eq!(
        (link.label.as_str(), link.by.as_str(), link.item.as_str()),
        ("Flaky CI", "you", "issue-9")
    );
    let comment = app
        .call(|s| s.record_notification(comment_on("issue-9", "repo-ctx:a>b:0")))
        .unwrap();
    assert_eq!(comment.chain, task.chain);
    // Adding it again relabels it, still one link.
    add(&mut app, &task.chain, &subject, "Flaky CI on main", "agent").unwrap();
    let links = links_of(&app, &task.chain);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].label, "Flaky CI on main");
}

#[test]
fn a_link_you_take_off_stays_off() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    touched(&mut app, &task.chain, "issue-7");
    let subject = subject_key("issue-tracker", "repo-ctx", "issue-7");
    app.call(|s| s.remove_link(task.chain.clone(), subject.clone()))
        .unwrap();
    assert!(links_of(&app, &task.chain).is_empty());

    // Nothing new about it joins the task, and the agent touching it does not bring it back.
    let comment = app
        .call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:a>b:0")))
        .unwrap();
    assert_eq!(comment.chain, comment.id);
    touched(&mut app, &task.chain, "issue-7");
    app.call(|s| s.touch_subject(task.chain.clone(), subject.clone()))
        .unwrap();
    assert!(links_of(&app, &task.chain).is_empty());
    let later = app
        .call(|s| s.record_notification(comment_on("issue-7", "repo-ctx:b>c:0")))
        .unwrap();
    assert_eq!(later.chain, later.id);

    // Only you bring it back.
    assert!(add(&mut app, &task.chain, &subject, "", "agent").is_err());
    assert!(links_of(&app, &task.chain).is_empty());
    add(&mut app, &task.chain, &subject, "", "you").unwrap();
    assert_eq!(links_of(&app, &task.chain).len(), 1);
}

#[test]
fn a_link_needs_a_real_chain_a_whole_subject_and_the_owner() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    assert!(add(&mut app, "no-such-chain", "chat:launch", "", "you").is_err());
    assert!(
        add(&mut app, &task.chain, "chat", "", "you").is_err(),
        "no context"
    );
    assert!(add(&mut app, &task.chain, "chat:", "", "you").is_err());
    assert!(add(&mut app, &task.chain, "chat:launch", "", "someone").is_err());
    assert!(add(
        &mut app,
        &task.chain,
        "chat:launch",
        &"x".repeat(MAX_TITLE + 1),
        "you"
    )
    .is_err());
    assert!(
        app.call(|s| s.remove_link(task.chain.clone(), "chat:launch".to_owned()))
            .is_err(),
        "not linked"
    );
    let input = LinkInput {
        subject: "chat:launch".to_owned(),
        label: String::new(),
        by: "you".to_owned(),
    };
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .add_link(task.chain.clone(), input))
        .is_err());
}

#[test]
fn a_task_takes_a_bounded_number_of_links() {
    let mut app = acting_in("issue-tracker");
    let task = app
        .call(|s| s.record_notification(notification("mero-bot:task", "mero-bot", false)))
        .unwrap();
    for n in 0..MAX_LINKS {
        add(&mut app, &task.chain, &format!("chat:ctx-{n}"), "", "you").unwrap();
    }
    assert!(add(&mut app, &task.chain, "chat:one-more", "", "you").is_err());
    // The agent touching one more is not an error: it is just not linked.
    app.call(|s| s.touch_subject(task.chain.clone(), "chat:agent-more".to_owned()))
        .unwrap();
    assert_eq!(links_of(&app, &task.chain).len(), MAX_LINKS);
}

#[test]
fn a_task_started_from_a_chat_gets_its_own_chain_and_both_link_each_other() {
    let mut app = acting_in("issue-tracker");
    let chat = app
        .call(|s| {
            s.say(
                String::new(),
                "Plan the roadmap\nwatches, safe merge, checkpoints".to_owned(),
                None,
                None,
            )
        })
        .unwrap();
    let task = app
        .call(|s| {
            s.start_task(
                chat.chain.clone(),
                "Build safe merge: merge only green PRs on main.".to_owned(),
                Some("Safe merge".to_owned()),
            )
        })
        .unwrap();
    // Your message opens a chain of its own, waiting for your agent.
    assert_eq!(task.chain, task.id);
    assert_ne!(task.chain, chat.chain);
    assert_eq!(
        (task.from.as_str(), task.status.as_str()),
        ("you", "waiting")
    );
    let open = app.view(|s| s.open_questions()).unwrap();
    assert!(open.iter().any(|m| m.id == task.id));

    let on_chat = links_of(&app, &chat.chain);
    assert_eq!(on_chat.len(), 1);
    assert_eq!(
        (
            on_chat[0].subject.as_str(),
            on_chat[0].app.as_str(),
            on_chat[0].context.as_str(),
            on_chat[0].label.as_str()
        ),
        (
            format!("{TASK_SUBJECT}{}", task.chain).as_str(),
            "hyperfeed",
            "task",
            "Safe merge"
        )
    );
    let on_task = links_of(&app, &task.chain);
    assert_eq!(on_task.len(), 1);
    assert_eq!(
        (
            on_task[0].context.as_str(),
            on_task[0].item.as_str(),
            on_task[0].label.as_str()
        ),
        ("from", chat.chain.as_str(), "Plan the roadmap")
    );

    // Without a headline the task is named by its first line.
    let second = app
        .call(|s| s.start_task(chat.chain.clone(), "Checkpoints\nper task".to_owned(), None))
        .unwrap();
    let on_chat = links_of(&app, &chat.chain);
    assert_eq!(on_chat.len(), 2);
    assert!(on_chat
        .iter()
        .any(|l| l.item == second.chain && l.label == "Checkpoints"));
}

#[test]
fn a_task_needs_a_real_chat_a_message_and_the_owner() {
    let mut app = acting_in("issue-tracker");
    let chat = app
        .call(|s| s.say(String::new(), "Plan".to_owned(), None, None))
        .unwrap();
    assert!(app
        .call(|s| s.start_task("no-such-chain".to_owned(), "X".to_owned(), None))
        .is_err());
    assert!(app
        .call(|s| s.start_task(chat.chain.clone(), String::new(), None))
        .is_err());
    assert!(app
        .call(|s| s.start_task(chat.chain.clone(), "X".to_owned(), Some("a\nb".to_owned())))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s.start_task(
            chat.chain.clone(),
            "X".to_owned(),
            None
        ))
        .is_err());
    // A chat full of links starts no task, and writes nothing.
    for n in 0..MAX_LINKS {
        add(&mut app, &chat.chain, &format!("chat:ctx-{n}"), "", "you").unwrap();
    }
    let before = app.view(|s| s.open_questions()).unwrap().len();
    assert!(app
        .call(|s| s.start_task(chat.chain.clone(), "One more".to_owned(), None))
        .is_err());
    assert_eq!(app.view(|s| s.open_questions()).unwrap().len(), before);
}

// ── push to your phone ───────────────────────────────────────────────────────

const VAPID: &str =
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const VAPID_2: &str =
    "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

fn phone(endpoint: &str, key: &str) -> PushDeviceInput {
    PushDeviceInput {
        endpoint: endpoint.to_owned(),
        p256dh: "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oQhFpFHw3Lvo".to_owned(),
        auth: "8eDyX_uCN0XRhSbY5hs7Hg".to_owned(),
        name: "Sandi's phone".to_owned(),
        quiet: false,
        key: key.to_owned(),
    }
}

#[test]
fn a_phone_subscribes_with_the_runtimes_key_and_is_listed() {
    let mut app = TestHost::new(Hyperfeed::init);
    assert_eq!(app.view(|s| s.push_key()).unwrap(), PushKeyView::default());
    // No key yet: nothing to subscribe with.
    assert!(app
        .call(|s| s.add_push_device(phone("https://fcm.googleapis.com/fcm/send/a", VAPID)))
        .is_err());

    let key = app
        .call(|s| s.set_push_key(VAPID.to_owned(), "mero-bot@laptop".to_owned()))
        .unwrap();
    assert_eq!(key.public_key, VAPID);
    let d = app
        .call(|s| s.add_push_device(phone("https://fcm.googleapis.com/fcm/send/a", VAPID)))
        .unwrap();
    assert_eq!(d.name, "Sandi's phone");
    // Adding it again updates it; still one device.
    let mut quiet = phone("https://fcm.googleapis.com/fcm/send/a", VAPID);
    quiet.quiet = true;
    app.call(|s| s.add_push_device(quiet)).unwrap();
    let list = app.view(|s| s.push_devices()).unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].quiet);
    assert_eq!(list[0].added_at, d.added_at);
}

#[test]
fn a_subscription_made_with_an_old_key_is_refused_and_a_new_key_drops_devices() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.set_push_key(VAPID.to_owned(), "a".to_owned()))
        .unwrap();
    app.call(|s| s.add_push_device(phone("https://web.push.apple.com/x", VAPID)))
        .unwrap();
    app.call(|s| s.set_push_key(VAPID_2.to_owned(), "b".to_owned()))
        .unwrap();
    assert!(app.view(|s| s.push_devices()).unwrap().is_empty());
    assert!(app
        .call(|s| s.add_push_device(phone("https://web.push.apple.com/x", VAPID)))
        .is_err());
    app.call(|s| s.add_push_device(phone("https://web.push.apple.com/x", VAPID_2)))
        .unwrap();
    assert_eq!(app.view(|s| s.push_devices()).unwrap().len(), 1);
}

#[test]
fn a_device_comes_off_and_bad_subscriptions_are_refused() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.set_push_key(VAPID.to_owned(), "a".to_owned()))
        .unwrap();
    app.call(|s| s.add_push_device(phone("https://push.example/1", VAPID)))
        .unwrap();
    app.call(|s| s.remove_push_device("https://push.example/1".to_owned()))
        .unwrap();
    assert!(app.view(|s| s.push_devices()).unwrap().is_empty());
    // Taking off one that is not there is fine.
    app.call(|s| s.remove_push_device("https://push.example/none".to_owned()))
        .unwrap();

    assert!(app
        .call(|s| s.add_push_device(phone("http://push.example/plain", VAPID)))
        .is_err());
    let mut bad = phone("https://push.example/2", VAPID);
    bad.auth = "not base64!".to_owned();
    assert!(app.call(|s| s.add_push_device(bad)).is_err());
    assert!(app
        .call(|s| s.set_push_key("has spaces".to_owned(), "a".to_owned()))
        .is_err());
}

#[test]
fn only_the_owner_sets_the_key_or_adds_devices() {
    let mut app = TestHost::new(Hyperfeed::init);
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .set_push_key(VAPID.to_owned(), "a".to_owned()))
        .is_err());
    app.call(|s| s.set_push_key(VAPID.to_owned(), "a".to_owned()))
        .unwrap();
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| s
            .add_push_device(phone("https://push.example/s", VAPID)))
        .is_err());
    // The owner's phone is the owner.
    assert!(app
        .call_as(PHONE, |s| s
            .add_push_device(phone("https://push.example/p", VAPID)))
        .is_ok());
}

#[test]
fn at_most_ten_devices_the_oldest_makes_room() {
    let mut app = TestHost::new(Hyperfeed::init);
    app.call(|s| s.set_push_key(VAPID.to_owned(), "a".to_owned()))
        .unwrap();
    for i in 0..=MAX_PUSH_DEVICES {
        app.call(|s| s.add_push_device(phone(&format!("https://push.example/{i}"), VAPID)))
            .unwrap();
    }
    let list = app.view(|s| s.push_devices()).unwrap();
    assert_eq!(list.len(), MAX_PUSH_DEVICES);
    assert!(!list.iter().any(|d| d.endpoint == "https://push.example/0"));
}

// ── Actions ──────────────────────────────────────────────────────────────────

fn act_def(id: &str, label: &str, category: &str, writes: bool, methods: &[&str]) -> ActionDef {
    ActionDef {
        id: id.to_owned(),
        label: label.to_owned(),
        description: String::new(),
        category: category.to_owned(),
        writes,
        methods: methods.iter().map(|m| (*m).to_owned()).collect(),
    }
}

/// Chat's actions, as an agent would learn them from its ABI.
fn chat_actions() -> Vec<ActionDef> {
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

fn approve_actions(app: &mut TestHost<Hyperfeed>, version: &str, actions: Vec<ActionDef>) {
    app.call(|s| {
        s.propose_actions(
            "chat".to_owned(),
            version.to_owned(),
            actions,
            "Chat".to_owned(),
        )
    })
    .unwrap();
    app.call(|s| s.decide_actions("chat".to_owned(), version.to_owned(), "approve".to_owned()))
        .unwrap();
}

fn check(app: &TestHost<Hyperfeed>, method: &str, category: &str, writes: bool) -> Verdict {
    app.view(|s| {
        s.check_action(
            "chat".to_owned(),
            category.to_owned(),
            writes,
            Some(method.to_owned()),
        )
    })
    .unwrap()
}

#[test]
fn approved_actions_decide_what_a_call_is() {
    let mut app = acting_in("chat");
    // Before you approve anything, the agent's word is taken.
    assert_eq!(check(&app, "delete_message", "", true).decision, "act");

    app.call(|s| {
        s.propose_actions(
            "chat".to_owned(),
            "app-1".to_owned(),
            chat_actions(),
            "Chat".to_owned(),
        )
    })
    .unwrap();
    // A proposal changes nothing until you approve it.
    assert_eq!(check(&app, "delete_message", "", true).decision, "act");

    app.call(|s| s.decide_actions("chat".to_owned(), "app-1".to_owned(), "approve".to_owned()))
        .unwrap();
    // The action's guard applies, whatever category the agent named.
    let v = check(&app, "delete_message", "", true);
    assert_eq!(v.decision, "ask");
    assert!(v.reason.contains("\"delete\""), "{}", v.reason);
    // An action with no guard of its own keeps the one the agent names: only
    // the agent knows the person is new.
    assert_eq!(
        check(&app, "send_message", "new_contact", true).decision,
        "ask"
    );
    assert_eq!(check(&app, "send_message", "", true).decision, "act");
    // A reading action runs, even when the agent says it writes.
    assert_eq!(check(&app, "search", "", true).decision, "act");
    // A method no action names asks every time, even when said to only read.
    let v = check(&app, "drop_channel", "", false);
    assert_eq!(v.decision, "ask");
    assert!(
        v.reason.contains("isn't one of chat's actions"),
        "{}",
        v.reason
    );
    // An agent that names no method is judged by what it says.
    let v = app
        .view(|s| s.check_action("chat".to_owned(), String::new(), true, None))
        .unwrap();
    assert_eq!(v.decision, "act");

    // Doing an undescribed thing without asking is a breach, and the row
    // records what the actions say it was.
    let mut input = action("chat", "done");
    input.method = "drop_channel".to_owned();
    let item = app.call(|s| s.record_action(input)).unwrap();
    assert!(
        item.breach.starts_with("acted without asking"),
        "{}",
        item.breach
    );
    let mut input = action("chat", "done");
    input.method = "delete_message".to_owned();
    let item = app.call(|s| s.record_action(input)).unwrap();
    assert_eq!(item.category, "delete");
    assert!(!item.breach.is_empty());
}

#[test]
fn each_action_can_be_set_apart_from_its_app() {
    let mut app = TestHost::new(Hyperfeed::init); // "chat" defaults to ask
    approve_actions(&mut app, "app-1", chat_actions());
    assert_eq!(check(&app, "edit_message", "", true).decision, "ask");

    app.call(|s| s.set_action_mode("chat".to_owned(), "edit".to_owned(), "act".to_owned()))
        .unwrap();
    let v = check(&app, "edit_message", "", true);
    assert_eq!(v.decision, "act");
    assert!(v.reason.contains("Edit your messages"), "{}", v.reason);
    // The others still follow the app.
    assert_eq!(check(&app, "send_message", "", true).decision, "ask");

    // A guard still wins over an action you let act.
    app.call(|s| s.set_action_mode("chat".to_owned(), "delete".to_owned(), "act".to_owned()))
        .unwrap();
    assert_eq!(check(&app, "delete_message", "", true).decision, "ask");

    // Off refuses, so a proposal for it is an error.
    app.call(|s| s.set_action_mode("chat".to_owned(), "send".to_owned(), "off".to_owned()))
        .unwrap();
    assert_eq!(check(&app, "send_message", "", true).decision, "refuse");
    let err = app
        .call(|s| s.record_action(action("chat", "proposed")))
        .unwrap_err();
    assert!(format!("{err:?}").contains("you turned off"), "{err:?}");

    // Ask on an app that acts.
    app.call(|s| s.set_policy("chat".to_owned(), "act".to_owned(), "feed".to_owned()))
        .unwrap();
    app.call(|s| s.set_action_mode("chat".to_owned(), "send".to_owned(), "ask".to_owned()))
        .unwrap();
    assert_eq!(check(&app, "send_message", "", true).decision, "ask");
    assert_eq!(check(&app, "reply", "", true).decision, "ask");

    // Empty follows the app again, and settings lists only what you set.
    app.call(|s| s.set_action_mode("chat".to_owned(), "send".to_owned(), String::new()))
        .unwrap();
    assert_eq!(check(&app, "send_message", "", true).decision, "act");
    let modes = app.view(|s| s.settings()).unwrap().action_modes;
    let set: Vec<(String, String)> = modes.into_iter().map(|m| (m.action, m.mode)).collect();
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
    let mut app = acting_in("chat");
    approve_actions(&mut app, "app-1", chat_actions());

    // Version 2 moves delete_message out of any action.
    let mut v2 = chat_actions();
    v2.pop();
    app.call(|s| s.propose_actions("chat".to_owned(), "app-2".to_owned(), v2, "v2".to_owned()))
        .unwrap();
    assert_eq!(check(&app, "delete_message", "", true).decision, "ask");
    assert!(check(&app, "delete_message", "", true)
        .reason
        .contains("\"delete\""));

    app.call(|s| s.decide_actions("chat".to_owned(), "app-2".to_owned(), "reject".to_owned()))
        .unwrap();
    assert!(check(&app, "delete_message", "", true)
        .reason
        .contains("\"delete\""));

    app.call(|s| s.decide_actions("chat".to_owned(), "app-2".to_owned(), "approve".to_owned()))
        .unwrap();
    let v = check(&app, "delete_message", "", true);
    assert!(
        v.reason.contains("isn't one of chat's actions"),
        "{}",
        v.reason
    );

    let sets = app.view(|s| s.action_sets()).unwrap();
    assert_eq!(sets.len(), 2);
    assert_eq!(sets[0].application_id, "app-2");
}

#[test]
fn actions_are_checked_and_only_the_owner_handles_them() {
    let mut app = TestHost::new(Hyperfeed::init);
    let propose = |actions: Vec<ActionDef>| {
        move |s: &mut Hyperfeed| {
            s.propose_actions(
                "chat".to_owned(),
                "app-1".to_owned(),
                actions,
                "x".to_owned(),
            )
        }
    };
    let twice = vec![
        act_def("a", "A", "", true, &["m"]),
        act_def("b", "B", "", true, &["m"]),
    ];
    let err = app.call(propose(twice)).unwrap_err();
    assert!(format!("{err:?}").contains("is in two actions"), "{err:?}");
    let bad_guard = vec![act_def("a", "A", "lunch", true, &["m"])];
    assert!(app.call(propose(bad_guard)).is_err());
    assert!(app.call(propose(Vec::new())).is_err());
    let no_methods = vec![act_def("a", "A", "", true, &[])];
    assert!(app.call(propose(no_methods)).is_err());

    app.call(propose(chat_actions())).unwrap();
    assert!(app
        .call(|s| s.set_action_mode("chat".to_owned(), "send".to_owned(), "read".to_owned()))
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.decide_actions("chat".to_owned(), "app-1".to_owned(), "approve".to_owned())
        })
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.set_action_mode("chat".to_owned(), "send".to_owned(), "act".to_owned())
        })
        .is_err());
    assert!(app
        .call_as_account(STRANGER, STRANGER, propose(chat_actions()))
        .is_err());
}

#[test]
fn a_session_grant_covers_one_action() {
    let mut app = TestHost::new(Hyperfeed::init); // "chat" defaults to ask
    approve_actions(&mut app, "app-1", chat_actions());
    let mut input = action("chat", "proposed");
    input.ask = choose(&["Allow once", SESSION_GRANT]);
    let proposal = app.call(|s| s.record_action(input)).unwrap();
    app.call(|s| {
        s.resolve_action(
            proposal.id.clone(),
            "approve".to_owned(),
            SESSION_GRANT.to_owned(),
        )
    })
    .unwrap();

    // Sending again under it is fine; editing is another action.
    let mut send = action("chat", "done");
    send.method = "reply".to_owned();
    send.grant = proposal.id.clone();
    assert!(app
        .call(|s| s.record_action(send))
        .unwrap()
        .breach
        .is_empty());
    let mut edit = action("chat", "done");
    edit.method = "edit_message".to_owned();
    edit.grant = proposal.id.clone();
    assert!(!app
        .call(|s| s.record_action(edit))
        .unwrap()
        .breach
        .is_empty());

    // A grant also covers an action you set to ask in an app that acts.
    app.call(|s| s.set_policy("chat".to_owned(), "act".to_owned(), "feed".to_owned()))
        .unwrap();
    app.call(|s| s.set_action_mode("chat".to_owned(), "send".to_owned(), "ask".to_owned()))
        .unwrap();
    let mut send = action("chat", "done");
    send.grant = proposal.id.clone();
    assert!(app
        .call(|s| s.record_action(send))
        .unwrap()
        .breach
        .is_empty());
}
