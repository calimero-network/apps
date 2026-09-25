/**
 * Pins this implementation to the Rust one, byte for byte.
 *
 * `logic/crates/crypto/vectors.json` is written by the Rust test
 * `vectors_are_current` from fixed seeds. Here the same seeds go through the
 * TypeScript prover, and every ciphertext, proof, digest, partial and count
 * must come out identical — then everything is verified by the TypeScript
 * verifier too. If this fails after a protocol change, regenerate the fixture
 * (`UPDATE_VECTORS=1 cargo test -p mero-vote-crypto --test vectors`) and make
 * both sides agree again; never edit the JSON by hand.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addCt,
  ballotDigest,
  ballotFromWire,
  ballotToWire,
  castBallot,
  combineKeys,
  decodePoint,
  decodeScalar,
  encodePoint,
  encodeScalar,
  hashToScalar,
  makeKeyShare,
  openCount,
  partialDecrypt,
  seededRng,
  verifyBallot,
  verifyKeyShare,
  verifyPartial,
  zeroCt,
  type Rules,
} from "./protocol";

const HERE = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(resolve(HERE, "..", "..", "..", "logic", "crates", "crypto", "vectors.json"), "utf8"),
);
const enc = new TextEncoder();

describe("cross-implementation vectors", () => {
  it("hashes and draws randomness identically", () => {
    const h = V.hash_to_scalar;
    expect(encodeScalar(hashToScalar(h.domain, h.parts.map((p: string) => enc.encode(p))))).toBe(h.scalar);
    const rng = seededRng(V.rng_seed);
    expect([rng(), rng(), rng()].map(encodeScalar)).toEqual(V.rng_first_three);
  });

  it("reproduces the key ceremony", () => {
    for (const s of V.shares) {
      const rng = seededRng(s.seed);
      const x = rng();
      expect(encodeScalar(x)).toBe(s.secret);
      const [h, proof] = makeKeyShare(V.poll_id, s.trustee, x, rng);
      expect(encodePoint(h)).toBe(s.share);
      expect({ c: encodeScalar(proof.c), z: encodeScalar(proof.z) }).toEqual(s.proof);
      expect(verifyKeyShare(V.poll_id, s.trustee, h, proof)).toBe(true);
    }
    const pk = combineKeys(V.shares.map((s: { share: string }) => decodePoint(s.share)));
    expect(encodePoint(pk)).toBe(V.election_key);
  });

  it("reproduces every ballot, digest, partial and count", () => {
    const pk = decodePoint(V.election_key);
    const rules: Rules = V.rules;
    let agg = Array.from({ length: rules.options }, zeroCt);
    for (const b of V.ballots) {
      const ballot = castBallot(pk, V.poll_id, b.voter, rules, b.selection, seededRng(b.seed));
      expect(ballotToWire(ballot)).toEqual(b.ballot);
      expect(ballotDigest(V.poll_id, b.voter, ballot)).toBe(b.digest);
      // And the Rust-made one verifies here.
      const theirs = ballotFromWire(b.ballot);
      expect(() => verifyBallot(pk, V.poll_id, b.voter, rules, theirs)).not.toThrow();
      expect(() => verifyBallot(pk, V.poll_id, "someone-else", rules, theirs)).toThrow();
      agg = agg.map((ct, j) => addCt(ct, theirs.choices[j]!.ct));
    }
    expect(agg.map((c) => ({ a: encodePoint(c.a), b: encodePoint(c.b) }))).toEqual(V.aggregate);

    const masks: ReturnType<typeof decodePoint>[][] = agg.map(() => []);
    V.partials.forEach((p: { trustee: string; seed: string; options: { d: string; proof: { c: string; z: string } }[] }, t: number) => {
      const x = decodeScalar(V.shares[t].secret);
      const share = decodePoint(V.shares[t].share);
      const rng = seededRng(p.seed);
      agg.forEach((ct, j) => {
        const [d, proof] = partialDecrypt(V.poll_id, p.trustee, j, x, ct.a, rng);
        expect(encodePoint(d)).toBe(p.options[j]!.d);
        expect({ c: encodeScalar(proof.c), z: encodeScalar(proof.z) }).toEqual(p.options[j]!.proof);
        expect(verifyPartial(V.poll_id, p.trustee, j, share, ct.a, d, proof)).toBe(true);
        masks[j]!.push(d);
      });
    });
    expect(agg.map((ct, j) => openCount(ct, masks[j]!, V.ballots.length))).toEqual(V.counts);
  });
});
