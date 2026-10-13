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
            .call(|s| s.log_decision(title.to_owned(), decision.to_owned(), String::new(), None))
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
        .view(|s| s.list_decisions(None, true, None, 10))
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
            Some("does-not-exist".to_owned())
        ))
        .is_err());

    let old = log(&mut app, "A", None);
    let _ = log(&mut app, "B", Some(&old));
    assert!(app
        .call(|s| s.log_decision(
            "C".to_owned(),
            "d".to_owned(),
            String::new(),
            Some(old.clone())
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
            )
        })
        .unwrap();

    let hits = app
        .view(|s| s.list_decisions(Some("github".to_owned()), false, None, 10))
        .unwrap();
    assert_eq!(hits.items.len(), 1);
    assert_eq!(hits.items[0].title, "Pick a CI provider");

    let mut seen = Vec::new();
    let mut cursor = None;
    loop {
        let page = app
            .view(|s| s.list_decisions(None, false, cursor.clone(), 4))
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
