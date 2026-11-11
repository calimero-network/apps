import { type ClientRoutes } from "@calimero-apps/connect";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-vote";

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log, a view is answered by a node
 * without writing. `meroVote.test.ts` asserts these lists, and every method's
 * parameter names, are exactly the committed `logic/res/abi.json`'s, so a
 * method the contract drops or renames fails a test rather than a request.
 */
export const CALLS = [
  "setName",
  "createPoll",
  "publishTransportKey",
  "publishDealing",
  "fileComplaint",
  "openVoting",
  "castBallot",
  "closePoll",
  "sealPoll",
  "publishPartial",
  "anchorResult",
] as const;
export const VIEWS = [
  "whoami",
  "roster",
  "listPolls",
  "getPoll",
  "ceremony",
  "tallyInputs",
  "getResult",
  "getTranscript",
] as const;

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

// ── The client ──────────────────────────────────────────────────────────────

/** v1's generated client's surface: same methods, same snake_case params. */
export interface MeroVoteClient {
  whoami(): Promise<Identity>;
  setName(params: { name: string }): Promise<void>;
  roster(): Promise<Member[]>;
  createPoll(params: {
    title: string;
    description: string;
    options: string[];
    min_choices: number;
    max_choices: number;
    trustees: string[];
    threshold: number;
    voters: string[];
    closes_at: number | null;
  }): Promise<string>;
  listPolls(): Promise<PollSummary[]>;
  getPoll(params: { poll_id: string }): Promise<PollView>;
  ceremony(params: { poll_id: string }): Promise<Ceremony>;
  publishTransportKey(params: { poll_id: string; key: string; proof: WireBranch }): Promise<void>;
  publishDealing(params: { poll_id: string; dealing: WireDealing }): Promise<void>;
  fileComplaint(params: { poll_id: string; dealer: string; secret: string; proof: WireBranch }): Promise<void>;
  openVoting(params: { poll_id: string }): Promise<string>;
  castBallot(params: { poll_id: string; ballot: WireBallot }): Promise<string>;
  closePoll(params: { poll_id: string }): Promise<void>;
  sealPoll(params: { poll_id: string }): Promise<number>;
  tallyInputs(params: { poll_id: string }): Promise<TallyInputs>;
  publishPartial(params: { poll_id: string; partials: WirePartial[] }): Promise<void>;
  getResult(params: { poll_id: string }): Promise<AuditReport>;
  getTranscript(params: { poll_id: string }): Promise<Transcript>;
  anchorResult(params: { poll_id: string; network: string; reference: string }): Promise<string>;
}

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

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/**
 * The contract at instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there).
 */
export function meroVote(client: Transport, app: string, after: () => void = () => {}): MeroVoteClient {
  const call = async <T>(method: (typeof CALLS)[number], args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return decode<T>((await client.apps.call({ app, method, args })).result);
    } finally {
      after();
    }
  };
  const view = async <T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return decode<T>((await client.apps.view({ app, method, args })).result);
    } finally {
      after();
    }
  };
  const poll = (p: { poll_id: string }) => ({ pollId: p.poll_id });
  return {
    whoami: () => view("whoami"),
    setName: ({ name }) => call("setName", { name }),
    roster: () => view("roster"),
    createPoll: (p) =>
      call("createPoll", {
        title: p.title,
        description: p.description,
        options: p.options,
        minChoices: p.min_choices,
        maxChoices: p.max_choices,
        trustees: p.trustees,
        threshold: p.threshold,
        voters: p.voters,
        // A u64 argument: a decimal string (D20).
        closesAt: p.closes_at === null ? null : String(Math.trunc(p.closes_at)),
      }),
    listPolls: () => view("listPolls"),
    getPoll: (p) => view("getPoll", poll(p)),
    ceremony: (p) => view("ceremony", poll(p)),
    publishTransportKey: (p) => call("publishTransportKey", { ...poll(p), key: p.key, proof: p.proof }),
    publishDealing: (p) => call("publishDealing", { ...poll(p), dealing: p.dealing }),
    fileComplaint: (p) =>
      call("fileComplaint", { ...poll(p), dealer: p.dealer, secret: p.secret, proof: p.proof }),
    openVoting: (p) => call("openVoting", poll(p)),
    castBallot: (p) => call("castBallot", { ...poll(p), ballot: p.ballot }),
    closePoll: (p) => call("closePoll", poll(p)),
    sealPoll: (p) => call("sealPoll", poll(p)),
    tallyInputs: (p) => view("tallyInputs", poll(p)),
    publishPartial: (p) => call("publishPartial", { ...poll(p), partials: p.partials }),
    getResult: (p) => view("getResult", poll(p)),
    getTranscript: (p) => view("getTranscript", poll(p)),
    anchorResult: (p) => call("anchorResult", { ...poll(p), network: p.network, reference: p.reference }),
  };
}
