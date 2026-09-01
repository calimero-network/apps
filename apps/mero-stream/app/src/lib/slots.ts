// ── Broadcaster slots ─────────────────────────────────────────────────────────
//
// A call has many participants and a bounded number of simultaneous
// BROADCASTERS. Everyone else is a spectator: they decode every broadcaster and
// cannot publish their own camera.
//
// Why a cap exists at all — the arithmetic, not a vibe.
//
// core runs gossipsub with `flood_publish(true)` and `mesh_n = 4`
// (`core/crates/network/{src/behaviour.rs,primitives/src/config.rs}`). A
// publisher therefore sends its own message to EVERY subscribed peer directly,
// while forwarding of other people's messages follows the mesh, to
// `min(N-1, 4) - 1` peers. Receivers dedupe, but the duplicate bytes are already
// on the wire. So, per node, with N participants and S broadcasters at BITRATE
// each:
//
//   upstream = BITRATE * [ (broadcasting ? N-1 : 0) + S_others * max(0, min(N-1,4)-1) ]
//
// At 1.5 Mbps that is:
//
//     N   S    broadcaster up    spectator up
//     2   2       1.5 Mbps            —
//     3   3       6   Mbps         3   Mbps
//     4   4      13.5 Mbps         9   Mbps
//     5   4      19.5 Mbps        18   Mbps
//     6   4      21   Mbps        18   Mbps
//     8   4      24   Mbps        18   Mbps
//
// Two non-obvious consequences:
//
//   * The forwarding term STOPS GROWING at N >= 5, because `mesh_n` caps it.
//     Only the flood-publish term grows, and only for broadcasters. So
//     spectators are cheap to ADD; each extra participant taxes every
//     broadcaster another BITRATE.
//   * A spectator is not cheap in absolute terms — 18 Mbps up at S=4, nearly a
//     broadcaster's cost — because gossipsub makes every node a relay. Being a
//     spectator saves the camera, the encoder and the send loop. It does not
//     save upstream.
//
// S=4 puts a broadcaster at ~20 Mbps up, which fits a typical cable/fibre uplink
// and not a typical DSL one. So bandwidth alone would allow 4.
//
// ⚠️ IT DOES NOT. All of the above is an UPPER bound, and the measured cap is
// HALF of it — see MAX_BROADCASTERS below for the four-node run that settled it.
// Bandwidth is simply not the binding constraint; frame loss on the LWW presence
// register is. Keep the arithmetic because it still bounds what is worth trying,
// and never treat it as the answer on its own.
//
// ⚠️ That is all for DIRECTLY connected peers. Behind a relay the whole call
// crosses one circuit — `S * N * BITRATE`, i.e. 36 Mbps at S=4/N=6 — which is
// exactly the "Remote reported resource limit exceeded" collapse recorded in the
// 2026-08-07 cross-network retro. Behind a relay the real cap is 2. The browser
// cannot detect that (libp2p transport state is not exposed to the app), so the
// only defence is the publish-latency congestion controller in ./congestion.ts.
//
// ── What this module is NOT ───────────────────────────────────────────────────
//
// It is a COOPERATIVE cap, not an enforced one, and the distinction matters:
//
//   * A client only ever stops ITSELF. `evaluateSlots` returns `mustYield` for
//     the caller and nothing else — there is no path by which one participant
//     silences another. That is what makes a cooperative rule safe to ship: a
//     buggy or hostile peer produces "5 broadcasters for a while", never
//     "someone got kicked".
//   * A modified client can ignore the cap entirely. The node cannot help: on
//     the ephemeral-presence transport the media never enters the runtime, so
//     there is no contract call to reject. Real enforcement would need either a
//     contract `claim_slot` mutation (a DAG write per claim, plus a round-trip
//     before the first frame) or core-side per-context author admission.
//
// Everything here is pure so the interesting cases — a simultaneous claim, a
// broadcaster going quiet, a skewed clock — are unit-testable with no node, no
// camera and no React.

/**
 * Simultaneous broadcasters allowed.
 *
 * **2, and it is a MEASUREMENT with a known cost.** The bandwidth arithmetic
 * above allows 4; four real nodes said otherwise and the run wins. See the
 * measured table in ./capacity.ts — 96% frame delivery at one broadcaster, 43%
 * at two, 22% at three.
 *
 * ⚠️ **A second broadcaster costs roughly 40% of its frames, and nothing on the
 * client fixes that.** The obvious remedy — share the publish budget so two
 * broadcasters put the same aggregate rate on the wire as one — was implemented,
 * measured, and DISPROVED: at the same aggregate rate delivery reached 61-70%,
 * not 96%. Concurrent author count is the variable, not rate, so whatever costs
 * the frames is per-author inside the node's inbound path and out of reach from
 * here. It is a core-side follow-up.
 *
 * So why 2 rather than 1? Because 2 at ~60% delivery is a usable call — roughly
 * 8 of 13 frames arriving still reads as video for a talking head — and the app
 * says so on screen rather than pretending otherwise. 3 measured 22%, which does
 * not. If the core-side cause is found and fixed, this is the constant to raise,
 * and the ladder is how to justify it.
 *
 * Deliberately a constant and not a setting: it is a property of the transport,
 * not a user preference, and a call where participants believe in different caps
 * does not converge.
 */
export const MAX_BROADCASTERS = 2;

/**
 * How far before our FIRST SIGHTING of a sender we will believe its claimed
 * start time. See {@link effectiveStart}.
 *
 * **This window is exactly the fake seniority a spoofing client retains, so it is
 * deliberately small.** An earlier draft used 30 s on the reasoning that a
 * generous window is safer; the opposite is true, and a test caught it — with 30 s
 * a backdating peer still outranked an honest broadcaster that had held its slot
 * for 30 s, which is the whole attack the floor exists to stop.
 *
 * The honest requirement it has to cover is small: the gap between a sender
 * genuinely starting and us first seeing a frame from them. On this transport
 * that is bounded by the keyframe interval — presence has no backlog, so a
 * receiver cannot decode a sender until its next keyframe, at most
 * KEYFRAME_INTERVAL_MS (2 s) away — plus gossip propagation. 5 s covers that with
 * room to spare.
 *
 * The residual is a genuine race and worth naming: a spoofer can still displace
 * someone who started within 5 s of the spoofer's own arrival. Two honest peers
 * starting within 5 s of each other is already resolved arbitrarily by clock
 * skew, so this does not create a new class of unfairness — it bounds an
 * unbounded one.
 */
export const CLAIM_BACKDATE_GRACE_MS = 5_000;

/**
 * Broadcaster count at which delivery is measurably degraded.
 *
 * Separate from {@link MAX_BROADCASTERS} on purpose, and not a duplicate of it:
 * this is where the MEASUREMENT says quality falls off (96% delivered at one
 * sender, ~43-70% at two), while the cap is where the app refuses to add another.
 * They happen to be the same number today. If the core-side cause is fixed and
 * the cap is raised, the degradation onset does NOT automatically move with it —
 * a banner keyed on the cap would then go quiet at exactly the count that was
 * measured as bad.
 *
 * The percentage the UI quotes alongside this lives in
 * {@link DEGRADED_DELIVERY_PERCENT}, so the two cannot drift apart.
 */
export const DEGRADED_FROM_BROADCASTERS = 2;

/**
 * Frames actually delivered, as a percentage, at {@link DEGRADED_FROM_BROADCASTERS}
 * broadcasters — from the four-node ladder (43% at full rate, 61-70% with the rate
 * shared, so ~60% is the honest round number for the shipped configuration).
 *
 * A constant rather than a number typed into the banner: the copy quotes a
 * measurement, and a measurement typed into prose goes stale silently. Re-running
 * the ladder now has one place to update, and the banner follows.
 */
export const DEGRADED_DELIVERY_PERCENT = 60;

/** One participant currently publishing media. */
export interface Claim {
  /** Member id (the ephemeral-presence author). */
  id: string;
  /**
   * Unix ms at which this participant began its current broadcast, AS CLAIMED BY
   * THAT PARTICIPANT. Constant for the run; carried in every frame header. See
   * ephemeralFrames.ts — and note it is remote input, not a fact.
   */
  startedAtMs: number;
  /** Local ms at which we first saw a frame from this sender. */
  firstSeenAt: number;
  /** Local receipt time of their most recent frame, unix ms. */
  lastSeenAt: number;
}

/**
 * The start time actually used for ranking: the claim, floored at our own first
 * sighting minus a grace window.
 *
 * ── Why the claim cannot be trusted raw ──────────────────────────────────────
 *
 * `startedAtMs` arrives in a frame header written by the sender. Ranking on it
 * directly means a modified client can publish `startedAtMs: 0` in every frame,
 * rank first forever, and never be asked to yield — turning the cooperative cap
 * from "someone can over-subscribe" into "someone can deterministically starve
 * every honest broadcaster out of a slot". That is a materially worse failure
 * than the one this module already documents, and the fairness note below only
 * ever reasoned about HONEST clock skew.
 *
 * ── Why a floor, and why this floor ──────────────────────────────────────────
 *
 * Presence has no backlog and no replay: a joiner receives what is being
 * published now, and replayed seed entries (the ones carrying `ageMs`) are
 * dropped before they reach here. So for a sender we are seeing live, a claim
 * more than `CLAIM_BACKDATE_GRACE_MS` older than our first sighting is not
 * something we can verify and not something an honest client needs — and that
 * window is kept tight precisely because it is the advantage a spoofer keeps.
 *
 * **The floor is a no-op in the honest case, which is what keeps the ranking
 * convergent.** An honest claim sits within propagation delay of our first
 * sighting, so `max()` returns the claim unchanged and every peer still compares
 * identical values — the total order, and therefore the agreed slot count,
 * survives exactly as before.
 *
 * ── The residual, stated precisely ───────────────────────────────────────────
 *
 * A peer that joins a call already in progress will floor the incumbents' genuine
 * seniority at its own first sighting, so its view of THEIR relative order can
 * differ from theirs. That is harmless by construction, because no client ever
 * acts on another client's rank — `mustYield` is about the caller only. And the
 * error is in the safe direction: a late joiner sees incumbents as *younger* than
 * they are, which can only make the joiner itself more likely to yield, never
 * less. Under-subscribing is a fairness annoyance; over-subscribing is the
 * capacity bug, and this cannot cause one.
 *
 * It does not make the cap enforceable — nothing client-side can, on a transport
 * where the media never enters the runtime. It removes the deterministic starve.
 */
export function effectiveStart(claim: Claim): number {
  return Math.max(
    claim.startedAtMs,
    claim.firstSeenAt - CLAIM_BACKDATE_GRACE_MS,
  );
}

export interface SlotView {
  /** Active claims, ranked; the first {@link MAX_BROADCASTERS} hold the floor. */
  ranked: Claim[];
  /** Claims that hold a slot. */
  holders: Claim[];
  /** Claims that are publishing but outside the cap, and should be yielding. */
  overflow: Claim[];
  occupied: number;
  free: number;
  full: boolean;
  /** Our own position in `ranked`, or null if we are not broadcasting. */
  myRank: number | null;
  /**
   * True when we are not broadcasting and a slot is available — i.e. whether the
   * "Go live" control should be enabled.
   */
  mayClaim: boolean;
  /**
   * True when we ARE broadcasting but rank outside the cap. The caller stops its
   * own capture; it must never act on this for anyone else.
   */
  mustYield: boolean;
}

/**
 * Total order over broadcasters: earliest start wins, member id breaks a tie.
 *
 * First-come-first-served is the right shape here — a newcomer should not evict
 * someone mid-sentence — and ranking on member id alone would do exactly that,
 * deterministically and forever, to whoever drew a high key.
 *
 * The cost is a dependence on sender wall clocks, and the honest bound is worth
 * stating: a participant whose clock runs behind wins ties it should have lost,
 * and one whose clock runs ahead loses ties it should have won. Skew changes WHO
 * holds a slot; it cannot change HOW MANY do, because every peer applies the
 * same comparator to the same values and the member-id tiebreak makes the order
 * total (so no two peers can disagree, even on identical timestamps). Picking
 * the "wrong" winner under skew is a fairness bug; admitting five broadcasters
 * would be a capacity bug, and this ordering cannot produce one.
 *
 * The skew-free alternative — rank purely by local first-seen time — is worse:
 * each receiver observes a different arrival order, so peers would disagree about
 * the ranking itself and the count would not converge. What is used instead is
 * the claim FLOORED at local first sighting (see {@link effectiveStart}), which
 * is a no-op for honest peers and so keeps the order total and agreed.
 */
export function compareClaims(a: Claim, b: Claim): number {
  const sa = effectiveStart(a);
  const sb = effectiveStart(b);
  if (sa !== sb) return sa - sb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Claims still considered live, ranked. Quiet participants hold nothing. */
export function rankClaims(
  claims: readonly Claim[],
  nowMs: number,
  timeoutMs: number,
): Claim[] {
  const cutoff = nowMs - timeoutMs;
  return claims.filter((c) => c.lastSeenAt >= cutoff).sort(compareClaims);
}

/**
 * Decide this client's own broadcast state.
 *
 * `me` is our member id and `myStartedAtMs` is when we began broadcasting, or
 * null if we are not. We are ranked alongside everyone else rather than treated
 * specially — the ranking has to be the same function on every peer or the
 * outcome does not converge.
 *
 * A claim carrying our own id is dropped from `others` before ranking. The
 * node echoes our own presence slices back to us, so without that we would be
 * ranked twice and could out-compete ourselves for the last slot.
 */
export function evaluateSlots(args: {
  /** Claims observed from the media stream, our own echo included. */
  others: readonly Claim[];
  me: string | null;
  myStartedAtMs: number | null;
  nowMs: number;
  timeoutMs: number;
  max?: number;
}): SlotView {
  const max = args.max ?? MAX_BROADCASTERS;
  const remote = args.me
    ? args.others.filter((c) => c.id !== args.me)
    : args.others;

  const claims: Claim[] = [...remote];
  if (args.me && args.myStartedAtMs !== null) {
    claims.push({
      id: args.me,
      startedAtMs: args.myStartedAtMs,
      // Our OWN claim needs no flooring — we know when we started, so
      // `firstSeenAt` is that same instant and `effectiveStart` returns it
      // unchanged however long we have been broadcasting.
      firstSeenAt: args.myStartedAtMs,
      // Live by definition — we are the one publishing it, so it must not be
      // aged out by a receive-side timeout that never applies.
      lastSeenAt: args.nowMs,
    });
  }

  const ranked = rankClaims(claims, args.nowMs, args.timeoutMs);
  const holders = ranked.slice(0, max);
  const overflow = ranked.slice(max);
  const myRank =
    args.me && args.myStartedAtMs !== null
      ? ranked.findIndex((c) => c.id === args.me)
      : -1;

  const broadcasting = myRank >= 0;
  // Occupancy counts holders, not every claim: an overflowing peer is on its way
  // out and counting it would make the readout say 5/4.
  const occupied = holders.length;

  return {
    ranked,
    holders,
    overflow,
    occupied,
    free: Math.max(0, max - occupied),
    full: occupied >= max,
    myRank: broadcasting ? myRank : null,
    // Not broadcasting: a slot has to be free. Note this reads the same
    // `occupied` a holder does, so two clients CAN both see the last slot free
    // and both claim it. That race is resolved by the ranking a beat later —
    // `mustYield` on the later starter — rather than prevented, because
    // preventing it would need a round-trip and a lock the transport has no
    // room for.
    mayClaim: !broadcasting && occupied < max,
    mustYield: broadcasting && myRank >= max,
  };
}
