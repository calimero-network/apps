/**
 * The browser half of mero-vote's ballot cryptography.
 *
 * A line-for-line mirror of `logic/crates/crypto/src/lib.rs`. The browser
 * encrypts and proves; the contract verifies and tallies; and a member who
 * does not want to trust even their own node can run `verifyTranscript`
 * (./verify.ts) on this code instead. That only works if both implementations
 * agree to the byte, which `vectors.test.ts` enforces against the fixture the
 * Rust test writes: same seeds in, same JSON out.
 *
 * Everything the node sees leaves this file already encrypted. Plaintext
 * selections and trustee secrets never go over the wire.
 *
 * `rng` consumption order is part of the wire format — see each prover, and
 * keep it identical to the Rust.
 */
import { ristretto255 } from "@noble/curves/ed25519.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

const RP = ristretto255.Point;

/**
 * The slice of noble's ristretto point this protocol uses. Declared here
 * rather than taken as `InstanceType<typeof RP>` because that class carries
 * protected members, which `tsc -b` refuses to re-emit in a declaration file.
 */
export interface Point {
  add(other: Point): Point;
  subtract(other: Point): Point;
  multiply(k: bigint): Point;
  multiplyUnsafe(k: bigint): Point;
  equals(other: Point): boolean;
  toBytes(): Uint8Array;
}

export const BASE = RP.BASE as unknown as Point;
export const IDENTITY = RP.ZERO as unknown as Point;

/** The group order ℓ. */
export const L = RP.Fn.ORDER;
const G = BASE;

export const PROTOCOL = "mero-vote/v1/";
export const MAX_OPTIONS = 16;

const utf8 = new TextEncoder();

// ── bytes ───────────────────────────────────────────────────────────────────

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error("bad hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u64le(n: bigint | number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

function bytesToBigLE(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]!);
  return x;
}

function bigToBytesLE(x: bigint, len = 32): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

export const mod = (x: bigint): bigint => ((x % L) + L) % L;

// ── encoding ────────────────────────────────────────────────────────────────

export function encodePoint(p: Point): string {
  return toHex(p.toBytes());
}

/** Canonical decode only — noble rejects a non-canonical ristretto encoding. */
export function decodePoint(s: string, what = "point"): Point {
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error(`${what}: not 32 bytes of hex`);
  try {
    return RP.fromBytes(fromHex(s)) as unknown as Point;
  } catch {
    throw new Error(`${what}: not a valid ristretto255 point`);
  }
}

export function encodeScalar(x: bigint): string {
  return toHex(bigToBytesLE(mod(x)));
}

export function decodeScalar(s: string, what = "scalar"): bigint {
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error(`${what}: not 32 bytes of hex`);
  const x = bytesToBigLE(fromHex(s));
  if (x >= L) throw new Error(`${what}: not a canonical scalar`);
  return x;
}

// ── group helpers ───────────────────────────────────────────────────────────

/** Constant-time multiply for secrets; noble refuses 0, which is the identity. */
function mulSecret(p: Point, k: bigint): Point {
  const x = mod(k);
  return x === 0n ? IDENTITY : p.multiply(x);
}

/** Variable-time multiply for public values (verification). */
function mulPublic(p: Point, k: bigint): Point {
  return p.multiplyUnsafe(mod(k));
}

// ── hashing ─────────────────────────────────────────────────────────────────

function framed(domain: string, parts: Uint8Array[]): Uint8Array {
  const chunks: Uint8Array[] = [utf8.encode(PROTOCOL), utf8.encode(domain), new Uint8Array([0])];
  for (const p of parts) chunks.push(u32le(p.length), p);
  return concat(chunks);
}

export function hashToScalar(domain: string, parts: Uint8Array[]): bigint {
  return mod(bytesToBigLE(sha512(framed(domain, parts))));
}

export function hashToDigest(domain: string, parts: Uint8Array[]): Uint8Array {
  return sha256(framed(domain, parts));
}

export type Rng = () => bigint;

/** Deterministic stream, for tests only. Mirrors `seeded_rng`. */
export function seededRng(seed: Uint8Array | string): Rng {
  const s = typeof seed === "string" ? utf8.encode(seed) : seed;
  let k = 0n;
  return () => hashToScalar("test-rng", [s, u64le(k++)]);
}

/** The browser's rng: 64 uniform bytes reduced mod ℓ (bias < 2⁻²⁵⁰). */
export function secureRng(): bigint {
  const b = new Uint8Array(64);
  crypto.getRandomValues(b);
  return mod(bytesToBigLE(b));
}

// ── ElGamal ─────────────────────────────────────────────────────────────────

export interface Ciphertext {
  a: Point;
  b: Point;
}

export const zeroCt = (): Ciphertext => ({ a: IDENTITY, b: IDENTITY });
export const addCt = (x: Ciphertext, y: Ciphertext): Ciphertext => ({ a: x.a.add(y.a), b: x.b.add(y.b) });

export function encrypt(pk: Point, m: bigint, r: bigint): Ciphertext {
  return { a: mulSecret(G, r), b: mulPublic(G, m).add(mulSecret(pk, r)) };
}

export function combineKeys(shares: Point[]): Point {
  return shares.reduce((acc, h) => acc.add(h), IDENTITY);
}

export function smallDlog(target: Point, max: number): number | null {
  let acc = IDENTITY;
  for (let m = 0; m <= max; m++) {
    if (acc.equals(target)) return m;
    acc = acc.add(G);
  }
  return null;
}

// ── proofs ──────────────────────────────────────────────────────────────────

export interface Branch {
  c: bigint;
  z: bigint;
}

function membershipChallenge(
  domain: string,
  ctx: Uint8Array[],
  pk: Point,
  ct: Ciphertext,
  values: bigint[],
  commitments: [Point, Point][],
): bigint {
  const parts = [...ctx, pk.toBytes(), ct.a.toBytes(), ct.b.toBytes()];
  for (const v of values) parts.push(u64le(v));
  for (const [t1, t2] of commitments) parts.push(t1.toBytes(), t2.toBytes());
  return hashToScalar(domain, parts);
}

/** CDS94 OR-proof. rng order: (cᵢ, zᵢ) for each i ≠ real, then w. */
export function proveMembership(
  domain: string,
  ctx: Uint8Array[],
  pk: Point,
  ct: Ciphertext,
  values: bigint[],
  real: number,
  r: bigint,
  rng: Rng,
): Branch[] {
  const n = values.length;
  const branches: Branch[] = Array.from({ length: n }, () => ({ c: 0n, z: 0n }));
  const commitments: [Point, Point][] = Array.from({ length: n }, () => [IDENTITY, IDENTITY]);
  for (let i = 0; i < n; i++) {
    if (i === real) continue;
    const c = rng();
    const z = rng();
    const shifted = ct.b.subtract(mulPublic(G, values[i]!));
    commitments[i] = [mulPublic(G, z).subtract(mulPublic(ct.a, c)), mulPublic(pk, z).subtract(mulPublic(shifted, c))];
    branches[i] = { c, z };
  }
  const w = rng();
  commitments[real] = [mulSecret(G, w), mulSecret(pk, w)];
  const challenge = membershipChallenge(domain, ctx, pk, ct, values, commitments);
  const others = branches.reduce((acc, b, i) => (i === real ? acc : acc + b.c), 0n);
  const cReal = mod(challenge - others);
  branches[real] = { c: cReal, z: mod(w + cReal * r) };
  return branches;
}

export function verifyMembership(
  domain: string,
  ctx: Uint8Array[],
  pk: Point,
  ct: Ciphertext,
  values: bigint[],
  proof: Branch[],
): boolean {
  if (values.length === 0 || proof.length !== values.length) return false;
  const commitments = proof.map((br, i): [Point, Point] => {
    const shifted = ct.b.subtract(mulPublic(G, values[i]!));
    return [mulPublic(G, br.z).subtract(mulPublic(ct.a, br.c)), mulPublic(pk, br.z).subtract(mulPublic(shifted, br.c))];
  });
  const sum = mod(proof.reduce((a, b) => a + b.c, 0n));
  return sum === membershipChallenge(domain, ctx, pk, ct, values, commitments);
}

function dleqChallenge(domain: string, ctx: Uint8Array[], base: Point, pubG: Point, pubBase: Point, t1: Point, t2: Point): bigint {
  return hashToScalar(domain, [...ctx, pubG.toBytes(), base.toBytes(), pubBase.toBytes(), t1.toBytes(), t2.toBytes()]);
}

/** Chaum–Pedersen DLEQ. rng is drawn once. */
export function proveDleq(domain: string, ctx: Uint8Array[], base: Point, x: bigint, rng: Rng): [Point, Point, Branch] {
  const pubG = mulSecret(G, x);
  const pubBase = mulSecret(base, x);
  const w = rng();
  const c = dleqChallenge(domain, ctx, base, pubG, pubBase, mulSecret(G, w), mulSecret(base, w));
  return [pubG, pubBase, { c, z: mod(w + c * x) }];
}

export function verifyDleq(domain: string, ctx: Uint8Array[], base: Point, pubG: Point, pubBase: Point, p: Branch): boolean {
  const t1 = mulPublic(G, p.z).subtract(mulPublic(pubG, p.c));
  const t2 = mulPublic(base, p.z).subtract(mulPublic(pubBase, p.c));
  return p.c === dleqChallenge(domain, ctx, base, pubG, pubBase, t1, t2);
}

/** Schnorr proof of knowledge. rng is drawn once. */
export function proveKnowledge(domain: string, ctx: Uint8Array[], x: bigint, rng: Rng): [Point, Branch] {
  const h = mulSecret(G, x);
  const w = rng();
  const c = hashToScalar(domain, [...ctx, h.toBytes(), mulSecret(G, w).toBytes()]);
  return [h, { c, z: mod(w + c * x) }];
}

export function verifyKnowledge(domain: string, ctx: Uint8Array[], h: Point, p: Branch): boolean {
  const t = mulPublic(G, p.z).subtract(mulPublic(h, p.c));
  return p.c === hashToScalar(domain, [...ctx, h.toBytes(), t.toBytes()]);
}

// ── the protocol ────────────────────────────────────────────────────────────

export interface Rules {
  options: number;
  min: number;
  max: number;
}

export function checkRules(r: Rules): void {
  if (r.options < 2 || r.options > MAX_OPTIONS) throw new Error("a poll needs 2..=16 options");
  if (r.min > r.max || r.max > r.options || r.max === 0) throw new Error("bad choice bounds");
}

const sumValues = (r: Rules): bigint[] => {
  const out: bigint[] = [];
  for (let v = r.min; v <= r.max; v++) out.push(BigInt(v));
  return out;
};

const BINARY = [0n, 1n];

export interface EncryptedChoice {
  ct: Ciphertext;
  proof: Branch[];
}

export interface Ballot {
  choices: EncryptedChoice[];
  sumProof: Branch[];
}

/** rng order: per option, r then that option's proof draws; then the sum proof's. */
export function castBallot(pk: Point, pollId: string, voter: string, rules: Rules, selections: boolean[], rng: Rng): Ballot {
  checkRules(rules);
  if (selections.length !== rules.options) throw new Error("one selection per option");
  const chosen = selections.filter(Boolean).length;
  if (chosen < rules.min || chosen > rules.max) throw new Error("selection count outside the poll's bounds");

  const pkB = pk.toBytes();
  const poll = utf8.encode(pollId);
  const who = utf8.encode(voter);
  const choices: EncryptedChoice[] = [];
  let totalR = 0n;
  let total = zeroCt();
  selections.forEach((sel, i) => {
    const m = sel ? 1n : 0n;
    const r = rng();
    const ct = encrypt(pk, m, r);
    const proof = proveMembership("choice", [poll, who, pkB, u32le(i)], pk, ct, BINARY, Number(m), r, rng);
    totalR = mod(totalR + r);
    total = addCt(total, ct);
    choices.push({ ct, proof });
  });
  const sumProof = proveMembership("sum", [poll, who, pkB], pk, total, sumValues(rules), chosen - rules.min, totalR, rng);
  return { choices, sumProof };
}

/** Throws with the reason a ballot must not be counted. */
export function verifyBallot(pk: Point, pollId: string, voter: string, rules: Rules, ballot: Ballot): void {
  checkRules(rules);
  if (ballot.choices.length !== rules.options) throw new Error("one ciphertext per option");
  const pkB = pk.toBytes();
  const poll = utf8.encode(pollId);
  const who = utf8.encode(voter);
  let total = zeroCt();
  ballot.choices.forEach((ch, i) => {
    if (!verifyMembership("choice", [poll, who, pkB, u32le(i)], pk, ch.ct, BINARY, ch.proof)) {
      throw new Error("an option is not an encryption of 0 or 1");
    }
    total = addCt(total, ch.ct);
  });
  if (!verifyMembership("sum", [poll, who, pkB], pk, total, sumValues(rules), ballot.sumProof)) {
    throw new Error("the number of options chosen is outside the bounds");
  }
}

export function ballotDigest(pollId: string, voter: string, ballot: Ballot): string {
  const owned: Uint8Array[] = [];
  for (const ch of ballot.choices) {
    owned.push(ch.ct.a.toBytes(), ch.ct.b.toBytes());
    for (const br of ch.proof) owned.push(bigToBytesLE(br.c), bigToBytesLE(br.z));
  }
  for (const br of ballot.sumProof) owned.push(bigToBytesLE(br.c), bigToBytesLE(br.z));
  return toHex(
    hashToDigest("ballot", [
      utf8.encode(pollId),
      utf8.encode(voter),
      u32le(ballot.choices.length),
      u32le(ballot.sumProof.length),
      ...owned,
    ]),
  );
}

export function makeKeyShare(pollId: string, trustee: string, x: bigint, rng: Rng): [Point, Branch] {
  return proveKnowledge("keyshare", [utf8.encode(pollId), utf8.encode(trustee)], x, rng);
}

export function verifyKeyShare(pollId: string, trustee: string, h: Point, p: Branch): boolean {
  return verifyKnowledge("keyshare", [utf8.encode(pollId), utf8.encode(trustee)], h, p);
}

export function partialDecrypt(pollId: string, trustee: string, option: number, x: bigint, aggA: Point, rng: Rng): [Point, Branch] {
  const [, d, proof] = proveDleq("partial", [utf8.encode(pollId), utf8.encode(trustee), u32le(option)], aggA, x, rng);
  return [d, proof];
}

export function verifyPartial(pollId: string, trustee: string, option: number, share: Point, aggA: Point, d: Point, p: Branch): boolean {
  return verifyDleq("partial", [utf8.encode(pollId), utf8.encode(trustee), u32le(option)], aggA, share, d, p);
}

export function openCount(agg: Ciphertext, partials: Point[], max: number): number | null {
  const mask = partials.reduce((acc, d) => acc.add(d), IDENTITY);
  return smallDlog(agg.b.subtract(mask), max);
}

// ── wire (the contract's JSON shapes) ───────────────────────────────────────

export interface WireBranch {
  c: string;
  z: string;
}
export interface WireChoice {
  a: string;
  b: string;
  proof: WireBranch[];
}
export interface WireBallot {
  choices: WireChoice[];
  sum_proof: WireBranch[];
}
export interface WirePartial {
  d: string;
  proof: WireBranch;
}

export const branchToWire = (b: Branch): WireBranch => ({ c: encodeScalar(b.c), z: encodeScalar(b.z) });
export const branchFromWire = (w: WireBranch, what = "proof"): Branch => ({
  c: decodeScalar(w.c, what),
  z: decodeScalar(w.z, what),
});

export function ballotToWire(b: Ballot): WireBallot {
  return {
    choices: b.choices.map((ch) => ({
      a: encodePoint(ch.ct.a),
      b: encodePoint(ch.ct.b),
      proof: ch.proof.map(branchToWire),
    })),
    sum_proof: b.sumProof.map(branchToWire),
  };
}

export function ballotFromWire(w: WireBallot): Ballot {
  return {
    choices: w.choices.map((ch) => ({
      ct: { a: decodePoint(ch.a, "ciphertext"), b: decodePoint(ch.b, "ciphertext") },
      proof: ch.proof.map((p) => branchFromWire(p, "choice proof")),
    })),
    sumProof: w.sum_proof.map((p) => branchFromWire(p, "sum proof")),
  };
}
