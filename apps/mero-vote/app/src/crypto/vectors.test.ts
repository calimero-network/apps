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
  complaintIsValid,
  deal,
  dealingFromWire,
  dealingToWire,
  decodePoint,
  decodeScalar,
  encodePoint,
  encodeScalar,
  hashToScalar,
  jointKey,
  lagrangeAtZero,
  makeComplaint,
  makeTransportKey,
  openCount,
  openShare,
  partialDecrypt,
  seededRng,
  verificationKey,
  verifyBallot,
  verifyDealing,
  verifyPartial,
  verifyTransportKey,
  zeroCt,
  type Point,
  type Rules,
} from "./protocol";

const HERE = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(resolve(HERE, "..", "..", "..", "logic", "crates", "crypto", "vectors.json"), "utf8"),
);
const enc = new TextEncoder();
const br = (b: { c: bigint; z: bigint }) => ({ c: encodeScalar(b.c), z: encodeScalar(b.z) });

describe("cross-implementation vectors", () => {
  it("hashes, draws randomness and interpolates identically", () => {
    const h = V.hash_to_scalar;
    expect(encodeScalar(hashToScalar(h.domain, h.parts.map((p: string) => enc.encode(p))))).toBe(h.scalar);
    const rng = seededRng(V.rng_seed);
    expect([rng(), rng(), rng()].map(encodeScalar)).toEqual(V.rng_first_three);
    const set: number[] = V.lagrange.set;
    expect(set.map((i) => encodeScalar(lagrangeAtZero(i, set)))).toEqual(V.lagrange.coefficients);
  });

  it("reproduces the key ceremony", () => {
    const keys: Point[] = [];
    for (const t of V.transport) {
      const rng = seededRng(t.seed);
      const e = rng();
      expect(encodeScalar(e)).toBe(t.secret);
      const [key, proof] = makeTransportKey(V.poll_id, t.trustee, e, rng);
      expect(encodePoint(key)).toBe(t.key);
      expect(br(proof)).toEqual(t.proof);
      expect(verifyTransportKey(V.poll_id, t.trustee, key, proof)).toBe(true);
      keys.push(key);
    }
    const dealings = V.dealings.map((d: { dealer: string; seed: string; dealing: unknown }) => {
      const mine = deal(V.poll_id, d.dealer, V.threshold, keys, seededRng(d.seed));
      expect(dealingToWire(mine)).toEqual(d.dealing);
      expect(() => verifyDealing(V.poll_id, d.dealer, V.threshold, V.trustees.length, mine)).not.toThrow();
      return mine;
    });
    expect(encodePoint(jointKey(dealings))).toBe(V.election_key);
    V.trustees.forEach((_: string, j: number) => {
      const e = decodeScalar(V.transport[j].secret);
      const x = dealings.reduce(
        (acc: bigint, d: ReturnType<typeof deal>, i: number) => acc + openShare(V.poll_id, V.trustees[i], j + 1, e, d)!,
        0n,
      );
      expect(encodeScalar(x)).toBe(V.combined_secrets[j]);
      expect(encodePoint(verificationKey(dealings, j + 1))).toBe(V.verification_keys[j]);
    });
  });

  it("reproduces and adjudicates the complaint", () => {
    const c = V.complaint;
    const d = dealingFromWire(c.dealing);
    const e = decodeScalar(V.transport[c.index - 1].secret);
    expect(openShare(V.poll_id, c.dealer, c.index, e, d)).toBeNull();
    const rng = seededRng(c.seed);
    // The fixture's rng was also used to deal first: t coefficients, a nonce, one k per trustee.
    for (let i = 0; i < V.threshold + 1 + V.trustees.length; i++) rng();
    const [secret, proof] = makeComplaint(V.poll_id, c.recipient, c.dealer, c.index, e, d, rng);
    expect(encodePoint(secret)).toBe(c.secret);
    expect(br(proof)).toEqual(c.proof);
    const key = decodePoint(V.transport[c.index - 1].key);
    expect(complaintIsValid(V.poll_id, c.recipient, c.dealer, c.index, key, d, secret, proof)).toBe(true);
    expect(complaintIsValid(V.poll_id, c.recipient, c.dealer, c.index, decodePoint(V.transport[0].key), d, secret, proof)).toBe(false);
  });

  it("reproduces every ballot, digest, partial and count", () => {
    const pk = decodePoint(V.election_key);
    const rules: Rules = V.rules;
    let agg = Array.from({ length: rules.options }, zeroCt);
    for (const b of V.ballots) {
      const ballot = castBallot(pk, V.poll_id, b.voter, rules, b.selection, seededRng(b.seed));
      expect(ballotToWire(ballot)).toEqual(b.ballot);
      expect(ballotDigest(V.poll_id, b.voter, ballot)).toBe(b.digest);
      const theirs = ballotFromWire(b.ballot);
      expect(() => verifyBallot(pk, V.poll_id, b.voter, rules, theirs)).not.toThrow();
      expect(() => verifyBallot(pk, V.poll_id, "someone-else", rules, theirs)).toThrow();
      agg = agg.map((ct, j) => addCt(ct, theirs.choices[j]!.ct));
    }
    expect(agg.map((c) => ({ a: encodePoint(c.a), b: encodePoint(c.b) }))).toEqual(V.aggregate);

    const picked: [number, Point][][] = agg.map(() => []);
    for (const p of V.partials) {
      const x = decodeScalar(V.combined_secrets[p.index - 1]);
      const vkey = decodePoint(V.verification_keys[p.index - 1]);
      const rng = seededRng(p.seed);
      agg.forEach((ct, j) => {
        const [d, proof] = partialDecrypt(V.poll_id, p.trustee, j, x, ct.a, rng);
        expect(encodePoint(d)).toBe(p.options[j].d);
        expect(br(proof)).toEqual(p.options[j].proof);
        expect(verifyPartial(V.poll_id, p.trustee, j, vkey, ct.a, d, proof)).toBe(true);
        picked[j]!.push([p.index, d]);
      });
    }
    expect(agg.map((ct, j) => openCount(ct, picked[j]!, V.ballots.length))).toEqual(V.counts);
  });
});
