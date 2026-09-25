import { describe, expect, it } from "vitest";
import {
  ballotFromWire,
  ballotToWire,
  castBallot,
  decodePoint,
  decodeScalar,
  encodePoint,
  encrypt,
  makeKeyShare,
  BASE,
  proveMembership,
  secureRng,
  seededRng,
  verifyBallot,
  verifyKeyShare,
  verifyMembership,
} from "./protocol";

const G = BASE;

describe("protocol", () => {
  it("round-trips a ballot made with real randomness", () => {
    const pk = G.multiply(secureRng());
    const rules = { options: 4, min: 0, max: 2 };
    const ballot = castBallot(pk, "poll", "voter", rules, [true, false, true, false], secureRng);
    const back = ballotFromWire(JSON.parse(JSON.stringify(ballotToWire(ballot))));
    expect(() => verifyBallot(pk, "poll", "voter", rules, back)).not.toThrow();
  });

  it("refuses an over-vote and a tampered ciphertext", () => {
    const pk = G.multiply(7n);
    const rng = seededRng("t");
    const r = rng();
    const ct = encrypt(pk, 2n, r);
    const proof = proveMembership("choice", [], pk, ct, [0n, 1n], 1, r, rng);
    expect(verifyMembership("choice", [], pk, ct, [0n, 1n], proof)).toBe(false);

    const rules = { options: 2, min: 1, max: 1 };
    const ballot = castBallot(pk, "p", "v", rules, [true, false], rng);
    ballot.choices[0]!.ct.b = ballot.choices[0]!.ct.b.add(G);
    expect(() => verifyBallot(pk, "p", "v", rules, ballot)).toThrow();
  });

  it("rejects selections outside the bounds before proving", () => {
    const pk = G.multiply(5n);
    expect(() => castBallot(pk, "p", "v", { options: 3, min: 1, max: 1 }, [true, true, false], secureRng)).toThrow();
  });

  it("binds a key share to its trustee", () => {
    const [h, p] = makeKeyShare("poll", "t1", 42n, seededRng("k"));
    expect(verifyKeyShare("poll", "t1", h, p)).toBe(true);
    expect(verifyKeyShare("poll", "t2", h, p)).toBe(false);
  });

  it("only accepts canonical encodings", () => {
    expect(encodePoint(decodePoint(encodePoint(G)))).toBe(encodePoint(G));
    expect(() => decodePoint("ff".repeat(32))).toThrow();
    expect(() => decodeScalar("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010")).toThrow();
  });
});
