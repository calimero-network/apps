//! The forum on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's merge and forged-write tests as what they become
//! under one log and method checks, and the access and wire checks v1 could not
//! express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner (the founder, so the first moderator), members `bob` and `cy`,
/// and a guest, `gus`.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "cy"]).guests(["gus"]))
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn view(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .view(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn code(result: Result<Value, Failure>) -> String {
    match result {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn post(t: &mut TestApp, who: &str, title: &str) -> String {
    call(
        t,
        who,
        "createPost",
        json!({ "title": title, "body": "body" }),
    )
    .as_str()
    .expect("an id")
    .to_owned()
}

fn comment(t: &mut TestApp, who: &str, post_id: &str, body: &str) -> String {
    call(
        t,
        who,
        "createComment",
        json!({ "postId": post_id, "body": body }),
    )
    .as_str()
    .expect("an id")
    .to_owned()
}

fn get_post(t: &mut TestApp, who: &str, id: &str) -> Value {
    view(t, who, "getPost", json!({ "postId": id }))
}

fn feed(t: &mut TestApp, who: &str, sort: Option<&str>, cursor: Value, limit: u32) -> Value {
    view(
        t,
        who,
        "listPosts",
        json!({ "sort": sort, "cursor": cursor, "limit": limit }),
    )
}

fn thread(t: &mut TestApp, who: &str, post_id: &str) -> Vec<Value> {
    view(
        t,
        who,
        "listComments",
        json!({ "postId": post_id, "cursor": null, "limit": 100 }),
    )["items"]
        .as_array()
        .expect("items")
        .clone()
}

fn ids(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|p| p["id"].as_str().expect("id").to_owned())
        .collect()
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── posts ────────────────────────────────────────────────────────────────────

#[test]
fn a_post_round_trips() {
    let mut t = app();
    let id = post(&mut t, "owner", "Hello");
    let view = get_post(&mut t, "bob", &id);
    assert_eq!(view["id"], json!(id));
    assert_eq!(view["title"], json!("Hello"));
    assert_eq!(view["body"], json!("body"));
    assert_eq!(view["author"], json!("owner"));
    assert_eq!(view["authorName"], json!(""));
    // 64-bit integers are decimal strings on the wire; `myVote` is a number.
    assert_eq!(view["score"], json!("0"));
    assert_eq!(view["commentCount"], json!("0"));
    assert_eq!(view["myVote"], json!(0));
    assert_eq!(view["createdAt"], json!(common::T0.to_string()));
    assert_eq!(view["editedAt"], view["createdAt"]);
    assert_eq!(
        t.events_for("bob"),
        [("PostCreated".to_owned(), json!({ "id": id }))]
    );
}

/// The defect that forced v1's rewrite: ids are random, never positional.
#[test]
fn post_ids_are_not_positional() {
    let mut t = app();
    let a = post(&mut t, "owner", "First");
    let b = post(&mut t, "owner", "Second");
    assert_ne!(a, b);
    assert_eq!(a.len(), 32, "16 random bytes as hex: {a}");
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn empty_and_oversized_fields_are_rejected() {
    let mut t = app();
    let huge = "x".repeat(10_001);
    for args in [
        json!({ "title": "   ", "body": "body" }),
        json!({ "title": "t", "body": "" }),
        json!({ "title": "x".repeat(301), "body": "b" }),
        json!({ "title": "t", "body": huge }),
    ] {
        assert_eq!(
            code(t.as_("owner").call("createPost", args.clone())),
            "Invalid",
            "{args}"
        );
    }
    assert!(ids(&feed(&mut t, "owner", None, Value::Null, 10)).is_empty());
    assert!(names(&t, "bob").is_empty(), "a refused write emits nothing");
}

#[test]
fn the_author_edits_a_post() {
    let mut t = app();
    let id = post(&mut t, "bob", "Mine");
    t.advance(1_000);
    call(
        &mut t,
        "bob",
        "editPost",
        json!({ "postId": id, "title": "Edited", "body": "new" }),
    );
    let view = get_post(&mut t, "owner", &id);
    assert_eq!(view["title"], json!("Edited"));
    assert_eq!(view["body"], json!("new"));
    assert_eq!(view["createdAt"], json!(common::T0.to_string()));
    assert_eq!(view["editedAt"], json!((common::T0 + 1_000).to_string()));
    assert_eq!(names(&t, "cy"), ["PostCreated", "PostEdited"]);
}

/// v1 held this in storage (`Moderated`: an entry's owner stamp); here the
/// method checks the caller against `author`, so a forged edit is just the call
/// made as someone else.
#[test]
fn only_the_author_can_edit_or_delete_a_post() {
    let mut t = app();
    let id = post(&mut t, "owner", "Mine");
    for who in ["bob", "gus"] {
        assert_eq!(
            code(t.as_(who).call(
                "editPost",
                json!({ "postId": id, "title": "Hijacked", "body": "b" })
            )),
            "Forbidden"
        );
        assert_eq!(
            code(t.as_(who).call("deletePost", json!({ "postId": id }))),
            "Forbidden"
        );
    }
    assert_eq!(get_post(&mut t, "owner", &id)["title"], json!("Mine"));
    assert_eq!(names(&t, "bob"), ["PostCreated"]);
}

#[test]
fn a_deleted_post_is_gone_from_reads_and_from_the_feed() {
    let mut t = app();
    let keep = post(&mut t, "owner", "Keep");
    let id = post(&mut t, "owner", "Temporary");
    let c = comment(&mut t, "bob", &id, "on a doomed post");
    call(&mut t, "bob", "vote", json!({ "postId": id, "value": 1 }));
    call(
        &mut t,
        "cy",
        "voteComment",
        json!({ "commentId": c, "value": 1 }),
    );
    call(&mut t, "owner", "deletePost", json!({ "postId": id }));

    assert_eq!(
        t.as_("owner").view("getPost", json!({ "postId": id })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "what": "post", "id": id })
        })
    );
    assert_eq!(ids(&feed(&mut t, "bob", None, Value::Null, 10)), [keep]);
    // Its comments went with it.
    assert!(thread(&mut t, "bob", &id).is_empty());
    assert_eq!(
        code(
            t.as_("cy")
                .call("voteComment", json!({ "commentId": c, "value": 1 }))
        ),
        "NotFound"
    );
    // Deleting it again, or anything that needs it, is NotFound.
    for (method, args) in [
        ("deletePost", json!({ "postId": id })),
        (
            "editPost",
            json!({ "postId": id, "title": "t", "body": "b" }),
        ),
        ("createComment", json!({ "postId": id, "body": "late" })),
        ("vote", json!({ "postId": id, "value": 1 })),
    ] {
        assert_eq!(
            code(t.as_("owner").call(method, args)),
            "NotFound",
            "{method}"
        );
    }
    assert_eq!(
        t.events_for("gus").last(),
        Some(&("PostDeleted".to_owned(), json!({ "id": id })))
    );
}

// ── the feed ─────────────────────────────────────────────────────────────────

#[test]
fn the_feed_pages_newest_first_without_skipping_or_repeating() {
    let mut t = app();
    let mut created = Vec::new();
    for i in 0..7 {
        created.push(post(&mut t, "owner", &format!("post {i}")));
        t.advance(10);
    }

    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = feed(&mut t, "bob", Some("new"), cursor, 3);
        assert!(page["items"].as_array().expect("items").len() <= 3);
        seen.extend(ids(&page));
        match &page["nextCursor"] {
            Value::Null => break,
            next => cursor = next.clone(),
        }
    }
    created.reverse();
    assert_eq!(seen, created, "newest first, every post exactly once");
}

/// Posts written in one millisecond still page as a total order.
#[test]
fn the_feed_pages_across_a_shared_timestamp() {
    let mut t = app();
    let mut created: Vec<String> = (0..5)
        .map(|i| post(&mut t, "owner", &i.to_string()))
        .collect();
    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = feed(&mut t, "owner", None, cursor, 2);
        seen.extend(ids(&page));
        match &page["nextCursor"] {
            Value::Null => break,
            next => cursor = next.clone(),
        }
    }
    seen.sort();
    created.sort();
    assert_eq!(seen, created);
}

#[test]
fn a_limit_of_zero_uses_the_default_and_a_huge_one_is_capped() {
    let mut t = app();
    for i in 0..25 {
        post(&mut t, "owner", &format!("p{i}"));
    }
    let page = feed(&mut t, "owner", None, Value::Null, 0);
    assert_eq!(ids(&page).len(), 20);
    assert!(page["nextCursor"].is_string());
    let page = feed(&mut t, "owner", None, Value::Null, u32::MAX);
    assert_eq!(ids(&page).len(), 25);
    assert_eq!(page["nextCursor"], Value::Null);
}

#[test]
fn top_sorts_by_score_then_newest() {
    let mut t = app();
    let quiet = post(&mut t, "owner", "quiet");
    t.advance(10);
    let loud = post(&mut t, "owner", "loud");
    t.advance(10);
    let sunk = post(&mut t, "owner", "sunk");
    t.advance(10);
    let newest_quiet = post(&mut t, "owner", "also quiet");
    call(
        &mut t,
        "owner",
        "vote",
        json!({ "postId": loud, "value": 1 }),
    );
    call(&mut t, "bob", "vote", json!({ "postId": loud, "value": 1 }));
    call(
        &mut t,
        "bob",
        "vote",
        json!({ "postId": sunk, "value": -1 }),
    );

    let page = feed(&mut t, "owner", Some("top"), Value::Null, 10);
    assert_eq!(
        ids(&page),
        [
            loud.clone(),
            newest_quiet.clone(),
            quiet.clone(),
            sunk.clone()
        ]
    );
    assert_eq!(page["items"][0]["score"], json!("2"));
    assert_eq!(page["items"][0]["myVote"], json!(1));
    assert_eq!(page["items"][3]["score"], json!("-1"));
    assert_eq!(page["items"][3]["myVote"], json!(0));

    // Paging `top` too, one at a time.
    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = feed(&mut t, "bob", Some("top"), cursor, 1);
        seen.extend(ids(&page));
        match &page["nextCursor"] {
            Value::Null => break,
            next => cursor = next.clone(),
        }
    }
    assert_eq!(
        seen,
        [
            loud.clone(),
            newest_quiet.clone(),
            quiet.clone(),
            sunk.clone()
        ]
    );
}

#[test]
fn an_unknown_sort_or_a_cursor_from_the_other_sort_is_refused() {
    let mut t = app();
    for i in 0..3 {
        post(&mut t, "owner", &i.to_string());
    }
    assert_eq!(
        code(t.as_("owner").view(
            "listPosts",
            json!({ "sort": "hot", "cursor": null, "limit": 1 })
        )),
        "Invalid"
    );
    let next = feed(&mut t, "owner", Some("new"), Value::Null, 1)["nextCursor"].clone();
    assert!(next.is_string());
    assert!(matches!(
        t.as_("owner").view(
            "listPosts",
            json!({ "sort": "top", "cursor": next, "limit": 1 })
        ),
        Err(Failure::App { .. })
    ));
}

// ── comments ─────────────────────────────────────────────────────────────────

#[test]
fn a_comment_is_authored_by_the_caller_and_counted() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    let c = comment(&mut t, "bob", &p, "hi");
    let rows = thread(&mut t, "owner", &p);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], json!(c));
    assert_eq!(rows[0]["postId"], json!(p));
    assert_eq!(rows[0]["author"], json!("bob"));
    assert_eq!(rows[0]["body"], json!("hi"));
    assert_eq!(rows[0]["score"], json!("0"));
    assert_eq!(get_post(&mut t, "owner", &p)["commentCount"], json!("1"));
    assert_eq!(
        t.events_for("cy").last(),
        Some(&("CommentCreated".to_owned(), json!({ "postId": p, "id": c })))
    );
    // There is no author argument to forge.
    assert_eq!(
        code(t.as_("bob").call(
            "createComment",
            json!({ "postId": p, "body": "x", "user": "owner" })
        )),
        "BadArgs"
    );
}

#[test]
fn only_the_author_can_edit_or_delete_a_comment() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    let c = comment(&mut t, "bob", &p, "mine");
    assert_eq!(
        code(t.as_("owner").call(
            "editComment",
            json!({ "commentId": c, "body": "rewritten" })
        )),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("cy").call("deleteComment", json!({ "commentId": c }))),
        "Forbidden"
    );
    assert_eq!(thread(&mut t, "owner", &p)[0]["body"], json!("mine"));

    t.advance(5);
    call(
        &mut t,
        "bob",
        "editComment",
        json!({ "commentId": c, "body": "edited" }),
    );
    let row = thread(&mut t, "owner", &p)[0].clone();
    assert_eq!(row["body"], json!("edited"));
    assert_eq!(row["editedAt"], json!((common::T0 + 5).to_string()));

    call(&mut t, "bob", "deleteComment", json!({ "commentId": c }));
    assert!(thread(&mut t, "owner", &p).is_empty());
    assert_eq!(get_post(&mut t, "owner", &p)["commentCount"], json!("0"));
    assert_eq!(
        names(&t, "cy"),
        [
            "PostCreated",
            "CommentCreated",
            "CommentEdited",
            "CommentDeleted"
        ]
    );
    assert_eq!(t.events_for("cy")[3].1, json!({ "postId": p, "id": c }));
}

#[test]
fn comments_page_oldest_first() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    let other = post(&mut t, "owner", "other");
    comment(&mut t, "bob", &other, "elsewhere");
    let mut created = Vec::new();
    for i in 0..5 {
        created.push(comment(&mut t, "bob", &p, &format!("c{i}")));
        t.advance(1);
    }
    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = view(
            &mut t,
            "cy",
            "listComments",
            json!({ "postId": p, "cursor": cursor, "limit": 2 }),
        );
        seen.extend(ids(&page));
        match &page["nextCursor"] {
            Value::Null => break,
            next => cursor = next.clone(),
        }
    }
    assert_eq!(seen, created);
    assert_eq!(get_post(&mut t, "owner", &p)["commentCount"], json!("5"));
    assert_eq!(
        get_post(&mut t, "owner", &other)["commentCount"],
        json!("1")
    );
}

#[test]
fn commenting_on_a_missing_post_and_blank_comments_are_errors() {
    let mut t = app();
    assert_eq!(
        t.as_("bob")
            .call("createComment", json!({ "postId": "nope", "body": "x" })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "what": "post", "id": "nope" })
        })
    );
    let p = post(&mut t, "owner", "p");
    assert_eq!(
        code(
            t.as_("bob")
                .call("createComment", json!({ "postId": p, "body": " " }))
        ),
        "Invalid"
    );
    let c = comment(&mut t, "bob", &p, "ok");
    assert_eq!(
        code(
            t.as_("bob")
                .call("editComment", json!({ "commentId": c, "body": "" }))
        ),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_("bob")
                .call("editComment", json!({ "commentId": "nope", "body": "x" }))
        ),
        "NotFound"
    );
    // A thread of a post that does not exist reads as empty, as in v1.
    assert!(thread(&mut t, "bob", "nope").is_empty());
}

// ── votes ────────────────────────────────────────────────────────────────────

#[test]
fn one_account_gets_one_vote_however_many_times_it_votes() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    for _ in 0..3 {
        call(&mut t, "bob", "vote", json!({ "postId": p, "value": 1 }));
    }
    call(&mut t, "owner", "vote", json!({ "postId": p, "value": 1 }));
    let as_bob = get_post(&mut t, "bob", &p);
    assert_eq!(as_bob["score"], json!("2"));
    assert_eq!(as_bob["myVote"], json!(1));
    assert_eq!(get_post(&mut t, "cy", &p)["myVote"], json!(0));
    assert_eq!(
        t.events_for("cy").last(),
        Some(&("Voted".to_owned(), json!({ "postId": p })))
    );
}

#[test]
fn a_vote_can_be_switched_and_retracted() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    call(&mut t, "bob", "vote", json!({ "postId": p, "value": 1 }));
    call(&mut t, "bob", "vote", json!({ "postId": p, "value": -1 }));
    let v = get_post(&mut t, "bob", &p);
    assert_eq!(
        (v["score"].clone(), v["myVote"].clone()),
        (json!("-1"), json!(-1))
    );
    call(&mut t, "bob", "vote", json!({ "postId": p, "value": 0 }));
    let v = get_post(&mut t, "bob", &p);
    assert_eq!(
        (v["score"].clone(), v["myVote"].clone()),
        (json!("0"), json!(0))
    );
    // Retracting a vote that is not there changes nothing.
    call(&mut t, "cy", "vote", json!({ "postId": p, "value": 0 }));
    assert_eq!(get_post(&mut t, "bob", &p)["score"], json!("0"));
}

#[test]
fn an_out_of_range_vote_is_rejected() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    let c = comment(&mut t, "owner", &p, "c");
    for value in [2, -2, 100] {
        assert_eq!(
            code(
                t.as_("bob")
                    .call("vote", json!({ "postId": p, "value": value }))
            ),
            "Invalid"
        );
        assert_eq!(
            code(
                t.as_("bob")
                    .call("voteComment", json!({ "commentId": c, "value": value }))
            ),
            "Invalid"
        );
    }
    // Past i8 is not even an argument.
    assert_eq!(
        code(
            t.as_("bob")
                .call("vote", json!({ "postId": p, "value": 1000 }))
        ),
        "BadArgs"
    );
    assert_eq!(get_post(&mut t, "owner", &p)["score"], json!("0"));
}

#[test]
fn a_comment_carries_its_score_and_the_callers_own_vote() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    let c = comment(&mut t, "owner", &p, "c");
    call(
        &mut t,
        "bob",
        "voteComment",
        json!({ "commentId": c, "value": 1 }),
    );
    call(
        &mut t,
        "bob",
        "voteComment",
        json!({ "commentId": c, "value": 1 }),
    );
    call(
        &mut t,
        "cy",
        "voteComment",
        json!({ "commentId": c, "value": 1 }),
    );
    let as_bob = thread(&mut t, "bob", &p)[0].clone();
    assert_eq!(as_bob["score"], json!("2"));
    assert_eq!(as_bob["myVote"], json!(1));
    assert_eq!(thread(&mut t, "owner", &p)[0]["myVote"], json!(0));

    call(
        &mut t,
        "bob",
        "voteComment",
        json!({ "commentId": c, "value": 0 }),
    );
    assert_eq!(thread(&mut t, "bob", &p)[0]["score"], json!("1"));
    assert_eq!(
        t.events_for("gus").last(),
        Some(&(
            "CommentVoted".to_owned(),
            json!({ "postId": p, "commentId": c })
        ))
    );
}

#[test]
fn comment_votes_do_not_leak_into_post_scores() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    let c = comment(&mut t, "owner", &p, "c");
    call(
        &mut t,
        "bob",
        "voteComment",
        json!({ "commentId": c, "value": 1 }),
    );
    let v = get_post(&mut t, "bob", &p);
    assert_eq!(
        (v["score"].clone(), v["myVote"].clone()),
        (json!("0"), json!(0))
    );
}

#[test]
fn a_deleted_comment_cannot_be_voted_on_and_its_votes_go_with_it() {
    let mut t = app();
    let p = post(&mut t, "owner", "p");
    let c = comment(&mut t, "bob", &p, "c");
    call(
        &mut t,
        "cy",
        "voteComment",
        json!({ "commentId": c, "value": 1 }),
    );
    call(&mut t, "bob", "deleteComment", json!({ "commentId": c }));
    assert_eq!(
        code(
            t.as_("cy")
                .call("voteComment", json!({ "commentId": c, "value": 1 }))
        ),
        "NotFound"
    );
}

// ── nicknames ────────────────────────────────────────────────────────────────

#[test]
fn a_name_reaches_every_reader_not_just_its_owner() {
    let mut t = app();
    call(&mut t, "owner", "setNickname", json!({ "name": "  ana  " }));
    let p = post(&mut t, "owner", "p");
    comment(&mut t, "owner", &p, "c");
    assert_eq!(get_post(&mut t, "bob", &p)["authorName"], json!("ana"));
    assert_eq!(thread(&mut t, "bob", &p)[0]["authorName"], json!("ana"));
    assert_eq!(
        view(&mut t, "bob", "getNickname", json!({ "account": "owner" })),
        json!("ana")
    );
    assert_eq!(
        t.events_for("bob")[0],
        ("ProfileSet".to_owned(), json!({ "account": "owner" }))
    );
}

#[test]
fn an_unnamed_account_reads_as_empty_and_an_empty_name_clears_the_claim() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "owner", "getNickname", json!({ "account": "bob" })),
        json!("")
    );
    call(&mut t, "bob", "setNickname", json!({ "name": "bob" }));
    call(&mut t, "bob", "setNickname", json!({ "name": "   " }));
    assert_eq!(
        view(&mut t, "owner", "getNickname", json!({ "account": "bob" })),
        json!("")
    );
    assert_eq!(names(&t, "cy"), ["ProfileSet", "ProfileSet"]);
}

#[test]
fn a_nickname_cannot_be_a_paragraph() {
    let mut t = app();
    assert_eq!(
        code(
            t.as_("bob")
                .call("setNickname", json!({ "name": "x".repeat(65) }))
        ),
        "Invalid"
    );
    call(
        &mut t,
        "bob",
        "setNickname",
        json!({ "name": "x".repeat(64) }),
    );
}

/// v1's `UserStorage` held every node to "only you write your slot"; here no
/// method takes the account it names, so there is nothing to forge.
#[test]
fn a_nickname_is_written_only_by_its_account() {
    let mut t = app();
    call(&mut t, "owner", "setNickname", json!({ "name": "ana" }));
    assert_eq!(
        code(t.as_("bob").call(
            "setNickname",
            json!({ "name": "not ana", "account": "owner" })
        )),
        "BadArgs"
    );
    call(&mut t, "bob", "setNickname", json!({ "name": "bob" }));
    assert_eq!(
        view(&mut t, "cy", "getNickname", json!({ "account": "owner" })),
        json!("ana")
    );
}

// ── moderation ───────────────────────────────────────────────────────────────

#[test]
fn the_founder_moderates_and_nobody_else_does_until_appointed() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "bob", "moderators", json!({})),
        json!(["owner"])
    );

    let spam = post(&mut t, "bob", "Buy cheap tokens");
    let p = post(&mut t, "owner", "p");
    let c = comment(&mut t, "bob", &p, "spam reply");

    // Neither a member nor a guest moderates or appoints.
    for who in ["bob", "gus"] {
        assert_eq!(
            code(t.as_(who).call("moderatePost", json!({ "postId": p }))),
            "Forbidden"
        );
        assert_eq!(
            code(
                t.as_(who)
                    .call("moderateComment", json!({ "commentId": c }))
            ),
            "Forbidden"
        );
        assert_eq!(
            code(
                t.as_(who)
                    .call("setModerators", json!({ "accounts": [who] }))
            ),
            "Forbidden"
        );
    }

    call(
        &mut t,
        "owner",
        "moderateComment",
        json!({ "commentId": c }),
    );
    call(&mut t, "owner", "moderatePost", json!({ "postId": spam }));
    assert_eq!(
        ids(&feed(&mut t, "bob", None, Value::Null, 10)),
        std::slice::from_ref(&p)
    );
    assert!(thread(&mut t, "bob", &p).is_empty());
    assert_eq!(
        code(
            t.as_("owner")
                .call("moderatePost", json!({ "postId": spam }))
        ),
        "NotFound"
    );

    // Appointed, cy moderates; the founder, no longer listed, does not.
    call(
        &mut t,
        "owner",
        "setModerators",
        json!({ "accounts": ["cy", "cy"] }),
    );
    assert_eq!(view(&mut t, "bob", "moderators", json!({})), json!(["cy"]));
    assert_eq!(
        code(t.as_("owner").call("moderatePost", json!({ "postId": p }))),
        "Forbidden"
    );
    call(&mut t, "cy", "moderatePost", json!({ "postId": p }));
    assert_eq!(
        names(&t, "gus"),
        [
            "PostCreated",
            "PostCreated",
            "CommentCreated",
            "CommentDeleted",
            "PostDeleted",
            "ModeratorsChanged",
            "PostDeleted"
        ]
    );
    assert_eq!(
        t.events_for("gus")[5].1,
        json!({ "count": "1" }),
        "a u64 count is a decimal string"
    );
}

#[test]
fn moderators_must_be_a_non_empty_list_of_the_forums_accounts() {
    let mut t = app();
    for accounts in [json!([]), json!(["mallory"]), json!(["bob", "mallory"])] {
        assert_eq!(
            code(
                t.as_("owner")
                    .call("setModerators", json!({ "accounts": accounts.clone() }))
            ),
            "Invalid",
            "{accounts}"
        );
    }
    // A guest of the org may be appointed.
    call(
        &mut t,
        "owner",
        "setModerators",
        json!({ "accounts": ["owner", "gus"] }),
    );
    assert_eq!(
        view(&mut t, "bob", "moderators", json!({})),
        json!(["gus", "owner"])
    );
}

// ── what v1 could not check ──────────────────────────────────────────────────

/// The org decides who reaches the forum: the owner, admins, members and
/// guests (as any member of a v1 context could post). Nobody else.
#[test]
fn who_reaches_the_forum() {
    let mut t = app();
    let p = post(&mut t, "gus", "from a guest");
    comment(&mut t, "gus", &p, "guest reply");
    call(&mut t, "gus", "vote", json!({ "postId": p, "value": 1 }));
    assert_eq!(get_post(&mut t, "bob", &p)["author"], json!("gus"));

    for (method, args) in [
        (
            "listPosts",
            json!({ "sort": null, "cursor": null, "limit": 1 }),
        ),
        ("getPost", json!({ "postId": p })),
    ] {
        assert_eq!(
            t.anonymous().view(method, args.clone()),
            Err(Failure::Refused {
                status: 401,
                code: "UNAUTHENTICATED".to_owned()
            })
        );
        assert_eq!(
            t.as_("mallory").view(method, args),
            Err(Failure::Refused {
                status: 404,
                code: "NOT_FOUND".to_owned()
            })
        );
    }
    assert_eq!(
        t.as_("mallory")
            .call("createPost", json!({ "title": "t", "body": "b" })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(
        t.anonymous()
            .call("vote", json!({ "postId": p, "value": -1 })),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(get_post(&mut t, "owner", &p)["score"], json!("1"));
}

/// A member removed from the org loses the forum: every call and view after it
/// is refused. (The harness resolves an `All` audience without the access
/// check; on a node the event stream is behind that same check.)
#[test]
fn a_removed_member_is_refused() {
    let mut t = app();
    let p = post(&mut t, "bob", "before");
    t.remove_member("bob");
    for result in [
        t.as_("bob")
            .call("createPost", json!({ "title": "t", "body": "b" })),
        t.as_("bob").call("deletePost", json!({ "postId": p })),
        t.as_("bob").view("getPost", json!({ "postId": p })),
    ] {
        assert_eq!(
            result,
            Err(Failure::Refused {
                status: 404,
                code: "NOT_FOUND".to_owned()
            })
        );
    }
    // What they wrote stays, still theirs.
    assert_eq!(get_post(&mut t, "owner", &p)["author"], json!("bob"));
}

/// Arguments are a JSON object of exactly the method's parameters.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = app();
    for args in [
        json!({ "title": "t" }),
        json!({ "title": "t", "body": "b", "extra": 1 }),
        json!({ "title": 7, "body": "b" }),
    ] {
        assert_eq!(
            code(t.as_("owner").call("createPost", args.clone())),
            "BadArgs",
            "{args}"
        );
    }
    assert!(ids(&feed(&mut t, "owner", None, Value::Null, 10)).is_empty());
    assert!(names(&t, "bob").is_empty());
}

/// v1's snake_case names are not methods any more; a write is not a view.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = app();
    assert_eq!(
        code(
            t.as_("owner")
                .call("create_post", json!({ "title": "t", "body": "b" }))
        ),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("createPost", json!({ "title": "t", "body": "b" }))
        ),
        "NotAView"
    );
    // A view may run as a call (it writes nothing).
    t.as_("owner")
        .call("moderators", json!({}))
        .expect("a view as a call");
}
