//! The board on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's storage-level write rules (`Authored`) as the same
//! calls made by another account, v1's convergence test as what it becomes under
//! one log, and the access and wire checks v1 could not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner and one member, `bob`, who hears every event.
fn app() -> TestApp {
    common::app(Org::new().members(["bob"]))
}

fn call_as(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{method} as {who}: {e:?}"))
}

fn call(t: &mut TestApp, method: &str, args: Value) -> Value {
    call_as(t, "owner", method, args)
}

fn view(t: &mut TestApp, method: &str, args: Value) -> Value {
    t.as_("owner")
        .view(method, args)
        .unwrap_or_else(|e| panic!("{method}: {e:?}"))
}

fn names(t: &TestApp) -> Vec<String> {
    t.events_for("bob").into_iter().map(|(n, _)| n).collect()
}

fn app_error(code: &str) -> impl Fn(&Result<Value, Failure>) -> bool + '_ {
    move |r| matches!(r, Err(Failure::App { code: c, .. }) if c == code)
}

fn issue_args(title: &str, priority: &str, labels: Value) -> Value {
    json!({
        "title": title,
        "summary": "Clicking login does nothing",
        "impact": "Nobody can sign in",
        "repro": "Click the login button on a fresh session",
        "resolutionCriteria": "Login succeeds and lands on the board",
        "priority": priority,
        "labels": labels,
    })
}

/// v1's `new_issue`: "Login broken", high, labelled `bug`, filed by `who`.
fn new_issue_as(t: &mut TestApp, who: &str) -> String {
    let id = call_as(
        t,
        who,
        "createIssue",
        issue_args("Login broken", "high", json!(["bug"])),
    );
    id.as_str().expect("an id").to_owned()
}

fn new_issue(t: &mut TestApp) -> String {
    new_issue_as(t, "owner")
}

fn other_issue(t: &mut TestApp) -> String {
    let id = call(
        t,
        "createIssue",
        json!({
            "title": "Other", "summary": "s", "impact": "i", "repro": "r",
            "resolutionCriteria": "rc", "priority": "low", "labels": null,
        }),
    );
    id.as_str().expect("an id").to_owned()
}

fn issue(t: &mut TestApp, id: &str) -> Value {
    view(t, "getIssue", json!({ "issueId": id }))
}

fn list(t: &mut TestApp, status: Value, assignee: Value, label: Value) -> Vec<String> {
    view(
        t,
        "listIssues",
        json!({ "status": status, "assignee": assignee, "label": label }),
    )
    .as_array()
    .expect("a list")
    .iter()
    .map(|i| i["id"].as_str().expect("an id").to_owned())
    .collect()
}

// ── v1's TestHost tests ──────────────────────────────────────────────────────

#[test]
fn create_issue_starts_open_and_lists() {
    let mut t = app();
    let id = new_issue(&mut t);
    assert!(id.starts_with(&format!("issue-{}-", common::T0)), "{id}");
    assert_eq!(id.len(), "issue-".len() + 13 + 1 + 8);

    // The whole view, as the wire carries it: camelCase, createdAt a string.
    assert_eq!(
        issue(&mut t, &id),
        json!({
            "issue": {
                "id": id,
                "title": "Login broken",
                "summary": "Clicking login does nothing",
                "impact": "Nobody can sign in",
                "repro": "Click the login button on a fresh session",
                "resolutionCriteria": "Login succeeds and lands on the board",
                "status": "Open",
                "priority": "high",
                "assignee": null,
                "labels": ["bug"],
                "createdBy": "owner",
                "createdAt": common::T0.to_string(),
            },
            "comments": [],
        })
    );
    assert_eq!(
        list(&mut t, json!(null), json!(null), json!(null)),
        std::slice::from_ref(&id)
    );
    // createIssue emits exactly one event.
    assert_eq!(
        t.events_for("bob"),
        [(
            "IssueCreated".to_owned(),
            json!({ "id": id, "createdBy": "owner" })
        )]
    );
}

#[test]
fn create_issue_rejects_bad_priority_title_and_labels() {
    let mut t = app();
    let bad = t
        .as_("owner")
        .call("createIssue", issue_args("t", "sky-high", json!(null)));
    assert_eq!(
        bad,
        Err(Failure::App {
            code: "Invalid".to_owned(),
            fields: json!({
                "message": "priority must be one of [\"low\", \"medium\", \"high\", \"urgent\"]"
            }),
        })
    );
    for args in [
        issue_args("", "low", json!(null)),
        issue_args(&"t".repeat(65), "low", json!(null)),
        issue_args("t", "low", json!(["ok", " "])),
        issue_args("t", "low", json!(["x".repeat(65)])),
    ] {
        assert!(
            app_error("Invalid")(&t.as_("owner").call("createIssue", args.clone())),
            "{args}"
        );
    }
    // 64 characters is the limit, not past it.
    call(
        &mut t,
        "createIssue",
        issue_args(&"é".repeat(64), "low", json!(["l".repeat(64)])),
    );
    assert_eq!(
        view(
            &mut t,
            "listIssues",
            json!({ "status": null, "assignee": null, "label": null })
        )
        .as_array()
        .map(Vec::len),
        Some(1)
    );
    assert_eq!(names(&t), ["IssueCreated"], "refused creates emit nothing");
}

#[test]
fn create_issue_rejects_each_empty_section() {
    let mut t = app();
    // One section blank per case (whitespace-only too), the rest valid.
    for (field, blank) in [
        ("summary", ""),
        ("impact", "  "),
        ("repro", ""),
        ("resolutionCriteria", "\t"),
    ] {
        let mut args = issue_args("t", "low", json!(null));
        args[field] = json!(blank);
        assert!(
            app_error("Invalid")(&t.as_("owner").call("createIssue", args)),
            "{field}"
        );
    }
    assert!(list(&mut t, json!(null), json!(null), json!(null)).is_empty());
}

#[test]
fn section_setters_update_and_reject_empty() {
    let mut t = app();
    let id = new_issue(&mut t);
    for (method, field) in [
        ("setSummary", "summary"),
        ("setImpact", "impact"),
        ("setRepro", "repro"),
        ("setResolutionCriteria", "resolutionCriteria"),
    ] {
        call(
            &mut t,
            method,
            json!({ "issueId": id, field: format!("New {field}") }),
        );
        assert_eq!(
            issue(&mut t, &id)["issue"][field],
            json!(format!("New {field}"))
        );
        assert!(
            app_error("Invalid")(
                &t.as_("owner")
                    .call(method, json!({ "issueId": id, field: " \n" }))
            ),
            "{method}"
        );
        assert!(
            app_error("NotFound")(
                &t.as_("owner")
                    .call(method, json!({ "issueId": "issue-nope", field: "x" }))
            ),
            "{method}"
        );
    }
    assert_eq!(
        names(&t),
        [
            "IssueCreated",
            "IssueEdited",
            "IssueEdited",
            "IssueEdited",
            "IssueEdited"
        ]
    );
}

#[test]
fn set_status_moves_column_and_rejects_bad_value() {
    let mut t = app();
    let id = new_issue(&mut t);
    call(
        &mut t,
        "setStatus",
        json!({ "issueId": id, "status": "In progress" }),
    );
    assert_eq!(issue(&mut t, &id)["issue"]["status"], json!("In progress"));
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("setStatus", json!({ "issueId": id, "status": "Nope" }))
    ));
    // Case-sensitive, and the space matters.
    assert!(app_error("Invalid")(&t.as_("owner").call(
        "setStatus",
        json!({ "issueId": id, "status": "in_progress" })
    )));
    assert!(app_error("NotFound")(&t.as_("owner").call(
        "setStatus",
        json!({ "issueId": "issue-nope", "status": "Done" })
    )));
    assert_eq!(
        t.events_for("bob")[1],
        (
            "IssueStatusChanged".to_owned(),
            json!({ "id": id, "status": "In progress" })
        )
    );
}

#[test]
fn set_priority_and_assignee() {
    let mut t = app();
    let id = new_issue(&mut t);
    call(
        &mut t,
        "setPriority",
        json!({ "issueId": id, "priority": "urgent" }),
    );
    call(
        &mut t,
        "setAssignee",
        json!({ "issueId": id, "assignee": "alice" }),
    );
    let got = issue(&mut t, &id)["issue"].clone();
    assert_eq!(got["priority"], json!("urgent"));
    assert_eq!(got["assignee"], json!("alice"));
    assert!(app_error("Invalid")(&t.as_("owner").call(
        "setPriority",
        json!({ "issueId": id, "priority": "meh" })
    )));

    // `null` clears the assignee.
    call(
        &mut t,
        "setAssignee",
        json!({ "issueId": id, "assignee": null }),
    );
    assert_eq!(issue(&mut t, &id)["issue"]["assignee"], json!(null));
    assert_eq!(
        t.events_for("bob")[1..],
        [
            (
                "IssuePriorityChanged".to_owned(),
                json!({ "id": id, "priority": "urgent" })
            ),
            ("IssueAssigneeChanged".to_owned(), json!({ "id": id })),
            ("IssueAssigneeChanged".to_owned(), json!({ "id": id })),
        ]
    );
}

#[test]
fn labels_add_remove_and_no_duplicates() {
    let mut t = app();
    let id = new_issue(&mut t);
    call(
        &mut t,
        "addLabel",
        json!({ "issueId": id, "label": "frontend" }),
    );
    // Adding the same label twice keeps one.
    call(
        &mut t,
        "addLabel",
        json!({ "issueId": id, "label": "frontend" }),
    );
    assert_eq!(
        issue(&mut t, &id)["issue"]["labels"],
        json!(["bug", "frontend"])
    );

    call(
        &mut t,
        "removeLabel",
        json!({ "issueId": id, "label": "bug" }),
    );
    // Removing a label it lacks succeeds.
    call(
        &mut t,
        "removeLabel",
        json!({ "issueId": id, "label": "nope" }),
    );
    assert_eq!(issue(&mut t, &id)["issue"]["labels"], json!(["frontend"]));

    assert!(app_error("NotFound")(&t.as_("owner").call(
        "addLabel",
        json!({ "issueId": "issue-nope", "label": "x" })
    )));
    assert!(app_error("NotFound")(&t.as_("owner").call(
        "removeLabel",
        json!({ "issueId": "issue-nope", "label": "x" })
    )));
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("addLabel", json!({ "issueId": id, "label": "" }))
    ));
    assert_eq!(
        names(&t),
        [
            "IssueCreated",
            "IssueLabelsChanged",
            "IssueLabelsChanged",
            "IssueLabelsChanged",
            "IssueLabelsChanged"
        ]
    );
}

#[test]
fn list_issues_filters_by_status_assignee_and_label() {
    let mut t = app();
    let a = new_issue(&mut t);
    t.advance(1);
    let b = other_issue(&mut t);
    call(
        &mut t,
        "setStatus",
        json!({ "issueId": a, "status": "Done" }),
    );
    call(
        &mut t,
        "setAssignee",
        json!({ "issueId": a, "assignee": "alice" }),
    );

    assert_eq!(
        list(&mut t, json!("Done"), json!(null), json!(null)),
        std::slice::from_ref(&a)
    );
    assert_eq!(
        list(&mut t, json!(null), json!("alice"), json!(null)),
        std::slice::from_ref(&a)
    );
    assert_eq!(
        list(&mut t, json!(null), json!(null), json!("bug")),
        std::slice::from_ref(&a)
    );
    assert_eq!(
        list(&mut t, json!("Open"), json!(null), json!(null)),
        std::slice::from_ref(&b)
    );
    // Filters combine.
    assert_eq!(
        list(&mut t, json!("Done"), json!("alice"), json!("bug")),
        std::slice::from_ref(&a)
    );
    assert!(list(&mut t, json!("Open"), json!("alice"), json!(null)).is_empty());
    assert!(list(&mut t, json!(null), json!("alice"), json!("nope")).is_empty());
    // Unfiltered, oldest first.
    assert_eq!(list(&mut t, json!(null), json!(null), json!(null)), [a, b]);
}

#[test]
fn list_is_oldest_first_for_every_filter() {
    let mut t = app();
    let mut ids = Vec::new();
    for _ in 0..3 {
        ids.push(new_issue(&mut t));
        t.advance(1);
    }
    for id in &ids {
        call(
            &mut t,
            "setAssignee",
            json!({ "issueId": id, "assignee": "alice" }),
        );
    }
    assert_eq!(list(&mut t, json!(null), json!(null), json!(null)), ids);
    assert_eq!(list(&mut t, json!("Open"), json!(null), json!(null)), ids);
    assert_eq!(list(&mut t, json!(null), json!("alice"), json!(null)), ids);
    assert_eq!(list(&mut t, json!(null), json!(null), json!("bug")), ids);
}

#[test]
fn status_counts_match_board() {
    let mut t = app();
    let a = new_issue(&mut t);
    other_issue(&mut t);
    call(
        &mut t,
        "setStatus",
        json!({ "issueId": a, "status": "Done" }),
    );
    assert_eq!(
        view(&mut t, "getStatusCounts", json!({})),
        json!([
            { "status": "Open", "count": "1" },
            { "status": "In progress", "count": "0" },
            { "status": "Blocked", "count": "0" },
            { "status": "Done", "count": "1" },
        ])
    );
}

#[test]
fn comment_roundtrip_and_thread_order() {
    let mut t = app();
    let id = new_issue(&mut t);
    let c1 = call(
        &mut t,
        "addComment",
        json!({ "issueId": id, "body": "I can reproduce" }),
    );
    t.advance(5);
    let c2 = call_as(
        &mut t,
        "bob",
        "addComment",
        json!({ "issueId": id, "body": "Me too" }),
    );
    let c1 = c1.as_str().expect("an id").to_owned();
    assert!(c1.starts_with("comment-"), "{c1}");

    assert_eq!(
        issue(&mut t, &id)["comments"],
        json!([
            {
                "id": c1, "issueId": id, "author": "owner", "body": "I can reproduce",
                "createdAt": common::T0.to_string(), "editedAt": null,
            },
            {
                "id": c2, "issueId": id, "author": "bob", "body": "Me too",
                "createdAt": (common::T0 + 5).to_string(), "editedAt": null,
            },
        ])
    );
    assert_eq!(
        t.events_for("bob")[1],
        (
            "CommentAdded".to_owned(),
            json!({ "id": c1, "issueId": id })
        )
    );
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("addComment", json!({ "issueId": id, "body": "  " }))
    ));
    assert!(app_error("NotFound")(&t.as_("owner").call(
        "addComment",
        json!({ "issueId": "issue-nope", "body": "x" })
    )));
}

#[test]
fn author_can_edit_and_delete_own_comment() {
    let mut t = app();
    let id = new_issue(&mut t);
    let c = call(
        &mut t,
        "addComment",
        json!({ "issueId": id, "body": "first" }),
    );
    t.advance(7);
    call(
        &mut t,
        "editComment",
        json!({ "commentId": c, "newBody": "edited" }),
    );
    let comment = issue(&mut t, &id)["comments"][0].clone();
    assert_eq!(comment["body"], json!("edited"));
    assert_eq!(comment["editedAt"], json!((common::T0 + 7).to_string()));
    assert!(app_error("Invalid")(
        &t.as_("owner")
            .call("editComment", json!({ "commentId": c, "newBody": "" }))
    ));

    call(&mut t, "deleteComment", json!({ "commentId": c }));
    assert_eq!(issue(&mut t, &id)["comments"], json!([]));
    assert!(app_error("NotFound")(
        &t.as_("owner")
            .call("deleteComment", json!({ "commentId": c }))
    ));
    assert!(app_error("NotFound")(
        &t.as_("owner")
            .call("editComment", json!({ "commentId": c, "newBody": "x" }))
    ));
    assert_eq!(
        names(&t),
        [
            "IssueCreated",
            "CommentAdded",
            "CommentEdited",
            "CommentDeleted"
        ]
    );
}

#[test]
fn repo_url_starts_empty_sets_and_rejects_bad_values() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "getRepoInfo", json!({})),
        json!({ "repoUrl": "" })
    );

    let url = "https://github.com/acme/tracker";
    call(&mut t, "setRepoUrl", json!({ "url": url }));
    assert_eq!(
        view(&mut t, "getRepoInfo", json!({})),
        json!({ "repoUrl": url })
    );
    assert_eq!(
        t.events_for("bob"),
        [("RepoUrlChanged".to_owned(), json!({ "url": url }))]
    );

    // http:// too; the later write holds.
    call(
        &mut t,
        "setRepoUrl",
        json!({ "url": "http://example.com/repo" }),
    );
    for bad in [
        "",
        "  ",
        "github.com/acme/tracker",
        "ftp://example.com/repo",
    ] {
        assert!(
            app_error("Invalid")(&t.as_("owner").call("setRepoUrl", json!({ "url": bad }))),
            "{bad:?}"
        );
    }
    assert_eq!(
        view(&mut t, "getRepoInfo", json!({})),
        json!({ "repoUrl": "http://example.com/repo" })
    );
}

#[test]
fn creator_deletes_issue_and_cascades_comments_and_labels() {
    let mut t = app();
    let id = new_issue(&mut t); // labelled "bug"
    let keep = other_issue(&mut t);
    call(
        &mut t,
        "addLabel",
        json!({ "issueId": id, "label": "frontend" }),
    );
    call(
        &mut t,
        "addLabel",
        json!({ "issueId": keep, "label": "bug" }),
    );
    call(
        &mut t,
        "addComment",
        json!({ "issueId": id, "body": "repro confirmed" }),
    );
    // Someone else's comment goes too: the thread is part of the issue.
    call_as(
        &mut t,
        "bob",
        "addComment",
        json!({ "issueId": id, "body": "+1" }),
    );
    call(
        &mut t,
        "addComment",
        json!({ "issueId": keep, "body": "unrelated" }),
    );

    call(&mut t, "deleteIssue", json!({ "issueId": id }));
    assert!(app_error("NotFound")(
        &t.as_("owner").view("getIssue", json!({ "issueId": id }))
    ));
    assert_eq!(
        list(&mut t, json!(null), json!(null), json!(null)),
        std::slice::from_ref(&keep)
    );
    // The label index no longer reaches the deleted issue.
    assert_eq!(
        list(&mut t, json!(null), json!(null), json!("bug")),
        std::slice::from_ref(&keep)
    );
    assert!(list(&mut t, json!(null), json!(null), json!("frontend")).is_empty());
    assert_eq!(
        view(&mut t, "getStatusCounts", json!({}))[0],
        json!({ "status": "Open", "count": "1" })
    );
    // The other issue's thread is untouched.
    assert_eq!(
        issue(&mut t, &keep)["comments"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(names(&t).last().map(String::as_str), Some("IssueDeleted"));

    // Gone means gone: a second delete, and any triage, is NotFound.
    assert!(app_error("NotFound")(
        &t.as_("owner").call("deleteIssue", json!({ "issueId": id }))
    ));
}

#[test]
fn delete_missing_issue_errors() {
    let mut t = app();
    assert_eq!(
        t.as_("owner")
            .call("deleteIssue", json!({ "issueId": "issue-nope" })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "id": "issue-nope" }),
        })
    );
}

// ── v1's storage-level write rules, as calls by another account ─────────────
//
// v1 kept the issue's filer and the comment's author as `Authored` owner
// stamps, which every node checked on a peer's write. Here every write is a
// method, so the forged write is the same call made as someone else.

#[test]
fn non_author_cannot_edit_or_delete_comment() {
    let mut t = common::app(Org::new().members(["bob"]).admins(["ada"]).guests(["gus"]));
    let id = new_issue(&mut t);
    let c = call(
        &mut t,
        "addComment",
        json!({ "issueId": id, "body": "mine" }),
    );

    // Not a member, not an admin, not a guest: only the author.
    for who in ["bob", "ada", "gus"] {
        assert_eq!(
            t.as_(who)
                .call("editComment", json!({ "commentId": c, "newBody": "hax" })),
            Err(Failure::App {
                code: "Forbidden".to_owned(),
                fields: json!({ "message": "only the author may edit this comment" }),
            }),
            "{who}"
        );
        assert_eq!(
            t.as_(who).call("deleteComment", json!({ "commentId": c })),
            Err(Failure::App {
                code: "Forbidden".to_owned(),
                fields: json!({ "message": "only the author may delete this comment" }),
            }),
            "{who}"
        );
    }
    // Not even the app's owner may touch bob's comment.
    let bobs = call_as(
        &mut t,
        "bob",
        "addComment",
        json!({ "issueId": id, "body": "bob's" }),
    );
    assert!(app_error("Forbidden")(
        &t.as_("owner")
            .call("deleteComment", json!({ "commentId": bobs }))
    ));

    let thread = issue(&mut t, &id)["comments"].clone();
    assert_eq!(thread[0]["body"], json!("mine"));
    assert_eq!(thread[0]["editedAt"], json!(null));
    assert_eq!(thread[1]["author"], json!("bob"));
    assert_eq!(names(&t), ["IssueCreated", "CommentAdded", "CommentAdded"]);
}

#[test]
fn non_creator_cannot_delete_issue() {
    let mut t = common::app(Org::new().members(["bob"]).admins(["ada"]));
    let id = new_issue_as(&mut t, "bob");
    for who in ["owner", "ada"] {
        assert_eq!(
            t.as_(who).call("deleteIssue", json!({ "issueId": id })),
            Err(Failure::App {
                code: "Forbidden".to_owned(),
                fields: json!({ "message": "only the creator may delete this issue" }),
            }),
            "{who}"
        );
    }
    let got = issue(&mut t, &id)["issue"].clone();
    assert_eq!(
        got["createdBy"],
        json!("bob"),
        "the filer is never reattributed"
    );
    assert_eq!(got["status"], json!("Open"));
    call_as(&mut t, "bob", "deleteIssue", json!({ "issueId": id }));
    assert!(list(&mut t, json!(null), json!(null), json!(null)).is_empty());
}

/// Triage is shared on purpose: anyone the app admits may move, re-prioritise,
/// re-assign, relabel or rewrite someone else's issue, as in v1.
#[test]
fn anyone_may_triage_anyones_issue() {
    let mut t = common::app(Org::new().members(["bob"]).guests(["gus"]));
    let id = new_issue(&mut t);
    for (who, method, args) in [
        (
            "bob",
            "setStatus",
            json!({ "issueId": id, "status": "Blocked" }),
        ),
        (
            "gus",
            "setPriority",
            json!({ "issueId": id, "priority": "low" }),
        ),
        (
            "bob",
            "setAssignee",
            json!({ "issueId": id, "assignee": "bob" }),
        ),
        (
            "gus",
            "addLabel",
            json!({ "issueId": id, "label": "triaged" }),
        ),
        (
            "bob",
            "setSummary",
            json!({ "issueId": id, "summary": "Rewritten" }),
        ),
    ] {
        call_as(&mut t, who, method, args);
    }
    let got = issue(&mut t, &id)["issue"].clone();
    assert_eq!(got["status"], json!("Blocked"));
    assert_eq!(got["priority"], json!("low"));
    assert_eq!(got["assignee"], json!("bob"));
    assert_eq!(got["labels"], json!(["bug", "triaged"]));
    assert_eq!(got["summary"], json!("Rewritten"));
    assert_eq!(got["createdBy"], json!("owner"));
}

// ── v1's tests/converge.rs, under one log ────────────────────────────────────

/// v1 merged three replicas' concurrent `set_status` by the registers' clocks.
/// Here the leader orders the calls: the issue survives once, holding the later
/// write, and the counts follow it.
#[test]
fn concurrent_triage_holds_the_later_write() {
    let mut t = common::app(Org::new().members(["bob", "cy"]));
    let id = new_issue(&mut t);
    for (who, status) in [("owner", "Done"), ("bob", "Blocked"), ("cy", "Done")] {
        call_as(
            &mut t,
            who,
            "setStatus",
            json!({ "issueId": id, "status": status }),
        );
    }
    assert_eq!(
        list(&mut t, json!(null), json!(null), json!(null)),
        std::slice::from_ref(&id)
    );
    assert_eq!(issue(&mut t, &id)["issue"]["status"], json!("Done"));
    assert_eq!(
        view(&mut t, "getStatusCounts", json!({}))[3],
        json!({ "status": "Done", "count": "1" })
    );
    assert_eq!(
        view(&mut t, "getStatusCounts", json!({}))[2]["count"],
        json!("0")
    );
}

/// Every member's issues survive side by side.
#[test]
fn every_members_issues_survive() {
    let mut t = common::app(Org::new().members(["bob", "cy"]));
    let mut ids = Vec::new();
    for who in ["owner", "bob", "cy"] {
        ids.push(new_issue_as(&mut t, who));
        t.advance(1);
    }
    assert_eq!(list(&mut t, json!(null), json!(null), json!(null)), ids);
    assert_eq!(
        view(&mut t, "getStatusCounts", json!({}))[0]["count"],
        json!("3")
    );
}

// ── what v1 could not check ──────────────────────────────────────────────────

/// The org decides who reaches the board: owner, admins, members and guests.
/// Nobody else, and nobody anonymous.
#[test]
fn who_reaches_the_board() {
    let mut t = common::app(Org::new().members(["bob"]).guests(["gus"]));
    let id = new_issue_as(&mut t, "gus");
    assert_eq!(issue(&mut t, &id)["issue"]["createdBy"], json!("gus"));

    let unauthenticated = Err(Failure::Refused {
        status: 401,
        code: "UNAUTHENTICATED".to_owned(),
    });
    let not_found = Err(Failure::Refused {
        status: 404,
        code: "NOT_FOUND".to_owned(),
    });
    assert_eq!(
        t.anonymous().view("getStatusCounts", json!({})),
        unauthenticated
    );
    assert_eq!(
        t.anonymous()
            .call("createIssue", issue_args("x", "low", json!(null))),
        unauthenticated
    );
    assert_eq!(
        t.as_("mallory").view("getIssue", json!({ "issueId": id })),
        not_found
    );
    assert_eq!(
        t.as_("mallory")
            .call("deleteIssue", json!({ "issueId": id })),
        not_found
    );
    // The system caller (timers) is no account: it cannot file anything.
    assert!(matches!(
        t.system()
            .call("createIssue", issue_args("x", "low", json!(null))),
        Err(Failure::App { .. })
    ));
    assert_eq!(list(&mut t, json!(null), json!(null), json!(null)), [id]);
}

/// An API key acting for an account files and comments as that account (what
/// the MCP server uses).
#[test]
fn an_api_key_acts_as_its_account() {
    let mut t = app();
    let id = t
        .api_key("key-1", "bob")
        .call(
            "createIssue",
            issue_args("From the agent", "medium", json!(null)),
        )
        .expect("create");
    let got = issue(&mut t, id.as_str().expect("an id"))["issue"].clone();
    assert_eq!(got["createdBy"], json!("bob"));
    t.api_key("key-1", "bob")
        .call("deleteIssue", json!({ "issueId": id }))
        .expect("bob's key deletes bob's issue");
}

/// Arguments are a JSON object of exactly the method's camelCase parameters. An
/// `Option` parameter may be left out (it is `null`), as in v1.
#[test]
fn malformed_arguments_are_refused_before_anything_is_written() {
    let mut t = app();
    let id = new_issue(&mut t);
    for (method, args) in [
        ("setStatus", json!({ "issueId": id })),
        ("setStatus", json!({ "issue_id": id, "status": "Done" })),
        (
            "setStatus",
            json!({ "issueId": id, "status": "Done", "extra": 1 }),
        ),
        ("setStatus", json!({ "issueId": 7, "status": "Done" })),
        ("createIssue", json!({ "title": "t" })),
        ("listIssues", json!({ "status": 3 })),
    ] {
        let got = if method == "listIssues" {
            t.as_("owner").view(method, args.clone())
        } else {
            t.as_("owner").call(method, args.clone())
        };
        assert!(app_error("BadArgs")(&got), "{method} {args}: {got:?}");
    }
    assert_eq!(issue(&mut t, &id)["issue"]["status"], json!("Open"));
    assert_eq!(names(&t), ["IssueCreated"]);
    // Left-out optional parameters are null: no filter.
    assert_eq!(
        view(&mut t, "listIssues", json!({}))
            .as_array()
            .map(Vec::len),
        Some(1)
    );
}

/// v1's snake_case names are not methods any more, and a write is not a view.
#[test]
fn methods_are_reached_by_their_camel_case_names() {
    let mut t = app();
    assert!(app_error("UnknownMethod")(
        &t.as_("owner").view("get_status_counts", json!({}))
    ));
    assert!(app_error("NotAView")(
        &t.as_("owner")
            .view("createIssue", issue_args("t", "low", json!(null)))
    ));
    // A view may run as a call.
    assert!(t.as_("owner").call("getStatusCounts", json!({})).is_ok());
}

/// A list is at most one page: the first 1,000 matches, oldest first.
#[test]
fn list_issues_is_at_most_a_thousand() {
    let mut t = app();
    for _ in 0..1001 {
        other_issue(&mut t);
        t.advance(1);
    }
    let all = view(
        &mut t,
        "listIssues",
        json!({ "status": null, "assignee": null, "label": null }),
    );
    let all = all.as_array().expect("a list");
    assert_eq!(all.len(), 1000);
    assert_eq!(all[0]["createdAt"], json!(common::T0.to_string()));
    assert_eq!(all[999]["createdAt"], json!((common::T0 + 999).to_string()));
    assert_eq!(
        view(&mut t, "getStatusCounts", json!({}))[0]["count"],
        json!("1001")
    );
}
