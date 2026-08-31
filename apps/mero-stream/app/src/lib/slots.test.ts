import { describe, expect, it } from "vitest";
import {
  CLAIM_BACKDATE_GRACE_MS,
  DEGRADED_DELIVERY_PERCENT,
  DEGRADED_FROM_BROADCASTERS,
  MAX_BROADCASTERS,
  compareClaims,
  effectiveStart,
  evaluateSlots,
  rankClaims,
  type Claim,
} from "./slots";

const T = 6000; // PEER_TIMEOUT_MS
const NOW = 1_700_000_000_000;

/**
 * A claim from an HONEST peer: it says it started when we first saw it, which is
 * what an honest client's header actually carries (within propagation delay). The
 * backdate floor is a no-op for these, which is the property that keeps the
 * ranking convergent — see `effectiveStart`.
 */
const claim = (id: string, startedAtMs: number, lastSeenAt = NOW): Claim => ({
  id,
  startedAtMs,
  firstSeenAt: startedAtMs,
  lastSeenAt,
});

/** A claim that BACKDATES itself — a spoofed `startedAtMs` from a modified client. */
const spoofed = (
  id: string,
  claimedStartedAtMs: number,
  firstSeenAt: number,
): Claim => ({
  id,
  startedAtMs: claimedStartedAtMs,
  firstSeenAt,
  lastSeenAt: NOW,
});

describe("compareClaims", () => {
  it("orders by start time, earliest first", () => {
    expect(compareClaims(claim("b", 100), claim("a", 200))).toBeLessThan(0);
  });

  it("breaks an exact tie on member id so the order is TOTAL", () => {
    // Load-bearing: two peers must never disagree about the ranking, and
    // simultaneous starts are exactly when they would.
    expect(compareClaims(claim("a", 100), claim("b", 100))).toBeLessThan(0);
    expect(compareClaims(claim("b", 100), claim("a", 100))).toBeGreaterThan(0);
    expect(compareClaims(claim("a", 100), claim("a", 100))).toBe(0);
  });

  it("is a stable total order over a whole set regardless of input order", () => {
    const set = [
      claim("d", 100),
      claim("a", 100),
      claim("c", 50),
      claim("b", 200),
    ];
    const forward = [...set].sort(compareClaims).map((c) => c.id);
    const backward = [...set]
      .reverse()
      .sort(compareClaims)
      .map((c) => c.id);
    expect(forward).toEqual(["c", "a", "d", "b"]);
    expect(backward).toEqual(forward);
  });
});

describe("rankClaims", () => {
  it("drops claims older than the timeout", () => {
    const ranked = rankClaims(
      [claim("live", 10, NOW - 1000), claim("gone", 5, NOW - T - 1)],
      NOW,
      T,
    );
    expect(ranked.map((c) => c.id)).toEqual(["live"]);
  });

  it("keeps a claim exactly AT the cutoff", () => {
    // Inclusive, matching the receive loop's own reaper (`lastSeenAt >= cutoff`).
    expect(rankClaims([claim("x", 1, NOW - T)], NOW, T)).toHaveLength(1);
  });
});

describe("evaluateSlots", () => {
  // An EXPLICIT cap, not MAX_BROADCASTERS. These tests are about the ranking and
  // yield logic, and pinning them to the shipped constant made them fail the
  // moment a real measurement moved it from 4 to 2 — a change to a number that
  // has nothing to do with what they check. The shipped value has its own test
  // below.
  const CAP = 4;
  const base = { me: "me", nowMs: NOW, timeoutMs: T, max: CAP };

  it("a lone spectator may claim", () => {
    const v = evaluateSlots({ ...base, others: [], myStartedAtMs: null });
    expect(v.occupied).toBe(0);
    expect(v.free).toBe(CAP);
    expect(v.mayClaim).toBe(true);
    expect(v.mustYield).toBe(false);
    expect(v.myRank).toBeNull();
  });

  it("counts remote broadcasters and still lets us in below the cap", () => {
    const v = evaluateSlots({
      ...base,
      others: [claim("a", 1), claim("b", 2), claim("c", 3)],
      myStartedAtMs: null,
    });
    expect(v.occupied).toBe(3);
    expect(v.free).toBe(1);
    expect(v.full).toBe(false);
    expect(v.mayClaim).toBe(true);
  });

  it("refuses a claim once the cap is full", () => {
    const v = evaluateSlots({
      ...base,
      others: [claim("a", 1), claim("b", 2), claim("c", 3), claim("d", 4)],
      myStartedAtMs: null,
    });
    expect(v.full).toBe(true);
    expect(v.free).toBe(0);
    expect(v.mayClaim).toBe(false);
    // Not yielding: we were never broadcasting. The two states are distinct and
    // the UI says different things for them.
    expect(v.mustYield).toBe(false);
  });

  it("keeps us broadcasting when we started before the others", () => {
    const v = evaluateSlots({
      ...base,
      others: [claim("a", 500), claim("b", 600), claim("c", 700)],
      myStartedAtMs: 100,
    });
    expect(v.myRank).toBe(0);
    expect(v.occupied).toBe(4);
    expect(v.mustYield).toBe(false);
    expect(v.mayClaim).toBe(false); // already broadcasting
  });

  it("YIELDS when four peers all started before us", () => {
    const v = evaluateSlots({
      ...base,
      others: [claim("a", 1), claim("b", 2), claim("c", 3), claim("d", 4)],
      myStartedAtMs: 5,
    });
    expect(v.myRank).toBe(4);
    expect(v.mustYield).toBe(true);
    expect(v.overflow.map((c) => c.id)).toEqual(["me"]);
    // The readout must not say 5/4 while an overflowing peer is on its way out.
    expect(v.occupied).toBe(CAP);
  });

  it("resolves a simultaneous claim for the last slot deterministically", () => {
    // Both clients see three holders and claim; both then observe five claims.
    // The rule has to make exactly one of them yield, from either point of view.
    const three = [claim("a", 1), claim("b", 2), claim("c", 3)];
    const alice = { id: "alice", startedAtMs: 900 };
    const bob = { id: "bob", startedAtMs: 900 }; // same instant

    const fromAlice = evaluateSlots({
      ...base,
      me: alice.id,
      others: [...three, claim(bob.id, bob.startedAtMs)],
      myStartedAtMs: alice.startedAtMs,
    });
    const fromBob = evaluateSlots({
      ...base,
      me: bob.id,
      others: [...three, claim(alice.id, alice.startedAtMs)],
      myStartedAtMs: bob.startedAtMs,
    });

    // "alice" < "bob", so alice keeps the slot and bob yields — and crucially
    // BOTH clients reach that same conclusion from their own vantage point.
    expect(fromAlice.mustYield).toBe(false);
    expect(fromBob.mustYield).toBe(true);
    expect(fromAlice.ranked.map((c) => c.id)).toEqual(
      fromBob.ranked.map((c) => c.id),
    );
  });

  it("frees a slot when a broadcaster goes quiet", () => {
    const v = evaluateSlots({
      ...base,
      others: [
        claim("a", 1),
        claim("b", 2),
        claim("c", 3),
        claim("d", 4, NOW - T - 1), // stopped sending
      ],
      myStartedAtMs: null,
    });
    expect(v.occupied).toBe(3);
    expect(v.mayClaim).toBe(true);
  });

  it("stops yielding once an earlier broadcaster leaves", () => {
    // The client is 5th while four peers are live...
    const others = [claim("a", 1), claim("b", 2), claim("c", 3), claim("d", 4)];
    expect(evaluateSlots({ ...base, others, myStartedAtMs: 5 }).mustYield).toBe(
      true,
    );
    // ...and holds a slot the moment one of them goes quiet.
    const after = evaluateSlots({
      ...base,
      others: [...others.slice(0, 3), claim("d", 4, NOW - T - 1)],
      myStartedAtMs: 5,
    });
    expect(after.mustYield).toBe(false);
    expect(after.myRank).toBe(3);
  });

  it("ignores our own echoed claim instead of ranking us twice", () => {
    // The node echoes our own presence slices back to us. Counting both copies
    // would let us out-compete ourselves for the last slot.
    const v = evaluateSlots({
      ...base,
      others: [claim("a", 1), claim("b", 2), claim("c", 3), claim("me", 4)],
      myStartedAtMs: 4,
    });
    expect(v.ranked).toHaveLength(4);
    expect(v.ranked.filter((c) => c.id === "me")).toHaveLength(1);
    expect(v.mustYield).toBe(false);
  });

  it("never ages out our OWN claim, however stale the ranking clock", () => {
    // Our claim is live by definition — we are the one publishing it — so a
    // receive-side timeout must not apply to it.
    const v = evaluateSlots({
      ...base,
      others: [],
      myStartedAtMs: NOW - 10 * T,
    });
    expect(v.myRank).toBe(0);
    expect(v.occupied).toBe(1);
  });

  it("honours a lower cap, so the constant is not baked into the logic", () => {
    const v = evaluateSlots({
      ...base,
      others: [claim("a", 1)],
      myStartedAtMs: null,
      max: 1,
    });
    expect(v.full).toBe(true);
    expect(v.mayClaim).toBe(false);
  });

  it("defaults to MAX_BROADCASTERS when no cap is passed", () => {
    const others = Array.from({ length: MAX_BROADCASTERS }, (_, i) =>
      claim(`p${i}`, i + 1),
    );
    const v = evaluateSlots({
      me: "me",
      nowMs: NOW,
      timeoutMs: T,
      others,
      myStartedAtMs: null,
    });
    expect(v.full).toBe(true);
    expect(v.mayClaim).toBe(false);
  });

  it("works with no member id yet (session not up)", () => {
    const v = evaluateSlots({
      ...base,
      me: null,
      others: [claim("a", 1)],
      myStartedAtMs: null,
    });
    expect(v.occupied).toBe(1);
    expect(v.myRank).toBeNull();
    expect(v.mustYield).toBe(false);
  });
});

describe("MAX_BROADCASTERS", () => {
  it("is the MEASURED cap, and changing it is a deliberate act", () => {
    // 2 comes from workflows/e2e-capacity-ladder.yml on four real nodes: 96%
    // frame delivery at one broadcaster, 43% at two at full rate, 22% at three —
    // and 61-70% at two even after sharing the publish budget, which is the
    // measurement that ruled out a client-side fix. The bandwidth arithmetic in
    // slots.ts allows 4 and was wrong by 2x, so this guard makes raising it
    // require a new measurement rather than an argument.
    expect(MAX_BROADCASTERS).toBe(2);
  });

  it("is at least 2, or the multi-party feature does not exist", () => {
    expect(MAX_BROADCASTERS).toBeGreaterThanOrEqual(2);
  });
});

describe("effectiveStart (the backdate floor)", () => {
  it("returns an honest claim unchanged, so the ranking stays convergent", () => {
    // Load-bearing: if the floor altered honest values, peers would compare
    // locally-derived numbers and could disagree about how many hold slots.
    const c = claim("a", NOW - 5_000);
    expect(effectiveStart(c)).toBe(NOW - 5_000);
  });

  it("floors a backdated claim at first sighting minus the grace window", () => {
    // The attack: publish `startedAtMs: 0` in every frame and outrank everyone
    // forever. Without the floor this returns 0.
    const c = spoofed("attacker", 0, NOW);
    expect(effectiveStart(c)).toBe(NOW - CLAIM_BACKDATE_GRACE_MS);
  });

  it("leaves a claim inside the grace window alone", () => {
    const c = spoofed("a", NOW - CLAIM_BACKDATE_GRACE_MS + 1_000, NOW);
    expect(effectiveStart(c)).toBe(NOW - CLAIM_BACKDATE_GRACE_MS + 1_000);
  });

  it("does not floor OUR own long-running broadcast", () => {
    // We know when we started, so `firstSeenAt` is that same instant and the
    // floor can never move it — however long we have been live.
    const mine: Claim = {
      id: "me",
      startedAtMs: NOW - 10 * 60_000,
      firstSeenAt: NOW - 10 * 60_000,
      lastSeenAt: NOW,
    };
    expect(effectiveStart(mine)).toBe(NOW - 10 * 60_000);
  });
});

describe("a spoofed startedAtMs cannot squat a slot", () => {
  const base = { me: "me", nowMs: NOW, timeoutMs: T, max: 2 };

  it("does not let a backdating peer outrank an established broadcaster", () => {
    // Alice has genuinely been live for 5 minutes. The attacker claims epoch 0
    // and we first saw it a moment ago. Ranking on the raw claim would put the
    // attacker first; the floor puts it behind Alice.
    const alice = claim("alice", NOW - 5 * 60_000);
    const attacker = spoofed("attacker", 0, NOW - 500);
    const ranked = rankClaims([attacker, alice], NOW, T);
    expect(ranked.map((c) => c.id)).toEqual(["alice", "attacker"]);
  });

  it("does not displace an incumbent from the incumbent's own vantage point", () => {
    // The right thing to assert, and the reason it is phrased this way:
    //
    // A client that spoofs its own `startedAtMs` also controls its own copy of
    // this function, so what IT concludes about itself is not something any
    // design can constrain — asserting that an attacker's client chooses to
    // yield would be asserting on the attacker's goodwill.
    //
    // What the floor actually buys is that HONEST clients do not hand the slot
    // over. Bob is second of two holders and is the one at risk of being pushed
    // out; with the raw claim the attacker would rank first and Bob would yield.
    const v = evaluateSlots({
      ...base,
      me: "bob",
      others: [claim("alice", NOW - 60_000), spoofed("attacker", 0, NOW - 100)],
      myStartedAtMs: NOW - 30_000,
    });
    expect(v.mustYield).toBe(false);
    expect(v.holders.map((c) => c.id)).toEqual(["alice", "bob"]);
    expect(v.overflow.map((c) => c.id)).toEqual(["attacker"]);
  });

  it("does not make an honest late joiner yield to a backdating peer", () => {
    // The honest peer's own claim is true and unfloored; the attacker's is
    // floored to roughly now. So the honest peer keeps its slot.
    const attacker = spoofed("attacker", 0, NOW - 200);
    const v = evaluateSlots({
      ...base,
      max: 1,
      me: "me",
      others: [attacker],
      myStartedAtMs: NOW - 60_000,
    });
    expect(v.mustYield).toBe(false);
    expect(v.myRank).toBe(0);
  });

  it("still admits exactly MAX holders when a spoofer is present", () => {
    // The floor must not accidentally change HOW MANY hold slots — only who.
    const v = evaluateSlots({
      ...base,
      others: [claim("a", NOW - 9_000), spoofed("attacker", 0, NOW - 100)],
      myStartedAtMs: null,
    });
    expect(v.occupied).toBe(2);
    expect(v.full).toBe(true);
  });
});

describe("the measured constants the UI quotes", () => {
  it("pins the degradation onset, which is NOT the same thing as the cap", () => {
    // Deliberately separate: one is where the measurement says quality falls off,
    // the other is where the app refuses another sender. They are equal today and
    // need not move together — a banner keyed on the cap would go quiet at
    // exactly the count measured as bad if the cap were ever raised.
    expect(DEGRADED_FROM_BROADCASTERS).toBe(2);
    expect(DEGRADED_FROM_BROADCASTERS).toBeLessThanOrEqual(MAX_BROADCASTERS);
  });

  it("pins the delivery percentage the banner shows the user", () => {
    // The banner quotes a measurement. A measurement typed into prose goes stale
    // silently, so it comes from this constant and this test makes re-running the
    // ladder touch one place.
    expect(DEGRADED_DELIVERY_PERCENT).toBe(60);
    // Sanity, so a typo cannot pass: it is a percentage of frames arriving, and
    // it must be worse than healthy and better than useless.
    expect(DEGRADED_DELIVERY_PERCENT).toBeGreaterThan(0);
    expect(DEGRADED_DELIVERY_PERCENT).toBeLessThan(96);
  });
});
