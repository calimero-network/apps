#!/usr/bin/env node
/**
 * app/e2e/capacity-ladder.mjs — HOW MANY PEOPLE CAN ACTUALLY BROADCAST?
 *
 * `lib/capacity.ts` answers that with arithmetic: gossipsub fan-out gives an
 * upstream bound, and the serial publish loop gives an RTT bound. Both are UPPER
 * bounds. Neither says what a real node actually sustains, and the cap shipped in
 * `lib/slots.ts` should not be a number somebody liked the look of.
 *
 * So this measures it. Four real nodes, one context, and a ladder: 1 author, then
 * 2, then 3, then 4, each publishing a REALISTIC 640x480 / 25 fps / 1.5 Mbps
 * stream on ephemeral presence — 49 single-fragment delta frames and one
 * four-fragment keyframe per 2 s, fragments serialised per author exactly as
 * `publishEphemeralFrame` serialises them. One node subscribes and counts what
 * actually arrives.
 *
 * What comes out, per rung:
 *
 *   * achieved publish rate vs the 26.5/s the schedule demands,
 *   * publish RTT p50/p95 — the input to the send-loop duty cycle,
 *   * frames DELIVERED to the observer per author, as a ratio of frames sent,
 *   * reassembly failures (a keyframe that lost a fragment is never shown).
 *
 * The rung where delivery or achieved fps falls off a cliff IS the cap. That
 * number then goes into `MAX_BROADCASTERS`, and the table goes into the plan.
 *
 * ── Design notes that matter for reading the output ──────────────────────────
 *
 * AUTHOR ATTRIBUTION IS DERIVED, NOT SUPPLIED. Each node publishes from its own
 * `msgSeq` range (node i uses `i * 1_000_000 + n`), so the observer can tell who
 * sent a frame from the framing header alone and then CHECK that each presence
 * `author` key carries exactly one node's range. That is a stronger assertion
 * than trusting a preloaded key, and it avoids depending on which output name
 * merobox happens to expose for a member identity.
 *
 * THE OBSERVER CHANGES ROLE ON THE LAST RUNG. Nodes 1..S publish; node 4
 * observes. So for S=1..3 the observer is a pure spectator, and at S=4 it is also
 * the fourth publisher — which is exactly the real app's situation, where every
 * participant is also a receiver. The comparable series across all four rungs is
 * therefore NODE 1's send-side numbers; the observer's delivery numbers are
 * comparable across the first three and indicative on the fourth. Both are
 * printed and labelled.
 *
 * PUBLISH RTT INCLUDES THE HTTP HOP, and should: in the real app the browser
 * talks to its own merod over local HTTP too, so this is the same measurement
 * `lib/congestion.ts` makes. It is NOT the network RTT between peers.
 *
 * ONE PROCESS DRIVES EVERY PUBLISHER, so at the top rung this makes ~106
 * requests/s across four sockets. That is far inside what Node sustains, but it
 * is shared — if the script itself became the bottleneck the symptom would be
 * every author degrading together and identically, which is called out below.
 *
 * Usage: capacity-ladder.mjs <n1_url> <n2_url> <n3_url> <n4_url> <context_id>
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EPHEMERAL_MAX_BYTES,
  HEADER_FIXED_BYTES,
  decodeHeader,
  encodeFragments,
} from "./lib/frame.mjs";
import { KEYFRAME_COST_RATIO } from "./lib/workload.mjs";

const URLS = [
  process.argv[2],
  process.argv[3],
  process.argv[4],
  process.argv[5],
];
const CONTEXT_ID = process.argv[6];
// Optional overrides, POSITIONAL rather than env-only: merobox's `script` step is
// documented to take `args`, and whether it forwards an `env:` block is not
// something to find out from a 6-minute CI job.
const ARG_RUNGS = process.argv[7];
const ARG_FPS = process.argv[8];
const ARG_SECONDS = process.argv[9];
const ARG_BITRATE = process.argv[10];

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = resolve(REPO, "data/capacity-ladder");

// ── The workload, matched to what the app actually publishes ──────────────────
const FPS = Number(ARG_FPS || process.env.LADDER_FPS || 25);
const KEYFRAME_EVERY = Number(process.env.LADDER_KEYFRAME_EVERY ?? 50); // frames
const SECONDS_PER_RUNG = Number(
  ARG_SECONDS || process.env.LADDER_SECONDS || 10,
);
const RUNGS = (ARG_RUNGS || process.env.LADDER_RUNGS || "1,2,3,4")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => n >= 1 && n <= 4);

// 1.5 Mbps over a 2 s keyframe interval is 375 KB, split 49 deltas + 1 keyframe
// at ~8x a delta — the same arithmetic as lib/capacity.ts. The ratio is imported
// from a shared module and held to the TypeScript original by
// src/lib/workloadParity.test.ts, because the previous version of this comment
// claimed the two agreed "by construction" when it was a copy-pasted literal with
// nothing enforcing it.
const BITRATE = Number(ARG_BITRATE || process.env.LADDER_BITRATE || 1_500_000);
const INTERVAL_S = KEYFRAME_EVERY / FPS;
const BYTES_PER_INTERVAL = (BITRATE / 8) * INTERVAL_S;
const DELTA_BYTES = Math.round(
  BYTES_PER_INTERVAL / (KEYFRAME_EVERY - 1 + KEYFRAME_COST_RATIO),
);
const KEYFRAME_BYTES = DELTA_BYTES * KEYFRAME_COST_RATIO;
const FRAME_PERIOD_MS = 1000 / FPS;

// ── Framing ──────────────────────────────────────────────────────────────────
// Shared with e2e/ephemeral-frames.mjs and byte-checked against the TypeScript
// source of truth by src/lib/frameParity.test.ts. This layout used to be
// hand-retyped here, which is how a header change reaches CI as garbled bytes.
const CODEC = "avc1.42001f";
const SEQ_BASE = 1_000_000; // node i publishes msgSeq in [i*BASE, (i+1)*BASE)

/** Deterministic, incompressible-ish bytes — a real access unit is not zeroes. */
function synthFrame(length, salt) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + salt * 7 + 11) & 0xff;
  return out;
}

/**
 * Pull the author and the framing header out of a raw SSE `data:` line, without
 * parsing the payload. Returns null when the line is not a live media slice.
 *
 * `HEADER_PREFIX_ENTRIES` is generous: the header is 40 fixed bytes plus an
 * 11-byte codec string, so 60 covers it with room for a longer codec.
 *
 * A slice carrying `ageMs` is a REPLAYED seed entry handed to a new subscriber —
 * a stale frame by definition, up to the 7 s TTL old. Counting it as delivered
 * would inflate the ratio with frames the app itself deliberately drops, so it is
 * excluded here, cheaply, by looking for the field's presence in the text.
 */
const HEADER_PREFIX_ENTRIES = 60;
const AUTHOR_RE = /"author":"([^"]+)"/;
const STATE_RE = /"state":\[([^\]]{0,600})/;

function matchEphemeralHead(raw) {
  // Cheapest possible reject first: every media event names the variant.
  if (!raw.includes('"Ephemeral"')) return null;
  if (/"ageMs":\s*\d/.test(raw)) return null;

  const author = AUTHOR_RE.exec(raw);
  const state = STATE_RE.exec(raw);
  if (!author || !state) return null;

  const nums = state[1].split(",", HEADER_PREFIX_ENTRIES);
  const header = new Uint8Array(nums.length);
  for (let i = 0; i < nums.length; i++) header[i] = Number(nums[i]) & 0xff;
  return { author: author[1], header };
}

// ── Reporting ────────────────────────────────────────────────────────────────
const c = {
  step: (m) => console.log(`\n\x1b[1m▸ ${m}\x1b[0m`),
  ok: (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`),
  bad: (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`),
  warn: (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`),
  info: (m) => console.log(`    ${m}`),
};
const failures = [];
function check(cond, message) {
  if (cond) c.ok(message);
  else {
    failures.push(message);
    c.bad(message);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pctOf = (sorted, p) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
    : null;
/** Sorts. Prefer `pctOf` on an already-sorted copy when taking two percentiles. */
const pct = (arr, p) =>
  pctOf(
    [...arr].sort((a, b) => a - b),
    p,
  );

// ── Transport ────────────────────────────────────────────────────────────────
//
// Every request is bounded. A node that stops responding mid-run is exactly the
// degradation this ladder exists to detect, and an unbounded `fetch` turns it into
// a silent stall whose only backstop is the 600 s job timeout — at which point
// "the node hung" and "the rig hung" look identical in the log. 10 s is far above
// the measured p95 (39 ms), so it can only fire on a genuine stall.
const REQUEST_TIMEOUT_MS = 10_000;

async function rpc(url, method, params) {
  let res;
  try {
    res = await fetch(`${url}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new Error(
        `${method} did not respond within ${REQUEST_TIMEOUT_MS}ms — the node is stalled, not slow`,
      );
    }
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${method}`);
  return res.json();
}

async function stateHash(url) {
  const res = await fetch(`${url}/admin-api/contexts/${CONTEXT_ID}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} reading context`);
  const body = await res.json();
  const d = body.data ?? body;
  return d.rootHash ?? d.root_hash ?? d.contextStateHash ?? null;
}

/**
 * Subscribe to a node's SSE stream and hand every Ephemeral slice to `onSlice`.
 *
 * A pump failure is RECORDED, never swallowed: a dead stream and a context
 * nobody published into look identical from the outside (zero events), and the
 * first must never be reported as the second.
 */
async function observe(url, onSlice) {
  // The stream is deliberately NOT time-limited — it stays open for the whole
  // rung — so the CONNECT is raced against a timer rather than given a timeout
  // signal, which would abort the stream mid-rung.
  const controller = new AbortController();
  const connectTimer = setTimeout(
    () => controller.abort(new Error("SSE connect timed out")),
    REQUEST_TIMEOUT_MS,
  );
  let res;
  try {
    res = await fetch(`${url}/sse`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(connectTimer);
  }
  if (!res.ok || !res.body)
    throw new Error(`SSE connect failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let pumpError = null;
  let subscribed = false;

  // An idle watchdog on the CONNECTED stream. `rpc()` already distinguishes "the
  // node is stalled, not slow"; the same reasoning applies to a long-lived read
  // that stops producing bytes without closing, which would otherwise block
  // forever with the 600 s job timeout as the only backstop. Rearmed on every
  // chunk, so a healthy stream never trips it.
  const IDLE_TIMEOUT_MS = 30_000;
  let idleTimer = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(new Error("SSE stream stalled")),
      IDLE_TIMEOUT_MS,
    );
  };

  const pump = (async () => {
    armIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      armIdle();
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();

        // ── Do NOT JSON.parse a media event ──────────────────────────────────
        //
        // The SSE envelope carries the slice as a JSON ARRAY OF INTEGERS, so a
        // 6.6 KB frame arrives as ~25 KB of text like `"state":[17,42,...]`.
        // Parsing that allocates a 6600-element array per frame, and at two
        // authors it is 53 of them a second — in the same event loop that is
        // driving the publishers.
        //
        // That is not a hypothetical: the first run with this observer measured
        // 96% delivery at one author and 27% at two, while the publishers' own
        // achieved frame rate fell from 24.6 to 19.1 as authors were added. Both
        // symptoms are the OBSERVER stealing the event loop, not the node
        // running out of capacity — and a capacity rig whose own cost scales
        // with the load it applies cannot tell you where the load stops working.
        //
        // Only the header is needed (40 fixed bytes + an 11-byte codec), so this
        // pulls the author and the first 60 state entries out with a regex and
        // never materialises the payload. `connect` frames are small and rare,
        // so they still go through JSON.parse.
        const head = matchEphemeralHead(raw);
        if (head) {
          onSlice(head.author, head.header);
          continue;
        }

        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          continue;
        }
        if (msg.type === "connect" && msg.session_id) {
          // `fetch` does not throw on 4xx, so an unchecked subscribe would leave
          // the stream connected and subscribed to NOTHING — which is
          // indistinguishable from "nobody published" at assertion time.
          // Bounded, like every other request in this file — and it was MISSED
          // when the others were bounded, which is worth the comment. It sits
          // inside the pump's `for (;;)`, so an unbounded fetch here blocks the
          // loop forever: the idle watchdog only re-arms around `reader.read()`,
          // and `controller.abort()` cannot cancel a fetch that was never given
          // the signal. The 600 s job timeout was the only backstop, which is
          // exactly the failure this file's REQUEST_TIMEOUT_MS exists to avoid.
          //
          // `controller.signal` rather than `AbortSignal.timeout`, so `stop()`
          // and the idle watchdog can cancel it too.
          const subDeadline = setTimeout(
            () => controller.abort(new Error("SSE subscribe timed out")),
            REQUEST_TIMEOUT_MS,
          );
          let sub;
          try {
            sub = await fetch(`${url}/sse/subscription`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: msg.session_id,
                method: "subscribe",
                params: { contextIds: [CONTEXT_ID] },
              }),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(subDeadline);
          }
          if (!sub.ok) throw new Error(`SSE subscribe failed: ${sub.status}`);
          subscribed = true;
          continue;
        }
        // `msg.result`, and the envelope shape is not negotiable: this is the
        // same wire format e2e-ephemeral-frames.mjs reads, and guessing at it
        // (`msg.data ?? msg`) silently counted ZERO delivered frames on the
        // first run while the send side worked perfectly — which reads as
        // "presence delivered nothing" rather than "the observer looked in the
        // wrong field".
        // Anything left is not a media slice — `matchEphemeralHead` above took
        // those. Nothing else in this stream is interesting to the ladder.
      }
    }
  })().catch((e) => {
    if (e.name !== "AbortError") pumpError = e;
  });

  // Wait for the subscription to be live before any publishing starts, or the
  // first frames land before anyone is listening and read as loss.
  for (let i = 0; i < 100 && !subscribed; i++) await sleep(50);
  if (!subscribed) throw new Error("SSE subscription never confirmed");

  return {
    async stop() {
      if (idleTimer) clearTimeout(idleTimer);
      controller.abort();
      await pump;
      if (pumpError) throw pumpError;
    },
  };
}

/**
 * Publish a realistic stream from one node for `seconds`, serialising fragments.
 *
 * Serial is not a simplification — it is the constraint being measured. The node
 * assigns the per-author LWW seq when it accepts the call, so firing fragments
 * concurrently races that assignment and lets the channel drop a fragment of a
 * frame that was fully published. The app serialises for that reason, so the
 * ladder must too or it measures a transport the app does not use.
 *
 * The schedule does NOT slip: it targets absolute frame deadlines and counts the
 * frames it could not reach as `skipped`. A loop that simply ran as fast as it
 * could would report a healthy publish rate while quietly delivering 8 fps.
 */
async function publishStream(nodeIndex, seconds) {
  const url = URLS[nodeIndex - 1];
  const seqBase = nodeIndex * SEQ_BASE;
  const rtts = [];
  let framesSent = 0;
  let publishes = 0;
  let publishErrors = 0;
  let skipped = 0;

  const startedAt = Date.now();
  const deadline = startedAt + seconds * 1000;
  let frame = 0;

  while (Date.now() < deadline) {
    const due = startedAt + frame * FRAME_PERIOD_MS;
    const now = Date.now();
    if (now < due) {
      await sleep(due - now);
    } else if (now - due > FRAME_PERIOD_MS) {
      // Behind schedule: drop this frame's slot rather than bunching. This is
      // the headline degradation the ladder exists to find.
      skipped += 1;
      frame += 1;
      continue;
    }

    const isKeyframe = frame % KEYFRAME_EVERY === 0;
    const bytes = synthFrame(
      isKeyframe ? KEYFRAME_BYTES : DELTA_BYTES,
      (frame % 251) + nodeIndex,
    );
    const fragments = encodeFragments({
      msgSeq: seqBase + frame,
      track: 0,
      isKeyframe,
      width: 640,
      height: 480,
      timestampUs: (seqBase + frame) * 40_000,
      createdAtMs: Date.now(),
      startedAtMs: 1_700_000_000_000,
      codec: CODEC,
      bytes,
    });

    let frameOk = true;
    for (const fragment of fragments) {
      const t0 = Date.now();
      try {
        const resp = await rpc(url, "set_ephemeral", {
          contextId: CONTEXT_ID,
          state: Array.from(fragment),
        });
        if (resp.error) throw new Error(JSON.stringify(resp.error));
        publishes += 1;
        rtts.push(Date.now() - t0);
      } catch {
        publishErrors += 1;
        frameOk = false;
        break; // a frame missing a fragment can never be reassembled
      }
    }
    if (frameOk) framesSent += 1;
    frame += 1;
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  const sortedRtts = [...rtts].sort((a, b) => a - b);
  return {
    nodeIndex,
    seqBase,
    elapsedS,
    framesSent,
    framesScheduled: frame,
    skipped,
    publishes,
    publishErrors,
    achievedFps: framesSent / elapsedS,
    achievedPublishRate: publishes / elapsedS,
    // Sorted once for both percentiles rather than once each.
    rttP50: pctOf(sortedRtts, 50),
    rttP95: pctOf(sortedRtts, 95),
  };
}

/** Reassembles per author, and reports what could not be completed. */
/**
 * Most fragments a rung will hold part-assembled before evicting the oldest.
 *
 * A frame that loses a fragment never completes, so its entry would otherwise sit
 * in the map for the rest of the rung. Bounded in practice at the default 10-12 s
 * — but `ARG_SECONDS` can extend a rung arbitrarily, and a lossy link is exactly
 * the condition this rig is pointed at, so the assumption that incompleteness is
 * self-limiting is the wrong one to rely on. 256 is far above the ~4 concurrent
 * multi-fragment frames real traffic produces.
 */
const MAX_PENDING_FRAMES = 256;

function makeCollector() {
  const perAuthor = new Map();
  const pending = new Map(); // `${author}|${msgSeq}` -> Set(fragIndex)
  let foreign = 0;
  let evicted = 0;

  return {
    onSlice(author, slice) {
      const h = decodeHeader(slice);
      if (!h) {
        foreign += 1;
        return;
      }
      let a = perAuthor.get(author);
      if (!a) {
        a = { frames: 0, keyframes: 0, seqs: new Set(), incomplete: 0 };
        perAuthor.set(author, a);
      }
      if (h.fragCount === 1) {
        a.frames += 1;
        if (h.isKeyframe) a.keyframes += 1;
        a.seqs.add(h.msgSeq);
        return;
      }
      const key = `${author}|${h.msgSeq}`;
      let seen = pending.get(key);
      if (!seen) {
        // Insertion-ordered, so the first key is the oldest.
        if (pending.size >= MAX_PENDING_FRAMES) {
          const oldest = pending.keys().next().value;
          pending.delete(oldest);
          evicted += 1;
        }
        seen = new Set();
        pending.set(key, seen);
      }
      seen.add(h.fragIndex);
      if (seen.size === h.fragCount) {
        pending.delete(key);
        a.frames += 1;
        if (h.isKeyframe) a.keyframes += 1;
        a.seqs.add(h.msgSeq);
      }
    },
    result() {
      // Anything still pending lost at least one fragment. On this channel that
      // is expected and self-healing (the next keyframe is the retry), so it is
      // reported rather than failed.
      for (const key of pending.keys()) {
        const author = key.slice(0, key.indexOf("|"));
        const a = perAuthor.get(author);
        if (a) a.incomplete += 1;
      }
      return { perAuthor, foreign, evicted };
    },
  };
}

/** Which node a delivered author key belongs to, from its msgSeq range. */
function nodeOfSeqs(seqs) {
  const idx = new Set([...seqs].map((s) => Math.floor(s / SEQ_BASE)));
  return idx.size === 1 ? [...idx][0] : null;
}

async function runRung(senders, observerIndex) {
  c.step(`Rung: ${senders} author${senders === 1 ? "" : "s"} at ${FPS} fps`);
  const collector = makeCollector();
  const sub = await observe(URLS[observerIndex - 1], (a, s) =>
    collector.onSlice(a, s),
  );

  const sends = await Promise.all(
    Array.from({ length: senders }, (_, i) =>
      publishStream(i + 1, SECONDS_PER_RUNG),
    ),
  );

  // Presence is best effort and gossip is not instant; give in-flight slices a
  // moment to land before counting, or the tail reads as loss.
  await sleep(1500);
  await sub.stop();
  const { perAuthor, foreign, evicted } = collector.result();

  // Map each author key to the node it must be, from the seq range it carried.
  const byNode = new Map();
  const ambiguous = [];
  for (const [author, a] of perAuthor) {
    const node = nodeOfSeqs(a.seqs);
    if (node === null) ambiguous.push(author);
    else byNode.set(node, { author, ...a });
  }

  const rows = sends.map((s) => {
    const got = byNode.get(s.nodeIndex);
    const delivered = got?.frames ?? 0;
    return {
      ...s,
      delivered,
      deliveredFps: delivered / s.elapsedS,
      deliveryRatio: s.framesSent ? delivered / s.framesSent : 0,
      incomplete: got?.incomplete ?? 0,
      keyframesDelivered: got?.keyframes ?? 0,
    };
  });

  // Author keys must partition 1:1 onto nodes. If one key carried two nodes'
  // seq ranges, per-author isolation on the presence channel is broken — which
  // is the exact class of bug the shared-counter retro was about.
  check(
    ambiguous.length === 0,
    `each presence author carried exactly one node's seq range (${ambiguous.length} ambiguous)`,
  );
  check(
    byNode.size === senders ||
      (observerIndex <= senders && byNode.size >= senders - 1),
    `observer saw ${byNode.size} distinct authors for ${senders} publisher(s)`,
  );

  for (const r of rows) {
    const self = r.nodeIndex === observerIndex ? " (own echo)" : "";
    c.info(
      `node ${r.nodeIndex}${self}: sent ${r.framesSent}/${r.framesScheduled} ` +
        `(${r.achievedFps.toFixed(1)} fps, ${r.achievedPublishRate.toFixed(1)} pub/s), ` +
        `RTT p50 ${r.rttP50}ms p95 ${r.rttP95}ms, ` +
        `skipped ${r.skipped}, errors ${r.publishErrors} → ` +
        `delivered ${r.delivered} (${(r.deliveryRatio * 100).toFixed(0)}%, ` +
        `${r.deliveredFps.toFixed(1)} fps), incomplete ${r.incomplete}`,
    );
  }
  if (foreign) c.warn(`${foreign} slices were not ours (ignored)`);
  if (evicted) {
    c.warn(
      `${evicted} part-assembled frames evicted at the ${MAX_PENDING_FRAMES} cap — reported, not silent, because a high count means the loss rate is far worse than the delivery ratio alone suggests`,
    );
  }

  // If EVERY author degrades by the same amount, suspect this script's own event
  // loop rather than the node — see the header note.
  const spread =
    rows.length > 1
      ? Math.max(...rows.map((r) => r.achievedFps)) -
        Math.min(...rows.map((r) => r.achievedFps))
      : 0;

  return { senders, observerIndex, rows, foreign, fpsSpread: spread };
}

async function main() {
  if (URLS.some((u) => !u) || !CONTEXT_ID) {
    throw new Error(
      "usage: capacity-ladder.mjs <n1_url> <n2_url> <n3_url> <n4_url> <context_id>",
    );
  }

  c.step("Workload");
  c.info(
    `${FPS} fps · ${(BITRATE / 1e6).toFixed(1)} Mbps · keyframe every ${KEYFRAME_EVERY} frames`,
  );
  c.info(
    `delta ${DELTA_BYTES} B (1 fragment) · keyframe ${KEYFRAME_BYTES} B (${Math.ceil(KEYFRAME_BYTES / (EPHEMERAL_MAX_BYTES - HEADER_FIXED_BYTES - CODEC.length))} fragments)`,
  );
  c.info(
    `schedule demands ${(((KEYFRAME_EVERY - 1) * 1 + Math.ceil(KEYFRAME_BYTES / (EPHEMERAL_MAX_BYTES - HEADER_FIXED_BYTES - CODEC.length))) / (KEYFRAME_EVERY / FPS)).toFixed(1)} publishes/s per author`,
  );
  c.info(`${SECONDS_PER_RUNG}s per rung, rungs: ${RUNGS.join(", ")}`);

  const hashBefore = await stateHash(URLS[0]);
  check(
    hashBefore !== null,
    `baseline context state hash is readable (${hashBefore})`,
  );

  const results = [];
  for (const senders of RUNGS) {
    results.push(await runRung(senders, 4));
    // Let the presence TTL clear between rungs so a rung never counts the
    // previous rung's tail.
    await sleep(2000);
  }

  const hashAfter = await stateHash(URLS[0]);
  check(
    hashBefore === hashAfter,
    `state hash UNCHANGED across the whole ladder (${hashBefore} → ${hashAfter}) — ` +
      `nothing entered the DAG`,
  );

  // ── The table ──────────────────────────────────────────────────────────────
  c.step("Capacity ladder");
  const head = [
    "authors",
    "sent fps/author",
    "pub/s/author",
    "RTT p50",
    "RTT p95",
    "duty",
    "delivered fps",
    "delivery",
    "incomplete",
  ];
  const COL = 17;
  console.log(`    ${head.map((h) => h.padEnd(COL)).join("")}`);
  const table = [];
  for (const r of results) {
    const avg = (f) => r.rows.reduce((n, x) => n + f(x), 0) / r.rows.length;
    const demand =
      ((KEYFRAME_EVERY - 1) * 1 +
        Math.ceil(
          KEYFRAME_BYTES /
            (EPHEMERAL_MAX_BYTES - HEADER_FIXED_BYTES - CODEC.length),
        )) /
      (KEYFRAME_EVERY / FPS);
    // Rounded: an average of integer millisecond samples is fractional, and
    // "9.333333333333334ms" in a results table is noise pretending to be
    // precision.
    const p50 = Math.round(avg((x) => x.rttP50 ?? 0));
    const row = {
      authors: r.senders,
      sentFps: avg((x) => x.achievedFps),
      pubRate: avg((x) => x.achievedPublishRate),
      rttP50: p50,
      rttP95: Math.round(avg((x) => x.rttP95 ?? 0)),
      dutyCycle: (demand * p50) / 1000,
      deliveredFps: avg((x) => x.deliveredFps),
      deliveryRatio: avg((x) => x.deliveryRatio),
      incomplete: avg((x) => x.incomplete),
      fpsSpread: r.fpsSpread,
    };
    table.push(row);
    console.log(
      `    ${String(row.authors).padEnd(COL)}` +
        `${row.sentFps.toFixed(1).padEnd(COL)}` +
        `${row.pubRate.toFixed(1).padEnd(COL)}` +
        `${`${row.rttP50}ms`.padEnd(COL)}` +
        `${`${row.rttP95}ms`.padEnd(COL)}` +
        `${`${(row.dutyCycle * 100).toFixed(0)}%`.padEnd(COL)}` +
        `${row.deliveredFps.toFixed(1).padEnd(COL)}` +
        `${`${(row.deliveryRatio * 100).toFixed(0)}%`.padEnd(COL)}` +
        `${row.incomplete.toFixed(1).padEnd(COL)}`,
    );
  }

  // ── The verdict ────────────────────────────────────────────────────────────
  //
  // Deliberately WEAK assertions. This is a measurement, and a measurement that
  // fails the build when the answer is "3 works, 4 does not" has destroyed the
  // information it existed to collect. What is asserted is that the RIG worked:
  // author isolation held, nothing hit the DAG, and the floor rung performed.
  c.step("Verdict");
  // ONLY when rung 1 was actually run. This is the rig check — "with a single
  // publisher, does anything arrive at all" — and applying it to whichever rung
  // happens to be first turned the confirming run (rungs=2) into a failure that
  // said "single author is healthy (70%)" about two authors. A measurement rig
  // must not fail the build for measuring something.
  const floor = table.find((r) => r.authors === 1);
  if (floor) {
    check(
      floor.deliveryRatio > 0.8,
      `single author is healthy (${(floor.deliveryRatio * 100).toFixed(0)}% delivered, ${floor.sentFps.toFixed(1)} fps) — if THIS rung fails the rig is wrong, not the cap`,
    );
  } else {
    c.info(
      "rung 1 was not run, so the rig's own floor check is skipped — read the table above as a comparison, not a verdict",
    );
  }
  const healthy = table.filter(
    (r) => r.deliveryRatio >= 0.9 && r.sentFps >= FPS * 0.9,
  );
  const cap = healthy.length ? Math.max(...healthy.map((r) => r.authors)) : 0;
  console.log("");
  c.info(
    `Highest rung holding >=90% delivery AND >=90% of ${FPS} fps: ${cap} author(s).`,
  );
  c.info(
    `MAX_BROADCASTERS in app/src/lib/slots.ts should be ${cap || "reviewed by hand"}.`,
  );
  for (const r of table) {
    if (r.authors > 1 && r.fpsSpread > FPS * 0.25) {
      c.warn(
        `rung ${r.authors}: authors degraded UNEVENLY (${r.fpsSpread.toFixed(1)} fps spread) — node-side contention, not this script`,
      );
    }
  }

  // Named by the workload, so the confirming run at the adaptive rate does not
  // clobber the full-rate ladder it is being compared against.
  const outName = `results-fps${FPS}-rungs${RUNGS.join("")}.json`;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, outName),
    JSON.stringify(
      {
        workload: {
          fps: FPS,
          bitrate: BITRATE,
          keyframeEvery: KEYFRAME_EVERY,
          deltaBytes: DELTA_BYTES,
          keyframeBytes: KEYFRAME_BYTES,
          secondsPerRung: SECONDS_PER_RUNG,
        },
        stateHash: { before: hashBefore, after: hashAfter },
        table,
        detail: results,
        derivedCap: cap,
        failures,
      },
      null,
      2,
    ),
  );
  c.ok(`results written to data/capacity-ladder/${outName}`);

  if (failures.length) {
    console.error(`\n${failures.length} rig assertion(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nLadder complete.");
}

main().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
