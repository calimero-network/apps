// ── Redeeming an invitation: joining once, and knowing whether it worked ──────
//
// Every app in this repo had its own copy of this, and every copy decided
// "did we join?" by asking whether the join request resolved. That is the wrong
// question, and it produced the two failures below on a real node (rc.41,
// 2026-09-22, mero-design):
//
//   1. The desktop proxy aborts every admin request at 30s. A namespace join
//      whose members are all offline waits for one to appear — measured at 95s.
//      So the request failed, the join landed anyway, and the app reported
//      "could not join" for a namespace it was already in. The invitation was
//      never acked, so it replayed on every load and every node restart, for
//      good. That is the "it keeps rejoining a link I already used" report.
//
//   2. The post-join refresh shared the join's `try`. A refresh that threw
//      turned a real join into a reported failure, with the same consequence.
//
// So membership is the question, and there are two independent proofs of it:
// the request resolving, and the namespace being listed. Either one is enough,
// which matters because either one can be missing.

/** What the app must supply: the two calls that differ between apps. */
export interface InviteRedeemer {
  /**
   * Send the join. Resolve on success, throw on failure.
   *
   * It does not have to be reliable, and it does not have to be idempotent on
   * the client — the node's join is idempotent, and `memberships()` settles any
   * ambiguity this throws.
   */
  join(namespaceId: string, invitation: unknown): Promise<void>;
  /**
   * Namespace ids this node is a member of.
   *
   * Throwing is a legitimate answer ("could not tell") and is treated as such:
   * it never converts a join that succeeded into a failure.
   */
  memberships(): Promise<readonly string[]>;
}

/**
 * What happened, in the terms the UI needs.
 *
 * `already-member` is deliberately a success and deliberately distinct: it is
 * the outcome of following a link twice, or of the timeout above, and telling
 * the user "you are already in this one" is neither an error nor the same
 * message as having just joined.
 */
export type RedeemOutcome =
  | { status: "joined"; namespaceId: string; teamName?: string }
  | { status: "already-member"; namespaceId: string; teamName?: string }
  | {
      status: "failed";
      namespaceId: string | null;
      /** The node's own words, for logs and for an app that shows detail. */
      message: string;
      /** Why, in terms a person can act on — see `describeInviteFailure`. */
      reason: InviteFailureReason;
      /**
       * Whether trying again later could plausibly work. A malformed token
       * cannot; an unreachable peer can. The caller uses this to decide whether
       * to keep the invitation for another load — see `shouldRetain`.
       */
      retryable: boolean;
    };

/**
 * Why a join failed, as far as it tells a person what to do next.
 *
 * Read off the HTTP status where the node gives one (core rc.56+ answers a
 * refused join with a 4xx, not a 500), and off the message otherwise.
 */
export type InviteFailureReason =
  /** The invitation's time ran out. Only a new link helps. */
  | "expired"
  /** The link is malformed or names nothing joinable. Only a new link helps. */
  | "invalid"
  /** The node refused this person (removed, blocked, not allowed). */
  | "refused"
  /** This browser's session with the node lapsed; signing in finishes it. */
  | "signed-out"
  /** No member was reachable to let them in yet. Trying later can work. */
  | "no-one-online"
  /** This browser could not reach its own node at all. */
  | "node-unreachable"
  /** Nothing more specific is known; the node's message is all there is. */
  | "unknown";

/** Whether an outcome means the invitation is finished with. */
export function isSettled(outcome: RedeemOutcome): boolean {
  return outcome.status !== "failed" || !outcome.retryable;
}

/**
 * Whether the invitation should be kept for another attempt on a later load.
 *
 * The inverse of `isSettled`, named for the decision it drives so the call site
 * does not have to invert it in the head.
 */
export function shouldRetain(outcome: RedeemOutcome): boolean {
  return !isSettled(outcome);
}

function messageFrom(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object") {
    const shaped = err as {
      message?: unknown;
      error?: unknown;
      data?: { message?: unknown };
      response?: { data?: { error?: unknown; message?: unknown } };
    };
    for (const candidate of [
      shaped.response?.data?.error,
      shaped.response?.data?.message,
      shaped.data?.message,
      shaped.error,
      shaped.message,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return fallback;
}

/**
 * The HTTP status a join error carries, in any of the shapes the apps' clients
 * throw: mero-js's `HTTPError.status`, an axios-style `response.status`, or a
 * bare `statusCode`. `undefined` when there is none (a thrown string, an error
 * from before the request was sent).
 */
function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const shaped = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  for (const candidate of [
    shaped.status,
    shaped.response?.status,
    shaped.statusCode,
  ]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Which reason the message alone names, for a node that answers without a
 * useful status — older than rc.56, where every refusal was a bare 500.
 *
 * Kept narrow on purpose. Anything not recognised here stays retryable, because
 * the cost of retrying a dead link is one more attempt against the cap, while
 * the cost of discarding a live one is a user who cannot join at all.
 */
function reasonFromMessage(message: string): InviteFailureReason | null {
  const m = message.toLowerCase();
  if (
    m.includes("invitation has expired") ||
    m.includes("invitation expired") ||
    // Core rc.56+ names the group between the words: "invitation for group
    // <id> expired at <secs>".
    /\binvitation for group .+? expired at \d+/.test(m)
  ) {
    return "expired";
  }
  if (
    m.includes("malformed") ||
    m.includes("does not match namespace_id") ||
    m.includes("invalid invitation") ||
    /\binvitation for group .+? is invalid:/.test(m)
  ) {
    return "invalid";
  }
  return null;
}

/**
 * Why the join failed, and whether a later attempt could work.
 *
 * The status decides where there is one. A 4xx the node chose is a definitive
 * answer about this invitation or this person, so it is not retried; a 5xx, a
 * 429 or no answer at all is about the moment, so it is. Two exceptions keep an
 * invitation that is still good: a 401 is this browser's session, not the
 * invitation, and a 404 is not specific enough to throw a link away on.
 */
function classify(
  err: unknown,
  message: string,
): { reason: InviteFailureReason; retryable: boolean } {
  const status = statusOf(err);
  const fromText = reasonFromMessage(message);

  if (status === 401) return { reason: "signed-out", retryable: true };
  if (status === 400) return { reason: fromText ?? "invalid", retryable: false };
  if (status === 410) return { reason: "expired", retryable: false };
  if (status === 403) return { reason: "refused", retryable: false };
  // An expired invitation, a spent one, a member who was removed or blocked:
  // every 409 a join can answer is final.
  if (status === 409) return { reason: fromText ?? "refused", retryable: false };
  if (status === 503 || status === 504) {
    return { reason: "no-one-online", retryable: true };
  }
  // mero-js reports a fetch that never reached the node as status 0.
  if (status === 0 || err instanceof TypeError) {
    return { reason: "node-unreachable", retryable: true };
  }
  // A 500 from a node older than rc.56 may still be a refusal in disguise;
  // anything else without a status has only its message to go on.
  if (fromText) return { reason: fromText, retryable: false };
  return { reason: "unknown", retryable: true };
}

/**
 * What to tell a person about a failed join, or `null` to show the node's own
 * message (an `unknown` failure has nothing better to offer).
 *
 * `noun` is what the app calls the thing being joined: "team", "space", "vault".
 */
export function describeInviteFailure(
  reason: InviteFailureReason,
  noun = "team",
): string | null {
  switch (reason) {
    case "expired":
      return "This invitation has expired. Ask for a new link.";
    case "invalid":
      return "This invitation link isn't valid. Ask for a new one.";
    case "refused":
      return `You can't join this ${noun} with this invitation. Ask an admin to invite you again.`;
    case "signed-out":
      return "Your session with your node has ended. Sign in again to finish joining.";
    case "no-one-online":
      return `No one in this ${noun} is online to let you in yet. It will try again the next time you open the app.`;
    case "node-unreachable":
      return "Couldn't reach your node. Check that it is running, then try again.";
    case "unknown":
      return null;
  }
}

/**
 * Join the namespace an invitation names, and report what happened.
 *
 * Never throws for an ordinary failure — the outcome type carries it, because
 * every caller has to branch on "already a member" anyway.
 */
export async function redeemInvitation(
  parsed: { namespaceId: string; invitation: unknown; teamName?: string },
  redeemer: InviteRedeemer,
): Promise<RedeemOutcome> {
  const { namespaceId, invitation, teamName } = parsed;

  let joinError: unknown = null;
  try {
    await redeemer.join(namespaceId, invitation);
  } catch (err) {
    joinError = err;
  }

  // The request resolving is proof on its own, so this must not be able to
  // demote a real join: a `memberships()` that throws is "could not tell".
  let listed: boolean | null = null;
  try {
    listed = (await redeemer.memberships()).includes(namespaceId);
  } catch {
    listed = null;
  }

  if (joinError === null) {
    return { status: "joined", namespaceId, teamName };
  }
  if (listed === true) {
    // The join landed despite the error — an aborted request, or a link
    // followed twice.
    return { status: "already-member", namespaceId, teamName };
  }

  const message = messageFrom(
    joinError,
    "Could not join. Check the invitation.",
  );
  const { reason, retryable } = classify(joinError, message);
  return {
    status: "failed",
    namespaceId,
    message,
    reason,
    retryable,
  };
}
