//! In-process tests: TestHost drives real CRDT state with no node and no wasm.
//!
//! "Someone else" is always a second ACCOUNT. `call_as` alone moves only the
//! device and keeps the account, which models one person's second machine —
//! and since authorship is per account, a test using it for another person
//! would silently assert nothing.

use calimero_sdk::testing::TestHost;

use super::*;

const BOB: [u8; 32] = [0xB0; 32];
const BOB_DEVICE: [u8; 32] = [0xB1; 32];
const CAROL: [u8; 32] = [0xC0; 32];
const CAROL_DEVICE: [u8; 32] = [0xC1; 32];
/// The default caller, on a second machine.
const MY_PHONE: [u8; 32] = [0xA2; 32];

fn team() -> TestHost<MeroStandup> {
    TestHost::new(MeroStandup::init)
}

fn post(app: &mut TestHost<MeroStandup>, day: &str, done: &str, blockers: &str) {
    app.call(|s| {
        s.post_update(
            day.to_owned(),
            done.to_owned(),
            "next".to_owned(),
            blockers.to_owned(),
        )
    })
    .unwrap();
}

fn post_as(app: &mut TestHost<MeroStandup>, who: ([u8; 32], [u8; 32]), day: &str, blockers: &str) {
    app.call_as_account(who.0, who.1, |s| {
        s.post_update(
            day.to_owned(),
            "done".to_owned(),
            "next".to_owned(),
            blockers.to_owned(),
        )
    })
    .unwrap();
}

fn log(app: &mut TestHost<MeroStandup>, title: &str, supersedes: Option<&str>) -> String {
    app.call(|s| {
        s.log_decision(
            title.to_owned(),
            "we do it".to_owned(),
            "because".to_owned(),
            supersedes.map(str::to_owned),
            vec![],
            vec![],
            None,
        )
    })
    .unwrap()
}

// ── days ─────────────────────────────────────────────────────────────────────

#[test]
fn a_day_must_be_a_real_date() {
    assert_eq!(parse_day("2026-10-13"), Some((2026, 10, 13)));
    assert_eq!(parse_day("2028-02-29"), Some((2028, 2, 29)));
    for bad in [
        "2026-02-29", // not a leap year
        "2026-13-01",
        "2026-00-10",
        "2026-04-31",
        "2026-1-01",
        "26-10-13",
        "2026/10/13",
        "1999-12-31",
        "２０２６-10-13",
        "",
    ] {
        assert_eq!(parse_day(bad), None, "{bad} should not parse");
    }
}

#[test]
fn posting_for_a_non_date_is_refused() {
    let mut app = team();
    let res = app.call(|s| {
        s.post_update(
            "today".to_owned(),
            "x".to_owned(),
            String::new(),
            String::new(),
        )
    });
    assert!(res.is_err());
}

// ── standups ─────────────────────────────────────────────────────────────────

#[test]
fn an_update_round_trips_with_its_author_from_the_stamp() {
    let mut app = team();
    post(&mut app, "2026-10-13", "shipped the thing", "");
    let me = app.view(|s| s.whoami()).unwrap();

    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates.len(), 1);
    assert_eq!(day.updates[0].author, me);
    assert_eq!(day.updates[0].done, "shipped the thing");
    assert_eq!(day.updates[0].blockers, "");
}

#[test]
fn an_empty_update_is_refused_and_an_oversized_one_too() {
    let mut app = team();
    assert!(app
        .call(|s| s.post_update(
            "2026-10-13".to_owned(),
            "  ".to_owned(),
            String::new(),
            "\n".to_owned()
        ))
        .is_err());
    assert!(app
        .call(|s| s.post_update(
            "2026-10-13".to_owned(),
            "x".repeat(MAX_FIELD + 1),
            String::new(),
            String::new()
        ))
        .is_err());
}

/// One entry per account per day: posting again rewrites it, keeps when it
/// was first posted, and does not add a second row.
#[test]
fn posting_twice_the_same_day_rewrites_the_update() {
    let mut app = team();
    post(&mut app, "2026-10-13", "first", "");
    let first = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    post(&mut app, "2026-10-13", "second", "waiting on review");

    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates.len(), 1);
    assert_eq!(day.updates[0].done, "second");
    assert_eq!(day.updates[0].blockers, "waiting on review");
    assert_eq!(day.updates[0].created_at, first.updates[0].created_at);
}

/// Per account, not per device: the phone edits the laptop's update.
#[test]
fn my_second_device_edits_the_same_update() {
    let mut app = team();
    post(&mut app, "2026-10-13", "from the laptop", "");
    app.call_as(MY_PHONE, |s| {
        s.post_update(
            "2026-10-13".to_owned(),
            "from the phone".to_owned(),
            String::new(),
            String::new(),
        )
    })
    .unwrap();
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates.len(), 1);
    assert_eq!(day.updates[0].done, "from the phone");
}

/// Bob posting for the same day lands BESIDE my update, never over it: keys
/// are per owner, so there is no shared key for him to overwrite.
#[test]
fn someone_else_posting_the_same_day_cannot_touch_mine() {
    let mut app = team();
    post(&mut app, "2026-10-13", "mine", "");
    post_as(&mut app, (BOB, BOB_DEVICE), "2026-10-13", "");

    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates.len(), 2);
    assert!(day.updates.iter().any(|u| u.done == "mine"));

    // And Bob clearing "his" update for the day clears only his.
    app.call_as_account(BOB, BOB_DEVICE, |s| s.clear_update("2026-10-13".to_owned()))
        .unwrap();
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates.len(), 1);
    assert_eq!(day.updates[0].done, "mine");
}

#[test]
fn clearing_needs_an_update_and_posting_again_restores_it() {
    let mut app = team();
    assert!(app
        .call(|s| s.clear_update("2026-10-13".to_owned()))
        .is_err());

    post(&mut app, "2026-10-13", "oops", "");
    app.call(|s| s.clear_update("2026-10-13".to_owned()))
        .unwrap();
    assert!(app
        .view(|s| s.get_day("2026-10-13".to_owned()))
        .unwrap()
        .updates
        .is_empty());
    assert!(app.view(|s| s.list_days(None, 10)).unwrap().days.is_empty());

    post(&mut app, "2026-10-13", "for real", "");
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates[0].done, "for real");
}

#[test]
fn days_list_newest_first_with_counts_and_page_without_gaps() {
    let mut app = team();
    for d in 10..=16 {
        post(&mut app, &format!("2026-10-{d}"), "x", "");
    }
    post_as(&mut app, (BOB, BOB_DEVICE), "2026-10-16", "blocked on CI");

    let first = app.view(|s| s.list_days(None, 3)).unwrap();
    assert_eq!(
        first.days[0],
        DaySummary {
            day: "2026-10-16".to_owned(),
            updates: 2,
            blocked: 1
        }
    );
    let mut seen: Vec<String> = first.days.iter().map(|d| d.day.clone()).collect();
    let mut cursor = first.next_cursor;
    while let Some(c) = cursor {
        let page = app.view(|s| s.list_days(Some(c.clone()), 3)).unwrap();
        seen.extend(page.days.iter().map(|d| d.day.clone()));
        cursor = page.next_cursor;
    }
    let want: Vec<String> = (10..=16).rev().map(|d| format!("2026-10-{d}")).collect();
    assert_eq!(seen, want);
}

/// Only each member's LATEST update counts: a blocker you posted past is not
/// blocking anyone any more.
#[test]
fn current_blockers_are_each_members_latest_update_only() {
    let mut app = team();
    post(&mut app, "2026-10-12", "x", "old blocker");
    post(&mut app, "2026-10-13", "x", "");
    post_as(
        &mut app,
        (BOB, BOB_DEVICE),
        "2026-10-13",
        "need a design review",
    );
    post_as(
        &mut app,
        (CAROL, CAROL_DEVICE),
        "2026-10-11",
        "waiting on legal",
    );

    let blockers = app.view(|s| s.current_blockers()).unwrap();
    let texts: Vec<&str> = blockers.iter().map(|b| b.blockers.as_str()).collect();
    assert_eq!(texts, vec!["need a design review", "waiting on legal"]);
}

#[test]
fn members_are_everyone_who_posted_or_named_themselves() {
    let mut app = team();
    post(&mut app, "2026-10-12", "x", "");
    post(&mut app, "2026-10-13", "x", "");
    app.call_as_account(CAROL, CAROL_DEVICE, |s| s.set_name("Carol".to_owned()))
        .unwrap();

    let members = app.view(|s| s.members()).unwrap();
    assert_eq!(members.len(), 2);
    let me = app.view(|s| s.whoami()).unwrap();
    let mine = members.iter().find(|m| m.account == me).unwrap();
    assert_eq!(mine.last_day, "2026-10-13");
    let carol = members.iter().find(|m| m.name == "Carol").unwrap();
    assert_eq!(carol.last_day, "");
}

// ── names ────────────────────────────────────────────────────────────────────

#[test]
fn a_name_reaches_other_readers_and_an_empty_one_clears_it() {
    let mut app = team();
    let (my_account, my_device) = (app.account_id(), app.device_id());
    app.call(|s| s.set_name("  Ana  ".to_owned())).unwrap();
    post(&mut app, "2026-10-13", "x", "");
    let me = app.view(|s| s.whoami()).unwrap();

    app.set_account(BOB);
    app.set_device(BOB_DEVICE);
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates[0].author_name, "Ana");
    assert_eq!(app.view(|s| s.get_name(me.clone())).unwrap(), "Ana");

    app.set_account(my_account);
    app.set_device(my_device);
    app.call(|s| s.set_name(String::new())).unwrap();
    assert_eq!(app.view(|s| s.get_name(me)).unwrap(), "");
    assert!(app.call(|s| s.set_name("x".repeat(MAX_NAME + 1))).is_err());
}

// ── decisions ────────────────────────────────────────────────────────────────

#[test]
fn a_decision_round_trips_and_needs_a_title_and_a_decision() {
    let mut app = team();
    let id = log(&mut app, "Use Postgres", None);
    let me = app.view(|s| s.whoami()).unwrap();
    let d = app.view(|s| s.get_decision(id.clone())).unwrap();
    assert_eq!(d.title, "Use Postgres");
    assert_eq!(d.author, me);
    assert_eq!(d.supersedes, "");
    assert_eq!(d.superseded_by, "");
    assert_eq!(id.len(), 32, "16 random bytes, hex");

    for (title, decision) in [("", "x"), ("x", "  ")] {
        assert!(app
            .call(|s| s.log_decision(
                title.to_owned(),
                decision.to_owned(),
                String::new(),
                None,
                vec![],
                vec![],
                None
            ))
            .is_err());
    }
    assert!(app.view(|s| s.get_decision("nope".to_owned())).is_err());
}

#[test]
fn superseding_is_derived_and_shows_on_both_ends() {
    let mut app = team();
    let old = log(&mut app, "Ship weekly", None);
    let new = log(&mut app, "Ship daily", Some(&old));

    let old_view = app.view(|s| s.get_decision(old.clone())).unwrap();
    assert_eq!(old_view.superseded_by, new);
    let new_view = app.view(|s| s.get_decision(new.clone())).unwrap();
    assert_eq!(new_view.supersedes, old);

    // Standing-only leaves out the replaced one.
    let standing = app
        .view(|s| s.list_decisions(None, None, None, true, None, 10))
        .unwrap();
    let ids: Vec<&str> = standing.items.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(ids, vec![new.as_str()]);
}

#[test]
fn superseding_needs_a_real_standing_decision() {
    let mut app = team();
    assert!(app
        .call(|s| s.log_decision(
            "t".to_owned(),
            "d".to_owned(),
            String::new(),
            Some("does-not-exist".to_owned()),
            vec![],
            vec![],
            None
        ))
        .is_err());

    let old = log(&mut app, "A", None);
    let _ = log(&mut app, "B", Some(&old));
    assert!(app
        .call(|s| s.log_decision(
            "C".to_owned(),
            "d".to_owned(),
            String::new(),
            Some(old.clone()),
            vec![],
            vec![],
            None
        ))
        .is_err());
}

/// Anyone on the team may supersede anyone's decision — the decision belongs
/// to the team — but the original is never rewritten: it is still there,
/// attributed to its author, marked as replaced.
#[test]
fn a_teammate_supersedes_my_decision_without_rewriting_it() {
    let mut app = team();
    let mine = log(&mut app, "Mine", None);
    let theirs = app
        .call_as_account(BOB, BOB_DEVICE, |s| {
            s.log_decision(
                "Theirs".to_owned(),
                "changed".to_owned(),
                String::new(),
                Some(mine.clone()),
                vec![],
                vec![],
                None,
            )
        })
        .unwrap();
    let me = app.view(|s| s.whoami()).unwrap();
    let original = app.view(|s| s.get_decision(mine.clone())).unwrap();
    assert_eq!(original.title, "Mine");
    assert_eq!(original.author, me);
    assert_eq!(original.superseded_by, theirs);
}

/// A forged row under the forger's own stamp claiming to supersede a NEWER
/// decision is inert: "older only" keeps the links acyclic, so it cannot mark
/// a decision as replaced by something logged before it existed.
#[test]
fn a_supersede_link_pointing_forward_in_time_is_ignored() {
    let mut app = team();
    let target = log(&mut app, "Real", None);
    let created = app
        .view(|s| s.get_decision(target.clone()))
        .unwrap()
        .created_at;

    // What a patched node can write: a decision dated BEFORE its target.
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.decisions.insert(
            "f".repeat(32),
            Decision {
                title: "forged".to_owned(),
                decision: "x".to_owned(),
                rationale: String::new(),
                supersedes: Some(target.clone()),
                created_at: created.saturating_sub(1),
            },
        )
    })
    .unwrap();

    let real = app.view(|s| s.get_decision(target.clone())).unwrap();
    assert_eq!(real.superseded_by, "");
    let forged = app.view(|s| s.get_decision("f".repeat(32))).unwrap();
    assert_eq!(forged.supersedes, "");
}

/// A patched node writing an update at a key that is not a date gets a row
/// nobody reads.
#[test]
fn an_update_at_a_non_date_key_is_inert() {
    let mut app = team();
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.updates.insert(
            "zzzz-forever".to_owned(),
            Update {
                done: "x".to_owned(),
                next: String::new(),
                blockers: "pinned to the top".to_owned(),
                created_at: 0,
                edited_at: 0,
                cleared: false,
            },
        )
    })
    .unwrap();
    assert!(app.view(|s| s.list_days(None, 10)).unwrap().days.is_empty());
    assert!(app.view(|s| s.current_blockers()).unwrap().is_empty());
    assert!(app.view(|s| s.members()).unwrap().is_empty());
}

#[test]
fn the_log_lists_newest_first_searches_and_pages() {
    let mut app = team();
    let mut ids = Vec::new();
    for i in 0..5 {
        ids.push(log(&mut app, &format!("Decision {i}"), None));
    }
    let _ = app
        .call(|s| {
            s.log_decision(
                "Pick a CI provider".to_owned(),
                "GitHub Actions".to_owned(),
                "It is where the code is".to_owned(),
                None,
                vec![],
                vec![],
                None,
            )
        })
        .unwrap();

    let hits = app
        .view(|s| s.list_decisions(Some("github".to_owned()), None, None, false, None, 10))
        .unwrap();
    assert_eq!(hits.items.len(), 1);
    assert_eq!(hits.items[0].title, "Pick a CI provider");

    let mut seen = Vec::new();
    let mut cursor = None;
    loop {
        let page = app
            .view(|s| s.list_decisions(None, None, None, false, cursor.clone(), 4))
            .unwrap();
        seen.extend(page.items.iter().map(|d| d.id.clone()));
        match page.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
    }
    assert_eq!(seen.len(), 6);
    let mut unique = seen.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 6, "a decision appeared on two pages");
}

#[test]
fn page_sizes_are_defaulted_and_capped() {
    assert_eq!(page_size(0), DEFAULT_PAGE);
    assert_eq!(page_size(7), 7);
    assert_eq!(page_size(u32::MAX), MAX_PAGE);
}

// ── v2: the team's name ──────────────────────────────────────────────────────

#[test]
fn any_member_names_the_team_and_an_empty_name_clears_it() {
    let mut app = team();
    assert_eq!(app.view(|s| s.team_name()).unwrap(), "");
    app.call(|s| s.set_team_name("  Platform  ".to_owned()))
        .unwrap();
    assert_eq!(app.view(|s| s.team_name()).unwrap(), "Platform");
    app.call_as_account(BOB, BOB_DEVICE, |s| s.set_team_name("Infra".to_owned()))
        .unwrap();
    assert_eq!(app.view(|s| s.team_name()).unwrap(), "Infra");
    assert!(app
        .call(|s| s.set_team_name("x".repeat(MAX_TEAM_NAME + 1)))
        .is_err());
    app.call(|s| s.set_team_name(String::new())).unwrap();
    assert_eq!(app.view(|s| s.team_name()).unwrap(), "");
}

// ── v2: helping with blockers ────────────────────────────────────────────────

fn bob_is_blocked(app: &mut TestHost<MeroStandup>) -> String {
    post_as(app, (BOB, BOB_DEVICE), "2026-10-13", "need prod access");
    app.call_as_account(BOB, BOB_DEVICE, |s| s.whoami())
        .unwrap()
}

#[test]
fn an_offer_to_help_shows_on_the_blocker_everywhere() {
    let mut app = team();
    let bob = bob_is_blocked(&mut app);
    app.call(|s| s.set_name("Ana".to_owned())).unwrap();
    app.call(|s| s.offer_help("2026-10-13".to_owned(), bob.clone(), "I have it".to_owned()))
        .unwrap();
    let me = app.view(|s| s.whoami()).unwrap();

    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    let helpers = &day.updates[0].helpers;
    assert_eq!(helpers.len(), 1);
    assert_eq!(helpers[0].account, me);
    assert_eq!(helpers[0].name, "Ana");
    assert_eq!(helpers[0].note, "I have it");

    let blockers = app.view(|s| s.current_blockers()).unwrap();
    assert_eq!(blockers[0].helpers.len(), 1);

    // Offering again rewrites the note rather than adding a second offer.
    app.call(|s| s.offer_help("2026-10-13".to_owned(), bob.clone(), "on it".to_owned()))
        .unwrap();
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates[0].helpers.len(), 1);
    assert_eq!(day.updates[0].helpers[0].note, "on it");
}

#[test]
fn help_needs_a_real_blocker_by_someone_else() {
    let mut app = team();
    let bob = bob_is_blocked(&mut app);
    // No update that day.
    assert!(app
        .call(|s| s.offer_help("2026-10-12".to_owned(), bob.clone(), String::new()))
        .is_err());
    // Not an account.
    assert!(app
        .call(|s| s.offer_help("2026-10-13".to_owned(), "bob".to_owned(), String::new()))
        .is_err());
    // An update with no blocker.
    post(&mut app, "2026-10-13", "fine", "");
    let me = app.view(|s| s.whoami()).unwrap();
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.offer_help(
            "2026-10-13".to_owned(),
            me.clone(),
            String::new()
        ))
        .is_err());
    // Yourself.
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.offer_help(
            "2026-10-13".to_owned(),
            bob.clone(),
            String::new()
        ))
        .is_err());
}

#[test]
fn offers_are_per_helper_and_only_the_helper_withdraws_theirs() {
    let mut app = team();
    let bob = bob_is_blocked(&mut app);
    app.call(|s| s.offer_help("2026-10-13".to_owned(), bob.clone(), String::new()))
        .unwrap();
    app.call_as_account(CAROL, CAROL_DEVICE, |s| {
        s.offer_help("2026-10-13".to_owned(), bob.clone(), "me too".to_owned())
    })
    .unwrap();
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates[0].helpers.len(), 2);

    // Carol withdrawing removes hers, never mine.
    app.call_as_account(CAROL, CAROL_DEVICE, |s| {
        s.withdraw_help("2026-10-13".to_owned(), bob.clone())
    })
    .unwrap();
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert_eq!(day.updates[0].helpers.len(), 1);
    assert_eq!(day.updates[0].helpers[0].note, "");
    // Nothing left of hers to withdraw.
    assert!(app
        .call_as_account(CAROL, CAROL_DEVICE, |s| s
            .withdraw_help("2026-10-13".to_owned(), bob.clone()))
        .is_err());
}

/// Once the blocker is gone the offers stop showing: help is about a blocker,
/// not about the person.
#[test]
fn offers_disappear_with_the_blocker() {
    let mut app = team();
    let bob = bob_is_blocked(&mut app);
    app.call(|s| s.offer_help("2026-10-13".to_owned(), bob.clone(), String::new()))
        .unwrap();
    post_as(&mut app, (BOB, BOB_DEVICE), "2026-10-13", "");
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert!(day.updates[0].helpers.is_empty());
}

/// A patched node can write a help row under its own stamp at its OWN
/// update's key — offering itself help. The read drops it.
#[test]
fn a_forged_offer_of_help_to_yourself_is_inert() {
    let mut app = team();
    let bob = bob_is_blocked(&mut app);
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.helps.insert(
            help_key("2026-10-13", &bob),
            Help {
                note: "self-help".to_owned(),
                at: 0,
            },
        )
    })
    .unwrap();
    let day = app.view(|s| s.get_day("2026-10-13".to_owned())).unwrap();
    assert!(day.updates[0].helpers.is_empty());
}

// ── v2: decision notes ───────────────────────────────────────────────────────

fn log_with(
    app: &mut TestHost<MeroStandup>,
    title: &str,
    tags: &[&str],
    with: Vec<String>,
    from_day: Option<&str>,
) -> app::Result<String> {
    app.call(|s| {
        s.log_decision(
            title.to_owned(),
            "d".to_owned(),
            String::new(),
            None,
            tags.iter().map(|t| (*t).to_owned()).collect(),
            with,
            from_day.map(str::to_owned),
        )
    })
}

#[test]
fn tags_are_normalized_and_counted() {
    let mut app = team();
    let id = log_with(
        &mut app,
        "A",
        &["Infra", " infra ", "Release Process"],
        vec![],
        None,
    )
    .unwrap();
    let _ = log_with(&mut app, "B", &["infra"], vec![], None).unwrap();
    let _ = log_with(&mut app, "C", &[], vec![], None).unwrap();

    let d = app.view(|s| s.get_decision(id)).unwrap();
    assert_eq!(d.tags, vec!["infra", "release-process"]);
    assert_eq!(
        app.view(|s| s.tags()).unwrap(),
        vec![
            TagCount {
                tag: "infra".to_owned(),
                count: 2
            },
            TagCount {
                tag: "release-process".to_owned(),
                count: 1
            },
        ]
    );

    let infra = app
        .view(|s| s.list_decisions(None, Some("INFRA".to_owned()), None, false, None, 10))
        .unwrap();
    assert_eq!(infra.items.len(), 2);
    // Free-text search reaches tags too.
    let hits = app
        .view(|s| s.list_decisions(Some("release".to_owned()), None, None, false, None, 10))
        .unwrap();
    assert_eq!(hits.items.len(), 1);

    let too_many: Vec<String> = (0..=MAX_TAGS).map(|i| format!("t{i}")).collect();
    let refs: Vec<&str> = too_many.iter().map(String::as_str).collect();
    assert!(log_with(&mut app, "D", &refs, vec![], None).is_err());
    assert!(log_with(&mut app, "E", &[&"x".repeat(MAX_TAG + 1)], vec![], None).is_err());
}

#[test]
fn with_and_from_day_are_recorded_and_checked() {
    let mut app = team();
    app.call_as_account(BOB, BOB_DEVICE, |s| s.set_name("Bob".to_owned()))
        .unwrap();
    let bob = app
        .call_as_account(BOB, BOB_DEVICE, |s| s.whoami())
        .unwrap();
    let id = log_with(
        &mut app,
        "A",
        &[],
        vec![bob.clone(), bob.clone()],
        Some("2026-10-13"),
    )
    .unwrap();
    let d = app.view(|s| s.get_decision(id.clone())).unwrap();
    assert_eq!(
        d.with,
        vec![PersonView {
            account: bob,
            name: "Bob".to_owned()
        }]
    );
    assert_eq!(d.from_day, "2026-10-13");

    let from = app
        .view(|s| s.list_decisions(None, None, Some("2026-10-13".to_owned()), false, None, 10))
        .unwrap();
    assert_eq!(from.items.len(), 1);
    let other = app
        .view(|s| s.list_decisions(None, None, Some("2026-10-12".to_owned()), false, None, 10))
        .unwrap();
    assert!(other.items.is_empty());

    assert!(log_with(&mut app, "B", &[], vec!["not-an-account".to_owned()], None).is_err());
    assert!(log_with(&mut app, "C", &[], vec![], Some("someday")).is_err());
}

/// Notes count only when the decision's author wrote them. Bob writing notes
/// at my decision's id puts them in his own entry, which is never read.
#[test]
fn someone_else_cannot_retag_my_decision() {
    let mut app = team();
    let id = log_with(&mut app, "Mine", &["keep"], vec![], None).unwrap();
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.decision_notes.insert(
            id.clone(),
            DecisionNotes {
                tags: vec!["hijacked".to_owned()],
                with: vec![],
                from_day: None,
            },
        )
    })
    .unwrap();
    let d = app.view(|s| s.get_decision(id)).unwrap();
    assert_eq!(d.tags, vec!["keep"]);
}

// ── v2: the week ─────────────────────────────────────────────────────────────

#[test]
fn a_week_is_seven_days_across_a_month_boundary() {
    assert_eq!(next_day((2026, 10, 31)), (2026, 11, 1));
    assert_eq!(next_day((2026, 12, 31)), (2027, 1, 1));
    assert_eq!(next_day((2028, 2, 28)), (2028, 2, 29));

    let mut app = team();
    post(&mut app, "2026-10-30", "fri", "");
    post(&mut app, "2026-11-02", "mon", "");
    let week = app.view(|s| s.get_week("2026-10-28".to_owned())).unwrap();
    let days: Vec<&str> = week.iter().map(|d| d.day.as_str()).collect();
    assert_eq!(
        days,
        vec![
            "2026-10-28",
            "2026-10-29",
            "2026-10-30",
            "2026-10-31",
            "2026-11-01",
            "2026-11-02",
            "2026-11-03"
        ]
    );
    assert_eq!(week[2].updates[0].done, "fri");
    assert_eq!(week[5].updates[0].done, "mon");
    assert!(app.view(|s| s.get_week("next week".to_owned())).is_err());
}

// ── v1 -> v2 ─────────────────────────────────────────────────────────────────

/// The frozen v1 contract, compiled into this test module from the same file
/// `crates/v1` builds the v1 bundle from. In-module rather than a
/// dev-dependency because `#[app::state]` only implements TestHost's bridge
/// under `cfg(test)` of the crate that defines the state.
#[path = "../crates/v1/src/lib.rs"]
#[allow(dead_code)]
mod v1;

type V1 = v1::MeroStandup;

/// What a v1 team looks like after a few days of use: two people's updates,
/// a blocker, names, and a decision that superseded another.
fn v1_team() -> (TestHost<V1>, String) {
    let mut app = TestHost::new(V1::init);
    app.call(|s| s.set_name("Ana".to_owned())).unwrap();
    app.call(|s| {
        s.post_update(
            "2026-10-12".to_owned(),
            "v1 work".to_owned(),
            "more".to_owned(),
            "waiting on review".to_owned(),
        )
    })
    .unwrap();
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.post_update(
            "2026-10-12".to_owned(),
            "bob v1".to_owned(),
            String::new(),
            String::new(),
        )
    })
    .unwrap();
    let old = app
        .call(|s| s.log_decision("Old".to_owned(), "x".to_owned(), String::new(), None))
        .unwrap();
    let _ = app
        .call_as_account(BOB, BOB_DEVICE, |s| {
            s.log_decision(
                "New".to_owned(),
                "y".to_owned(),
                String::new(),
                Some(old.clone()),
            )
        })
        .unwrap();
    (app, old)
}

#[test]
fn the_migration_keeps_every_v1_record_readable() {
    let (v1, old) = v1_team();
    let app = v1.migrate(migrate_v1_to_v2);

    let day = app.view(|s| s.get_day("2026-10-12".to_owned())).unwrap();
    assert_eq!(day.updates.len(), 2);
    let mine = day.updates.iter().find(|u| u.done == "v1 work").unwrap();
    assert_eq!(mine.author_name, "Ana");
    assert_eq!(mine.blockers, "waiting on review");
    assert!(mine.helpers.is_empty());

    let original = app.view(|s| s.get_decision(old)).unwrap();
    assert_eq!(original.title, "Old");
    assert!(
        !original.superseded_by.is_empty(),
        "the v1 supersession still holds"
    );
    assert!(original.tags.is_empty());
    assert_eq!(app.view(|s| s.team_name()).unwrap(), "");
    assert_eq!(app.view(|s| s.list_days(None, 10)).unwrap().days.len(), 1);
}

/// After the upgrade the v1 entries are not frozen relics: their owners still
/// edit them, and v2 features work on top of them.
#[test]
fn v1_entries_stay_editable_and_v2_features_work_on_them() {
    let (v1, _) = v1_team();
    let mut app = v1.migrate(migrate_v1_to_v2);
    let me = app.view(|s| s.whoami()).unwrap();

    app.call(|s| {
        s.post_update(
            "2026-10-12".to_owned(),
            "edited after the upgrade".to_owned(),
            String::new(),
            "still waiting".to_owned(),
        )
    })
    .unwrap();
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        s.offer_help(
            "2026-10-12".to_owned(),
            me.clone(),
            "I'll review".to_owned(),
        )
    })
    .unwrap();
    app.call(|s| s.set_team_name("Platform".to_owned()))
        .unwrap();
    let id = log_with(&mut app, "Tagged", &["v2"], vec![], Some("2026-10-12")).unwrap();

    let day = app.view(|s| s.get_day("2026-10-12".to_owned())).unwrap();
    let mine = day.updates.iter().find(|u| u.author == me).unwrap();
    assert_eq!(mine.done, "edited after the upgrade");
    assert_eq!(mine.helpers.len(), 1);
    assert_eq!(app.view(|s| s.team_name()).unwrap(), "Platform");
    assert_eq!(app.view(|s| s.get_decision(id)).unwrap().tags, vec!["v2"]);
}

/// Every node runs the migration on its own, so it must produce the same v2
/// root whichever node runs it.
///
/// Over the EMPTY v1 state, on purpose. The harness compares two separately
/// installed v1 states, and every v1 write stamps `env::time_now()` (the wall
/// clock), so two installs with data differ before the migration even runs —
/// the same node migrating twice "diverges" (checked while writing this). What
/// the migration itself does is the same either way: it carries the three v1
/// collections through as handles and creates the three v2 ones, and the
/// latter is what this proves deterministic. Convergence over real v1 data is
/// what `workflows/migrate-v1-v2.yml` checks, on two nodes.
#[test]
fn the_migration_converges_across_nodes() {
    calimero_sdk::testing::assert_migrate_converges::<V1, MeroStandup>(
        V1::init,
        migrate_v1_to_v2,
        [1u8; 32],
        [2u8; 32],
    );
}
