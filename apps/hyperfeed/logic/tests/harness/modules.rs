//! v1's inline `#[cfg(test)] mod tests` of `checkpoint.rs`, `memo.rs`,
//! `prs.rs` and `watches.rs`, through the methods that use them.

use calimero_app_sdk::testing::{Failure, TestApp};
use serde_json::{json, Value};

use crate::support::*;

/// Opens a chain with your message; its chain.
fn say(t: &mut TestApp, text: &str) -> Value {
    call(t, "say", json!({ "chain": "", "text": text }))["chain"].clone()
}

fn list(v: Value) -> Vec<Value> {
    v.as_array()
        .unwrap_or_else(|| panic!("not a list: {v}"))
        .clone()
}

// ── checkpoint.rs ────────────────────────────────────────────────────────────

mod checkpoint {
    use super::*;

    const MAX_CHECKPOINT_TEXT: usize = 1_000;
    const MAX_CHECKPOINT_ENTRIES: usize = 10;
    const MAX_CHECKPOINT_ENTRY: usize = 300;
    const MAX_CHECKPOINT_AUTHOR: usize = 120;

    fn input(done: &str, next: &str) -> Value {
        json!({
            "done": done,
            "next": next,
            "branches": ["mero-bot/chain-1"],
            "worktrees": ["/w/apps-chain-1"],
            "prs": ["calimero-network/apps#12"],
            "questions": [],
            "author": "mero-bot@studio",
        })
    }

    fn set(t: &mut TestApp, chain: &Value, i: Value) -> Result<Value, Failure> {
        t.as_(OWNER)
            .call("setCheckpoint", json!({ "chain": chain, "input": i }))
    }

    fn get(t: &mut TestApp, chain: &Value) -> Value {
        view(t, "checkpoint", json!({ "chain": chain }))
    }

    #[test]
    fn a_checkpoint_is_kept_with_its_chain_and_the_next_one_replaces_it() {
        let mut t = app();
        let chain = say(&mut t, "Fix the digest card");
        assert_eq!(get(&mut t, &chain), Value::Null);

        let first = set(&mut t, &chain, input("Found the bug", "Write the fix")).unwrap();
        assert_eq!(first["chain"], chain);
        assert_eq!(first["author"], "mero-bot@studio");
        assert_eq!(first["branches"], json!(["mero-bot/chain-1"]));
        assert!(first["updated_at"].as_u64().unwrap() > 0);
        assert_eq!(get(&mut t, &chain), first);

        let mut later = input("  Fixed it; PR open  ", "Merge once CI is green");
        later["questions"] = json!(["Squash or merge?", "  "]);
        let second = set(&mut t, &chain, later).unwrap();
        assert_eq!(second["done"], "Fixed it; PR open", "trimmed");
        assert_eq!(
            second["questions"],
            json!(["Squash or merge?"]),
            "blank entries dropped"
        );
        assert!(second["updated_at"].as_u64() > first["updated_at"].as_u64());
        assert_eq!(get(&mut t, &chain), second, "the latest replaces the last");

        let names = event_names(&t);
        assert_eq!(
            names.iter().filter(|k| *k == "CheckpointChanged").count(),
            2
        );
    }

    #[test]
    fn checkpoints_are_checked_and_owner_only() {
        let mut t = app();
        let chain = say(&mut t, "Fix the digest card");
        let refused = |t: &mut TestApp, chain: &Value, i: Value| {
            let f = set(t, chain, i).expect_err("refused");
            assert_invalid(&f, "");
        };
        refused(&mut t, &json!(""), input("a", "b")); // a chain
        refused(&mut t, &json!("no-chain"), input("a", "b")); // an existing chain
        refused(&mut t, &chain, input(" ", "")); // says something
        let long = "x".repeat(MAX_CHECKPOINT_TEXT + 1);
        refused(&mut t, &chain, input(&long, ""));
        refused(&mut t, &chain, input("", &long));
        let mut many = input("a", "b");
        many["prs"] = json!((0..=MAX_CHECKPOINT_ENTRIES)
            .map(|n| format!("#{n}"))
            .collect::<Vec<_>>());
        refused(&mut t, &chain, many);
        let mut wide = input("a", "b");
        wide["branches"] = json!(["b".repeat(MAX_CHECKPOINT_ENTRY + 1)]);
        refused(&mut t, &chain, wide);
        let mut lines = input("a", "b");
        lines["questions"] = json!(["one\ntwo"]);
        refused(&mut t, &chain, lines);
        let mut author = input("a", "b");
        author["author"] = json!("a".repeat(MAX_CHECKPOINT_AUTHOR + 1));
        refused(&mut t, &chain, author);
        let f = fail_as(
            &mut t,
            STRANGER,
            "setCheckpoint",
            json!({ "chain": chain, "input": input("a", "b") }),
        );
        assert_forbidden(&f);
        assert_eq!(get(&mut t, &chain), Value::Null);
        // Only `next` is enough; the lists may be empty.
        let bare = json!({
            "done": "",
            "next": "Start",
            "branches": [],
            "worktrees": [],
            "prs": [],
            "questions": [],
            "author": "",
        });
        set(&mut t, &chain, bare).unwrap();
    }
}

// ── memo.rs ──────────────────────────────────────────────────────────────────

mod memo {
    use super::*;

    const MAX_MEMOS: usize = 500;
    const MAX_MEMO_BYTES: usize = 2 * 1024 * 1024;
    const MAX_MEMO_VALUE: usize = 16 * 1024;
    const MAX_MEMO_BATCH: usize = 50;
    const HEAT_HALF_LIFE_MS: u64 = 6 * 60 * 60 * 1000;
    const ME: &str = "mero-bot@studio";
    // v1's CLOUD account is `agentbot`, added as "cloud".
    const CLOUD: &str = AGENT;

    fn key(n: u64) -> String {
        format!("{n:064x}")
    }

    /// v1's `row(n)`, read at `T0` (the harness clock; v1's `now_ms()`).
    fn row(n: u64) -> Value {
        json!({
            "key": key(n),
            "scope": "chat:ctx",
            "tool": "chat_get_messages",
            "args": format!("{{\"n\":{n}}}"),
            "value": "[]",
            "class": "fast",
            "ttl_ms": 30_000,
            "fetched_at": T0,
            "unchanged": 0,
            "hits": 1,
            "last_hit_at": T0,
            "attested": false,
        })
    }

    fn with(mut row: Value, fields: Value) -> Value {
        for (k, v) in fields.as_object().expect("fields") {
            row[k] = v.clone();
        }
        row
    }

    fn put_as(t: &mut TestApp, who: &str, agent: &str, rows: Vec<Value>) -> Result<Value, Failure> {
        t.as_(who)
            .call("putMemos", json!({ "agent": agent, "memos": rows }))
    }

    fn put(t: &mut TestApp, agent: &str, rows: Vec<Value>) -> Result<Value, Failure> {
        put_as(t, OWNER, agent, rows)
    }

    fn all(t: &mut TestApp) -> Vec<Value> {
        list(view(t, "memos", json!({ "since": "0" })))
    }

    fn hits(pairs: &[(&str, u64)]) -> Value {
        json!(pairs
            .iter()
            .map(|(agent, hits)| json!({ "agent": agent, "hits": hits }))
            .collect::<Vec<_>>())
    }

    #[test]
    fn the_runtime_keeps_a_read_and_reads_it_back() {
        let mut t = app();
        assert_eq!(put(&mut t, ME, vec![row(1)]).unwrap(), 1);
        let rows = all(&mut t);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["key"], key(1));
        assert_eq!(rows[0]["agent"], ME);
        assert_eq!(rows[0]["hits"], hits(&[(ME, 1)]));
        // Read after what it has: nothing new.
        let since = rows[0]["updated_at"].as_u64().unwrap().to_string();
        assert!(list(view(&mut t, "memos", json!({ "since": since }))).is_empty());

        // A refetch replaces the value and keeps the larger count.
        let again = with(
            row(1),
            json!({ "value": "[1]", "hits": 3, "fetched_at": T0 + 1 }),
        );
        put(&mut t, ME, vec![again]).unwrap();
        let rows = all(&mut t);
        assert_eq!(rows[0]["value"], "[1]");
        assert_eq!(rows[0]["hits"][0]["hits"], 3);
    }

    #[test]
    fn an_older_fetch_counts_its_hits_but_keeps_the_newer_value() {
        let mut t = app();
        add_agent(&mut t, "cloud");
        let newer = with(row(1), json!({ "value": "new", "fetched_at": T0 + 1_000 }));
        put(&mut t, ME, vec![newer]).unwrap();
        let older = with(
            row(1),
            json!({ "value": "old", "fetched_at": T0 - 60_000, "hits": 4 }),
        );
        put_as(&mut t, CLOUD, "cloud", vec![older]).unwrap();
        let rows = all(&mut t);
        assert_eq!(rows[0]["value"], "new");
        assert_eq!(rows[0]["agent"], ME);
        assert_eq!(rows[0]["hits"], hits(&[("cloud", 4), (ME, 1)]));
    }

    /// Replaces v1's `two_agents_merge_without_losing_hits`: under one log the
    /// two agents write in turn, and the newer fetch's value wins while each
    /// agent's count is kept; replaying the older write changes nothing.
    #[test]
    fn two_agents_writing_in_turn_keep_each_others_hits() {
        let mut t = app();
        add_agent(&mut t, "cloud");
        let mine = with(
            row(1),
            json!({ "value": "mine", "fetched_at": T0 - 20, "last_hit_at": T0 - 20, "hits": 5 }),
        );
        let theirs = with(
            row(1),
            json!({ "value": "theirs", "fetched_at": T0 - 10, "last_hit_at": T0 - 10, "hits": 7 }),
        );
        put(&mut t, ME, vec![mine.clone()]).unwrap();
        put_as(&mut t, CLOUD, "cloud", vec![theirs]).unwrap();
        // The older write again, after: nothing new.
        assert_eq!(put(&mut t, ME, vec![mine]).unwrap(), 0);
        let rows = all(&mut t);
        assert_eq!(rows[0]["value"], "theirs");
        assert_eq!(rows[0]["hits"], hits(&[("cloud", 7), (ME, 5)]));
        assert_eq!(rows[0]["last_hit_at"], T0 - 10);
    }

    #[test]
    fn the_least_used_rows_make_room() {
        let mut t = app();
        // One hot row, then enough cold ones to pass the limit.
        put(&mut t, ME, vec![with(row(0), json!({ "hits": 50 }))]).unwrap();
        let cold: Vec<Value> = (1..=MAX_MEMOS as u64)
            .map(|n| {
                with(
                    row(n),
                    json!({ "hits": 1, "last_hit_at": T0 - HEAT_HALF_LIFE_MS * 4 }),
                )
            })
            .collect();
        for chunk in cold.chunks(MAX_MEMO_BATCH) {
            put(&mut t, ME, chunk.to_vec()).unwrap();
        }
        let rows = all(&mut t);
        assert_eq!(rows.len(), MAX_MEMOS);
        assert!(rows.iter().any(|r| r["key"] == key(0)), "the hot row stays");
    }

    #[test]
    fn rows_stay_within_their_bytes() {
        let mut t = app();
        let big = "x".repeat(MAX_MEMO_VALUE);
        let n = (MAX_MEMO_BYTES / MAX_MEMO_VALUE) as u64 + 5;
        let rows: Vec<Value> = (0..n)
            .map(|i| with(row(i), json!({ "value": big })))
            .collect();
        // 25 rows a call, not v1's 50: 50 full rows pass the 512 KiB a node
        // takes as one call's arguments.
        for chunk in rows.chunks(25) {
            put(&mut t, ME, chunk.to_vec()).unwrap();
        }
        let kept: usize = all(&mut t)
            .iter()
            .map(|r| {
                ["value", "args", "scope", "tool"]
                    .iter()
                    .map(|f| s(&r[*f]).len())
                    .sum::<usize>()
            })
            .sum();
        assert!(kept <= MAX_MEMO_BYTES);
    }

    #[test]
    fn rows_are_checked() {
        let mut t = app();
        for bad in [
            json!({ "key": "not hex" }),
            json!({ "key": "" }),
            json!({ "scope": "" }),
            json!({ "tool": "" }),
            json!({ "class": "warm" }),
            json!({ "value": "x".repeat(MAX_MEMO_VALUE + 1) }),
        ] {
            let bad = with(row(1), bad);
            let f = put(&mut t, ME, vec![row(2), bad.clone()]).expect_err("refused");
            assert_eq!(err(&f).0, "Invalid", "{bad}");
        }
        assert!(all(&mut t).is_empty(), "a bad batch writes nothing");
        let too_many: Vec<Value> = (0..=MAX_MEMO_BATCH as u64).map(row).collect();
        assert_invalid(&put(&mut t, ME, too_many).unwrap_err(), "");
    }

    #[test]
    fn strangers_and_other_names_are_refused_and_clearing_is_yours() {
        let mut t = app();
        assert_forbidden(&put_as(&mut t, STRANGER, ME, vec![row(1)]).unwrap_err());
        add_agent(&mut t, "cloud");
        // An added agent writes only as itself.
        assert_forbidden(&put_as(&mut t, CLOUD, ME, vec![row(1)]).unwrap_err());
        put_as(&mut t, CLOUD, "cloud", vec![row(1)]).unwrap();
        // Only you clear the cache.
        assert_forbidden(&fail_as(&mut t, CLOUD, "clearMemos", json!({})));

        put(&mut t, ME, vec![row(2), row(3)]).unwrap();
        assert_eq!(
            call(
                &mut t,
                "dropMemos",
                json!({ "agent": ME, "keys": [key(2), key(9)] })
            ),
            1
        );
        assert_eq!(all(&mut t).len(), 2);
        assert_eq!(call(&mut t, "clearMemos", json!({})), 2);
        assert!(all(&mut t).is_empty());
    }
}

// ── prs.rs ───────────────────────────────────────────────────────────────────

mod prs {
    use super::*;

    const MAX_PRS: usize = 200;
    const MAX_FAILING: usize = 10;

    fn pending_434(chain: &Value) -> Value {
        json!({
            "chain": chain,
            "repo": "calimero-network/apps",
            "pr": 434,
            "title": "Safe merge button",
            "state": "open",
            "draft": false,
            "base": "master",
            "default_branch": "master",
            "conflicts": false,
            "head_sha": "abc123",
            "checks": "pending",
            "checks_total": 5,
            "checks_passed": 3,
            "checks_pending": 2,
            "failing": [],
            "stacked_on": 0,
            "stacked_merged": false,
        })
    }

    fn with(mut v: Value, fields: Value) -> Value {
        for (k, f) in fields.as_object().expect("fields") {
            v[k] = f.clone();
        }
        v
    }

    fn record(t: &mut TestApp, input: Value) -> Result<Value, Failure> {
        t.as_(OWNER).call("recordPr", json!({ "input": input }))
    }

    fn prs(t: &mut TestApp, chain: &str) -> Vec<Value> {
        list(view(t, "prs", json!({ "chain": chain })))
    }

    #[test]
    fn the_runtime_records_a_pr_and_the_card_reads_it() {
        let mut t = app();
        let chain = say(&mut t, "Ship #434");
        let first = record(&mut t, pending_434(&chain)).unwrap();
        assert_eq!(first["checks"], "pending");
        assert!(first["seen_at"].as_u64().unwrap() > 0);

        // Checks went red; recorded without naming the chain, it keeps the one it had.
        let red = record(
            &mut t,
            with(
                pending_434(&chain),
                json!({ "chain": "", "checks": "red", "checks_pending": 0, "failing": ["e2e"] }),
            ),
        )
        .unwrap();
        assert_eq!(red["chain"], chain);
        assert_eq!(red["failing"], json!(["e2e"]));
        assert!(red["seen_at"].as_u64() > first["seen_at"].as_u64());

        assert_eq!(prs(&mut t, s(&chain)), vec![red.clone()]);
        assert_eq!(prs(&mut t, "").len(), 1);
        assert!(prs(&mut t, "other").is_empty());

        // A stacked PR: its base is another PR's branch.
        let stacked = record(
            &mut t,
            with(
                pending_434(&chain),
                json!({ "pr": 435, "base": "mero-bot/chain-1", "stacked_on": 434 }),
            ),
        )
        .unwrap();
        assert_eq!(stacked["stacked_on"], 434);
        assert_eq!(stacked["stacked_merged"], false);
        assert_eq!(prs(&mut t, s(&chain)).len(), 2);
    }

    #[test]
    fn prs_are_checked_and_owner_only() {
        let mut t = app();
        let chain = say(&mut t, "Ship #434");
        for fields in [
            json!({ "chain": "nope" }),
            json!({ "repo": "apps" }),
            json!({ "pr": 0 }),
            json!({ "state": "draft" }),
            json!({ "checks": "yellow" }),
            json!({ "base": "" }),
            json!({ "default_branch": "my main" }),
            json!({ "head_sha": "not a sha" }),
            json!({ "checks_passed": 9 }),
            // Red names what failed; green names nothing.
            json!({ "checks": "red" }),
            json!({ "failing": ["e2e"] }),
            json!({ "checks": "red", "failing": vec!["x"; MAX_FAILING + 1] }),
            // Into the default branch is not stacked.
            json!({ "stacked_on": 433 }),
        ] {
            let input = with(pending_434(&chain), fields);
            let f = record(&mut t, input.clone()).expect_err("refused");
            assert_eq!(err(&f).0, "Invalid", "{input}");
        }
        let f = fail_as(
            &mut t,
            STRANGER,
            "recordPr",
            json!({ "input": pending_434(&chain) }),
        );
        assert_forbidden(&f);
        assert!(prs(&mut t, "").is_empty());
    }

    #[test]
    fn the_oldest_pr_makes_room() {
        let mut t = app();
        let chain = say(&mut t, "Ship #434");
        for n in 1..=MAX_PRS as u64 {
            t.advance(1);
            record(&mut t, with(pending_434(&chain), json!({ "pr": n }))).unwrap();
        }
        t.advance(1);
        record(&mut t, with(pending_434(&chain), json!({ "pr": 9_999 }))).unwrap();
        let all = prs(&mut t, "");
        assert_eq!(all.len(), MAX_PRS);
        assert!(all.iter().any(|p| p["pr"] == 9_999));
        assert!(!all.iter().any(|p| p["pr"] == 1));
    }
}

// ── watches.rs ───────────────────────────────────────────────────────────────

mod watches {
    use super::*;

    fn merge_434(chain: &Value) -> Value {
        json!({
            "chain": chain,
            "condition": "pr_green",
            "repo": "calimero-network/apps",
            "pr": 434,
            "branch": "",
            "action": "merge",
            "text": "",
            "agent": "mero-bot@studio",
        })
    }

    fn with(mut v: Value, fields: Value) -> Value {
        for (k, f) in fields.as_object().expect("fields") {
            v[k] = f.clone();
        }
        v
    }

    fn add(t: &mut TestApp, input: Value) -> Result<Value, Failure> {
        t.as_(OWNER).call("addWatch", json!({ "input": input }))
    }

    fn watches(t: &mut TestApp, chain: &str) -> Vec<Value> {
        list(view(t, "watches", json!({ "chain": chain })))
    }

    fn fire(t: &mut TestApp, id: &Value, session: &str) -> Result<Value, Failure> {
        t.as_(OWNER)
            .call("fireWatch", json!({ "id": id, "session": session }))
    }

    #[test]
    fn a_watch_fires_once_and_reports_how_it_went() {
        let mut t = app();
        let chain = say(&mut t, "Merge #434 when it's green");
        let w = add(&mut t, merge_434(&chain)).unwrap();
        assert_eq!(w["status"], "watching");
        assert_eq!(w["agent"], "mero-bot@studio");

        let seen = call(
            &mut t,
            "watchSeen",
            json!({ "id": w["id"], "seen": "3 of 5 checks passed, 2 running" }),
        );
        assert_eq!(seen["seen"], "3 of 5 checks passed, 2 running");
        assert!(seen["seen_at"].as_u64().unwrap() > 0);

        let fired = fire(&mut t, &w["id"], "studio#1").unwrap();
        assert_eq!(fired["status"], "firing");
        assert_eq!(fired["fired_by"], "studio#1");
        // A second session, or the same one after a restart, is refused.
        assert_invalid(
            &fire(&mut t, &w["id"], "laptop#1").unwrap_err(),
            "fires once",
        );
        // Too late to cancel once it fired.
        let f = fail(&mut t, "cancelWatch", json!({ "id": w["id"] }));
        assert_invalid(&f, "too late");

        let done = call(
            &mut t,
            "finishWatch",
            json!({ "id": w["id"], "outcome": "done", "note": "Merged #434" }),
        );
        assert_eq!(done["status"], "done");
        assert_eq!(done["note"], "Merged #434");
        let f = fail(
            &mut t,
            "finishWatch",
            json!({ "id": w["id"], "outcome": "failed", "note": "" }),
        );
        assert_invalid(&f, "");
        assert_invalid(&fire(&mut t, &w["id"], "studio#2").unwrap_err(), "");

        assert_eq!(watches(&mut t, s(&chain)), vec![done]);
    }

    #[test]
    fn a_cancelled_watch_never_fires() {
        let mut t = app();
        let chain = say(&mut t, "Merge #434 when it's green");
        let w = add(&mut t, merge_434(&chain)).unwrap();
        let cancelled = call(
            &mut t,
            "cancelWatch",
            json!({ "id": w["id"], "note": "Not needed" }),
        );
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["note"], "Not needed");
        assert_invalid(&fire(&mut t, &w["id"], "studio#1").unwrap_err(), "");
        // Cancelling twice is fine.
        call(
            &mut t,
            "cancelWatch",
            json!({ "id": w["id"], "note": null }),
        );
    }

    #[test]
    fn watches_are_checked() {
        let mut t = app();
        let chain = say(&mut t, "Merge #434 when it's green");
        for fields in [
            json!({ "chain": "nope" }),
            json!({ "condition": "pr_yellow" }),
            json!({ "action": "deploy" }),
            json!({ "repo": "apps" }),
            json!({ "repo": "calimero network/apps" }),
            json!({ "pr": 0 }),
            json!({ "branch": "main" }),
            // Merging on red, or on a branch, is not a thing.
            json!({ "condition": "pr_red" }),
            json!({ "condition": "branch_green", "pr": 0 }),
            // A turn needs its prompt.
            json!({ "condition": "branch_red", "pr": 0, "action": "turn" }),
        ] {
            let input = with(merge_434(&chain), fields);
            let f = add(&mut t, input.clone()).expect_err("refused");
            assert_eq!(err(&f).0, "Invalid", "{input}");
        }
        // Watch main and fix it if red: a branch, "" for the default one.
        let main = add(
            &mut t,
            with(
                merge_434(&chain),
                json!({
                    "condition": "branch_red",
                    "pr": 0,
                    "action": "turn",
                    "text": "Main went red: find the failing check and fix it",
                }),
            ),
        )
        .unwrap();
        assert_eq!(main["branch"], "");
        // The same watch twice is kept once.
        let twice = add(&mut t, merge_434(&chain)).unwrap();
        assert_eq!(add(&mut t, merge_434(&chain)).unwrap()["id"], twice["id"]);
        assert_eq!(watches(&mut t, "").len(), 2);
        // Only the owner sets, fires or cancels one.
        let f = fail_as(
            &mut t,
            STRANGER,
            "addWatch",
            json!({ "input": merge_434(&chain) }),
        );
        assert_forbidden(&f);
        let f = fail_as(
            &mut t,
            STRANGER,
            "fireWatch",
            json!({ "id": twice["id"], "session": "x" }),
        );
        assert_forbidden(&f);
        let f = fail_as(
            &mut t,
            STRANGER,
            "cancelWatch",
            json!({ "id": twice["id"] }),
        );
        assert_forbidden(&f);
    }

    #[test]
    fn watches_list_by_chain() {
        let mut t = app();
        let one = say(&mut t, "Merge #434 when it's green");
        let two = say(&mut t, "Watch main");
        add(&mut t, merge_434(&one)).unwrap();
        add(
            &mut t,
            with(
                merge_434(&two),
                json!({ "condition": "branch_red", "pr": 0, "action": "notify", "text": "Main is red" }),
            ),
        )
        .unwrap();
        assert_eq!(watches(&mut t, s(&one)).len(), 1);
        assert_eq!(watches(&mut t, s(&two))[0]["action"], "notify");
        assert_eq!(watches(&mut t, "").len(), 2);
    }

    /// Replaces v1's `a_fired_watch_stays_fired_when_devices_merge`: under one
    /// log, checks seen after the watch fired change nothing; it stays firing.
    #[test]
    fn a_fired_watch_stays_fired_when_checks_are_seen_later() {
        let mut t = app();
        let chain = say(&mut t, "Merge #434 when it's green");
        let w = add(&mut t, merge_434(&chain)).unwrap();
        t.advance(10);
        fire(&mut t, &w["id"], "s").unwrap();
        t.advance(40);
        let seen = call(
            &mut t,
            "watchSeen",
            json!({ "id": w["id"], "seen": "1 of 2 checks passed" }),
        );
        assert_eq!(seen["status"], "firing");
        assert_eq!(seen["seen"], "");
        assert_eq!(watches(&mut t, s(&chain))[0]["status"], "firing");
    }
}
