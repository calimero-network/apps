# RE-DO — make Mero Stream a usable 2-person 480p video call

Reviewed against the code on `main` @ `20d2fef`. Five separate problems, only one of
which is cosmetic. They are ordered below by *how much you get per unit of work*,
not by how they were reported.

---

## TL;DR

| # | Problem | Cause | Size |
|---|---|---|---|
| 1 | "It's 64×48, not 480p" | The app **navigates to the wrong route**. `/stream` is the toy codec. `/live` is the 480p one. | 3 lines |
| 2 | Only one person's video | Receive loop has **one decoder for all senders** and ignores `from` | Medium |
| 3 | Two-way would show garbage even if wired | Global keyframe + one shared prune window in the **contract** | Contract change |
| 4 | No rooms | `createStream` makes namespace + context, **no subgroup** | Medium |
| 5 | No way to invite / join | Only `scripts/dev-invite.sh` (curl). No UI. | Medium |

**Nothing here is a Calimero or rc.19 defect.** Every gap is in this app.

---

## 1. You were never looking at the 480p route

This is the whole reason it "isn't 480p", and it is three lines.

There are two routes, and they are *deliberately* different (that contrast is the
Task-3 finding):

| Route | Approach | Codec runs | Resolution |
|---|---|---|---|
| `/stream` | 3 | **inside the WASM app** | **64×48 greyscale** |
| `/live` | 2 | in the browser (WebCodecs) | **640×480 H.264** |

And the app sends you to `/stream` every time:

- `app/src/pages/StreamsPage.tsx:139` — `navigate("/stream")` right after creating.
- `app/src/App.tsx` — `path="/"` → `getContextId() ? "/stream" : "/streams"`, so every
  re-entry and reload lands on 64×48 too.

`/live` was only ever reachable by hand-editing the URL, which is exactly what the
automated test does — so the suite "passed at 480p" while the product showed 64×48.
That is the honest version of what happened.

**Fix:** make `/live` the default everywhere, and demote `/stream` to an explicitly
labelled comparison route (keep it — the 64×48 baseline is a measured result and the
approach-3 numbers depend on it).

- `StreamsPage` → `navigate("/live")`
- `App` `path="/"` → `/live` when a context exists
- Keep the existing cross-links between the two, relabelled "Compare: 64×48 in-WASM
  codec".

Do this first and independently. It is the only item that changes what you see
without any new machinery.

---

## 2. The receive loop cannot handle more than one sender

`app/src/hooks/useLiveStream.ts`, in `drain()`:

```js
for (const c of chunks) {
  if (c.track !== 0) continue;        // filters TRACK, never `from`
  if (!decoderRef.current && …) { decoderRef.current = createDecoder({ … }); }
  decoderRef.current?.push({ … });   // ONE decoder, every sender
}
```

`ChunkView` already carries `from` (`logic/src/lib.rs:254`) — the contract does the
right thing and the frontend throws the information away.

With two people streaming, two independent H.264 bitstreams interleave into a single
decoder. Frame N from B is not a valid continuation of frame N−1 from A, so this is
not "slightly wrong": expect a decode error or a smear. It has never been observed
because nothing has ever had two senders.

The UI is 1:1 for the same reason — one `<video>` for local capture, one
`remoteCanvasRef` canvas.

**Fix — per-sender demux:**

- Key decoders by sender: `Map<from, DecoderHandle>`, each with its own canvas.
- Key cursors by sender too, so one peer stalling cannot advance another's cursor.
- Render a **tile grid**: local preview plus one tile per remote sender, labelled
  with the member's display name (`get_members()` already returns `Member`).
- Reap a decoder when a sender goes quiet for N seconds, and close it —
  `VideoFrame.close()` / `decoder.close()` discipline matters here; leaking frames
  stalls the pipeline after a handful (already learned once on the single-peer path).
- Per-sender probe stats, so §4 numbers stay attributable rather than averaged into
  meaninglessness.

---

## 3. The contract's chunk state is global — this is why (2) alone isn't enough

`logic/src/lib.rs`:

```
chunks:            UnorderedMap<String, MediaChunk>   // ONE map
next_chunk_seq:    LwwRegister<u64>                   // ONE seq space
last_keyframe_seq: LwwRegister<u64>                   // ONE keyframe pointer
const CHUNK_WINDOW: u64 = 120;                        // ONE window
```

Shared `chunks` and a shared seq space are fine — entries carry `from`. The other two
are not, and both bite specifically at 2+ senders:

**a. `last_keyframe_seq` is whoever keyframed most recently.** `keyframe_cursor()`
returns that single value, and the receive loop starts there. A joiner therefore
starts mid-GOP for *every other* sender and cannot decode them until their next
keyframe — up to `KEYFRAME_INTERVAL_MS` (2 s). It self-heals, but the visible effect
is "the other person's tile is black for two seconds after you join", which reads as
a bug.

**b. The reaper clamps to the global newest keyframe** (`prune_chunks_internal`), so
it can prune peer A's only keyframe while protecting peer B's. A becomes undecodable
for anyone who joins later — until A keyframes again. The clamp does exactly what it
was designed to do; the design just assumed one sender.

**c. The window is shared.** 120 chunks across *all* senders means retention per peer
halves with two and quarters with four. At 15 fps that is ~4 s of history per peer at
two senders. Not fatal, but it makes the tombstone/retention numbers mean something
different than they did in the single-sender measurements — worth stating in the
write-up rather than silently comparing.

**Fix — make the per-sender dimension explicit:**

- `last_keyframe_seq` → a per-sender map: `UnorderedMap<String, u64>` keyed by member.
  Prefer `AuthoredMap` here so only the sender can write their own entry (per-entry
  ownership enforced at merge, `crates/storage/src/collections/authored_map.rs`) — it
  is the right primitive and it prevents one peer clobbering another's keyframe
  pointer.
- `keyframe_cursor()` → `keyframe_cursor_for(from)`, plus a
  `keyframe_cursors() -> Vec<(String, u64)>` so a joiner can seed every sender in one
  round-trip.
- Reaper clamps to `min(all senders' last keyframe)`, so it can never strand any
  sender. Bound the cost: with a per-sender window of `CHUNK_WINDOW` the total grows
  with sender count, which is the honest trade — say so in the write-up rather than
  keeping a fixed global cap that silently degrades per-peer retention.
- Keep the existing C3 tests and add a two-sender variant: prune everything, assert
  **both** senders still have a decodable keyframe. That is the regression that
  matters and the current suite cannot express it.

⚠️ **This changes state layout.** Existing contexts will not carry the new map —
recreate streams rather than migrating, exactly as with the mero-meet clock-skew
change. Bump the bundle and re-publish.

---

## 4. Namespace vs room — the model you actually want

Current `createStream` (`StreamsPage.tsx:102–145`) does namespace → context, skipping
the subgroup entirely.

Vocabulary, kept straight deliberately: **"group" means a subgroup inside a
namespace, never the namespace itself.**

Target:

```
Namespace  = the stream / workspace        ← invite people here
  └── Subgroup ("room")  + Context        ← one video call
  └── Subgroup ("room")  + Context
```

Every API needed already exists on `mero.admin`:

| Step | Call |
|---|---|
| Create the namespace | `createNamespace({ applicationId, upgradePolicy, name })` |
| Member caps | `setDefaultCapabilities(nsId, { defaultCapabilities: 15 })` |
| Create a room | `createGroupInNamespace(namespaceId, request?)` |
| List rooms | `listNamespaceGroups(namespaceId)` → `SubgroupEntry[]` |
| Room's context | `createContext({ applicationId, groupId: <subgroupId>, initializationParams })` |
| Who's in a room | `listGroupMembers(groupId)`, `listGroupContexts(groupId)` |

**Fix:**

- `/streams` becomes **Namespaces** — create / list, and an Invite action.
- New `/streams/:namespaceId` — **Rooms** in that namespace: create / list / join,
  each row showing member count. "Create room" = `createGroupInNamespace` then
  `createContext` with `groupId` set to the new subgroup.
- `/live?context=…` is the call itself.
- Keep `initializationParams` as the JSON bytes of `{name}` — the contract's
  `init(name: String)` is unchanged.
- Make subgroups **OPEN** so an invited namespace member can self-admit into a room
  without a second round of admin approval (see `getSubgroupVisibility`,
  `joinSubgroupInheritance`). This was learned the hard way in mero-blocks/merraria:
  OPEN subgroups plus per-room namespacing is what makes invites actually work.

---

## 5. Invite and join, in the UI

Today only `scripts/dev-invite.sh` can do this, over curl. The app has no path, which
is why two nodes can only be paired by running a script.

APIs:

| Step | Call |
|---|---|
| Invite to namespace | `createNamespaceInvitation(namespaceId, request?)` |
| Accept | `joinNamespace(namespaceId, { … })` |
| Invite to a room | `createGroupInvitation(groupId, request?)` |
| Accept | `joinGroup({ … })` |

**Fix:**

- **Invite** button on a namespace → mint an invitation → render it as copyable text
  **and** a deep link (`/join#invitation=…`). An OPEN invitation carries no invitee
  key, so anyone holding it can join — do **not** send `inviteePublicKey`, it is
  silently ignored and misleads the next reader (learned in `dev-invite.sh`).
- **Join** screen that accepts a pasted invitation or reads the deep link, calls
  `joinNamespace`, then lands on the room list.
- Unwrap the invitation payload until you reach the object carrying
  `inviter_signature` — the join endpoint wants the invitation *object*, not a JSON
  string of it. `dev-invite.sh` already has the working `jq` unwrap; port that logic.
- After joining, confirm the context is actually held (poll
  `getContextIdentitiesOwned`) rather than assuming auto-join landed it, and fall back
  to an explicit `joinContext`. `dev-invite.sh` does exactly this and needs to,
  because auto-follow is not instant.

---

## 6. Two-way call, end to end

Once 1–5 are in, the call itself is small: **both peers press Start.** The send path
is already per-peer (each posts its own chunks); it was only the receive path and the
UI that assumed one sender.

- Both capture and both decode → each sees the other. That is the "Google Meet" shape.
- Layout: local preview small, remote tiles filling the space.
- Mute/stop per peer is just `stop()` — already there.
- **Audio is architecturally free and unbuilt**: track 1 is reserved and tested, but
  nothing opens a mic. Out of scope here; note it so it is not mistaken for missing.

Bandwidth reality check before anyone calls this shippable: one sender at 1.5 Mbps is
~188 KB/s of *permanently stored, tombstone-generating* state. Two senders double the
write rate and double tombstone production, against a shared prune window. Measuring
that is the actual Task-3 question — this work makes the question askable, it does not
answer it.

---

## 7. Test plan

The existing automation is good but structurally blind to all of the above: it drives
`/live` **directly by URL** (so it never exercised the route bug), with **one** sender
(so it never exercised demux), on a **loopback** origin (so it could never catch the
hosted-callback rejection).

- **Extend `app/e2e/browser-call.mjs` to two senders.** Both pages Start. Assert
  *each* page shows a remote tile with 640×480 non-uniform, *changing* pixels — that
  is the check that fails today and would have caught the single-decoder design.
- **Assert the route, not the URL.** Navigate from the picker by clicking, and assert
  you land on 480p. A test that types `/live` cannot catch `navigate("/stream")`.
- **Namespace → room → invite → join, in the browser**, replacing the curl script for
  the happy path. Keep `dev-invite.sh` for setup speed.
- **Contract tests**: two-sender prune leaves *both* senders decodable (the C3
  extension in §3).
- **A non-loopback callback check** remains impossible locally; it needs the hosted
  deployment. Record it as a manual post-deploy step rather than pretending coverage.

---

## Suggested order

1. **§1 route fix** — 3 lines, and you immediately see 480p. Do it alone and confirm.
2. **§3 contract** per-sender keyframes + reaper clamp (recreate streams, republish).
3. **§2 frontend** per-sender demux + tiles.
4. **§6** both-Start two-way call + §7 two-sender e2e — this is where it becomes real.
5. **§4 rooms**, then **§5 invite/join UI** — biggest UX win, no protocol risk.

1 is independent. 2 and 3 are one unit (either alone leaves two-way broken). 4 and 5
can land any time and touch nothing above.

---

## Open questions for you

- **Keep `/stream` (64×48)?** I would: the approach-3 vs approach-2 contrast *is* the
  Task-3 result and the 9.93 ms/frame WASM-CPU number came from it. But it should be
  clearly a comparison route, not the default.
- **Cap the room size?** Every extra sender multiplies write rate and tombstones
  against a shared window. A 2-person cap keeps the probe honest; 4 would need §3's
  per-sender windows to be sized deliberately.
- **Republish under a real key while re-publishing anyway?** §3 forces a bundle bump.
  The currently-published 0.1.1 is signed with the well-known **dev** key, so anyone
  can mint a bundle with the same `signerId` and therefore the same ApplicationId.
  Rotating changes the app id, so it is a deliberate break — but this is the natural
  moment to take it.
