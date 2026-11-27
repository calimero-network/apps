//! Sylence on core's real wasmtime engine (`TestApp`): every method of the ABI,
//! who may write what, resent batches, paging, limits and deleting in batches.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// The owner, two members and a guest.
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
    let m = call(
        t,
        who,
        "startMeeting",
        json!({ "title": title, "platform": "meet", "url": "https://meet.google.com/abc-defg-hij",
                "model": "whisper-large-v3-turbo", "language": "en" }),
    );
    m.as_str().expect("an id").to_owned()
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

#[test]
fn a_meeting_records_and_ends() {
    let mut t = app();
    let id = start(&mut t, "bob", "Weekly sync");
    let m = view(&mut t, "cy", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["title"], "Weekly sync");
    assert_eq!(m["platform"], "meet");
    assert_eq!(m["recorder"], "bob");
    assert_eq!(m["live"], true);
    assert_eq!(m["segments"], 0);

    let r = append(
        &mut t,
        "bob",
        &id,
        vec![
            seg(0, "you", "Good morning everyone"),
            seg(1, "others", "Morning, shall we start?"),
        ],
    );
    assert_eq!(r, json!({ "added": 2, "skipped": 0, "nextSeq": 2 }));

    t.advance(60_000);
    let m = call(
        &mut t,
        "bob",
        "endMeeting",
        json!({ "meetingId": id, "durationMs": 60_000 }),
    );
    assert_eq!(m["live"], false);
    assert_eq!(m["durationMs"], 60_000);
    assert_eq!(m["words"], 7);
    assert_eq!(m["segments"], 2);
    // Timestamps travel as strings (D20).
    assert!(m["endedAt"].is_string());

    // Ending again changes nothing.
    let again = call(
        &mut t,
        "bob",
        "endMeeting",
        json!({ "meetingId": id, "durationMs": 1 }),
    );
    assert_eq!(again["endedAt"], m["endedAt"]);
    assert_eq!(again["durationMs"], 60_000);
}

#[test]
fn a_resent_batch_is_stored_once() {
    let mut t = app();
    let id = start(&mut t, "bob", "Retry");
    let batch = vec![seg(0, "you", "one"), seg(1, "others", "two")];
    append(&mut t, "bob", &id, batch.clone());
    let r = append(
        &mut t,
        "bob",
        &id,
        vec![batch[0].clone(), batch[1].clone(), seg(2, "you", "three")],
    );
    assert_eq!(r, json!({ "added": 1, "skipped": 2, "nextSeq": 3 }));
    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["segments"], 3);
    assert_eq!(m["words"], 3);
}

#[test]
fn empty_text_is_skipped_and_bad_segments_refused() {
    let mut t = app();
    let id = start(&mut t, "bob", "Shapes");
    let r = append(&mut t, "bob", &id, vec![seg(0, "you", "   ")]);
    assert_eq!(r["added"], 0);
    assert_eq!(r["skipped"], 1);

    let bad_speaker = t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": [seg(1, "someone", "hi")] }),
    );
    assert_eq!(code(bad_speaker), "Invalid");

    let backwards = t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": [{ "seq": 1, "startMs": 10, "endMs": 5, "speaker": "you", "text": "hi" }] }),
    );
    assert_eq!(code(backwards), "Invalid");

    let too_many: Vec<Value> = (0..101).map(|i| seg(i, "you", "x")).collect();
    let r = t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": too_many }),
    );
    assert_eq!(code(r), "Invalid");

    let long = "a".repeat(4_001);
    let r = t.as_("bob").call(
        "appendSegments",
        json!({ "meetingId": id, "segments": [seg(1, "you", &long)] }),
    );
    assert_eq!(code(r), "Invalid");
}

#[test]
fn only_the_recorder_writes_the_transcript() {
    let mut t = app();
    let id = start(&mut t, "bob", "Bob's call");
    append(&mut t, "bob", &id, vec![seg(0, "you", "hello")]);

    for (method, args) in [
        (
            "appendSegments",
            json!({ "meetingId": id, "segments": [seg(1, "you", "hi")] }),
        ),
        (
            "editSegment",
            json!({ "meetingId": id, "seq": 0, "text": "changed" }),
        ),
        ("endMeeting", json!({ "meetingId": id, "durationMs": 1 })),
        (
            "renameMeeting",
            json!({ "meetingId": id, "title": "Mine now" }),
        ),
        ("setSummary", json!({ "meetingId": id, "summary": "Nope" })),
    ] {
        assert_eq!(
            code(t.as_("cy").call(method, args)),
            "Forbidden",
            "{method}"
        );
    }
    // The owner of the instance is not the recorder either.
    assert_eq!(
        code(
            t.as_("owner")
                .call("renameMeeting", json!({ "meetingId": id, "title": "x" }))
        ),
        "Forbidden"
    );
}

#[test]
fn signed_out_callers_are_refused() {
    let mut t = app();
    let id = start(&mut t, "bob", "Private");
    let r = t.anonymous().view("getMeeting", json!({ "meetingId": id }));
    assert!(r.is_err());
    let r = t.anonymous().call(
        "startMeeting",
        json!({ "title": "x", "platform": "", "url": "", "model": "", "language": "" }),
    );
    assert!(r.is_err());
}

#[test]
fn an_api_key_acts_for_its_account() {
    let mut t = app();
    let id = t
        .api_key("key-1", "bob")
        .call(
            "startMeeting",
            json!({ "title": "From the extension", "platform": "zoom", "url": "", "model": "moonshine-base", "language": "" }),
        )
        .expect("start");
    let id = id.as_str().unwrap().to_owned();
    let m = view(&mut t, "cy", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["recorder"], "bob");
    // Bob signed in on the page writes the same meeting.
    append(&mut t, "bob", &id, vec![seg(0, "you", "works")]);
}

#[test]
fn start_checks_its_arguments() {
    let mut t = app();
    let r = t.as_("bob").call(
        "startMeeting",
        json!({ "title": "  ", "platform": "meet", "url": "", "model": "", "language": "" }),
    );
    assert_eq!(code(r), "Invalid");
    let r = t.as_("bob").call(
        "startMeeting",
        json!({ "title": "x", "platform": "meet", "url": "http://insecure", "model": "", "language": "" }),
    );
    assert_eq!(code(r), "Invalid");
    // An unknown platform is kept as "other".
    let id = call(
        &mut t,
        "bob",
        "startMeeting",
        json!({ "title": " Trimmed ", "platform": "Webex", "url": "", "model": "", "language": "" }),
    );
    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["platform"], "other");
    assert_eq!(m["title"], "Trimmed");
}

#[test]
fn the_transcript_pages_in_order() {
    let mut t = app();
    let id = start(&mut t, "bob", "Long");
    for batch in 0..3u32 {
        let segs = (0..100)
            .map(|i| {
                seg(
                    batch * 100 + i,
                    "others",
                    &format!("line {}", batch * 100 + i),
                )
            })
            .collect();
        append(&mut t, "bob", &id, segs);
    }
    let first = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 120 }),
    );
    let segs = first["segments"].as_array().unwrap();
    assert_eq!(segs.len(), 120);
    assert_eq!(segs[0]["seq"], 0);
    assert_eq!(segs[119]["seq"], 119);
    assert_eq!(first["next"], 120);

    let last = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 240, "limit": 500 }),
    );
    let segs = last["segments"].as_array().unwrap();
    assert_eq!(segs.len(), 60);
    assert_eq!(segs[0]["text"], "line 240");
    assert_eq!(last["next"], Value::Null);

    // A limit of 0 still returns one.
    let one = view(
        &mut t,
        "cy",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 5, "limit": 0 }),
    );
    assert_eq!(one["segments"].as_array().unwrap().len(), 1);
    assert_eq!(one["next"], 6);
}

#[test]
fn segments_out_of_order_sort_by_number() {
    let mut t = app();
    let id = start(&mut t, "bob", "Two streams");
    append(
        &mut t,
        "bob",
        &id,
        vec![seg(3, "others", "d"), seg(1, "you", "b")],
    );
    append(
        &mut t,
        "bob",
        &id,
        vec![seg(0, "you", "a"), seg(2, "others", "c")],
    );
    let page = view(
        &mut t,
        "bob",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 10 }),
    );
    let texts: Vec<&str> = page["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, ["a", "b", "c", "d"]);
    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["nextSeq"], 4);
}

#[test]
fn the_recorder_corrects_a_segment() {
    let mut t = app();
    let id = start(&mut t, "bob", "Typos");
    append(
        &mut t,
        "bob",
        &id,
        vec![seg(0, "others", "the calamari network")],
    );
    let s = call(
        &mut t,
        "bob",
        "editSegment",
        json!({ "meetingId": id, "seq": 0, "text": "the Calimero network" }),
    );
    assert_eq!(s["edited"], true);
    assert_eq!(s["text"], "the Calimero network");
    let r = t.as_("bob").call(
        "editSegment",
        json!({ "meetingId": id, "seq": 9, "text": "x" }),
    );
    assert_eq!(code(r), "NotFound");
    let r = t.as_("bob").call(
        "editSegment",
        json!({ "meetingId": id, "seq": 0, "text": " " }),
    );
    assert_eq!(code(r), "Invalid");
}

#[test]
fn a_transcript_redone_after_the_call_replaces_the_live_one() {
    let mut t = app();
    let id = start(&mut t, "bob", "Redo");
    let live: Vec<Value> = (0..3)
        .map(|i| seg(i, "others", "live words here"))
        .collect();
    append(&mut t, "bob", &id, live);
    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["revised"], false);
    let next = m["nextSeq"].as_u64().unwrap() as u32;
    assert_eq!(next, 3);
    append(
        &mut t,
        "bob",
        &id,
        vec![
            seg(next, "others", "the better words"),
            seg(next + 1, "you", "mine"),
        ],
    );
    let r = t.as_("cy").call(
        "dropSegments",
        json!({ "meetingId": id, "fromSeq": 0, "beforeSeq": next }),
    );
    assert_eq!(code(r), "Forbidden");
    let d = call(
        &mut t,
        "bob",
        "dropSegments",
        json!({ "meetingId": id, "fromSeq": 0, "beforeSeq": next }),
    );
    assert_eq!(d["removed"], 3);
    assert_eq!(d["remaining"], 0);
    let page = view(
        &mut t,
        "bob",
        "transcript",
        json!({ "meetingId": id, "fromSeq": 0, "limit": 100 }),
    );
    let texts: Vec<&str> = page["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, ["the better words", "mine"]);
    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["revised"], true);
    assert_eq!(m["segments"], 2);
    assert_eq!(m["words"], 4);
    // Again: nothing left before it.
    let d = call(
        &mut t,
        "bob",
        "dropSegments",
        json!({ "meetingId": id, "fromSeq": 0, "beforeSeq": next }),
    );
    assert_eq!(d["removed"], 0);
}

#[test]
fn a_failed_redo_is_rolled_back() {
    let mut t = app();
    let id = start(&mut t, "bob", "Rollback");
    append(
        &mut t,
        "bob",
        &id,
        vec![seg(0, "others", "live one"), seg(1, "you", "live two")],
    );
    append(&mut t, "bob", &id, vec![seg(2, "others", "half sent")]);
    let d = call(
        &mut t,
        "bob",
        "dropSegments",
        json!({ "meetingId": id, "fromSeq": 2, "beforeSeq": u32::MAX }),
    );
    assert_eq!(d["removed"], 1);
    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["revised"], false);
    assert_eq!(m["segments"], 2);
}

#[test]
fn rename_and_summary() {
    let mut t = app();
    let id = start(&mut t, "bob", "Untitled call");
    let m = call(
        &mut t,
        "bob",
        "renameMeeting",
        json!({ "meetingId": id, "title": "Roadmap review" }),
    );
    assert_eq!(m["title"], "Roadmap review");
    let m = call(
        &mut t,
        "bob",
        "setSummary",
        json!({ "meetingId": id, "summary": "We agreed on Q1 scope." }),
    );
    assert_eq!(m["summary"], "We agreed on Q1 scope.");
}

#[test]
fn meetings_list_newest_first() {
    let mut t = app();
    let a = start(&mut t, "bob", "First");
    t.advance(1_000);
    let b = start(&mut t, "cy", "Second");
    t.advance(1_000);
    let c = start(&mut t, "gus", "Guest's");
    let list = view(&mut t, "owner", "listMeetings", json!({}));
    let ids: Vec<&str> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [c.as_str(), b.as_str(), a.as_str()]);
}

#[test]
fn action_items_round_trip() {
    let mut t = app();
    let id = start(&mut t, "bob", "Planning");
    append(
        &mut t,
        "bob",
        &id,
        vec![seg(0, "others", "Cy will send the deck by Friday")],
    );
    let aid = call(
        &mut t,
        "cy",
        "addAction",
        json!({ "meetingId": id, "text": "Send the deck", "assignee": "Cy", "sourceSeq": 0 }),
    );
    let aid = aid.as_str().unwrap().to_owned();
    let a = &view(&mut t, "bob", "listActions", json!({ "meetingId": id }))[0];
    assert_eq!(a["done"], false);
    assert_eq!(a["sourceSeq"], 0);
    assert_eq!(a["createdBy"], "cy");
    assert_eq!(a["id"], aid);
    let bid = call(
        &mut t,
        "bob",
        "addAction",
        json!({ "meetingId": id, "text": "Book the room", "assignee": "", "sourceSeq": null }),
    );
    let bid = bid.as_str().unwrap().to_owned();

    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["openActions"], 2);
    assert_eq!(
        view(&mut t, "gus", "openActions", json!({}))
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let done = call(
        &mut t,
        "bob",
        "setActionDone",
        json!({ "actionId": aid, "done": true }),
    );
    assert_eq!(done["done"], true);
    let open = view(&mut t, "bob", "openActions", json!({}));
    assert_eq!(open.as_array().unwrap().len(), 1);
    assert_eq!(open[0]["id"], bid);
    // Ticking it again changes nothing; unticking reopens it.
    call(
        &mut t,
        "bob",
        "setActionDone",
        json!({ "actionId": aid, "done": true }),
    );
    call(
        &mut t,
        "cy",
        "setActionDone",
        json!({ "actionId": aid, "done": false }),
    );
    assert_eq!(
        view(&mut t, "bob", "openActions", json!({}))
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let edited = call(
        &mut t,
        "gus",
        "editAction",
        json!({ "actionId": bid, "text": "Book room 4", "assignee": "Gus" }),
    );
    assert_eq!(edited["text"], "Book room 4");
    assert_eq!(edited["assignee"], "Gus");

    let list = view(&mut t, "bob", "listActions", json!({ "meetingId": id }));
    let texts: Vec<&str> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, ["Send the deck", "Book room 4"]);
}

#[test]
fn action_items_check_their_arguments() {
    let mut t = app();
    let id = start(&mut t, "bob", "Checks");
    let r = t.as_("bob").call(
        "addAction",
        json!({ "meetingId": id, "text": " ", "assignee": "", "sourceSeq": null }),
    );
    assert_eq!(code(r), "Invalid");
    let r = t.as_("bob").call(
        "addAction",
        json!({ "meetingId": id, "text": "x", "assignee": "", "sourceSeq": 7 }),
    );
    assert_eq!(code(r), "NotFound");
    let r = t.as_("bob").call(
        "addAction",
        json!({ "meetingId": "nope", "text": "x", "assignee": "", "sourceSeq": null }),
    );
    assert_eq!(code(r), "NotFound");
    let r = t
        .as_("bob")
        .call("setActionDone", json!({ "actionId": "nope", "done": true }));
    assert_eq!(code(r), "NotFound");
}

#[test]
fn who_removes_an_action_item() {
    let mut t = app();
    let id = start(&mut t, "bob", "Removal");
    let add = |t: &mut TestApp, who: &str| -> String {
        call(
            t,
            who,
            "addAction",
            json!({ "meetingId": id, "text": "x", "assignee": "", "sourceSeq": null }),
        )
        .as_str()
        .unwrap()
        .to_owned()
    };
    let by_cy = add(&mut t, "cy");
    // Someone else's item: refused for a member.
    assert_eq!(
        code(
            t.as_("gus")
                .call("removeAction", json!({ "actionId": by_cy }))
        ),
        "Forbidden"
    );
    // Its author, the recorder and the instance's owner may.
    call(&mut t, "cy", "removeAction", json!({ "actionId": by_cy }));
    let second = add(&mut t, "cy");
    call(&mut t, "bob", "removeAction", json!({ "actionId": second }));
    let third = add(&mut t, "gus");
    call(
        &mut t,
        "owner",
        "removeAction",
        json!({ "actionId": third }),
    );
    assert_eq!(
        view(&mut t, "bob", "listActions", json!({ "meetingId": id }))
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(view(&mut t, "bob", "openActions", json!({})), json!([]));
}

#[test]
fn deleting_a_meeting_removes_everything_in_batches() {
    let mut t = app();
    let id = start(&mut t, "bob", "Big");
    for batch in 0..15u32 {
        let segs = (0..100).map(|i| seg(batch * 100 + i, "you", "w")).collect();
        append(&mut t, "bob", &id, segs);
    }
    call(
        &mut t,
        "cy",
        "addAction",
        json!({ "meetingId": id, "text": "x", "assignee": "", "sourceSeq": 3 }),
    );
    assert_eq!(
        code(
            t.as_("cy")
                .call("deleteMeeting", json!({ "meetingId": id }))
        ),
        "Forbidden"
    );

    let r = call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(r["remaining"], 500);
    // Gone from every read at once.
    assert_eq!(view(&mut t, "bob", "listMeetings", json!({})), json!([]));
    assert_eq!(view(&mut t, "bob", "openActions", json!({})), json!([]));
    assert_eq!(
        code(t.as_("bob").view("getMeeting", json!({ "meetingId": id }))),
        "NotFound"
    );
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
fn the_owner_deletes_anyones_meeting() {
    let mut t = app();
    let id = start(&mut t, "bob", "Bob's");
    append(&mut t, "bob", &id, vec![seg(0, "you", "hi")]);
    let r = call(&mut t, "owner", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(r["remaining"], 0);
}

#[test]
fn events_carry_ids_not_text() {
    let mut t = app();
    let id = start(&mut t, "bob", "Events");
    append(
        &mut t,
        "bob",
        &id,
        vec![seg(0, "you", "secret words"), seg(1, "others", "more")],
    );
    let events = t.events_for("cy");
    let changed = events
        .iter()
        .find(|(name, _)| name == "TranscriptChanged")
        .expect("a TranscriptChanged event");
    assert_eq!(changed.1["meetingId"], id);
    assert_eq!(changed.1["from"], 0);
    assert_eq!(changed.1["to"], 2);
    let all = serde_json::to_string(&events).unwrap();
    assert!(!all.contains("secret words"));
}

#[test]
fn my_account_names_the_caller() {
    let mut t = app();
    assert_eq!(view(&mut t, "cy", "myAccount", json!({})), "cy");
}

fn upload_meeting(t: &mut TestApp, who: &str) -> String {
    let m = call(
        t,
        who,
        "startMeeting",
        json!({ "title": "standup.m4a", "platform": "upload", "url": "", "model": "whisper-base", "language": "" }),
    );
    m.as_str().expect("an id").to_owned()
}

#[test]
fn an_uploaded_recording_keeps_its_audio() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    let m = view(&mut t, "bob", "getMeeting", json!({ "meetingId": id }));
    assert_eq!(m["platform"], "upload");
    assert_eq!(m["audio"], Value::Null);

    let blob = t.upload_blob(&[7_u8; 4_096], "audio/mp4");
    let m = call(
        &mut t,
        "bob",
        "attachAudio",
        json!({ "meetingId": id, "blob": blob, "mime": "Audio/MP4", "durationMs": 61_000 }),
    );
    assert_eq!(m["audio"]["blob"], blob);
    assert_eq!(m["audio"]["mime"], "audio/mp4");
    assert_eq!(m["audio"]["size"], 4_096);
    assert_eq!(m["audio"]["durationMs"], 61_000);
    assert_eq!(m["durationMs"], 61_000);
    assert_eq!(t.blob_refs(&blob), 1);

    let m = call(&mut t, "bob", "removeAudio", json!({ "meetingId": id }));
    assert_eq!(m["audio"], Value::Null);
    assert_eq!(t.blob_refs(&blob), 0);
}

#[test]
fn audio_is_checked() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    let blob = t.upload_blob(&[1_u8; 64], "audio/mpeg");
    let attach = |t: &mut TestApp, who: &str, blob: &str, mime: &str| {
        t.as_(who).call(
            "attachAudio",
            json!({ "meetingId": id, "blob": blob, "mime": mime, "durationMs": 1_000 }),
        )
    };
    // Only the recorder.
    assert_eq!(code(attach(&mut t, "cy", &blob, "audio/mpeg")), "Forbidden");
    assert_eq!(
        code(attach(&mut t, "owner", &blob, "audio/mpeg")),
        "Forbidden"
    );
    // Audio or video types only.
    assert_eq!(code(attach(&mut t, "bob", &blob, "text/plain")), "Invalid");
    // A blob the app does not hold.
    let missing = "ab".repeat(32);
    assert_eq!(
        code(attach(&mut t, "bob", &missing, "audio/mpeg")),
        "NotFound"
    );
    attach(&mut t, "bob", &blob, "audio/mpeg").expect("attached");
}

#[test]
fn speakers_get_names() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    let name = |t: &mut TestApp, who: &str, label: &str, name: &str| {
        t.as_(who).call(
            "setSpeakerName",
            json!({ "meetingId": id, "label": label, "name": name }),
        )
    };
    let m = name(&mut t, "bob", "Speaker 1", "Eve").unwrap();
    assert_eq!(
        m["speakerNames"],
        json!([{ "label": "Speaker 1", "name": "Eve" }])
    );
    // Renaming replaces; the owner may too; a member may not.
    let m = name(&mut t, "owner", "Speaker 1", "Sam").unwrap();
    assert_eq!(
        m["speakerNames"],
        json!([{ "label": "Speaker 1", "name": "Sam" }])
    );
    assert_eq!(code(name(&mut t, "cy", "Speaker 1", "Cy")), "Forbidden");
    // An empty name clears it.
    let m = name(&mut t, "bob", "Speaker 1", " ").unwrap();
    assert_eq!(m["speakerNames"], json!([]));
    assert_eq!(code(name(&mut t, "bob", "", "Eve")), "Invalid");
}

#[test]
fn people_insights_round_trip() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    assert_eq!(
        view(&mut t, "cy", "insights", json!({ "meetingId": id })),
        Value::Null
    );
    let person = json!({
        "label": "Speaker 1", "tone": "enthusiastic",
        "profile": "Drove the roadmap talk and asked the most questions.",
        "emotions": [{ "label": "excitement", "share": 420 }, { "label": "curiosity", "share": 210 }],
        "keyPoints": ["Ship the beta on Friday", " "]
    });
    let saved = call(
        &mut t,
        "bob",
        "setInsights",
        json!({ "meetingId": id, "insights": { "model": "go-emotions", "people": [person] } }),
    );
    assert_eq!(
        saved["people"][0]["keyPoints"],
        json!(["Ship the beta on Friday"])
    );
    assert_eq!(saved["updatedBy"], "bob");
    let read = view(&mut t, "cy", "insights", json!({ "meetingId": id }));
    assert_eq!(read["people"][0]["tone"], "enthusiastic");
    assert_eq!(read["people"][0]["emotions"][0]["share"], 420);
    assert!(t
        .events_for("cy")
        .iter()
        .any(|(n, _)| n == "InsightsChanged"));

    // Checks: who, shares, counts.
    let set = |t: &mut TestApp, who: &str, people: Value| {
        t.as_(who).call(
            "setInsights",
            json!({ "meetingId": id, "insights": { "model": "", "people": people } }),
        )
    };
    assert_eq!(code(set(&mut t, "cy", json!([]))), "Forbidden");
    let bad_share = json!([{ "label": "A", "tone": "", "profile": "", "emotions": [{ "label": "joy", "share": 1_001 }], "keyPoints": [] }]);
    assert_eq!(code(set(&mut t, "bob", bad_share)), "Invalid");
    let points: Vec<String> = (0..9).map(|i| format!("point {i}")).collect();
    let many =
        json!([{ "label": "A", "tone": "", "profile": "", "emotions": [], "keyPoints": points }]);
    assert_eq!(code(set(&mut t, "bob", many)), "Invalid");

    // No people clears them; deleting the meeting drops them too.
    assert_eq!(set(&mut t, "owner", json!([])).unwrap(), Value::Null);
    assert_eq!(
        view(&mut t, "cy", "insights", json!({ "meetingId": id })),
        Value::Null
    );
}

#[test]
fn deleting_a_meeting_drops_its_audio_and_insights() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    let blob = t.upload_blob(&[3_u8; 128], "audio/webm");
    call(
        &mut t,
        "bob",
        "attachAudio",
        json!({ "meetingId": id, "blob": blob, "mime": "audio/webm", "durationMs": 5_000 }),
    );
    call(
        &mut t,
        "bob",
        "setInsights",
        json!({ "meetingId": id, "insights": { "model": "m", "people": [
            { "label": "Speaker 1", "tone": "neutral", "profile": "", "emotions": [], "keyPoints": [] }
        ] } }),
    );
    let r = call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": id }));
    assert_eq!(r["remaining"], 0);
    assert_eq!(t.blob_refs(&blob), 0);
    // A new meeting does not inherit them.
    let again = upload_meeting(&mut t, "bob");
    assert_eq!(
        view(&mut t, "bob", "insights", json!({ "meetingId": again })),
        Value::Null
    );
}

fn attach(
    t: &mut TestApp,
    who: &str,
    id: &str,
    blob: &str,
    mime: &str,
    ms: u32,
) -> Result<Value, Failure> {
    t.as_(who).call(
        "attachAudio",
        json!({ "meetingId": id, "blob": blob, "mime": mime, "durationMs": ms }),
    )
}

#[test]
fn only_uploads_keep_audio_of_the_type_they_were_uploaded_as() {
    let mut t = app();
    // A recorded call never keeps audio.
    let call_id = start(&mut t, "bob", "Call");
    let blob = t.upload_blob(&[5_u8; 256], "audio/mpeg");
    assert_eq!(
        code(attach(&mut t, "bob", &call_id, &blob, "audio/mpeg", 1_000)),
        "Refused"
    );

    let id = upload_meeting(&mut t, "bob");
    // Not a playable type, or not the type the node serves.
    assert_eq!(
        code(attach(&mut t, "bob", &id, &blob, "audio/x-made-up", 1_000)),
        "Invalid"
    );
    assert_eq!(
        code(attach(&mut t, "bob", &id, &blob, "audio/wav", 1_000)),
        "Invalid"
    );
    let html = t.upload_blob(b"<script>alert(1)</script>", "text/html");
    assert_eq!(
        code(attach(&mut t, "bob", &id, &html, "audio/mpeg", 1_000)),
        "Invalid"
    );
    // Durations out of range.
    assert_eq!(
        code(attach(&mut t, "bob", &id, &blob, "audio/mpeg", 0)),
        "Invalid"
    );
    assert_eq!(
        code(attach(
            &mut t,
            "bob",
            &id,
            &blob,
            "audio/mpeg",
            6 * 3_600_000
        )),
        "Invalid"
    );
    attach(&mut t, "bob", &id, &blob, "audio/mpeg", 1_000).expect("attached");
}

#[test]
fn a_new_recording_replaces_the_old_one() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    let first = t.upload_blob(&[1_u8; 100], "audio/mpeg");
    let second = t.upload_blob(&[2_u8; 100], "audio/ogg");
    attach(&mut t, "bob", &id, &first, "audio/mpeg", 1_000).unwrap();
    let m = attach(&mut t, "bob", &id, &second, "audio/ogg", 2_000).unwrap();
    assert_eq!(m["audio"]["blob"], second);
    assert_eq!(t.blob_refs(&first), 0);
    assert_eq!(t.blob_refs(&second), 1);
}

#[test]
fn a_blob_over_the_limit_is_refused() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    let big = t.upload_blob(&vec![0_u8; 49_545_217], "audio/mpeg");
    assert_eq!(
        code(attach(&mut t, "bob", &id, &big, "audio/mpeg", 1_000)),
        "Invalid"
    );
}

#[test]
fn an_account_keeps_a_bounded_number_of_recordings() {
    let mut t = app();
    let mut n = 0_u32;
    let mut fresh = |t: &mut TestApp| {
        n += 1;
        t.upload_blob(&n.to_le_bytes(), "audio/mpeg")
    };
    let first = fresh(&mut t);
    let mut ids = Vec::new();
    for i in 0..100 {
        let id = upload_meeting(&mut t, "bob");
        let blob = if i == 0 { first.clone() } else { fresh(&mut t) };
        attach(&mut t, "bob", &id, &blob, "audio/mpeg", 1_000).unwrap();
        ids.push(id);
    }
    let extra = upload_meeting(&mut t, "bob");
    let b = fresh(&mut t);
    assert_eq!(
        code(attach(&mut t, "bob", &extra, &b, "audio/mpeg", 1_000)),
        "Refused"
    );
    // Re-attaching to a meeting that has one does not count twice.
    attach(&mut t, "bob", &ids[0], &first, "audio/mpeg", 2_000).unwrap();
    // Another account has its own allowance.
    let cy = upload_meeting(&mut t, "cy");
    let b = fresh(&mut t);
    attach(&mut t, "cy", &cy, &b, "audio/mpeg", 1_000).unwrap();
    // Removing one, or deleting a meeting, frees a place.
    call(&mut t, "bob", "removeAudio", json!({ "meetingId": ids[0] }));
    let b = fresh(&mut t);
    attach(&mut t, "bob", &extra, &b, "audio/mpeg", 1_000).unwrap();
    let another = upload_meeting(&mut t, "bob");
    let b = fresh(&mut t);
    assert_eq!(
        code(attach(&mut t, "bob", &another, &b, "audio/mpeg", 1_000)),
        "Refused"
    );
    // The owner deleting Bob's meeting frees Bob's place, not the owner's.
    assert_eq!(view(&mut t, "bob", "recordingsLeft", json!({})), 0);
    call(
        &mut t,
        "owner",
        "deleteMeeting",
        json!({ "meetingId": ids[1] }),
    );
    assert_eq!(view(&mut t, "bob", "recordingsLeft", json!({})), 1);
    assert_eq!(view(&mut t, "owner", "recordingsLeft", json!({})), 100);
    let b = fresh(&mut t);
    attach(&mut t, "bob", &another, &b, "audio/mpeg", 1_000).unwrap();
    // Removing twice, then deleting, never frees more than one place.
    call(&mut t, "bob", "removeAudio", json!({ "meetingId": ids[2] }));
    call(&mut t, "bob", "removeAudio", json!({ "meetingId": ids[2] }));
    call(
        &mut t,
        "bob",
        "deleteMeeting",
        json!({ "meetingId": ids[2] }),
    );
    assert_eq!(view(&mut t, "bob", "recordingsLeft", json!({})), 1);
}

#[test]
fn speaker_names_and_insights_have_limits() {
    let mut t = app();
    let id = upload_meeting(&mut t, "bob");
    // Naming a label as itself stores nothing.
    let m = call(
        &mut t,
        "bob",
        "setSpeakerName",
        json!({ "meetingId": id, "label": "Speaker 1", "name": "Speaker 1" }),
    );
    assert_eq!(m["speakerNames"], json!([]));
    for i in 0..50 {
        call(
            &mut t,
            "bob",
            "setSpeakerName",
            json!({ "meetingId": id, "label": format!("S{i}"), "name": "N" }),
        );
    }
    let over = t.as_("bob").call(
        "setSpeakerName",
        json!({ "meetingId": id, "label": "S50", "name": "N" }),
    );
    assert_eq!(code(over), "Refused");

    let person = |i: usize| json!({ "label": format!("P{i}"), "tone": "", "profile": "", "emotions": [], "keyPoints": [] });
    let many: Vec<Value> = (0..51).map(person).collect();
    let r = t.as_("bob").call(
        "setInsights",
        json!({ "meetingId": id, "insights": { "model": "m", "people": many } }),
    );
    assert_eq!(code(r), "Invalid");
    let emotions: Vec<Value> = (0..9)
        .map(|i| json!({ "label": format!("e{i}"), "share": 1 }))
        .collect();
    let r = t.as_("bob").call(
        "setInsights",
        json!({ "meetingId": id, "insights": { "model": "m", "people": [
        { "label": "A", "tone": "", "profile": "", "emotions": emotions, "keyPoints": [] }
    ] } }),
    );
    assert_eq!(code(r), "Invalid");
    // The owner may save them; unknown meetings are NotFound.
    call(
        &mut t,
        "owner",
        "setInsights",
        json!({ "meetingId": id, "insights": { "model": "m", "people": [person(0)] } }),
    );
    let r = t.as_("bob").call(
        "setInsights",
        json!({ "meetingId": "ffff", "insights": { "model": "m", "people": [] } }),
    );
    assert_eq!(code(r), "NotFound");
    assert_eq!(
        code(
            t.as_("bob")
                .view("insights", json!({ "meetingId": "ffff" }))
        ),
        "NotFound"
    );
}

#[test]
fn a_redone_transcript_drops_the_old_insights() {
    let mut t = app();
    let id = start(&mut t, "bob", "Redo");
    append(&mut t, "bob", &id, vec![seg(0, "you", "first take")]);
    call(
        &mut t,
        "bob",
        "setInsights",
        json!({ "meetingId": id, "insights": { "model": "m", "people": [
        { "label": "you", "tone": "neutral", "profile": "", "emotions": [], "keyPoints": [] }
    ] } }),
    );
    append(&mut t, "bob", &id, vec![seg(1, "you", "second take")]);
    call(
        &mut t,
        "bob",
        "dropSegments",
        json!({ "meetingId": id, "fromSeq": 0, "beforeSeq": 1 }),
    );
    assert_eq!(
        view(&mut t, "bob", "insights", json!({ "meetingId": id })),
        Value::Null
    );
}

#[test]
fn a_recording_belongs_to_one_meeting() {
    let mut t = app();
    let a = upload_meeting(&mut t, "bob");
    let b = upload_meeting(&mut t, "cy");
    let blob = t.upload_blob(&[42_u8; 64], "audio/mpeg");
    attach(&mut t, "bob", &a, &blob, "audio/mpeg", 1_000).unwrap();
    // Another meeting cannot name it, so removing it from the first removes it.
    assert_eq!(
        code(attach(&mut t, "cy", &b, &blob, "audio/mpeg", 1_000)),
        "Refused"
    );
    // Its own meeting can attach it again.
    attach(&mut t, "bob", &a, &blob, "audio/mpeg", 2_000).unwrap();
    call(&mut t, "bob", "removeAudio", json!({ "meetingId": a }));
    attach(&mut t, "cy", &b, &blob, "audio/mpeg", 1_000).unwrap();
    // Replaced or deleted, it is free again.
    let other = t.upload_blob(&[43_u8; 64], "audio/mpeg");
    attach(&mut t, "cy", &b, &other, "audio/mpeg", 1_000).unwrap();
    attach(&mut t, "bob", &a, &blob, "audio/mpeg", 1_000).unwrap();
    call(&mut t, "bob", "deleteMeeting", json!({ "meetingId": a }));
    let c = upload_meeting(&mut t, "cy");
    attach(&mut t, "cy", &c, &blob, "audio/mpeg", 1_000).unwrap();
}
