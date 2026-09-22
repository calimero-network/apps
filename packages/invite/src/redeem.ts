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
      message: string;
      /**
       * Whether trying again later could plausibly work. A malformed token
       * cannot; an unreachable peer can. The caller uses this to decide whether
       * to keep the invitation for another load — see `shouldRetain`.
       */
      retryable: boolean;
    };

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
 * A failure nobody should retry: the invitation itself is not usable.
 *
 * Kept narrow on purpose. Anything not recognised here stays retryable, because
 * the cost of retrying a dead link is one more attempt against the cap, while
 * the cost of discarding a live one is a user who cannot join at all.
 */
function isTerminal(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("invitation has expired") ||
    m.includes("invitation expired") ||
    m.includes("malformed") ||
    m.includes("does not match namespace_id") ||
    m.includes("invalid invitation")
  );
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
  return {
    status: "failed",
    namespaceId,
    message,
    retryable: !isTerminal(message),
  };
}
