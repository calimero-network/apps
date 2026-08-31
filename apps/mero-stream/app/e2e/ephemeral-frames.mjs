#!/usr/bin/env node
// ephemeral-frames.mjs — the media transport on ephemeral presence, across two
// real nodes.
//
// Approach 1 (core 0.11.0-rc.24, core#3427): a frame travels as an
// ephemeral-presence slice instead of as replicated state. This script asserts
// the three claims that only two real nodes can settle:
//
//   1. A single-fragment frame published on node 1 reaches a subscriber on
//      node 2 BYTE-IDENTICALLY, as a live delta (no `ageMs`), attributed to
//      node 1's identity.
//   2. A frame too large for one 16 KiB slice, published as sequential
//      fragments, is reassembled byte-identically on node 2.
//   3. Node 1's `contextStateHash` is UNCHANGED across every publish, measured
//      against a non-null baseline. This is the load-bearing one: it is the
//      difference between this transport and `post_chunk`, and the whole reason
//      the app offers it.
//
// SSE only, deliberately. It is the transport mero-js uses (`MeroJs.events` is
// an SseClient) and therefore the one mero-stream ships; core's own
// ephemeral-presence e2e covers the WS path against regression, and a second
// subscriber implementation here would be infrastructure this repo does not
// otherwise use.
//
// The fragment header is encoded by hand below rather than imported from
// app/src/lib/ephemeralFrames.ts, so this job needs no TypeScript build step.
// That is a second copy of the layout, and the way it is kept honest is the
// golden-vector test in ephemeralFrames.test.ts ("puts every header field at its
// documented offset") — change the layout and that test fails at the byte that
// moved, pointing here. The framing's decode side and every reorder / loss /
// replay rule are unit-tested there; this script is about the channel.
//
// Auth: merobox nodes run in Proxy mode (default), so no Bearer token.
//
// Args: $1 node1_url  $2 node2_url  $3 context_id  $4 node1_key

// Defaults match workflows/e2e-ephemeral-frames.yml's pinned base_rpc_port
// (2740), so running this by hand against that scenario needs only the context id
// and node 1's key.
import {
  EPHEMERAL_MAX_BYTES,
  HEADER_FIXED_BYTES,
  decodeHeader,
  encodeFragments,
} from "./lib/frame.mjs";

const NODE1_URL = process.argv[2] || "http://localhost:2740";
const NODE2_URL = process.argv[3] || "http://localhost:2741";
const CONTEXT_ID = process.argv[4] || "";
const NODE1_KEY = process.argv[5] || "";

const tally = { pass: 0, fail: 0 };
const ok = (label, got) => {
  console.log(`ok   ${label}${got !== undefined ? ` (${got})` : ""}`);
  tally.pass++;
};
const bad = (label, detail) => {
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  tally.fail++;
};

/**
 * Abort the whole run.
 *
 * A request that never completed is NOT a failed assertion — it is a run that
 * verified nothing, and several assertions below are satisfied by an empty
 * result (no event, an unchanged hash). Reporting a transport failure as a PASS
 * is the exact false pass this guards.
 */
const die = (label, detail) => {
  console.log(`FATAL ${label}${detail ? `: ${detail}` : ""}`);
  console.log(`\n=== ${tally.pass} passed, ${tally.fail} failed ===`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!CONTEXT_ID)
  die("CONTEXT_ID is empty — was create_mesh's output captured?");
if (!NODE1_KEY)
  die(
    "NODE1_KEY is empty — the author assertion cannot run, and an assertion that verifies nothing reads as coverage",
  );

// ── framing ──────────────────────────────────────────────────────────────────
// Shared with e2e/capacity-ladder.mjs and byte-checked against the TypeScript
// source of truth by src/lib/frameParity.test.ts. It used to be hand-retyped in
// both drivers, so a header change (v2 moved `codecLen` from offset 31 to 39) had
// to be applied in three places with nothing comparing them.
const CODEC = "avc1.42001f";

/** Header fields plus the payload, which is what this driver reassembles. */
function readHeader(slice) {
  const h = decodeHeader(slice);
  if (!h) return null;
  return { ...h, payload: slice.slice(h.payloadStart) };
}

/** Deterministic, incompressible-ish bytes — a real access unit is not a run of zeroes. */
function synthFrame(length, salt) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + salt * 7 + 11) & 0xff;
  return out;
}

const sameBytes = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ── transport ────────────────────────────────────────────────────────────────

async function rpc(url, method, params, id = 1) {
  const res = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${method}`);
  return res.json();
}

async function readContext(url, contextId) {
  const res = await fetch(`${url}/admin-api/contexts/${contextId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} reading context`);
  return res.json();
}

/**
 * Subscribe over SSE and collect every Ephemeral slice delivered.
 *
 * A transport failure inside the pump is RECORDED, not swallowed: a dead stream
 * and a context nobody published into look identical from the outside (zero
 * events), and the first must never be reported as the second.
 */
async function subscribeSse(httpUrl, contextId) {
  const controller = new AbortController();
  const res = await fetch(`${httpUrl}/sse`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!res.ok || !res.body)
    throw new Error(`SSE connect failed: ${res.status}`);

  const events = [];
  const waiters = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let pumpError = null;
  let closed = false;

  const failure = (err) =>
    new Error(
      `SSE stream failed: ${err.message} — a TRANSPORT failure, not an absent event`,
    );

  const deliver = (payload) => {
    events.push(payload);
    for (const w of [...waiters]) {
      if (w.pred(payload)) {
        clearTimeout(w.timer);
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(payload);
      }
    }
  };

  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        let msg;
        try {
          msg = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }

        if (msg.type === "connect" && msg.session_id) {
          // `fetch` does not throw on 4xx/5xx, so an unchecked subscribe POST
          // would leave the stream connected and subscribed to NOTHING — which
          // is indistinguishable from "nobody published" at assertion time.
          const sub = await fetch(`${httpUrl}/sse/subscription`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: msg.session_id,
              method: "subscribe",
              params: { contextIds: [contextId] },
            }),
          });
          if (!sub.ok) {
            const detail = await sub.text().catch(() => "<unreadable body>");
            throw new Error(
              `SSE subscribe POST failed: ${sub.status} ${sub.statusText} — ${detail}`,
            );
          }
          continue;
        }

        const event = msg.result;
        if (event && event.type === "Ephemeral") {
          deliver({
            ...event.data,
            contextId: event.contextId ?? event.context_id,
          });
        }
      }
    }
  })().catch((err) => {
    if (closed) return; // an abort from close() is how this is meant to end
    pumpError = err;
    for (const w of waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(failure(err));
    }
  });

  return {
    events,
    waitFor(pred, ms, label) {
      if (pumpError) return Promise.reject(failure(pumpError));
      const already = events.find(pred);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no ${label} within ${ms}ms`)),
          ms,
        );
        waiters.push({ pred, resolve, reject, timer });
      });
    },
    throwIfBroken() {
      if (pumpError) throw failure(pumpError);
    },
    close() {
      closed = true;
      for (const w of waiters) clearTimeout(w.timer);
      controller.abort();
      return pump;
    },
  };
}

/** Publish one frame's fragments, one at a time. See the app's publishEphemeralFrame. */
async function publishFrame(url, fragments) {
  for (const [i, fragment] of fragments.entries()) {
    const resp = await rpc(
      url,
      "set_ephemeral",
      { contextId: CONTEXT_ID, state: Array.from(fragment) },
      100 + i,
    );
    if (resp.error) {
      throw new Error(
        `set_ephemeral rejected fragment ${i}: ${JSON.stringify(resp.error)}`,
      );
    }
  }
}

// ── the run ──────────────────────────────────────────────────────────────────

console.log("=== ephemeral-frames e2e ===");
console.log(`  node1_url  : ${NODE1_URL}`);
console.log(`  node2_url  : ${NODE2_URL}`);
console.log(`  context_id : ${CONTEXT_ID}`);
console.log(`  node1_key  : ${NODE1_KEY}`);

console.log("\n-- Phase 0: the context is readable on both nodes --");
let hashBefore;
try {
  const [c1, c2] = await Promise.all([
    readContext(NODE1_URL, CONTEXT_ID),
    readContext(NODE2_URL, CONTEXT_ID),
  ]);
  const id1 = c1?.data?.id ?? c1?.id;
  const id2 = c2?.data?.id ?? c2?.id;
  if (id1 === CONTEXT_ID) ok("node 1 has the context");
  else bad("node 1 has the context", JSON.stringify(c1));
  if (id2 === CONTEXT_ID) ok("node 2 has the context");
  else bad("node 2 has the context", JSON.stringify(c2));

  hashBefore = c1?.data?.contextStateHash ?? c1?.contextStateHash ?? null;
} catch (e) {
  die(
    "read the context on both nodes",
    `${e.message} — the run verified nothing`,
  );
}

// The no-DAG-growth assertion is only meaningful against a NON-NULL baseline: if
// the hash were the genesis value both before and after, "unchanged" would also
// be satisfied by a context nothing had ever written to. The workflow runs a
// `join` call before this script for exactly that reason.
const NULL_HASH = "11111111111111111111111111111111";
if (!hashBefore || hashBefore === NULL_HASH) {
  die(
    "non-null contextStateHash baseline",
    `got ${hashBefore} — the no-DAG-growth guard would pass vacuously, so this run cannot assert it`,
  );
}
ok("non-null contextStateHash baseline on node 1", hashBefore);

console.log(
  "\n-- Phase 1: a single-fragment frame arrives byte-identically --",
);
let watcher;
try {
  watcher = await subscribeSse(NODE2_URL, CONTEXT_ID);
} catch (e) {
  die("subscribe on node 2", `${e.message} — nothing could be observed`);
}
// The subscriber has to be live BEFORE the publish: a live delta is the claim,
// and a late subscriber would be seeded with a replayed entry instead (carrying
// `ageMs`), which is a different assertion.
await sleep(1000);

const smallFrame = synthFrame(4_000, 1);
const smallFragments = encodeFragments({
  msgSeq: 1,
  isKeyframe: true,
  width: 640,
  height: 480,
  timestampUs: 1_000_000,
  createdAtMs: 1_700_000_000_000,
  startedAtMs: 1_700_000_000_000,
  codec: CODEC,
  bytes: smallFrame,
});
if (smallFragments.length !== 1) {
  die(
    "a 4 KB frame is one fragment",
    `got ${smallFragments.length} — the single-fragment claim is not what is being tested`,
  );
}

try {
  await publishFrame(NODE1_URL, smallFragments);
  ok("set_ephemeral accepted the frame on node 1");
} catch (e) {
  die(
    "publish the single-fragment frame",
    `${e.message} — on a node older than 0.11.0-rc.24 there is no set_ephemeral method at all`,
  );
}

try {
  const entry = await watcher.waitFor(
    (p) => p.author === NODE1_KEY && p.state && p.ageMs == null,
    20_000,
    "live Ephemeral delta from node 1",
  );
  const slice = new Uint8Array(entry.state);
  if (sameBytes(slice, smallFragments[0])) {
    ok("node 2 received the slice byte-identically", `${slice.length} bytes`);
  } else {
    bad(
      "node 2 received the slice byte-identically",
      `${slice.length} bytes received vs ${smallFragments[0].length} published`,
    );
  }

  const header = readHeader(slice);
  if (!header) {
    bad("the framing header survived the wire", "the slice did not parse");
  } else {
    if (header.msgSeq === 1) ok("msgSeq survived", header.msgSeq);
    else bad("msgSeq survived", `got ${header.msgSeq}`);
    if (header.codec === CODEC)
      ok("codec string survived verbatim", header.codec);
    else bad("codec string survived verbatim", `got ${header.codec}`);
    if (header.isKeyframe) ok("the keyframe flag survived");
    else bad("the keyframe flag survived", "flag lost");
    if (sameBytes(header.payload, smallFrame)) ok("the payload is the frame");
    else bad("the payload is the frame", `${header.payload.length} bytes`);
  }
} catch (e) {
  bad("node 2 received the frame", e.message);
}

console.log(
  "\n-- Phase 2: a frame larger than one slice is reassembled on node 2 --",
);
// Best-effort by construction, and the assertion says so. The node bumps a
// per-author LWW seq per publish and drops anything at or below the highest it
// has applied, while the outbound publish is spawned per call — so fragments of
// one frame can reach a peer out of order and the loser is discarded with no
// event. In the app the retry is the next keyframe (at most KEYFRAME_INTERVAL_MS
// away); here it is this loop. Asserting a single attempt must succeed would be
// asserting something the channel does not promise.
const BIG_ATTEMPTS = 4;
const bigFrame = synthFrame(45_000, 2);
let reassembledIn = 0;

for (let attempt = 1; attempt <= BIG_ATTEMPTS; attempt++) {
  const msgSeq = 100 + attempt;
  const fragments = encodeFragments({
    msgSeq,
    isKeyframe: true,
    width: 640,
    height: 480,
    timestampUs: 2_000_000 + attempt,
    createdAtMs: 1_700_000_000_000 + attempt,
    startedAtMs: 1_700_000_000_000,
    codec: CODEC,
    bytes: bigFrame,
  });
  if (attempt === 1) {
    if (fragments.length > 1) {
      ok(
        "a 45 KB frame needs multiple slices",
        `${fragments.length} fragments`,
      );
    } else {
      die(
        "a 45 KB frame needs multiple slices",
        "one fragment — the fragmentation claim is not being tested",
      );
    }
    for (const f of fragments) {
      if (f.length > EPHEMERAL_MAX_BYTES) {
        bad(
          "every fragment is within the node's 16 KiB cap",
          `${f.length} bytes`,
        );
      }
    }
    ok("every fragment is within the node's 16 KiB cap");
  }

  try {
    await publishFrame(NODE1_URL, fragments);
  } catch (e) {
    bad(`publish attempt ${attempt}`, e.message);
    continue;
  }

  // Give the fragments time to cross, then reassemble from what arrived.
  await sleep(3000);
  watcher.throwIfBroken();

  const parts = new Array(fragments.length).fill(null);
  for (const entry of watcher.events) {
    if (entry.author !== NODE1_KEY || !entry.state || entry.ageMs != null)
      continue;
    const header = readHeader(new Uint8Array(entry.state));
    if (!header || header.msgSeq !== msgSeq) continue;
    if (header.fragCount !== fragments.length) continue;
    parts[header.fragIndex] = header.payload;
  }

  const received = parts.filter(Boolean).length;
  if (received < fragments.length) {
    console.log(
      `  attempt ${attempt}: ${received}/${fragments.length} fragments arrived — retrying`,
    );
    continue;
  }

  const joined = new Uint8Array(bigFrame.length);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  if (sameBytes(joined, bigFrame)) {
    reassembledIn = attempt;
    break;
  }
  console.log(
    `  attempt ${attempt}: reassembled ${at} bytes, not the frame — retrying`,
  );
}

if (reassembledIn > 0) {
  ok(
    "node 2 reassembled the multi-fragment frame byte-identically",
    `attempt ${reassembledIn} of ${BIG_ATTEMPTS}`,
  );
} else {
  bad(
    "node 2 reassembled the multi-fragment frame byte-identically",
    `no attempt in ${BIG_ATTEMPTS} delivered every fragment — the channel is lossier than the keyframe cadence can cover`,
  );
}

console.log("\n-- Phase 3: no DAG growth (LOAD-BEARING) --");
await watcher.close();

let hashAfter;
try {
  const c1 = await readContext(NODE1_URL, CONTEXT_ID);
  hashAfter = c1?.data?.contextStateHash ?? c1?.contextStateHash ?? null;
} catch (e) {
  die(
    "read node 1's contextStateHash after publishing",
    `${e.message} — the load-bearing guard cannot be evaluated`,
  );
}

console.log(`  before: ${hashBefore}`);
console.log(`  after : ${hashAfter}`);
if (hashAfter === hashBefore) {
  ok("node 1's contextStateHash is unchanged by every ephemeral publish");
} else {
  bad(
    "node 1's contextStateHash is unchanged by every ephemeral publish",
    `${hashBefore} → ${hashAfter} — the transport wrote to the DAG, which is the one thing it must never do`,
  );
}

console.log(`\n=== ${tally.pass} passed, ${tally.fail} failed ===`);
process.exit(tally.fail === 0 ? 0 : 1);
