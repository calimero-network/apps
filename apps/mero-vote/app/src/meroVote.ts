/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-vote";

// ── What the screens use ────────────────────────────────────────────────────
//
// The shapes the screens and the TypeScript verifier were written against
// (v1's generated client): snake_case fields, timestamps as numbers (ms). The
// contract keeps the snake_case fields but answers 64-bit integers as decimal
// strings (D20); `decode` below is the one place that converts.

export interface Anchor {
  digest: string;
  network: string;
  reference: string;
  anchored_at: number;
}

export interface AuditReport {
  poll_id: string;
  phase: Phase;
  /**
   * Every check held. A poll is only as good as its worst check.
   */
  verified: boolean;
  checks: Check[];
  /**
   * Per-option counts, once `t` trustees have published and all checks hold.
   */
  counts: number[] | null;
  counted_ballots: number;
  /**
   * Trustees whose partials were combined, in index order.
   */
  decrypted_by: string[];
  /**
   * Digest of the canonical transcript. What gets anchored.
   */
  transcript_digest: string | null;
  anchor: Anchor | null;
  /**
   * Eligible voters whose current ballot is not in the sealed count.
   * Informational; under one log the seal takes every ballot cast before
   * the close, so this is empty.
   */
  uncounted: string[];
}

export interface Ceremony {
  threshold: number;
  trustees: CeremonyTrustee[];
  complaints: ComplaintView[];
}

export interface CeremonyTrustee {
  account: string;
  index: number;
  transport: string | null;
  dealing: WireDealing | null;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Closure {
  counted: CountedBallot[];
  /**
   * Per option, the sum of the counted ballots' ciphertexts (added in the port).
   */
  aggregate: WireCiphertext[];
  closed_at: number;
}

export interface ComplaintView {
  recipient: string;
  dealer: string;
  /**
   * Proves the dealer cheated. An invalid complaint disqualifies no one.
   */
  valid: boolean;
}

export interface CountedBallot {
  voter: string;
  /**
   * The protocol digest — the voter's receipt.
   */
  digest: string;
  /**
   * Where the body lives in `ballot_bodies`.
   */
  frozen: string;
}

export interface Election {
  key: string;
  threshold: number;
  /**
   * Transport keys, in trustee order. Frozen because complaints are
   * adjudicated against them.
   */
  transport: string[];
  /**
   * Dealings that make up the key, in trustee order.
   */
  qualified: QualifiedDealing[];
  /**
   * Dealers left out because a complaint proved they cheated.
   */
  disqualified: string[];
  opened_at: number;
}

export interface Identity {
  account: string;
}

export interface Member {
  account: string;
  name: string;
}

export type Phase = "KeyCeremony" | "Voting" | "Closing" | "Closed";

export interface PollDefinition {
  title: string;
  description: string;
  options: string[];
  min_choices: number;
  max_choices: number;
  /**
   * Accounts that hold the decryption key between them, in index order
   * (trustee `i` in this list has Shamir index `i + 1`).
   */
  trustees: string[];
  /**
   * How many trustees it takes to decrypt. 1..=trustees.len().
   */
  threshold: number;
  /**
   * Accounts allowed to vote. Empty means any member of the app's org.
   */
  voters: string[];
  creator: string;
  /**
   * Milliseconds. Also makes two otherwise identical polls distinct.
   */
  created_at: number;
  /**
   * Informational deadline in milliseconds. Node clocks are not a
   * consensus source, so closing is an explicit act of the creator.
   */
  closes_at: number | null;
}

export interface PollState {
  phase: Phase;
  election: Election | null;
  /**
   * When the close was announced (phase Closing onward).
   */
  closing_at: number | null;
  closure: Closure | null;
  anchor: Anchor | null;
}

export interface PollSummary {
  poll_id: string;
  title: string;
  creator: string;
  phase: Phase;
  created_at: number;
  ballots: number;
}

export interface PollView {
  poll_id: string;
  definition: PollDefinition;
  state: PollState;
  trustees: TrusteeStatus[];
  turnout: Turnout[];
  /**
   * The caller's own receipt, if they have voted.
   */
  my_digest: string | null;
  can_vote: boolean;
}

export interface QualifiedDealing {
  dealer: string;
  dealing: WireDealing;
}

export interface TallyInputs {
  aggregate: WireCiphertext[];
  counted: number;
}

export interface Transcript {
  protocol: string;
  poll_id: string;
  definition: PollDefinition;
  state: PollState;
  ballots: TranscriptBallot[];
  partials: TranscriptPartial[];
  report: AuditReport;
}

export interface TranscriptBallot {
  voter: string;
  digest: string;
  ballot: WireBallot;
  /**
   * Whether the voter's current ballot is still this one.
   */
  endorsed: boolean;
}

export interface TranscriptPartial {
  trustee: string;
  index: number;
  options: WirePartial[];
}

export interface TrusteeStatus {
  account: string;
  /**
   * 1-based Shamir index.
   */
  index: number;
  transport_published: boolean;
  dealing_published: boolean;
  /**
   * Valid complaints filed against this trustee's dealing.
   */
  complaints_against: number;
  /**
   * Whether this trustee's dealing is part of the key (after open).
   */
  qualified: boolean | null;
  partial_published: boolean;
}

export interface Turnout {
  voter: string;
  digest: string;
  cast_at: number;
}

export interface WireBallot {
  choices: WireChoice[];
  sum_proof: WireBranch[];
}

export interface WireBranch {
  c: string;
  z: string;
}

export interface WireChoice {
  a: string;
  b: string;
  proof: WireBranch[];
}

export interface WireCiphertext {
  a: string;
  b: string;
}

export interface WireDealing {
  /**
   * `t` Feldman commitments, constant term first.
   */
  commitments: string[];
  /**
   * Proof of knowledge of the constant term.
   */
  proof: WireBranch;
  /**
   * One per trustee, in the poll's trustee order.
   */
  shares: WireEncShare[];
}

export interface WireEncShare {
  r: string;
  v: string;
}

export interface WirePartial {
  d: string;
  proof: WireBranch;
}

// ── Calling the contract ────────────────────────────────────────────────────
//
// The contract is called through `MeroVoteClient`, which `mero-app-build
// codegen` writes from logic/res/abi.json (`src/generated/client.ts`): camelCase
// arguments (`pollId`, `minChoices`, ...) and 64-bit ones as decimal strings
// (`closesAt`). The ABI names its records without their shapes, so the
// generated types are `unknown`: every answer the screens read goes through
// `decode<T>` into the shapes above.

/** A 64-bit argument (a deadline in ms) as the contract takes it: a decimal string (D20), or `null`. */
export const u64Arg = (ms: number | null): string | null => (ms === null ? null : String(Math.trunc(ms)));

/** Every 64-bit field the contract answers, as a decimal string, in any answer. */
const U64_FIELDS = new Set([
  "created_at",
  "closes_at",
  "opened_at",
  "closed_at",
  "closing_at",
  "anchored_at",
  "cast_at",
]);

/**
 * An answer in the shapes above: each 64-bit field (a decimal string on the
 * wire) as a number. Timestamps in ms are far below 2^53, so nothing is lost.
 */
export function decode<T>(value: unknown): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    if (typeof v === "string" && key && U64_FIELDS.has(key)) return Number(v);
    return v;
  };
  return walk(value) as T;
}
