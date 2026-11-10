//! The stream on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method, v1's forged-write tests as what they become when
//! every write rule is a method check, and the access and wire checks v1 could
//! not express.
//!
//! Accounts: `owner` created the stream (v1's creator: its admin and the
//! moderator who sweeps departed senders); `bob`, `carol`, `dave` and
//! `mallory` are org members; `gus` a guest; `eve` is outside the org.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

const FRAME_WINDOW: u64 = 30;
const LIVE_WINDOW_MS: u64 = 6_000;
const MAX_LIVE_CHUNKS_PER_SENDER: u64 = 600;
const STALE_SENDER_MS: u64 = 30_000;
const MAX_MEDIA_CHUNK_BYTES: usize = 256 * 1024;
const MAX_DIM: u16 = 256;

fn app() -> TestApp {
    common::app(
        Org::new()
            .members(["bob", "carol", "dave", "mallory"])
            .guests(["gus"]),
    )
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Result<Value, Failure> {
    t.as_(who).call(method, args)
}

fn ok(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    call(t, who, method, args).unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn view(t: &mut TestApp, method: &str, args: Value) -> Value {
    t.as_("owner")
        .view(method, args)
        .unwrap_or_else(|e| panic!("{method}: {e:?}"))
}

fn code(r: Result<Value, Failure>) -> String {
    match r {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

/// A decimal-string u64 (D20) as a number.
fn n(v: &Value) -> u64 {
    v.as_str()
        .unwrap_or_else(|| panic!("not a decimal string: {v}"))
        .parse()
        .unwrap()
}

fn join(t: &mut TestApp, who: &str) {
    ok(t, who, "join", json!({ "username": who, "now": "1000" }));
}

/// A stream with these accounts joined.
fn stream(who: &[&str]) -> TestApp {
    let mut t = app();
    for w in who {
        join(&mut t, w);
    }
    t
}

/// A frame whose pixels are all `(q<<4)|q`, so the codec's round trip is the
/// identity (C1).
fn aligned(w: usize, h: usize) -> Vec<u8> {
    (0..w * h)
        .map(|i| {
            let q = (i % 16) as u8;
            (q << 4) | q
        })
        .collect()
}

fn encode(
    t: &mut TestApp,
    who: &str,
    raw: &[u8],
    w: u16,
    h: u16,
    now: u64,
) -> Result<Value, Failure> {
    call(
        t,
        who,
        "encodeFrame",
        json!({ "raw": URL_SAFE_NO_PAD.encode(raw), "width": w, "height": h, "track": 0, "now": now.to_string() }),
    )
}

fn encode_ok(t: &mut TestApp, who: &str, raw: &[u8], w: u16, h: u16, now: u64) -> u64 {
    n(&encode(t, who, raw, w, h, now).unwrap_or_else(|e| panic!("encodeFrame: {e:?}")))
}

fn frames(t: &mut TestApp, after: u64) -> Vec<Value> {
    view(t, "getFrame", json!({ "afterSeq": after.to_string() }))
        .as_array()
        .unwrap()
        .clone()
}

fn pixels(frame: &Value) -> Vec<u8> {
    URL_SAFE_NO_PAD
        .decode(frame["pixels"].as_str().unwrap())
        .unwrap()
}

fn stats(t: &mut TestApp) -> Value {
    view(t, "getStats", json!({}))
}

fn post(t: &mut TestApp, who: &str, data: &[u8], key: bool, now: u64) -> Result<Value, Failure> {
    call(
        t,
        who,
        "postChunk",
        json!({
            "dataB64": STANDARD.encode(data), "track": 0, "isKeyframe": key,
            "codec": "avc1.42001f", "width": 640, "height": 480,
            "timestampUs": (now * 1000).to_string(), "now": now.to_string(),
        }),
    )
}

fn post_ok(t: &mut TestApp, who: &str, data: &[u8], key: bool, now: u64) -> u64 {
    n(&post(t, who, data, key, now).unwrap_or_else(|e| panic!("postChunk {who}: {e:?}")))
}

fn cursors(list: &[(&str, u64)]) -> Value {
    Value::Array(
        list.iter()
            .map(|(f, s)| json!({ "from": f, "afterSeq": s.to_string() }))
            .collect(),
    )
}

fn chunks(t: &mut TestApp, list: &[(&str, u64)]) -> Vec<Value> {
    view(t, "getChunks", json!({ "cursors": cursors(list) }))
        .as_array()
        .unwrap()
        .clone()
}

fn data(chunk: &Value) -> Vec<u8> {
    STANDARD.decode(chunk["dataB64"].as_str().unwrap()).unwrap()
}

fn sender(t: &mut TestApp, who: &str) -> Value {
    view(t, "getLiveStats", json!({}))["senders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["from"] == who)
        .cloned()
        .unwrap_or_else(|| panic!("no stats for {who}"))
}

fn live(t: &mut TestApp, who: &str) -> u64 {
    sender(t, who)["liveChunks"].as_u64().unwrap()
}

fn keyframes(t: &mut TestApp) -> Value {
    view(t, "keyframeCursors", json!({}))
}

// ── Membership ──────────────────────────────────────────────────────────────

#[test]
fn init_names_nothing_and_emits_initialized() {
    let mut t = app();
    let s = stats(&mut t);
    assert_eq!(s["name"], "");
    assert_eq!(s["nextSeq"], "0");
    assert_eq!(s["memberCount"], 0);
    assert_eq!(t.events_for("bob")[0].0, "Initialized");
}

#[test]
fn membership_is_idempotent_and_updates_the_name() {
    let mut t = app();
    let first = ok(
        &mut t,
        "bob",
        "join",
        json!({ "username": "Bob", "now": "1000" }),
    );
    assert_eq!(
        first,
        json!({ "memberId": "bob", "username": "Bob", "joinedAt": "1000", "updatedAt": "1000" })
    );
    let again = ok(
        &mut t,
        "bob",
        "join",
        json!({ "username": "Bob Renamed", "now": "2000" }),
    );
    assert_eq!(again["joinedAt"], "1000", "joinedAt is the first join's");
    assert_eq!(again["updatedAt"], "2000");
    let members = view(&mut t, "getMembers", json!({}));
    assert_eq!(members.as_array().unwrap().len(), 1);
    assert_eq!(members[0]["username"], "Bob Renamed");
    let joined: Vec<_> = t
        .events_for("carol")
        .into_iter()
        .filter(|(name, _)| name == "MemberJoined")
        .collect();
    assert_eq!(joined.len(), 2);
    assert_eq!(joined[0].1, json!({ "account": "bob" }));
}

#[test]
fn a_four_member_roster_is_complete() {
    let mut t = stream(&["owner", "bob", "carol", "dave"]);
    let members = view(&mut t, "getMembers", json!({}));
    let ids: Vec<&str> = members
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["memberId"].as_str().unwrap())
        .collect();
    for w in ["owner", "bob", "carol", "dave"] {
        assert!(ids.contains(&w), "roster is missing {w}");
    }
    assert_eq!(stats(&mut t)["memberCount"], 4);
}

// ── Approach 3: encode / decode in the component ────────────────────────────

#[test]
fn encode_then_get_frame_reconstructs_the_frame() {
    let mut t = stream(&["owner"]);
    let frame = aligned(64, 48);
    assert_eq!(encode_ok(&mut t, "owner", &frame, 64, 48, 1001), 1);
    let got = frames(&mut t, 0);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0]["seq"], "1");
    assert_eq!(got[0]["from"], "owner");
    assert_eq!(
        (got[0]["width"].as_u64(), got[0]["height"].as_u64()),
        (Some(64), Some(48))
    );
    assert_eq!(got[0]["createdAt"], "1001");
    assert_eq!(pixels(&got[0]), frame, "bit-identical round trip (C1)");
    let posted: Vec<_> = t
        .events_for("bob")
        .into_iter()
        .filter(|(n, _)| n == "FramePosted")
        .collect();
    assert_eq!(posted, [("FramePosted".to_owned(), json!({ "seq": "1" }))]);
}

#[test]
fn get_frame_cursor_only_returns_new_frames() {
    let mut t = stream(&["owner"]);
    let f = aligned(16, 16);
    let s1 = encode_ok(&mut t, "owner", &f, 16, 16, 1001);
    let s2 = encode_ok(&mut t, "owner", &f, 16, 16, 1002);
    assert!(s2 > s1);
    let newer = frames(&mut t, s1);
    assert_eq!(newer.len(), 1);
    assert_eq!(n(&newer[0]["seq"]), s2);
}

#[test]
fn large_frame_is_chunked_and_reassembles() {
    let mut t = stream(&["owner"]);
    let frame: Vec<u8> = (0..256 * 256)
        .map(|i| if i % 2 == 0 { 0 } else { 0xFF })
        .collect();
    let seq = encode_ok(&mut t, "owner", &frame, 256, 256, 1001);
    assert!(stats(&mut t)["liveFragments"].as_u64().unwrap() > 1);
    let got = frames(&mut t, seq - 1);
    assert_eq!(got.len(), 1);
    assert_eq!(pixels(&got[0]), frame);
    assert!(got[0]["encodedBytes"].as_u64().unwrap() <= 256 * 256 * 2 + 2);
}

#[test]
fn frame_keys_are_never_reused_across_prune() {
    let mut t = stream(&["owner"]);
    let f = aligned(8, 8);
    let total = FRAME_WINDOW + 5;
    let mut last = 0;
    for k in 0..total {
        last = encode_ok(&mut t, "owner", &f, 8, 8, 1001 + k);
    }
    assert_eq!(last, total, "seq is strictly monotone");
    let s = stats(&mut t);
    assert_eq!(n(&s["prunedFrames"]), 4, "frames below seq - FRAME_WINDOW");
    assert_eq!(n(&s["oldestLiveSeq"]), 5);
    assert_eq!(s["liveFragments"], 31);
    let live = frames(&mut t, 0);
    assert_eq!(live.len(), 31);
    assert!(live.iter().all(|fr| pixels(fr) == f));
    assert!(t
        .events_for("bob")
        .iter()
        .any(|(name, _)| name == "FramesPruned"));
}

#[test]
fn checksum_is_stable_and_matches_the_decoded_pixels() {
    let mut t = stream(&["owner", "bob"]);
    let frame = aligned(16, 16);
    let seq = encode_ok(&mut t, "owner", &frame, 16, 16, 1_751_955_010_123);
    let args = json!({ "seq": seq.to_string() });
    let mine = view(&mut t, "frameChecksum", args.clone());
    let theirs = t.as_("bob").view("frameChecksum", args).unwrap();
    assert!(mine.is_string(), "a live frame has a checksum");
    assert_eq!(mine, theirs, "every reader decodes the same pixels (C1)");
}

#[test]
fn checksum_separates_frames_that_differ_by_one_pixel() {
    let mut t = stream(&["owner"]);
    let base = aligned(8, 8);
    let mut perturbed = base.clone();
    perturbed[40] = perturbed[40].wrapping_add(16);
    let a = encode_ok(&mut t, "owner", &base, 8, 8, 1001);
    let b = encode_ok(&mut t, "owner", &perturbed, 8, 8, 1002);
    assert_ne!(
        view(&mut t, "frameChecksum", json!({ "seq": a.to_string() })),
        view(&mut t, "frameChecksum", json!({ "seq": b.to_string() }))
    );
}

#[test]
fn checksum_is_null_for_a_frame_that_is_not_live() {
    let mut t = stream(&["owner"]);
    assert_eq!(
        view(&mut t, "frameChecksum", json!({ "seq": "1" })),
        json!(null)
    );
    let f = aligned(8, 8);
    for k in 0..FRAME_WINDOW + 5 {
        encode_ok(&mut t, "owner", &f, 8, 8, 1001 + k);
    }
    assert_eq!(
        view(&mut t, "frameChecksum", json!({ "seq": "1" })),
        json!(null)
    );
}

#[test]
fn a_non_member_cannot_encode_or_prune() {
    let mut t = stream(&["owner"]);
    let f = aligned(8, 8);
    assert_eq!(code(encode(&mut t, "bob", &f, 8, 8, 1001)), "NotJoined");
    encode_ok(&mut t, "owner", &f, 8, 8, 1001);
    assert_eq!(
        code(call(
            &mut t,
            "bob",
            "pruneFrames",
            json!({ "beforeSeq": "1" })
        )),
        "NotJoined"
    );
    ok(&mut t, "owner", "pruneFrames", json!({ "beforeSeq": "1" }));
}

#[test]
fn bad_geometry_is_refused_and_takes_no_seq() {
    let mut t = stream(&["owner"]);
    assert_eq!(
        code(encode(&mut t, "owner", &[0; 64], 16, 16, 1001)),
        "RawLengthMismatch"
    );
    match encode(&mut t, "owner", &[0; 10], 64, 48, 1001) {
        Err(Failure::App { code, fields }) => {
            assert_eq!(code, "RawLengthMismatch");
            assert_eq!(fields, json!({ "expected": 3072, "got": 10 }));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        code(encode(&mut t, "owner", &[], 0, 48, 1001)),
        "ZeroDimension"
    );
    assert_eq!(
        code(encode(&mut t, "owner", &[], 64, 0, 1001)),
        "ZeroDimension"
    );
    let over = usize::from(MAX_DIM) + 1;
    assert_eq!(
        code(encode(
            &mut t,
            "owner",
            &vec![0; over],
            MAX_DIM + 1,
            1,
            1001
        )),
        "DimensionTooLarge"
    );
    assert_eq!(
        stats(&mut t)["nextSeq"],
        "0",
        "a refused frame takes no seq"
    );
}

#[test]
fn frames_from_two_senders_stay_separate() {
    let mut t = stream(&["owner", "bob"]);
    let a = aligned(8, 8);
    let b: Vec<u8> = a.iter().map(|p| p ^ 0xFF).collect();
    encode_ok(&mut t, "owner", &a, 8, 8, 1001);
    encode_ok(&mut t, "bob", &b, 8, 8, 1002);
    let got = frames(&mut t, 0);
    assert_eq!(got.len(), 2);
    let of = |who: &str| got.iter().find(|f| f["from"] == who).map(pixels).unwrap();
    assert_eq!(of("owner"), a);
    assert_eq!(of("bob"), b);
}

#[test]
fn get_frame_returns_frames_in_ascending_seq_order() {
    let mut t = stream(&["owner", "bob"]);
    let f = aligned(4, 4);
    for k in 0..6 {
        let who = if k % 2 == 0 { "bob" } else { "owner" };
        encode_ok(&mut t, who, &f, 4, 4, 1001 + k);
    }
    let seqs: Vec<u64> = frames(&mut t, 0).iter().map(|f| n(&f["seq"])).collect();
    assert_eq!(seqs, [1, 2, 3, 4, 5, 6]);
}

#[test]
fn a_multi_chunk_frame_checksums_the_same_as_its_pixels() {
    let mut t = stream(&["owner"]);
    let frame: Vec<u8> = (0..256 * 200).map(|i| ((i * 37) % 256) as u8).collect();
    let seq = encode_ok(&mut t, "owner", &frame, 256, 200, 1001);
    assert!(stats(&mut t)["liveFragments"].as_u64().unwrap() > 1);
    let got = frames(&mut t, seq - 1);
    assert_eq!(pixels(&got[0]).len(), 256 * 200);
}

#[test]
fn stats_track_the_live_window_and_the_prune_count() {
    let mut t = stream(&["owner"]);
    ok(&mut t, "owner", "renameStream", json!({ "name": "probe" }));
    let fresh = stats(&mut t);
    assert_eq!(
        fresh,
        json!({ "name": "probe", "memberCount": 1, "liveFragments": 0, "nextSeq": "0", "oldestLiveSeq": "0", "prunedFrames": "0" })
    );
    let f = aligned(4, 4);
    for k in 0..3 {
        encode_ok(&mut t, "owner", &f, 4, 4, 1001 + k);
    }
    assert_eq!(
        stats(&mut t),
        json!({ "name": "probe", "memberCount": 1, "liveFragments": 3, "nextSeq": "3", "oldestLiveSeq": "1", "prunedFrames": "0" })
    );
}

#[test]
fn explicit_prune_removes_only_below_the_watermark() {
    let mut t = stream(&["owner"]);
    let f = aligned(4, 4);
    for k in 0..5 {
        encode_ok(&mut t, "owner", &f, 4, 4, 1001 + k);
    }
    ok(&mut t, "owner", "pruneFrames", json!({ "beforeSeq": "4" }));
    let seqs: Vec<u64> = frames(&mut t, 0).iter().map(|f| n(&f["seq"])).collect();
    assert_eq!(seqs, [4, 5]);
    ok(&mut t, "owner", "pruneFrames", json!({ "beforeSeq": "0" }));
    assert_eq!(frames(&mut t, 0).len(), 2);
    assert_eq!(stats(&mut t)["prunedFrames"], "3");
}

#[test]
fn a_member_prunes_only_their_own_frames() {
    let mut t = stream(&["owner", "mallory"]);
    encode_ok(&mut t, "owner", &aligned(4, 4), 4, 4, 1001);
    ok(
        &mut t,
        "mallory",
        "pruneFrames",
        json!({ "beforeSeq": u64::MAX.to_string() }),
    );
    assert_eq!(
        frames(&mut t, 0).len(),
        1,
        "mallory's prune reaches only her own"
    );
    ok(
        &mut t,
        "owner",
        "pruneFrames",
        json!({ "beforeSeq": u64::MAX.to_string() }),
    );
    assert!(frames(&mut t, 0).is_empty());
    assert_eq!(stats(&mut t)["prunedFrames"], "1");
}

// ── Approach 2: opaque chunks ───────────────────────────────────────────────

#[test]
fn a_chunk_round_trips_byte_for_byte_without_being_interpreted() {
    let mut t = stream(&["owner", "bob"]);
    let payload: Vec<u8> = (0..500).map(|i| ((i * 31) % 256) as u8).collect();
    let seq = post_ok(&mut t, "owner", &payload, true, 1_751_955_010);
    assert_eq!(seq, 1);
    let got = chunks(&mut t, &[("owner", seq - 1)]);
    assert_eq!(got.len(), 1);
    assert_eq!(data(&got[0]), payload);
    assert_eq!(got[0]["codec"], "avc1.42001f");
    assert_eq!(
        (got[0]["width"].as_u64(), got[0]["height"].as_u64()),
        (Some(640), Some(480))
    );
    assert_eq!(got[0]["isKeyframe"], true);
    assert_eq!(got[0]["timestampUs"], "1751955010000");
    assert!(t
        .events_for("bob")
        .contains(&("ChunkPosted".to_owned(), json!({ "seq": "1" }))));
}

#[test]
fn chunks_come_back_in_seq_order() {
    let mut t = stream(&["owner"]);
    post_ok(&mut t, "owner", b"key", true, 1000);
    for k in 1..6 {
        post_ok(&mut t, "owner", b"delta", false, 1000 + k);
    }
    let seqs: Vec<u64> = chunks(&mut t, &[("owner", 0)])
        .iter()
        .map(|c| n(&c["seq"]))
        .collect();
    assert_eq!(seqs, [1, 2, 3, 4, 5, 6]);
}

#[test]
fn the_reaper_never_prunes_past_the_newest_keyframe() {
    let mut t = stream(&["owner"]);
    let kf = post_ok(&mut t, "owner", b"keyframe", true, 1000);
    let span = LIVE_WINDOW_MS * 4;
    for k in 1..=100u64 {
        post_ok(&mut t, "owner", b"delta", false, 1000 + k * (span / 100));
    }
    let st = sender(&mut t, "owner");
    assert_eq!(n(&st["lastKeyframe"]), kf);
    assert!(n(&st["oldestLive"]) <= kf);
    assert_eq!(keyframes(&mut t), cursors(&[("owner", kf)]));
    assert!(chunks(&mut t, &[("owner", kf - 1)])
        .iter()
        .any(|c| n(&c["seq"]) == kf && c["isKeyframe"] == true));
}

#[test]
fn a_newer_keyframe_releases_the_older_one_for_pruning() {
    let mut t = stream(&["owner"]);
    let first = post_ok(&mut t, "owner", b"kf1", true, 1000);
    for k in 1..=10u64 {
        post_ok(&mut t, "owner", b"delta", false, 1000 + k * 100);
    }
    let base = 1000 + LIVE_WINDOW_MS * 3;
    let second = post_ok(&mut t, "owner", b"kf2", true, base);
    for k in 1..=10u64 {
        post_ok(&mut t, "owner", b"delta", false, base + k * 100);
    }
    let st = sender(&mut t, "owner");
    assert_eq!(n(&st["lastKeyframe"]), second);
    assert!(n(&st["oldestLive"]) > first);
    assert!(n(&st["pruned"]) > 0);
    assert!(n(&view(&mut t, "getLiveStats", json!({}))["prunedChunks"]) > 0);
    assert_eq!(keyframes(&mut t), cursors(&[("owner", second)]));
}

#[test]
fn explicit_prune_cannot_strand_the_stream() {
    let mut t = stream(&["owner"]);
    let kf = post_ok(&mut t, "owner", b"kf", true, 1000);
    for k in 0..5 {
        post_ok(&mut t, "owner", b"delta", false, 1001 + k);
    }
    assert_eq!(
        code(call(
            &mut t,
            "bob",
            "pruneChunks",
            json!({ "beforeSeq": "9999" })
        )),
        "NotJoined"
    );
    ok(
        &mut t,
        "owner",
        "pruneChunks",
        json!({ "beforeSeq": "9999" }),
    );
    assert_eq!(keyframes(&mut t), cursors(&[("owner", kf)]));
    assert_eq!(
        live(&mut t, "owner"),
        6,
        "the keyframe is chunk 1, so nothing is below it"
    );
}

#[test]
fn explicit_prune_cannot_reach_another_senders_buffer() {
    let mut t = stream(&["owner", "bob"]);
    post_ok(&mut t, "owner", b"a-kf", true, 1000);
    for k in 1..=4u64 {
        post_ok(&mut t, "owner", b"a-delta", false, 1000 + k);
    }
    ok(
        &mut t,
        "bob",
        "pruneChunks",
        json!({ "beforeSeq": u64::MAX.to_string() }),
    );
    assert_eq!(live(&mut t, "owner"), 5);
}

#[test]
fn keyframe_cursors_is_empty_before_any_keyframe() {
    let mut t = stream(&["owner"]);
    assert_eq!(keyframes(&mut t), json!([]));
    post_ok(&mut t, "owner", b"delta-only", false, 1000);
    assert_eq!(keyframes(&mut t), json!([]));
    assert!(
        chunks(&mut t, &[]).is_empty(),
        "nothing decodable to hand a joiner"
    );
}

#[test]
fn chunk_guards_reject_what_the_wire_cannot_carry() {
    let mut t = stream(&["owner"]);
    let base = json!({
        "dataB64": "!!!not base64!!!", "track": 0, "isKeyframe": true, "codec": "avc1",
        "width": 640, "height": 480, "timestampUs": "0", "now": "1000",
    });
    assert_eq!(
        code(call(&mut t, "owner", "postChunk", base.clone())),
        "BadBase64"
    );
    assert_eq!(code(post(&mut t, "owner", b"", true, 1000)), "EmptyChunk");
    match post(
        &mut t,
        "owner",
        &vec![7u8; MAX_MEDIA_CHUNK_BYTES + 1],
        true,
        1000,
    ) {
        Err(Failure::App { code, fields }) => {
            assert_eq!(code, "ChunkTooLarge");
            assert_eq!(fields, json!({ "max": MAX_MEDIA_CHUNK_BYTES }));
        }
        other => panic!("{other:?}"),
    }
    let mut no_codec = base;
    no_codec["dataB64"] = json!(STANDARD.encode(b"x"));
    no_codec["codec"] = json!("");
    assert_eq!(
        code(call(&mut t, "owner", "postChunk", no_codec)),
        "CodecRequired"
    );
    assert_eq!(
        view(&mut t, "getLiveStats", json!({}))["senders"],
        json!([])
    );
}

#[test]
fn a_non_member_cannot_post_chunks() {
    let mut t = stream(&["owner", "bob", "carol", "dave"]);
    assert_eq!(
        code(post(&mut t, "mallory", b"gatecrash", true, 1000)),
        "NotJoined"
    );
    assert_eq!(
        view(&mut t, "getLiveStats", json!({}))["senders"],
        json!([])
    );
}

#[test]
fn live_stats_track_bytes_and_the_keyframe() {
    let mut t = stream(&["owner"]);
    assert_eq!(
        view(&mut t, "getLiveStats", json!({})),
        json!({ "liveChunks": 0, "liveBytes": "0", "prunedChunks": "0", "senders": [] })
    );
    post_ok(&mut t, "owner", &[1u8; 100], true, 1000);
    post_ok(&mut t, "owner", &[2u8; 250], false, 1001);
    assert_eq!(
        view(&mut t, "getLiveStats", json!({})),
        json!({
            "liveChunks": 2, "liveBytes": "350", "prunedChunks": "0",
            "senders": [{
                "from": "owner", "nextSeq": "2", "oldestLive": "1", "lastKeyframe": "1",
                "newestAt": "1001", "pruned": "0", "liveChunks": 2, "liveBytes": "350",
            }],
        })
    );
}

#[test]
fn audio_and_video_share_one_ring_and_stay_distinguishable() {
    let mut t = stream(&["owner"]);
    post_ok(&mut t, "owner", b"video", true, 1000);
    ok(
        &mut t,
        "owner",
        "postChunk",
        json!({
            "dataB64": STANDARD.encode(b"audio"), "track": 1, "isKeyframe": true,
            "codec": "opus", "width": 0, "height": 0, "timestampUs": "0", "now": "1001",
        }),
    );
    let all = chunks(&mut t, &[("owner", 0)]);
    assert_eq!(all.len(), 2);
    let audio = all.iter().find(|c| c["track"] == 1).unwrap();
    assert_eq!(audio["codec"], "opus");
    assert_eq!(data(audio), b"audio");
}

#[test]
fn approach_3_state_is_untouched_by_approach_2() {
    let mut t = stream(&["owner"]);
    post_ok(&mut t, "owner", b"opaque", true, 1000);
    encode_ok(&mut t, "owner", &aligned(8, 8), 8, 8, 1001);
    assert_eq!(stats(&mut t)["nextSeq"], "1");
    assert_eq!(sender(&mut t, "owner")["nextSeq"], "1");
    assert_eq!(frames(&mut t, 0).len(), 1);
    assert_eq!(chunks(&mut t, &[("owner", 0)]).len(), 1);
}

#[test]
fn two_senders_posting_the_same_seq_do_not_overwrite_each_other() {
    let mut t = stream(&["owner", "bob"]);
    for k in 0..5u64 {
        let a = post_ok(&mut t, "owner", b"alice-frame", k == 0, 1000 + k);
        let b = post_ok(&mut t, "bob", b"bob-frame", k == 0, 1000 + k);
        assert_eq!((a, b), (k + 1, k + 1));
    }
    let all = chunks(&mut t, &[("owner", 0), ("bob", 0)]);
    assert_eq!(all.len(), 10);
    for c in &all {
        let want: &[u8] = if c["from"] == "owner" {
            b"alice-frame"
        } else {
            b"bob-frame"
        };
        assert_eq!(data(c), want);
    }
}

#[test]
fn one_senders_traffic_does_not_reap_anothers_chunks() {
    let mut t = stream(&["owner", "bob"]);
    post_ok(&mut t, "owner", b"alice-kf", true, 1000);
    for k in 1..=200u64 {
        post_ok(&mut t, "bob", b"bob-delta", k == 1, 1000 + k);
    }
    assert_eq!(live(&mut t, "owner"), 1);
    assert!(keyframes(&mut t)
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["from"] == "owner"));
}

#[test]
fn the_live_window_is_wall_clock_not_a_row_count() {
    let mut t = stream(&["owner"]);
    for k in 0..300u64 {
        post_ok(&mut t, "owner", b"x", k == 0, 1000 + k / 300);
    }
    assert_eq!(live(&mut t, "owner"), 300);
    let at = 1000 + LIVE_WINDOW_MS * 2;
    post_ok(&mut t, "owner", b"new-kf", true, at);
    post_ok(&mut t, "owner", b"after", false, at + 1);
    let st = sender(&mut t, "owner");
    assert!(st["liveChunks"].as_u64().unwrap() < 300);
    assert!(n(&st["pruned"]) > 0);
}

#[test]
fn a_broken_clock_cannot_pin_state_forever() {
    let mut t = stream(&["owner"]);
    post_ok(&mut t, "owner", b"kf", true, 1000);
    for _ in 0..(MAX_LIVE_CHUNKS_PER_SENDER + 200) {
        post_ok(&mut t, "owner", b"delta", false, 1000);
    }
    assert!(live(&mut t, "owner") <= MAX_LIVE_CHUNKS_PER_SENDER + 1);
}

#[test]
fn a_departed_senders_buffer_is_collected_by_the_owner() {
    let mut t = stream(&["owner", "bob"]);
    for k in 0..5u64 {
        post_ok(&mut t, "bob", b"bob", k == 0, 1000 + k);
    }
    assert_eq!(live(&mut t, "bob"), 5);
    post_ok(
        &mut t,
        "owner",
        b"owner",
        true,
        1000 + STALE_SENDER_MS + 1000,
    );
    assert_eq!(live(&mut t, "bob"), 0);
    assert_eq!(live(&mut t, "owner"), 1);
}

#[test]
fn only_the_owner_sweeps_a_departed_sender() {
    // v1: only a moderator of `chunks` (the creator) could reap another
    // sender's buffer; here the stream's owner.
    let mut t = stream(&["owner", "bob", "mallory"]);
    post_ok(&mut t, "bob", b"bob", true, 1000);
    let late = 1000 + STALE_SENDER_MS + 1000;
    post_ok(&mut t, "mallory", b"m", true, late);
    assert_eq!(live(&mut t, "bob"), 1, "a member's post sweeps nobody");
    post_ok(&mut t, "owner", b"o", true, late);
    assert_eq!(live(&mut t, "bob"), 0);
}

#[test]
fn a_live_sender_is_never_swept_as_stale() {
    let mut t = stream(&["owner", "bob"]);
    let step = STALE_SENDER_MS / 4;
    for k in 0..6u64 {
        let at = 1000 + k * step;
        post_ok(&mut t, "owner", b"alice", true, at);
        post_ok(&mut t, "bob", b"bob", true, at);
    }
    assert!(live(&mut t, "owner") > 0);
    assert!(live(&mut t, "bob") > 0);
}

#[test]
fn a_joiner_starts_at_each_senders_own_keyframe() {
    let mut t = stream(&["owner", "bob"]);
    post_ok(&mut t, "owner", b"a-kf", true, 1000);
    post_ok(&mut t, "owner", b"a-d1", false, 1001);
    post_ok(&mut t, "bob", b"b-kf", true, 1002);
    post_ok(&mut t, "bob", b"b-d1", false, 1003);
    post_ok(&mut t, "owner", b"a-kf2", true, 1004);
    post_ok(&mut t, "owner", b"a-d2", false, 1005);
    let got = chunks(&mut t, &[]);
    for who in ["owner", "bob"] {
        let first = got.iter().find(|c| c["from"] == who).unwrap();
        assert_eq!(first["isKeyframe"], true, "{who}");
    }
    assert_eq!(got.len(), 4, "owner from kf2, bob from kf");
}

/// Four broadcasters, `frames` chunks each, every sender keyframing on its
/// first.
fn four_way(frames: u64) -> (TestApp, [&'static str; 4]) {
    let who = ["owner", "bob", "carol", "dave"];
    let mut t = stream(&who);
    for k in 0..frames {
        for (i, w) in who.iter().enumerate() {
            post_ok(&mut t, w, format!("s{i}-f{k}").as_bytes(), k == 0, 1000 + k);
        }
    }
    (t, who)
}

#[test]
fn four_senders_keep_four_independent_seq_spaces() {
    let (mut t, who) = four_way(6);
    for w in who {
        assert_eq!(sender(&mut t, w)["nextSeq"], "6");
    }
    let all = chunks(&mut t, &who.map(|w| (w, 0)));
    assert_eq!(all.len(), 24);
    for c in &all {
        let i = who.iter().position(|w| c["from"] == *w).unwrap();
        assert_eq!(data(c), format!("s{i}-f{}", n(&c["seq"]) - 1).as_bytes());
    }
}

#[test]
fn a_fourth_sender_does_not_reap_the_other_three() {
    let (mut t, who) = four_way(3);
    for k in 0..40u64 {
        post_ok(&mut t, "dave", b"dave", false, 2000 + k);
    }
    for w in &who[..3] {
        assert_eq!(live(&mut t, w), 3);
        assert_eq!(sender(&mut t, w)["pruned"], "0");
    }
}

#[test]
fn a_joiner_starts_at_all_four_senders_own_keyframes() {
    let (mut t, who) = four_way(2);
    for w in who {
        post_ok(&mut t, w, b"kf2", true, 1010);
        post_ok(&mut t, w, b"delta", false, 1011);
    }
    let served = chunks(&mut t, &[]);
    for w in who {
        let mine: Vec<_> = served.iter().filter(|c| c["from"] == w).collect();
        assert_eq!(mine.len(), 2, "{w}");
        assert_eq!(mine[0]["isKeyframe"], true, "{w}");
    }
    assert_eq!(keyframes(&mut t).as_array().unwrap().len(), 4);
}

#[test]
fn one_departed_sender_out_of_four_is_swept_and_the_rest_survive() {
    let (mut t, _) = four_way(2);
    let late = 1000 + STALE_SENDER_MS + 1000;
    for k in 0..3u64 {
        for w in ["owner", "bob", "carol"] {
            post_ok(&mut t, w, b"still-here", k == 0, late + k);
        }
    }
    assert_eq!(live(&mut t, "dave"), 0);
    for w in ["owner", "bob", "carol"] {
        assert!(live(&mut t, w) > 0, "{w} was swept");
    }
}

#[test]
fn four_senders_cursors_advance_independently() {
    let (mut t, who) = four_way(5);
    let mut at: Vec<(&str, u64)> = who.iter().map(|w| (*w, 5)).collect();
    assert!(chunks(&mut t, &at).is_empty());
    at[2].1 = 3;
    let got = chunks(&mut t, &at);
    assert!(got.iter().all(|c| c["from"] == "carol"));
    let seqs: Vec<u64> = got.iter().map(|c| n(&c["seq"])).collect();
    assert_eq!(seqs, [4, 5]);
}

#[test]
fn an_absent_cursor_among_four_is_treated_as_a_new_sender() {
    let (mut t, who) = four_way(2);
    for w in who {
        post_ok(&mut t, w, b"kf", true, 1005);
    }
    let got = chunks(&mut t, &[("owner", 3), ("bob", 3), ("dave", 3)]);
    assert!(got.iter().all(|c| c["from"] == "carol"));
    assert_eq!(got.len(), 1);
    assert_eq!(got[0]["isKeyframe"], true);
    assert_eq!(got[0]["seq"], "3");
}

#[test]
fn live_stats_report_all_four_senders_separately() {
    let (mut t, _) = four_way(4);
    let stats = view(&mut t, "getLiveStats", json!({}));
    let senders = stats["senders"].as_array().unwrap();
    assert_eq!(senders.len(), 4);
    let summed: u64 = senders
        .iter()
        .map(|s| s["liveChunks"].as_u64().unwrap())
        .sum();
    assert_eq!(stats["liveChunks"].as_u64().unwrap(), summed);
    let bytes: u64 = senders.iter().map(|s| n(&s["liveBytes"])).sum();
    assert_eq!(n(&stats["liveBytes"]), bytes);
    for row in senders {
        assert_eq!(row["nextSeq"], "4");
        assert_eq!(row["lastKeyframe"], "1");
    }
}

// ── Write rules: v1's forged writes, now method checks ──────────────────────
//
// v1 guarded every row with an owner stamp because any member's node could
// write any key. Here no method takes a sender id: every write lands under the
// caller's own account, so the forgeries v1 tested are not expressible. These
// tests pin that from the outside.

#[test]
fn nobody_but_the_sender_rewrites_or_removes_their_chunks_or_cursor() {
    let mut t = stream(&["owner", "mallory"]);
    let seq = post_ok(&mut t, "owner", b"alice", true, 1000);
    // Mallory's whole write surface, aimed at the owner's buffer.
    ok(
        &mut t,
        "mallory",
        "pruneChunks",
        json!({ "beforeSeq": u64::MAX.to_string() }),
    );
    post_ok(
        &mut t,
        "mallory",
        b"forged",
        true,
        1000 + STALE_SENDER_MS * 2,
    );
    assert_eq!(sender(&mut t, "owner")["nextSeq"], seq.to_string());
    let got: Vec<Value> = chunks(&mut t, &[("owner", 0)])
        .into_iter()
        .filter(|c| c["from"] == "owner")
        .collect();
    assert_eq!(got.len(), 1);
    assert_eq!(data(&got[0]), b"alice");
    // Mallory's own post went to her own sequence space.
    assert_eq!(sender(&mut t, "mallory")["nextSeq"], "1");
}

#[test]
fn a_frame_is_always_its_callers() {
    let mut t = stream(&["owner", "mallory"]);
    let f = aligned(4, 4);
    encode_ok(&mut t, "owner", &f, 4, 4, 1001);
    encode_ok(&mut t, "mallory", &[0; 16], 4, 4, 1002);
    let got = frames(&mut t, 0);
    let owners: Vec<_> = got.iter().filter(|fr| fr["from"] == "owner").collect();
    assert_eq!(owners.len(), 1);
    assert_eq!(pixels(owners[0]), f);
}

#[test]
fn a_member_row_is_the_callers_own() {
    let mut t = stream(&["owner", "mallory"]);
    ok(
        &mut t,
        "mallory",
        "join",
        json!({ "username": "Alice?", "now": "2000" }),
    );
    let members = view(&mut t, "getMembers", json!({}));
    let owner = members
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["memberId"] == "owner")
        .unwrap();
    assert_eq!(owner["username"], "owner", "mallory renamed only herself");
}

#[test]
fn only_the_owner_renames_and_is_admin() {
    let mut t = stream(&["owner", "bob"]);
    ok(&mut t, "owner", "renameStream", json!({ "name": "probe" }));
    assert_eq!(
        code(call(
            &mut t,
            "bob",
            "renameStream",
            json!({ "name": "hijacked" })
        )),
        "NotOwner"
    );
    assert_eq!(stats(&mut t)["name"], "probe");
    ok(
        &mut t,
        "owner",
        "renameStream",
        json!({ "name": "renamed" }),
    );
    assert_eq!(stats(&mut t)["name"], "renamed");

    assert_eq!(
        view(&mut t, "isMemberAdmin", json!({ "member": "owner" })),
        json!(true)
    );
    assert_eq!(
        view(&mut t, "isMemberAdmin", json!({ "member": "bob" })),
        json!(false)
    );
    assert_eq!(
        view(&mut t, "isMemberAdmin", json!({ "member": "" })),
        json!(false)
    );
    assert_eq!(
        t.as_("bob")
            .view("isMemberAdmin", json!({ "member": "owner" }))
            .unwrap(),
        json!(true)
    );
}

// ── Access and wire checks v1 could not express ─────────────────────────────

#[test]
fn a_guest_takes_part_like_a_member() {
    // v1: every member of the room's context could join and stream. A guest
    // reaches the app instance, and the contract treats them the same.
    let mut t = stream(&["owner"]);
    join(&mut t, "gus");
    post_ok(&mut t, "gus", b"guest", true, 1000);
    encode_ok(&mut t, "gus", &aligned(4, 4), 4, 4, 1001);
    assert_eq!(live(&mut t, "gus"), 1);
}

#[test]
fn outsiders_and_anonymous_callers_are_refused_by_the_node() {
    let mut t = stream(&["owner"]);
    for (method, args) in [
        ("getStats", json!({})),
        ("getMembers", json!({})),
        ("getChunks", json!({ "cursors": [] })),
    ] {
        assert!(matches!(
            t.as_("eve").view(method, args.clone()),
            Err(Failure::Refused { status: 404, .. })
        ));
        assert!(matches!(
            t.anonymous().view(method, args),
            Err(Failure::Refused { status: 401, .. })
        ));
    }
    assert!(matches!(
        t.as_("eve")
            .call("join", json!({ "username": "eve", "now": "1" })),
        Err(Failure::Refused { status: 404, .. })
    ));
}

#[test]
fn wire_checks() {
    let mut t = stream(&["owner"]);
    assert_eq!(
        code(t.as_("owner").call("nope", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("join", json!({ "username": "x", "now": "1" }))
        ),
        "NotAView"
    );
    // u64s are decimal strings (D20): a JSON number is refused.
    assert_eq!(
        code(
            t.as_("owner")
                .call("join", json!({ "username": "x", "now": 1 }))
        ),
        "BadArgs"
    );
    // `raw` is base64url bytes now; v1's JSON array of numbers is refused.
    assert_eq!(
        code(t.as_("owner").call(
            "encodeFrame",
            json!({ "raw": [0, 17], "width": 1, "height": 2, "track": 0, "now": "1" })
        )),
        "BadArgs"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("join", json!({ "username": "x", "now": "1", "extra": 1 }))
        ),
        "BadArgs"
    );
}
