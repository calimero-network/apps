use calimero_sdk::testing::TestHost;

use super::*;

// The default TestHost caller is the context creator: the first admin, i.e. the
// founder. A second PERSON needs both axes moved — `call_as` alone keeps the
// account and models the founder's own second device.
const INVESTOR: [u8; 32] = [0xB0; 32];
const INVESTOR_DEVICE: [u8; 32] = [0xB1; 32];
const COFOUNDER: [u8; 32] = [0xC0; 32];
const COFOUNDER_DEVICE: [u8; 32] = [0xC1; 32];
const FOUNDER_PHONE: [u8; 32] = [0xA2; 32];

fn account_hex(bytes: [u8; 32]) -> String {
    AccountId::from(bytes).to_string()
}

fn new_app() -> TestHost<MeroUpdates> {
    TestHost::new(MeroUpdates::init)
}

fn input(title: &str) -> UpdateInput {
    UpdateInput {
        title: title.to_owned(),
        summary: "tl;dr".to_owned(),
        category_id: String::new(),
        sections: vec![
            Section {
                kind: "highlights".to_owned(),
                title: "Highlights".to_owned(),
                body: "Closed our first enterprise customer.".to_owned(),
            },
            // An untouched template placeholder: must not be published.
            Section {
                kind: "lowlights".to_owned(),
                title: "Lowlights".to_owned(),
                body: "   ".to_owned(),
            },
        ],
        metrics: vec![Metric {
            name: "MRR".to_owned(),
            value: "$42k".to_owned(),
            unit: String::new(),
        }],
        asks: vec![AskInput {
            id: None,
            kind: "intro".to_owned(),
            title: "Intro to a fintech CFO".to_owned(),
            detail: "Selling into finance teams".to_owned(),
        }],
    }
}

fn publish(app: &mut TestHost<MeroUpdates>, title: &str) -> String {
    app.call(|s| s.publish_update(input(title))).unwrap()
}

fn as_investor<R>(app: &mut TestHost<MeroUpdates>, f: impl FnOnce(&mut MeroUpdates) -> R) -> R {
    app.call_as_account(INVESTOR, INVESTOR_DEVICE, f)
}

// ── roles ────────────────────────────────────────────────────────────────────

#[test]
fn the_creator_is_admin_and_team_and_a_reader_is_neither() {
    let mut app = new_app();
    let me = app.view(|s| s.get_me()).unwrap();
    assert!(me.is_admin && me.is_team);

    let them = as_investor(&mut app, |s| s.get_me()).unwrap();
    assert!(!them.is_admin && !them.is_team);
}

#[test]
fn only_the_team_can_publish() {
    let mut app = new_app();
    assert!(as_investor(&mut app, |s| s.publish_update(input("x"))).is_err());
    publish(&mut app, "Founder can");
}

#[test]
fn an_admin_can_add_a_teammate_who_can_then_publish() {
    let mut app = new_app();
    let cofounder = account_hex(COFOUNDER);
    app.call(|s| s.add_teammate(cofounder.clone())).unwrap();
    app.call_as_account(COFOUNDER, COFOUNDER_DEVICE, |s| {
        s.publish_update(input("By the CTO"))
    })
    .unwrap();

    app.call(|s| s.remove_teammate(cofounder)).unwrap();
    assert!(app
        .call_as_account(COFOUNDER, COFOUNDER_DEVICE, |s| s
            .publish_update(input("again")))
        .is_err());
}

#[test]
fn a_reader_cannot_grant_themselves_the_team_role() {
    let mut app = new_app();
    let me = account_hex(INVESTOR);
    assert!(as_investor(&mut app, |s| s.add_teammate(me)).is_err());
}

#[test]
fn a_garbage_account_is_rejected() {
    let mut app = new_app();
    assert!(app.call(|s| s.add_teammate("nope".to_owned())).is_err());
}

// ── settings & categories ────────────────────────────────────────────────────

#[test]
fn settings_round_trip_and_readers_cannot_change_them() {
    let mut app = new_app();
    app.call(|s| s.set_settings("Acme".to_owned(), 30)).unwrap();
    let got = app.view(|s| s.get_settings()).unwrap();
    assert_eq!(got.company_name, "Acme");
    assert_eq!(got.cadence_days, 30);
    assert!(as_investor(&mut app, |s| s.set_settings("Hijack".to_owned(), 1)).is_err());
}

#[test]
fn categories_are_team_managed_and_archiving_hides_them() {
    let mut app = new_app();
    let id = app
        .call(|s| s.create_category("Monthly".to_owned(), "📅".to_owned(), "#3b82f6".to_owned()))
        .unwrap();
    assert!(as_investor(&mut app, |s| s.create_category(
        "Spam".to_owned(),
        String::new(),
        String::new()
    ))
    .is_err());

    app.call(|s| {
        s.edit_category(
            id.clone(),
            "Monthly update".to_owned(),
            "📅".to_owned(),
            "#000".to_owned(),
        )
    })
    .unwrap();
    let cats = app.view(|s| s.list_categories()).unwrap();
    assert_eq!(cats.len(), 1);
    assert_eq!(cats[0].name, "Monthly update");

    app.call(|s| s.archive_category(id.clone())).unwrap();
    assert!(app.view(|s| s.list_categories()).unwrap().is_empty());

    // An archived category cannot take new updates.
    let mut i = input("x");
    i.category_id = id;
    assert!(app.call(|s| s.publish_update(i)).is_err());
}

#[test]
fn category_counts_and_filters_follow_the_updates() {
    let mut app = new_app();
    let monthly = app
        .call(|s| s.create_category("Monthly".to_owned(), String::new(), String::new()))
        .unwrap();
    let mut i = input("June");
    i.category_id = monthly.clone();
    app.call(|s| s.publish_update(i)).unwrap();
    publish(&mut app, "Uncategorised");

    let cats = as_investor(&mut app, |s| s.list_categories()).unwrap();
    assert_eq!(cats[0].update_count, 1);
    assert_eq!(cats[0].unread_count, 1);

    let page = app
        .view(|s| s.list_posts(Some(KIND_UPDATE.to_owned()), Some(monthly), None, 10))
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].title, "June");
}

#[test]
fn muting_a_category_drops_it_from_unread() {
    let mut app = new_app();
    let hiring = app
        .call(|s| s.create_category("Hiring".to_owned(), String::new(), String::new()))
        .unwrap();
    let mut i = input("We're hiring");
    i.category_id = hiring.clone();
    app.call(|s| s.publish_update(i)).unwrap();

    assert_eq!(
        as_investor(&mut app, |s| s.get_overview())
            .unwrap()
            .unread_updates,
        1
    );
    as_investor(&mut app, |s| s.set_muted_categories(vec![hiring.clone()])).unwrap();
    assert_eq!(
        as_investor(&mut app, |s| s.get_overview())
            .unwrap()
            .unread_updates,
        0
    );
    assert!(as_investor(&mut app, |s| s.list_categories()).unwrap()[0].muted);
}

// ── updates ──────────────────────────────────────────────────────────────────

#[test]
fn an_update_round_trips_without_its_empty_sections() {
    let mut app = new_app();
    let id = publish(&mut app, "May update");
    let view = as_investor(&mut app, |s| s.get_post(id)).unwrap();
    assert_eq!(view.card.title, "May update");
    assert_eq!(view.card.kind, KIND_UPDATE);
    assert!(view.card.author_is_team);
    assert_eq!(
        view.sections.len(),
        1,
        "the blank placeholder must be dropped"
    );
    assert_eq!(view.metrics[0].value, "$42k");
    assert_eq!(view.asks.len(), 1);
    assert_eq!(view.asks[0].status, "open");
}

#[test]
fn oversized_or_invalid_input_is_rejected() {
    let mut app = new_app();
    let mut i = input("x");
    i.title = " ".to_owned();
    assert!(app.call(|s| s.publish_update(i)).is_err());

    let mut i = input("x");
    i.asks[0].kind = "bribe".to_owned();
    assert!(app.call(|s| s.publish_update(i)).is_err());

    let mut i = input("x");
    i.sections[0].body = "x".repeat(MAX_BODY + 1);
    assert!(app.call(|s| s.publish_update(i)).is_err());
}

#[test]
fn editing_an_update_keeps_listed_asks_and_removes_the_rest() {
    let mut app = new_app();
    let id = publish(&mut app, "v1");
    let ask_id = app.view(|s| s.get_post(id.clone())).unwrap().asks[0]
        .id
        .clone();

    let mut i = input("v2");
    i.asks = vec![
        AskInput {
            id: Some(ask_id.clone()),
            kind: "intro".to_owned(),
            title: "Intro to a fintech CFO (edited)".to_owned(),
            detail: String::new(),
        },
        AskInput {
            id: None,
            kind: "hire".to_owned(),
            title: "Senior Rust engineer".to_owned(),
            detail: String::new(),
        },
    ];
    app.call(|s| s.edit_update(id.clone(), i)).unwrap();
    let view = app.view(|s| s.get_post(id.clone())).unwrap();
    assert_eq!(view.card.title, "v2");
    assert_eq!(view.asks.len(), 2);
    assert_eq!(view.asks[0].id, ask_id, "the edited ask keeps its id");

    let mut i = input("v3");
    i.asks = Vec::new();
    app.call(|s| s.edit_update(id.clone(), i)).unwrap();
    assert!(app.view(|s| s.get_post(id)).unwrap().asks.is_empty());
}

#[test]
fn a_reader_cannot_edit_or_delete_an_update() {
    let mut app = new_app();
    let id = publish(&mut app, "mine");
    assert!(as_investor(&mut app, |s| s.edit_update(id.clone(), input("hijack"))).is_err());
    assert!(as_investor(&mut app, |s| s.delete_post(id.clone())).is_err());
    assert_eq!(app.view(|s| s.get_post(id)).unwrap().card.title, "mine");
}

#[test]
fn a_deleted_update_leaves_the_feed_and_takes_its_asks_along() {
    let mut app = new_app();
    let id = publish(&mut app, "gone");
    app.call(|s| s.delete_post(id.clone())).unwrap();
    assert!(app.view(|s| s.get_post(id)).is_err());
    assert!(app
        .view(|s| s.list_posts(None, None, None, 10))
        .unwrap()
        .items
        .is_empty());
    assert!(app.view(|s| s.list_asks(None)).unwrap().is_empty());
    assert_eq!(app.view(|s| s.get_overview()).unwrap().open_asks, 0);
}

#[test]
fn the_feed_pages_newest_first_without_skipping_or_repeating() {
    let mut app = new_app();
    for i in 0..7 {
        publish(&mut app, &format!("u{i}"));
    }
    let mut seen = Vec::new();
    let mut cursor = None;
    loop {
        let page = app
            .view(|s| s.list_posts(None, None, cursor.clone(), 3))
            .unwrap();
        seen.extend(page.items.iter().map(|p| p.id.clone()));
        match page.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
    }
    assert_eq!(seen.len(), 7);
    let mut d = seen.clone();
    d.sort();
    d.dedup();
    assert_eq!(d.len(), 7);
}

// ── questions (the investor-initiated half) ──────────────────────────────────

#[test]
fn a_reader_can_ask_and_the_team_can_answer() {
    let mut app = new_app();
    let q = as_investor(&mut app, |s| {
        s.ask_question(
            "What's the runway?".to_owned(),
            "After the hire plan".to_owned(),
            None,
        )
    })
    .unwrap();
    assert_eq!(app.view(|s| s.get_overview()).unwrap().open_questions, 1);

    // Readers cannot close questions, the team can.
    assert!(as_investor(&mut app, |s| s
        .set_question_status(q.clone(), "answered".to_owned()))
    .is_err());
    app.call(|s| s.add_comment(q.clone(), None, "18 months.".to_owned()))
        .unwrap();
    app.call(|s| s.set_question_status(q.clone(), "answered".to_owned()))
        .unwrap();
    let view = app.view(|s| s.get_post(q.clone())).unwrap();
    assert_eq!(view.card.status, "answered");
    assert!(!view.card.author_is_team);
    assert_eq!(app.view(|s| s.get_overview()).unwrap().open_questions, 0);

    let questions = app
        .view(|s| s.list_posts(Some(KIND_QUESTION.to_owned()), None, None, 10))
        .unwrap();
    assert_eq!(questions.items.len(), 1);
    // A question is not an update.
    let updates = app
        .view(|s| s.list_posts(Some(KIND_UPDATE.to_owned()), None, None, 10))
        .unwrap();
    assert!(updates.items.is_empty());
}

#[test]
fn the_asker_can_delete_their_question_but_not_someone_elses() {
    let mut app = new_app();
    let q = as_investor(&mut app, |s| {
        s.ask_question("q".to_owned(), String::new(), None)
    })
    .unwrap();
    let other = app
        .call_as_account(COFOUNDER, COFOUNDER_DEVICE, |s| {
            s.ask_question("q2".to_owned(), String::new(), None)
        })
        .unwrap();
    assert!(as_investor(&mut app, |s| s.delete_post(other)).is_err());
    as_investor(&mut app, |s| s.delete_post(q)).unwrap();
}

// ── comments & reactions ─────────────────────────────────────────────────────

#[test]
fn replies_thread_one_level_deep() {
    let mut app = new_app();
    let id = publish(&mut app, "u");
    let top = as_investor(&mut app, |s| {
        s.add_comment(id.clone(), None, "Congrats!".to_owned())
    })
    .unwrap();
    let reply = app
        .call(|s| s.add_comment(id.clone(), Some(top.clone()), "Thanks!".to_owned()))
        .unwrap();
    // A reply to a reply attaches to the top-level comment.
    let nested = as_investor(&mut app, |s| {
        s.add_comment(id.clone(), Some(reply.clone()), "🙌".to_owned())
    })
    .unwrap();
    let thread = app.view(|s| s.list_comments(id.clone())).unwrap();
    assert_eq!(thread.len(), 3);
    let n = thread.iter().find(|c| c.id == nested).unwrap();
    assert_eq!(n.parent_id, top);
    assert!(
        thread
            .iter()
            .find(|c| c.id == reply)
            .unwrap()
            .author_is_team
    );
    assert_eq!(app.view(|s| s.get_post(id)).unwrap().card.comment_count, 3);
}

#[test]
fn only_the_author_edits_a_comment_but_the_team_can_moderate() {
    let mut app = new_app();
    let id = publish(&mut app, "u");
    let c = as_investor(&mut app, |s| {
        s.add_comment(id.clone(), None, "hi".to_owned())
    })
    .unwrap();
    assert!(app
        .call(|s| s.edit_comment(c.clone(), "rewritten".to_owned()))
        .is_err());
    as_investor(&mut app, |s| s.edit_comment(c.clone(), "hello".to_owned())).unwrap();
    app.call(|s| s.delete_comment(c)).unwrap();
    assert!(app.view(|s| s.list_comments(id)).unwrap().is_empty());
}

#[test]
fn reactions_are_one_per_account_per_emoji_and_can_be_retracted() {
    let mut app = new_app();
    let id = publish(&mut app, "u");
    as_investor(&mut app, |s| s.react(id.clone(), "🎉".to_owned(), true)).unwrap();
    as_investor(&mut app, |s| s.react(id.clone(), "🎉".to_owned(), true)).unwrap();
    app.call(|s| s.react(id.clone(), "🎉".to_owned(), true))
        .unwrap();
    // The founder's second device is the same person.
    app.call_as(FOUNDER_PHONE, |s| {
        s.react(id.clone(), "🎉".to_owned(), true)
    })
    .unwrap();

    let count = |app: &TestHost<MeroUpdates>| {
        app.view(|s| s.get_post(id.clone()))
            .unwrap()
            .card
            .reactions
            .into_iter()
            .find(|r| r.emoji == "🎉")
            .unwrap()
    };
    let r = count(&app);
    assert_eq!(r.count, 2);
    assert!(r.mine);

    as_investor(&mut app, |s| s.react(id.clone(), "🎉".to_owned(), false)).unwrap();
    assert_eq!(count(&app).count, 1);
    assert!(app
        .call(|s| s.react(id.clone(), "💩".to_owned(), true))
        .is_err());
}

// ── asks, offers, contributions ──────────────────────────────────────────────

#[test]
fn a_reader_offers_help_and_the_team_accepts_it_into_a_contribution() {
    let mut app = new_app();
    app.call(|s| s.set_profile("Ana Founder".to_owned(), "Acme".to_owned()))
        .unwrap();
    as_investor(&mut app, |s| {
        s.set_profile("Ben Investor".to_owned(), "Seed Fund".to_owned())
    })
    .unwrap();
    let id = publish(&mut app, "u");
    let ask = app.view(|s| s.get_post(id.clone())).unwrap().asks[0]
        .id
        .clone();

    as_investor(&mut app, |s| {
        s.offer_help(ask.clone(), "I know two CFOs".to_owned())
    })
    .unwrap();
    // Offering again edits, it does not duplicate.
    as_investor(&mut app, |s| {
        s.offer_help(ask.clone(), "I know three CFOs".to_owned())
    })
    .unwrap();

    // The reader sees their own offer but not the list; the team sees the list.
    let reader_view = as_investor(&mut app, |s| s.get_post(id.clone())).unwrap();
    assert_eq!(reader_view.asks[0].offer_count, 1);
    assert!(reader_view.asks[0].offers.is_empty());
    assert_eq!(
        reader_view.asks[0].my_offer.as_ref().unwrap().note,
        "I know three CFOs"
    );
    let team_view = app.view(|s| s.get_post(id.clone())).unwrap();
    assert_eq!(team_view.asks[0].offers[0].name, "Ben Investor");

    let investor = account_hex(INVESTOR);
    assert!(as_investor(&mut app, |s| s.set_offer_status(
        ask.clone(),
        investor.clone(),
        "accepted".to_owned()
    ))
    .is_err());
    app.call(|s| s.set_offer_status(ask.clone(), investor.clone(), "accepted".to_owned()))
        .unwrap();

    let thanks = app.view(|s| s.list_contributions(0)).unwrap();
    assert_eq!(thanks.len(), 1);
    assert_eq!(thanks[0].name, "Ben Investor");
    assert_eq!(thanks[0].ask_title, "Intro to a fintech CFO");

    // A helper editing their note must not undo the acceptance.
    as_investor(&mut app, |s| {
        s.offer_help(ask.clone(), "and a controller".to_owned())
    })
    .unwrap();
    assert_eq!(app.view(|s| s.list_contributions(0)).unwrap().len(), 1);

    let people = app.view(|s| s.list_people()).unwrap();
    let ben = people.iter().find(|p| p.account == investor).unwrap();
    assert_eq!(ben.accepted_offers, 1);
}

#[test]
fn a_withdrawn_offer_disappears_and_a_resolved_ask_takes_no_more() {
    let mut app = new_app();
    let id = publish(&mut app, "u");
    let ask = app.view(|s| s.get_post(id.clone())).unwrap().asks[0]
        .id
        .clone();
    as_investor(&mut app, |s| s.offer_help(ask.clone(), String::new())).unwrap();
    as_investor(&mut app, |s| s.withdraw_offer(ask.clone())).unwrap();
    assert_eq!(app.view(|s| s.list_asks(None)).unwrap()[0].offer_count, 0);

    assert!(as_investor(&mut app, |s| s
        .set_ask_status(ask.clone(), "resolved".to_owned()))
    .is_err());
    app.call(|s| s.set_ask_status(ask.clone(), "resolved".to_owned()))
        .unwrap();
    assert!(as_investor(&mut app, |s| s.offer_help(ask.clone(), String::new())).is_err());
    assert_eq!(
        app.view(|s| s.list_asks(Some("open".to_owned())))
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        app.view(|s| s.list_asks(Some("resolved".to_owned())))
            .unwrap()
            .len(),
        1
    );
}

// ── reads & engagement ───────────────────────────────────────────────────────

#[test]
fn reads_feed_unread_counts_and_the_teams_follow_up_list() {
    let mut app = new_app();
    as_investor(&mut app, |s| s.set_profile("Ben".to_owned(), String::new())).unwrap();
    app.call_as_account([0xD0; 32], [0xD1; 32], |s| {
        s.set_profile("Dee".to_owned(), String::new())
    })
    .unwrap();
    let id = publish(&mut app, "u");

    assert_eq!(
        as_investor(&mut app, |s| s.get_overview())
            .unwrap()
            .unread_updates,
        1
    );
    // The author has read their own update.
    assert_eq!(app.view(|s| s.get_overview()).unwrap().unread_updates, 0);

    as_investor(&mut app, |s| s.mark_read(id.clone())).unwrap();
    as_investor(&mut app, |s| s.mark_read(id.clone())).unwrap();
    let card = as_investor(&mut app, |s| s.get_post(id.clone()))
        .unwrap()
        .card;
    assert!(card.read_by_me);
    assert_eq!(card.read_count, 2, "founder + Ben, each once");

    let rows = app.view(|s| s.get_engagement()).unwrap();
    assert_eq!(rows[0].readers.len(), 1, "the team is not its own audience");
    assert_eq!(rows[0].readers[0].name, "Ben");
    assert_eq!(rows[0].not_read.len(), 1);
    assert_eq!(rows[0].not_read[0].name, "Dee");

    assert!(as_investor(&mut app, |s| s.get_engagement()).is_err());

    let people = app.view(|s| s.list_people()).unwrap();
    assert!(people[0].is_team, "the team sorts first");
    let ben = people.iter().find(|p| p.name == "Ben").unwrap();
    assert_eq!((ben.updates_read, ben.updates_total), (1, 1));
}

#[test]
fn the_overview_computes_the_next_due_date_from_the_cadence() {
    let mut app = new_app();
    assert_eq!(app.view(|s| s.get_overview()).unwrap().next_due_at, 0);
    app.call(|s| s.set_settings("Acme".to_owned(), 30)).unwrap();
    publish(&mut app, "u");
    let o = app.view(|s| s.get_overview()).unwrap();
    assert_eq!(o.next_due_at, o.last_update_at + 30 * 86_400_000);
    assert_eq!(o.updates_total, 1);
    assert_eq!(o.open_asks, 1);
    assert!(o.is_team);
}

// ── metrics ──────────────────────────────────────────────────────────────────

#[test]
fn metrics_group_into_series_across_updates() {
    let mut app = new_app();
    publish(&mut app, "May");
    let mut june = input("June");
    june.metrics = vec![
        Metric {
            name: "mrr".to_owned(),
            value: "$48k".to_owned(),
            unit: String::new(),
        },
        Metric {
            name: "Runway".to_owned(),
            value: "18".to_owned(),
            unit: "months".to_owned(),
        },
    ];
    app.call(|s| s.publish_update(june)).unwrap();
    let series = app.view(|s| s.list_metrics()).unwrap();
    assert_eq!(series.len(), 2);
    let mrr = series
        .iter()
        .find(|s| s.name.eq_ignore_ascii_case("mrr"))
        .unwrap();
    assert_eq!(mrr.points.len(), 2);
    assert_eq!(mrr.points[0].value, "$42k");
    assert_eq!(mrr.points[1].value, "$48k");
}

// ── drafts ───────────────────────────────────────────────────────────────────

#[test]
fn drafts_save_list_overwrite_and_delete() {
    let mut app = new_app();
    let id = app
        .call(|s| s.save_draft(None, "July".to_owned(), "{\"a\":1}".to_owned()))
        .unwrap();
    app.call(|s| {
        s.save_draft(
            Some(id.clone()),
            "July v2".to_owned(),
            "{\"a\":2}".to_owned(),
        )
    })
    .unwrap();
    let drafts = app.view(|s| s.list_drafts()).unwrap();
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].title, "July v2");
    app.call(|s| s.delete_draft(id)).unwrap();
    assert!(app.view(|s| s.list_drafts()).unwrap().is_empty());
}

// ── profiles ─────────────────────────────────────────────────────────────────

#[test]
fn a_profile_is_per_account_and_bounded() {
    let mut app = new_app();
    app.call(|s| s.set_profile("Ana".to_owned(), "Acme".to_owned()))
        .unwrap();
    let id = app
        .call_as(FOUNDER_PHONE, |s| s.publish_update(input("from my phone")))
        .unwrap();
    assert_eq!(
        app.view(|s| s.get_post(id)).unwrap().card.author_name,
        "Ana"
    );
    assert!(app
        .call(|s| s.set_profile("x".repeat(65), String::new()))
        .is_err());
}

// ── merge semantics ──────────────────────────────────────────────────────────

fn a_post(edited_at: u64, title: &str, status: &str, status_at: u64, deleted: bool) -> Post {
    Post {
        id: "p".to_owned(),
        kind: KIND_QUESTION.to_owned(),
        author: "a".to_owned(),
        content: PostContent {
            title: title.to_owned(),
            summary: String::new(),
            category_id: String::new(),
            sections: Vec::new(),
            metrics: Vec::new(),
        },
        edited_at,
        created_at: 1,
        status: status.to_owned(),
        status_at,
        deleted,
    }
}

fn converge<T: Mergeable + Clone>(a: &T, b: &T) -> (T, T) {
    let (mut l, mut r) = (a.clone(), b.clone());
    l.merge(b).unwrap();
    r.merge(a).unwrap();
    (l, r)
}

#[test]
fn content_and_status_merge_independently() {
    // Left: the author fixed a typo later. Right: the team answered later.
    let left = a_post(20, "fixed typo", "open", 5, false);
    let right = a_post(10, "fixd typo", "answered", 30, false);
    let (l, r) = converge(&left, &right);
    for m in [&l, &r] {
        assert_eq!(m.content.title, "fixed typo");
        assert_eq!(
            m.status, "answered",
            "a later edit must not reopen a question"
        );
    }
}

#[test]
fn a_timestamp_tie_still_converges() {
    let (l, r) = converge(
        &a_post(10, "alpha", "open", 1, false),
        &a_post(10, "beta", "open", 1, false),
    );
    assert_eq!(l.content.title, r.content.title);
}

#[test]
fn a_tombstone_survives_a_newer_edit() {
    let (l, r) = converge(
        &a_post(10, "gone", "open", 1, true),
        &a_post(99, "back", "open", 1, false),
    );
    assert!(l.deleted && r.deleted);
}

#[test]
fn an_offers_acceptance_and_its_note_merge_independently() {
    let base = Offer {
        ask_id: "a".to_owned(),
        account: "b".to_owned(),
        helper: OfferByHelper {
            note: "old".to_owned(),
            withdrawn: false,
        },
        updated_at: 1,
        created_at: 1,
        status: "offered".to_owned(),
        status_at: 1,
    };
    let mut helper_edit = base.clone();
    helper_edit.helper.note = "new".to_owned();
    helper_edit.updated_at = 5;
    let mut team_accept = base;
    team_accept.status = "accepted".to_owned();
    team_accept.status_at = 3;
    let (l, r) = converge(&helper_edit, &team_accept);
    for m in [&l, &r] {
        assert_eq!(m.helper.note, "new");
        assert_eq!(m.status, "accepted");
    }
}

#[test]
fn a_read_receipt_keeps_the_first_and_latest_read() {
    let a = Read {
        post_id: "p".to_owned(),
        account: "x".to_owned(),
        first_at: 10,
        last_at: 10,
    };
    let b = Read {
        first_at: 5,
        last_at: 50,
        ..a.clone()
    };
    let (l, r) = converge(&a, &b);
    assert_eq!((l.first_at, l.last_at), (5, 50));
    assert_eq!((r.first_at, r.last_at), (5, 50));
}

#[test]
fn merging_is_idempotent() {
    let mut left = a_post(10, "x", "open", 1, false);
    let right = a_post(20, "y", "answered", 2, false);
    left.merge(&right).unwrap();
    let once = left.clone();
    left.merge(&right).unwrap();
    assert_eq!(left.content, once.content);
    assert_eq!(left.status, once.status);
}

/// Timestamps are unix MILLISECONDS. A nanosecond value is past 2^53 and loses
/// digits the moment the browser JSON-decodes it.
#[test]
fn timestamps_are_milliseconds_that_fit_a_js_number() {
    let mut app = new_app();
    let id = publish(&mut app, "u");
    let at = app.view(|s| s.get_post(id)).unwrap().card.created_at;
    assert!(at > 1_600_000_000_000, "not a plausible ms timestamp: {at}");
    assert!(at < (1u64 << 53), "past Number.MAX_SAFE_INTEGER: {at}");
}
