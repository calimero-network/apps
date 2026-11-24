//! Edge cases of Minutes on core's real engine: what a flaky extension, a long
//! meeting or a careless caller can send, and what stays consistent after it.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

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

fn start(t: &mut TestApp, who: &str, title: &str) -> String {
    call(
        t,
        who,
        "startMeeting",
        json!({ "title": title, "platform": "zoom", "url": "", "model": "moonshine-base", "language": "" }),
    )
    .as_str()
    .expect("an id")
    .to_owned()
}

fn seg(seq: u32, speaker: &str, text: &str) -> Value {
    json!({ "seq": seq, "startMs": seq * 3_000, "endMs": seq * 3_000 + 2_500, "speaker": speaker, "text": text })
}

fn append(t: &mut TestApp, who: &str, id: &str, segments: Vec<Value>) -> Value {
    call(
        t,
        who,
        "appendSegments",
        json!({ "meetingId": id, "segments": segments }),
    )
}

fn meeting(t: &mut TestApp, id: &str) -> Value {
    view(t, "bob", "getMeeting", json!({ "meetingId": id }))
}

fn add_action(t: &mut TestApp, who: &str, id: &str, text: &str) -> String {
    call(
        t,
        who,
        "addAction",
        json!({ "meetingId": id, "text": text, "assignee": "", "sourceSeq": null }),
    )
    .as_str()
    .unwrap()
    .to_owned()
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap().to_owned())
        .collect()
}

fn texts(page: &Value) -> Vec<String> {
    page["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["text"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_full_batch_of_one_hundred_is_taken() {
    let mut t = app();
    let id = start(&mut t, "bob", "Full");
    let segs = (0..100).map(|i| seg(i, "others", "two words")).collect();
    let r = append(&mut t, "bob", &id, segs);
    assert_eq!(r, json!({ "added": 100, "skipped": 0, "nextSeq": 100 }));
    let m = meeting(&mut t, &id);
    assert_eq!(m["segments"], 100);
    assert_eq!(m["words"], 200);
}

#[test]
fn a_number_twice_in_one_batch_is_stored_once() {
    let mut t = app();
    let id = start(&mut t, "bob", "Dupes");
    let r = append(
        &mut t,
        "bob",
        &id,
        vec![seg(0, "you", "first copy"), seg(0, "you", "second copy")],
    );
    assert_eq!(r, json!({ "added": 1, "skipped": 1, "nextSeq": 1 }));
    let page = view(
        &mut t,
        "bob",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 10 }),
    );
    assert_eq!(texts(&page), ["first copy"]);
}

#[test]
fn a_refused_batch_stores_nothing() {
    let mut t = app();
    let id = start(&mut t, "bob", "Atomic");
    let r = t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": [seg(0, "you", "kept?"), seg(1, "nobody", "bad")] }),
    );
    assert_eq!(code(r), "Invalid");
    let m = meeting(&mut t, &id);
    assert_eq!(m["segments"], 0);
    assert_eq!(m["nextSeq"], 0);
    // The good segment can be sent again and lands.
    let r = append(&mut t, "bob", &id, vec![seg(0, "you", "kept")]);
    assert_eq!(r["added"], 1);
}

#[test]
fn a_gap_in_numbers_is_filled_later_and_pages_skip_it() {
    let mut t = app();
    let id = start(&mut t, "bob", "Gaps");
    append(
        &mut t,
        "bob",
        &id,
        vec![
            seg(0, "you", "a"),
            seg(1, "you", "b"),
            seg(5, "others", "f"),
        ],
    );
    assert_eq!(meeting(&mut t, &id)["nextSeq"], 6);
    let page = view(
        &mut t,
        "bob",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 2 }),
    );
    assert_eq!(texts(&page), ["a", "b"]);
    // The next page starts at the next stored number, not at 2.
    assert_eq!(page["next"], 5);
    // A late batch fills the gap without moving nextSeq back.
    let r = append(
        &mut t,
        "bob",
        &id,
        vec![
            seg(2, "others", "c"),
            seg(3, "you", "d"),
            seg(4, "you", "e"),
        ],
    );
    assert_eq!(r["nextSeq"], 6);
    let page = view(
        &mut t,
        "bob",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 2, "limit": 500 }),
    );
    assert_eq!(texts(&page), ["c", "d", "e", "f"]);
    assert_eq!(page["next"], Value::Null);
}

#[test]
fn transcript_edges() {
    let mut t = app();
    let id = start(&mut t, "bob", "Edges");
    // An empty meeting has an empty transcript.
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 50 }),
    );
    assert_eq!(page, json!({ "segments": [], "next": null }));
    for batch in 0..6u32 {
        let segs = (0..100).map(|i| seg(batch * 100 + i, "you", "w")).collect();
        append(&mut t, "bob", &id, segs);
    }
    // A limit above 500 is cut to 500.
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 100_000 }),
    );
    assert_eq!(page["segments"].as_array().unwrap().len(), 500);
    assert_eq!(page["next"], 500);
    // Past the end: nothing, and no next page.
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 600, "limit": 10 }),
    );
    assert_eq!(page, json!({ "segments": [], "next": null }));
    // Exactly the rest: no next page.
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 590, "limit": 10 }),
    );
    assert_eq!(page["segments"].as_array().unwrap().len(), 10);
    assert_eq!(page["next"], Value::Null);
    // Walking every page returns every segment once.
    let mut from = 0u64;
    let mut seen = 0usize;
    loop {
        let page = view(
            &mut t,
            "gus",
            "transcript",
            json!({ "meetingId": id, "fromSeq": from, "limit": 77 }),
        );
        seen += page["segments"].as_array().unwrap().len();
        match page["next"].as_u64() {
            Some(n) => from = n,
            None => break,
        }
    }
    assert_eq!(seen, 600);
    let r = t.as_("bob").view(
        "transcript",
        json!({ "meetingId": "nope", "fromSeq": 0, "limit": 10 }),
    );
    assert_eq!(code(r), "NotFound");
}

#[test]
fn the_highest_number_does_not_wrap() {
    let mut t = app();
    let id = start(&mut t, "bob", "Overflow");
    let r = t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": [{ "seq": u32::MAX, "startMs": 0, "endMs": 1, "speaker": "you", "text": "edge" }] }),
    );
    // Refused: nextSeq is the number plus one, which would wrap to 0.
    assert_eq!(code(r), "Invalid");
    assert_eq!(meeting(&mut t, &id)["nextSeq"], 0);
    let r = append(
        &mut t,
        "bob",
        &id,
        vec![
            json!({ "seq": u32::MAX - 1, "startMs": 0, "endMs": 1, "speaker": "you", "text": "edge" }),
        ],
    );
    assert_eq!(r["nextSeq"], u32::MAX);
}

#[test]
fn a_meeting_keeps_at_most_ten_thousand_segments() {
    let mut t = app();
    let id = start(&mut t, "bob", "Marathon");
    for batch in 0..100u32 {
        let segs = (0..100).map(|i| seg(batch * 100 + i, "you", "w")).collect();
        append(&mut t, "bob", &id, segs);
    }
    assert_eq!(meeting(&mut t, &id)["segments"], 10_000);
    let r = t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": [seg(10_000, "you", "one more")] }),
    );
    assert_eq!(code(r), "Refused");
    // Resending a stored number is still a harmless skip.
    let r = append(&mut t, "bob", &id, vec![seg(42, "you", "w")]);
    assert_eq!(r["skipped"], 1);
}

#[test]
fn late_segments_after_end_still_land_and_duration_keeps_the_longest() {
    let mut t = app();
    let id = start(&mut t, "bob", "Late");
    append(&mut t, "bob", &id, vec![seg(0, "you", "before end")]);
    let m = call(
        &mut t,
        "bob",
        "endMeeting",
        json!({ "meetingId": id, "durationMs": 1_000 }),
    );
    // The extension measured less than the segments cover: the longer wins.
    assert_eq!(m["durationMs"], 2_500);
    // The upload queue drains after Stop; its last batch must not be lost.
    let r = append(&mut t, "bob", &id, vec![seg(1, "others", "after end")]);
    assert_eq!(r["added"], 1);
    let m = meeting(&mut t, &id);
    assert_eq!(m["live"], false);
    assert_eq!(m["durationMs"], 5_500);
    assert_eq!(m["segments"], 2);
}

#[test]
fn editing_keeps_the_word_count_right() {
    let mut t = app();
    let id = start(&mut t, "bob", "Words");
    append(&mut t, "bob", &id, vec![seg(0, "you", "one two three")]);
    call(
        &mut t,
        "bob",
        "editSegment",
        json!({ "meetingId": id, "seq": 0, "text": "one" }),
    );
    assert_eq!(meeting(&mut t, &id)["words"], 1);
    call(
        &mut t,
        "bob",
        "editSegment",
        json!({ "meetingId": id, "seq": 0, "text": "  four five six seven  " }),
    );
    let m = meeting(&mut t, &id);
    assert_eq!(m["words"], 4);
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 1 }),
    );
    assert_eq!(page["segments"][0]["text"], "four five six seven");
    assert_eq!(page["segments"][0]["edited"], true);
    // A resend of the original number does not overwrite the correction.
    append(&mut t, "bob", &id, vec![seg(0, "you", "one two three")]);
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 1 }),
    );
    assert_eq!(page["segments"][0]["text"], "four five six seven");
}

#[test]
fn titles_urls_and_summaries_are_checked() {
    let mut t = app();
    let id = start(&mut t, "bob", "Checks");
    for (method, args) in [
        ("renameMeeting", json!({ "meetingId": id, "title": "   " })),
        (
            "renameMeeting",
            json!({ "meetingId": id, "title": "t".repeat(201) }),
        ),
        (
            "setSummary",
            json!({ "meetingId": id, "summary": "s".repeat(20_001) }),
        ),
    ] {
        assert_eq!(code(t.as_("bob").call(method, args)), "Invalid", "{method}");
    }
    // A title of exactly 200 characters is fine; so is clearing the summary.
    let m = call(
        &mut t,
        "bob",
        "renameMeeting",
        json!({ "meetingId": id, "title": "t".repeat(200) }),
    );
    assert_eq!(m["title"].as_str().unwrap().len(), 200);
    call(
        &mut t,
        "bob",
        "setSummary",
        json!({ "meetingId": id, "summary": "Some notes" }),
    );
    let m = call(
        &mut t,
        "bob",
        "setSummary",
        json!({ "meetingId": id, "summary": "" }),
    );
    assert_eq!(m["summary"], "");

    let base = json!({ "title": "x", "platform": "meet", "url": "", "model": "", "language": "" });
    for (key, value) in [
        ("url", json!("ftp://example.com")),
        ("url", json!(format!("https://{}", "a".repeat(2_000)))),
        ("model", json!("m".repeat(101))),
        ("language", json!("l".repeat(17))),
        ("platform", json!("p".repeat(41))),
    ] {
        let mut args = base.clone();
        args[key] = value;
        assert_eq!(
            code(t.as_("bob").call("startMeeting", args)),
            "Invalid",
            "{key}"
        );
    }
    // Platforms are matched without case.
    let mut args = base.clone();
    args["platform"] = json!("Teams");
    let tid = call(&mut t, "bob", "startMeeting", args);
    assert_eq!(meeting(&mut t, tid.as_str().unwrap())["platform"], "teams");
}

#[test]
fn unknown_meetings_are_not_found_everywhere() {
    let mut t = app();
    for (method, args) in [
        (
            "appendSegments",
            json!({ "meetingId": "nope", "segments": [] }),
        ),
        (
            "editSegment",
            json!({ "meetingId": "nope", "seq": 0, "text": "x" }),
        ),
        (
            "endMeeting",
            json!({ "meetingId": "nope", "durationMs": 1 }),
        ),
        (
            "renameMeeting",
            json!({ "meetingId": "nope", "title": "x" }),
        ),
        ("setSummary", json!({ "meetingId": "nope", "summary": "x" })),
        ("deleteMeeting", json!({ "meetingId": "nope" })),
        (
            "editAction",
            json!({ "actionId": "nope", "text": "x", "assignee": "" }),
        ),
        ("removeAction", json!({ "actionId": "nope" })),
    ] {
        assert_eq!(
            code(t.as_("bob").call(method, args)),
            "NotFound",
            "{method}"
        );
    }
    assert_eq!(
        code(
            t.as_("bob")
                .view("listActions", json!({ "meetingId": "nope" }))
        ),
        "NotFound"
    );
}

#[test]
fn deleting_one_meeting_leaves_the_others_alone() {
    let mut t = app();
    let a = start(&mut t, "bob", "Keep");
    t.advance(1_000);
    let b = start(&mut t, "bob", "Drop");
    append(&mut t, "bob", &a, vec![seg(0, "you", "keep me")]);
    append(&mut t, "bob", &b, vec![seg(0, "you", "drop me")]);
    let keep_action = add_action(&mut t, "cy", &a, "Keep this");
    add_action(&mut t, "cy", &b, "Drop this");
    let done = add_action(&mut t, "cy", &b, "Done already");
    call(
        &mut t,
        "cy",
        "setActionDone",
        json!({ "actionId": done, "done": true }),
    );

    let r = call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": b }));
    assert_eq!(r["remaining"], 0);

    assert_eq!(
        ids(&view(&mut t, "cy", "listMeetings", json!({}))),
        std::slice::from_ref(&a)
    );
    assert_eq!(
        ids(&view(&mut t, "cy", "openActions", json!({}))),
        std::slice::from_ref(&keep_action)
    );
    assert_eq!(meeting(&mut t, &a)["openActions"], 1);
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": a, "fromSeq": 0, "limit": 10 }),
    );
    assert_eq!(texts(&page), ["keep me"]);
    // The deleted meeting's action items are gone too, done or not.
    assert_eq!(
        code(
            t.as_("cy")
                .call("setActionDone", json!({ "actionId": done, "done": false }))
        ),
        "NotFound"
    );
    // Writes to the deleted meeting are refused.
    assert_eq!(
        code(t.as_("bob").call(
            "appendSegments",
            json!({ "meetingId": b, "segments": [seg(1, "you", "late")] }),
        )),
        "NotFound"
    );
}

#[test]
fn a_meeting_in_mid_delete_is_hidden_from_writes_and_reads() {
    let mut t = app();
    let id = start(&mut t, "bob", "Huge");
    for batch in 0..25u32 {
        let segs = (0..100).map(|i| seg(batch * 100 + i, "you", "w")).collect();
        append(&mut t, "bob", &id, segs);
    }
    let r = call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(r["remaining"], 1_000);
    for (method, args) in [
        (
            "appendSegments",
            json!({ "meetingId": id, "segments": [seg(9_000, "you", "x")] }),
        ),
        (
            "addAction",
            json!({ "meetingId": id, "text": "x", "assignee": "", "sourceSeq": null }),
        ),
    ] {
        assert_eq!(
            code(t.as_("bob").call(method, args)),
            "NotFound",
            "{method}"
        );
    }
    assert_eq!(
        code(t.as_("bob").view(
            "transcript",
            json!({ "meetingId": id, "fromSeq": 0, "limit": 10 })
        )),
        "NotFound"
    );
    // 1,000 a call: two more calls finish it (remaining counts at most 1,000).
    let r = call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(r["remaining"], 500);
    let r = call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(r["remaining"], 0);
    assert_eq!(
        code(
            t.as_("bob")
                .call("deleteMeeting", json!({ "meetingId": id }))
        ),
        "NotFound"
    );
}

#[test]
fn a_meeting_keeps_at_most_five_hundred_action_items() {
    let mut t = app();
    let id = start(&mut t, "bob", "Busy");
    for i in 0..500 {
        add_action(&mut t, "cy", &id, &format!("item {i}"));
    }
    let r = t.as_("cy").call(
        "addAction",
        json!({ "meetingId": id, "text": "one too many", "assignee": "", "sourceSeq": null }),
    );
    assert_eq!(code(r), "Refused");
    assert_eq!(meeting(&mut t, &id)["openActions"], 500);
    // Deleting the meeting removes all 500.
    call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(view(&mut t, "cy", "openActions", json!({})), json!([]));
}

#[test]
fn open_actions_are_newest_first_across_meetings() {
    let mut t = app();
    let a = start(&mut t, "bob", "A");
    let b = start(&mut t, "cy", "B");
    let first = add_action(&mut t, "bob", &a, "first");
    t.advance(1_000);
    let second = add_action(&mut t, "gus", &b, "second");
    t.advance(1_000);
    let third = add_action(&mut t, "cy", &a, "third");
    assert_eq!(
        ids(&view(&mut t, "bob", "openActions", json!({}))),
        [third.clone(), second.clone(), first.clone()]
    );
    // Editing does not reorder; ticking off drops it; unticking brings it back in place.
    call(
        &mut t,
        "bob",
        "editAction",
        json!({ "actionId": first, "text": "first, edited", "assignee": "Ana" }),
    );
    call(
        &mut t,
        "bob",
        "setActionDone",
        json!({ "actionId": second, "done": true }),
    );
    assert_eq!(
        ids(&view(&mut t, "bob", "openActions", json!({}))),
        [third.clone(), first.clone()]
    );
    call(
        &mut t,
        "bob",
        "setActionDone",
        json!({ "actionId": second, "done": false }),
    );
    assert_eq!(
        ids(&view(&mut t, "bob", "openActions", json!({}))),
        [third, second, first.clone()]
    );
    let edited = &view(&mut t, "bob", "listActions", json!({ "meetingId": a }))[0];
    assert_eq!(edited["text"], "first, edited");
    assert_eq!(edited["assignee"], "Ana");
    assert_ne!(edited["updatedAt"], edited["createdAt"]);
}

#[test]
fn action_item_text_and_assignee_limits() {
    let mut t = app();
    let id = start(&mut t, "bob", "Limits");
    let aid = add_action(&mut t, "bob", &id, "ok");
    for args in [
        json!({ "meetingId": id, "text": "a".repeat(501), "assignee": "", "sourceSeq": null }),
        json!({ "meetingId": id, "text": "x", "assignee": "b".repeat(101), "sourceSeq": null }),
    ] {
        assert_eq!(code(t.as_("bob").call("addAction", args)), "Invalid");
    }
    for args in [
        json!({ "actionId": aid, "text": " ", "assignee": "" }),
        json!({ "actionId": aid, "text": "x", "assignee": "b".repeat(101) }),
    ] {
        assert_eq!(code(t.as_("bob").call("editAction", args)), "Invalid");
    }
    // Signed-out callers touch no action item.
    assert!(t
        .anonymous()
        .call("setActionDone", json!({ "actionId": aid, "done": true }))
        .is_err());
    assert!(t.anonymous().view("openActions", json!({})).is_err());
}

#[test]
fn guests_record_their_own_meetings_but_not_others() {
    let mut t = app();
    let id = start(&mut t, "gus", "Guest call");
    append(&mut t, "gus", &id, vec![seg(0, "you", "hello")]);
    let bobs = start(&mut t, "bob", "Bob");
    assert_eq!(
        code(
            t.as_("gus")
                .call("deleteMeeting", json!({ "meetingId": bobs }))
        ),
        "Forbidden"
    );
    let r = call(&mut t, "gus", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(r["remaining"], 0);
}

// ── search and many meetings per workspace ───────────────────────────────────

#[test]
fn many_meetings_in_one_workspace_each_keep_their_own_transcript() {
    let mut t = app();
    let ids: Vec<String> = (0..12)
        .map(|i| {
            start(
                &mut t,
                if i % 2 == 0 { "bob" } else { "cy" },
                &format!("Call {i}"),
            )
        })
        .collect();
    for (i, id) in ids.iter().enumerate() {
        let who = if i % 2 == 0 { "bob" } else { "cy" };
        append(
            &mut t,
            who,
            id,
            vec![seg(0, "you", &format!("line of call {i}"))],
        );
        call(
            &mut t,
            who,
            "endMeeting",
            json!({ "meetingId": id, "durationMs": 1_000 }),
        );
    }
    let list = view(&mut t, "bob", "listMeetings", json!({}));
    assert_eq!(list.as_array().unwrap().len(), 12);
    for (i, id) in ids.iter().enumerate() {
        let page = view(
            &mut t,
            "bob",
            "transcript",
            json!({ "meetingId": id, "fromSeq": 0, "limit": 10 }),
        );
        assert_eq!(page["segments"][0]["text"], format!("line of call {i}"));
        assert_eq!(page["segments"].as_array().unwrap().len(), 1);
    }
}

#[test]
fn search_finds_titles_and_lines_in_every_meeting_any_case() {
    let mut t = app();
    let a = start(&mut t, "bob", "Pricing review");
    append(
        &mut t,
        "bob",
        &a,
        vec![
            seg(0, "you", "Let's look at the numbers."),
            seg(1, "others", "The new PRICING page ships Friday."),
        ],
    );
    let b = start(&mut t, "cy", "Standup");
    append(
        &mut t,
        "cy",
        &b,
        vec![
            seg(0, "others", "I fixed the pricing bug yesterday."),
            seg(1, "you", "Nothing else."),
        ],
    );

    let r = view(
        &mut t,
        "gus",
        "search",
        json!({ "query": "pricing", "limit": 50 }),
    );
    let hits = r["hits"].as_array().unwrap();
    // The engine's clock does not move here, so both meetings start at the same
    // time; newest-first is covered by `listMeetings`. A title hit has no line.
    let mut got: Vec<(String, Option<u64>)> = hits
        .iter()
        .map(|h| {
            (
                h["meetingId"].as_str().unwrap().to_owned(),
                h["seq"].as_u64(),
            )
        })
        .collect();
    got.sort();
    let mut want = vec![
        (a.clone(), None),
        (a.clone(), Some(1)),
        (b.clone(), Some(0)),
    ];
    want.sort();
    assert_eq!(got, want);
    let line = hits
        .iter()
        .find(|h| h["meetingId"] == a.as_str() && h["seq"] == 1)
        .unwrap();
    assert_eq!(line["startMs"], 3_000);
    assert_eq!(line["speaker"], "others");
    let title = hits.iter().find(|h| h["seq"].is_null()).unwrap();
    assert_eq!(title["title"], "Pricing review");
    assert!(title["text"].is_null());
    // Lines come in order within a meeting, right after its title.
    let pos = |seq: Option<u64>| {
        hits.iter()
            .position(|h| h["meetingId"] == a.as_str() && h["seq"].as_u64() == seq)
            .unwrap()
    };
    assert!(pos(None) < pos(Some(1)));
    assert_eq!(r["more"], false);

    // Every word must match, in any order.
    let r = view(
        &mut t,
        "bob",
        "search",
        json!({ "query": "friday  page", "limit": 50 }),
    );
    assert_eq!(r["hits"].as_array().unwrap().len(), 1);
    assert_eq!(r["hits"][0]["text"], "The new PRICING page ships Friday.");
    // Nothing to look for, nothing found.
    let r = view(
        &mut t,
        "bob",
        "search",
        json!({ "query": "   ", "limit": 50 }),
    );
    assert!(r["hits"].as_array().unwrap().is_empty());
}

#[test]
fn search_stops_at_its_limit_and_says_there_is_more() {
    let mut t = app();
    let id = start(&mut t, "bob", "Long call");
    append(
        &mut t,
        "bob",
        &id,
        (0..30)
            .map(|i| seg(i, "you", &format!("budget item {i}")))
            .collect(),
    );
    let r = view(
        &mut t,
        "bob",
        "search",
        json!({ "query": "budget", "limit": 10 }),
    );
    assert_eq!(r["hits"].as_array().unwrap().len(), 10);
    assert_eq!(r["more"], true);
    // The limit is clamped to 1–100.
    let r = view(
        &mut t,
        "bob",
        "search",
        json!({ "query": "budget", "limit": 0 }),
    );
    assert_eq!(r["hits"].as_array().unwrap().len(), 1);
}

#[test]
fn search_does_not_find_a_deleted_meeting_or_an_edited_away_word() {
    let mut t = app();
    let a = start(&mut t, "bob", "Gone");
    append(&mut t, "bob", &a, vec![seg(0, "you", "secret roadmap")]);
    let b = start(&mut t, "bob", "Kept");
    append(&mut t, "bob", &b, vec![seg(0, "you", "the roadmap draft")]);
    call(
        &mut t,
        "bob",
        "editSegment",
        json!({ "meetingId": b, "seq": 0, "text": "the plan draft" }),
    );
    loop {
        let r = call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": a }));
        if r["remaining"] == 0 {
            break;
        }
    }
    let r = view(
        &mut t,
        "bob",
        "search",
        json!({ "query": "roadmap", "limit": 50 }),
    );
    assert!(r["hits"].as_array().unwrap().is_empty(), "{r}");
    let r = view(
        &mut t,
        "bob",
        "search",
        json!({ "query": "plan", "limit": 50 }),
    );
    assert_eq!(r["hits"].as_array().unwrap().len(), 1);
}

// ── speaker names ────────────────────────────────────────────────────────────

#[test]
fn a_line_keeps_the_speaker_name_the_call_page_showed() {
    let mut t = app();
    let id = start(&mut t, "bob", "Named call");
    append(
        &mut t,
        "bob",
        &id,
        vec![
            json!({ "seq": 0, "startMs": 0, "endMs": 900, "speaker": "others", "name": "  Ana Kovač ", "text": "I'll send the deck." }),
            json!({ "seq": 1, "startMs": 1_000, "endMs": 1_900, "speaker": "others", "text": "Fine by me." }),
            seg(2, "you", "Thanks Ana."),
        ],
    );
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 10 }),
    );
    let names: Vec<&str> = page["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    // Trimmed; a line sent without one (an older extension) has none.
    assert_eq!(names, vec!["Ana Kovač", "", ""]);
    // Editing the text keeps the name.
    call(
        &mut t,
        "bob",
        "editSegment",
        json!({ "meetingId": id, "seq": 0, "text": "I'll send the deck today." }),
    );
    let page = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 1 }),
    );
    assert_eq!(page["segments"][0]["name"], "Ana Kovač");
    // Search hits say who spoke.
    let r = view(
        &mut t,
        "cy",
        "search",
        json!({ "query": "deck", "limit": 10 }),
    );
    assert_eq!(r["hits"][0]["name"], "Ana Kovač");
}

#[test]
fn a_speaker_name_has_a_length_limit() {
    let mut t = app();
    let id = start(&mut t, "bob", "Long name");
    let err = code(t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": [{ "seq": 0, "startMs": 0, "endMs": 1, "speaker": "others", "name": "x".repeat(101), "text": "hi" }] }),
    ));
    assert_eq!(err, "Invalid");
}
