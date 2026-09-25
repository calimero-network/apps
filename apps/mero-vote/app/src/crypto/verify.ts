/**
 * An independent re-count, in the browser, from a transcript alone.
 *
 * `get_result` already re-verifies everything on the member's own node. This
 * is for the member who does not want to trust even that: it takes the raw
 * inputs (`get_transcript`, or a downloaded JSON file from anyone) and redoes
 * every check with a second implementation in a second language. If it agrees
 * with the node — same counts, same transcript digest — neither implementation
 * can be quietly wrong on its own.
 *
 * What a transcript cannot show, and so this cannot check: whether each
 * trustee's and voter's *signed slot* still matches what was frozen. The node
 * checks that against live state (`voter endorsement`, `trustee shares`), and
 * the transcript carries its per-ballot `endorsed` flag as a claim.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type { Transcript } from "../generated/MeroVoteClient";
import {
  addCt,
  ballotDigest,
  ballotFromWire,
  branchFromWire,
  combineKeys,
  decodePoint,
  encodePoint,
  openCount,
  toHex,
  verifyBallot,
  verifyKeyShare,
  verifyPartial,
  zeroCt,
  type Ciphertext,
  type Point,
  type Rules,
} from "./protocol";

export interface LocalCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LocalAudit {
  checks: LocalCheck[];
  verified: boolean;
  counts: number[] | null;
  digest: string | null;
  /** Counts and digest equal what the node reported. */
  agreesWithNode: boolean;
}

const utf8 = new TextEncoder();
const hexUtf8 = (s: string) => toHex(utf8.encode(s));

/** Must equal `transcript_text` in the contract, byte for byte. */
export function transcriptText(
  pollId: string,
  def: Transcript["definition"],
  key: string,
  shares: { trustee: string; share: string }[],
  counted: { voter: string; digest: string }[],
  partials: { trustee: string; options: { d: string }[] }[],
  counts: number[],
): string {
  let out = "mero-vote/v1/transcript\n";
  out += `poll ${pollId}\n`;
  out += `title ${hexUtf8(def.title)}\n`;
  def.options.forEach((o, i) => (out += `option ${i} ${hexUtf8(o)}\n`));
  out += `rules ${def.options.length} ${def.min_choices} ${def.max_choices}\n`;
  out += `key ${key}\n`;
  for (const s of shares) out += `share ${s.trustee} ${s.share}\n`;
  for (const b of counted) out += `ballot ${b.voter} ${b.digest}\n`;
  for (const p of partials) p.options.forEach((o, j) => (out += `partial ${p.trustee} ${j} ${o.d}\n`));
  counts.forEach((n, j) => (out += `count ${j} ${n}\n`));
  return out;
}

export function transcriptDigest(text: string): string {
  return toHex(sha256(utf8.encode(text)));
}

export function verifyTranscript(t: Transcript): LocalAudit {
  const checks: LocalCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    return ok;
  };
  const done = (counts: number[] | null, digest: string | null): LocalAudit => {
    const verified = checks.every((c) => c.ok);
    const c = verified ? counts : null;
    const d = verified ? digest : null;
    const node = t.report;
    const agreesWithNode =
      node.verified === verified &&
      JSON.stringify(node.counts ?? null) === JSON.stringify(c) &&
      (node.transcript_digest ?? null) === d;
    return { checks, verified, counts: c, digest: d, agreesWithNode };
  };

  const def = t.definition;
  const rules: Rules = { options: def.options.length, min: def.min_choices, max: def.max_choices };
  const pollId = t.poll_id;
  push("protocol", t.protocol === "mero-vote/v1/", t.protocol);

  const election = t.state.election;
  if (!election) {
    push("election key", true, "key ceremony in progress");
    return done(null, null);
  }

  // 1. Shares and key.
  const shares = new Map<string, Point>();
  let sharesOk = election.shares.length === def.trustees.length;
  for (const trustee of def.trustees) {
    const s = election.shares.find((x) => x.trustee === trustee);
    try {
      if (!s) throw new Error("missing");
      const h = decodePoint(s.share, "share");
      if (!verifyKeyShare(pollId, trustee, h, branchFromWire(s.proof))) throw new Error("bad proof");
      shares.set(trustee, h);
    } catch {
      sharesOk = false;
    }
  }
  push("trustee shares", sharesOk, `${shares.size} of ${def.trustees.length} proofs of knowledge verify`);
  const keyOk = sharesOk && encodePoint(combineKeys([...shares.values()])) === election.key;
  push("election key", keyOk, "key = sum of trustee shares");
  let pk: Point;
  try {
    pk = decodePoint(election.key, "election key");
  } catch {
    return done(null, null);
  }

  // 2. Ballots.
  const closure = t.state.closure;
  if (!closure) {
    push("ballots", true, "voting in progress");
    return done(null, null);
  }
  const eligible = (v: string) => def.voters.length === 0 || def.voters.includes(v);
  let agg: Ciphertext[] = Array.from({ length: rules.options }, zeroCt);
  let valid = 0;
  const seen = new Set<string>();
  for (const cb of closure.counted) {
    const tb = t.ballots.find((b) => b.voter === cb.voter && b.digest === cb.digest);
    try {
      if (!tb) throw new Error("missing");
      if (!eligible(cb.voter) || seen.has(cb.voter)) throw new Error("ineligible or duplicate");
      seen.add(cb.voter);
      const ballot = ballotFromWire(tb.ballot);
      verifyBallot(pk, pollId, cb.voter, rules, ballot);
      if (ballotDigest(pollId, cb.voter, ballot) !== cb.digest) throw new Error("digest");
      agg = agg.map((ct, j) => addCt(ct, ballot.choices[j]!.ct));
      valid++;
    } catch {
      // counted as invalid below
    }
  }
  const n = closure.counted.length;
  push("ballot proofs", valid === n, `${valid} of ${n} counted ballots verified in this browser`);

  // 3. Partials and counts.
  let partialsOk = true;
  const masks: Point[][] = agg.map(() => []);
  for (const p of t.partials) {
    const h = shares.get(p.trustee);
    try {
      if (!h || p.options.length !== agg.length) throw new Error("shape");
      p.options.forEach((o, j) => {
        const d = decodePoint(o.d, "partial");
        if (!verifyPartial(pollId, p.trustee, j, h, agg[j]!.a, d, branchFromWire(o.proof))) throw new Error("proof");
        masks[j]!.push(d);
      });
    } catch {
      partialsOk = false;
    }
  }
  push("partial decryptions", partialsOk, `${t.partials.length} of ${def.trustees.length} trustees; every one proven`);

  const allIn = def.trustees.every((tr) => t.partials.some((p) => p.trustee === tr));
  if (!allIn || !checks.every((c) => c.ok)) return done(null, null);

  const opened = agg.map((ct, j) => openCount(ct, masks[j]!, n));
  const total = opened.reduce<number>((a, c) => a + (c ?? Number.NaN), 0);
  const sumOk = opened.every((c) => c !== null) && total >= n * def.min_choices && total <= n * def.max_choices;
  push("decryption", sumOk, "every option decrypts to a count within 0..=ballots");
  if (!sumOk) return done(null, null);
  const counts = opened as number[];

  // Partials in trustee order, as the contract emits them.
  const ordered = def.trustees.map((tr) => t.partials.find((p) => p.trustee === tr)!);
  const text = transcriptText(pollId, def, election.key, election.shares, closure.counted, ordered, counts);
  const digest = transcriptDigest(text);
  if (t.state.anchor) {
    push("anchor", t.state.anchor.digest === digest, `anchored on ${t.state.anchor.network}: ${t.state.anchor.reference}`);
  }
  return done(counts, digest);
}
