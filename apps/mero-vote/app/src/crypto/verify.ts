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
 * dealer's and voter's *signed slot* still matches what was frozen, and the
 * complaints behind a disqualification. The node checks those against live
 * state (`dealings`, `complaints`, `voter endorsement`), and the transcript
 * carries its per-ballot `endorsed` flag as a claim.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type { Transcript } from "../generated/MeroVoteClient";
import {
  addCt,
  ballotDigest,
  ballotFromWire,
  branchFromWire,
  dealingFromWire,
  decodePoint,
  encodePoint,
  jointKey,
  openCount,
  toHex,
  verificationKey,
  verifyBallot,
  verifyDealing,
  verifyPartial,
  zeroCt,
  type Dealing,
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

/** Must equal `transcript_text` in the contract, byte for byte. Partials are
 *  not in it — see the contract for why. */
export function transcriptText(
  pollId: string,
  def: Pick<Transcript["definition"], "title" | "options" | "min_choices" | "max_choices" | "trustees">,
  election: { key: string; threshold: number; qualified: { dealer: string; dealing: { commitments: string[] } }[]; disqualified: string[] },
  counted: { voter: string; digest: string }[],
  counts: number[],
): string {
  let out = "mero-vote/v2/transcript\n";
  out += `poll ${pollId}\n`;
  out += `title ${hexUtf8(def.title)}\n`;
  def.options.forEach((o, i) => (out += `option ${i} ${hexUtf8(o)}\n`));
  out += `rules ${def.options.length} ${def.min_choices} ${def.max_choices}\n`;
  out += `threshold ${election.threshold} ${def.trustees.length}\n`;
  def.trustees.forEach((t, i) => (out += `trustee ${i + 1} ${t}\n`));
  for (const q of election.qualified) out += `dealer ${q.dealer} ${q.dealing.commitments.join(" ")}\n`;
  for (const d of election.disqualified) out += `disqualified ${d}\n`;
  out += `key ${election.key}\n`;
  for (const b of counted) out += `ballot ${b.voter} ${b.digest}\n`;
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
  push("protocol", t.protocol === "mero-vote/v2/", t.protocol);
  const n = def.trustees.length;
  const threshold = def.threshold;

  const election = t.state.election;
  if (!election) {
    push("election key", true, "key ceremony in progress");
    return done(null, null);
  }

  // 1. Dealings and key.
  const dealings: Dealing[] = [];
  let dealingsOk = election.threshold === threshold && election.qualified.length >= threshold;
  let last = 0;
  for (const q of election.qualified) {
    const idx = def.trustees.indexOf(q.dealer) + 1;
    if (idx <= last) dealingsOk = false;
    last = idx;
    try {
      const d = dealingFromWire(q.dealing);
      verifyDealing(pollId, q.dealer, threshold, n, d);
      dealings.push(d);
    } catch {
      dealingsOk = false;
    }
  }
  push("dealings", dealingsOk, `${election.qualified.length} qualified dealings (threshold ${threshold}), each proven`);
  const keyOk = dealingsOk && encodePoint(jointKey(dealings)) === election.key;
  push("election key", keyOk, "key = sum of qualified constant terms");
  let pk: Point;
  try {
    pk = decodePoint(election.key, "election key");
  } catch {
    return done(null, null);
  }

  // 2. Ballots.
  const closure = t.state.closure;
  if (!closure) {
    push("ballots", true, t.state.phase === "Closing" ? "closing — the count is not sealed yet" : "voting in progress");
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
  const counted = closure.counted.length;
  push("ballot proofs", valid === counted, `${valid} of ${counted} counted ballots verified in this browser`);

  // 3. Partials and counts. Robust, like the node: an unproven partial is
  //    set aside, and the `t` lowest-indexed good ones are combined.
  const good: { index: number; ds: Point[] }[] = [];
  const rejected: string[] = [];
  for (const p of [...t.partials].sort((x, y) => x.index - y.index)) {
    const index = def.trustees.indexOf(p.trustee) + 1;
    try {
      if (index !== p.index || index === 0 || p.options.length !== agg.length) throw new Error("shape");
      const vkey = verificationKey(dealings, index);
      const ds = p.options.map((o, j) => {
        const d = decodePoint(o.d, "partial");
        if (!verifyPartial(pollId, p.trustee, j, vkey, agg[j]!.a, d, branchFromWire(o.proof))) throw new Error("proof");
        return d;
      });
      good.push({ index, ds });
    } catch {
      rejected.push(p.trustee);
    }
  }
  push(
    "partial decryptions",
    true,
    `${good.length} of ${threshold} needed${rejected.length ? `; set aside as unproven: ${rejected.join(", ")}` : ""}`,
  );
  if (good.length < threshold || !checks.every((c) => c.ok)) return done(null, null);

  const used = good.slice(0, threshold);
  const opened = agg.map((ct, j) =>
    openCount(
      ct,
      used.map((u): [number, Point] => [u.index, u.ds[j]!]),
      counted,
    ),
  );
  const total = opened.reduce<number>((a, c) => a + (c ?? Number.NaN), 0);
  const sumOk = opened.every((c) => c !== null) && total >= counted * def.min_choices && total <= counted * def.max_choices;
  push("decryption", sumOk, "every option decrypts to a count within 0..=ballots");
  if (!sumOk) return done(null, null);
  const counts = opened as number[];

  const digest = transcriptDigest(transcriptText(pollId, def, election, closure.counted, counts));
  if (t.state.anchor) {
    push("anchor", t.state.anchor.digest === digest, `anchored on ${t.state.anchor.network}: ${t.state.anchor.reference}`);
  }
  return done(counts, digest);
}
