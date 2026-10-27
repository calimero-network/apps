/** The two calls a redeem needs, so any client (or any app's join) can drive it. */
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
     * it never turns a join that succeeded into a failure.
     */
    memberships(): Promise<readonly string[]>;
}
/**
 * Why a join failed, as far as it tells a person what to do next.
 *
 * Read off the HTTP status where the node gives one (core rc.56+ answers a
 * refused join with a 4xx, not a 500), and off the message otherwise.
 */
export type InviteFailureReason = 
/** The invitation's time ran out. Only a new link helps. */
'expired'
/** The link is malformed or names nothing joinable. Only a new link helps. */
 | 'invalid'
/**
 * This person already joined with this link once, and has since left. A link
 * admits each person once: only a new one helps.
 */
 | 'already-used'
/** An admin removed this person. No link readmits them; an admin must re-add them. */
 | 'removed'
/** The node refused this person for another reason (blocked, not allowed). */
 | 'refused'
/** This client's session with the node lapsed; signing in finishes it. */
 | 'signed-out'
/** No member was reachable to let them in yet. Trying later can work. */
 | 'no-one-online'
/** This client could not reach its own node at all. */
 | 'node-unreachable'
/** Nothing more specific is known; the node's message is all there is. */
 | 'unknown';
/**
 * What happened, in the terms a UI needs.
 *
 * `already-member` is deliberately a success and deliberately distinct: it is
 * the outcome of following a link twice, or of the timeout above, and telling
 * someone "you are already in this one" is neither an error nor the same
 * message as having just joined.
 */
export type RedeemOutcome = {
    status: 'joined';
    namespaceId: string;
    teamName?: string;
} | {
    status: 'already-member';
    namespaceId: string;
    teamName?: string;
} | {
    status: 'failed';
    namespaceId: string | null;
    /** The node's own words, for logs and for a UI that shows detail. */
    message: string;
    /** Why, in terms a person can act on. */
    reason: InviteFailureReason;
    /**
     * Whether trying again later could plausibly work. A malformed token
     * cannot; an unreachable peer can. A caller holding the invitation uses
     * this to decide whether to keep it — see {@link shouldRetain}.
     */
    retryable: boolean;
};
/** Whether an outcome means the invitation is finished with. */
export declare function isSettled(outcome: RedeemOutcome): boolean;
/**
 * Whether the invitation should be kept for another attempt later.
 *
 * The inverse of {@link isSettled}, named for the decision it drives.
 */
export declare function shouldRetain(outcome: RedeemOutcome): boolean;
/**
 * Join the namespace an invitation names, and report what happened.
 *
 * Sends the join once and never retries it: a failed request whose namespace
 * is then listed is `already-member`, not a failure. Never throws for an
 * ordinary failure — the outcome carries it, because every caller has to branch
 * on "already a member" anyway.
 *
 * Most callers want {@link AdminApiClient.redeemInvitation}, which supplies the
 * redeemer from the admin API. This form is for a join that is more than one
 * call — a namespace followed by the context inside it, say.
 */
export declare function redeemInvitation(parsed: {
    namespaceId: string;
    invitation: unknown;
    teamName?: string;
}, redeemer: InviteRedeemer): Promise<RedeemOutcome>;
