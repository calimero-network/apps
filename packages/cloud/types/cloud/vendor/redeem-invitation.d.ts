/** Whether an outcome means the invitation is finished with. */
export function isSettled(outcome: any): boolean;
/**
 * Whether the invitation should be kept for another attempt later.
 *
 * The inverse of {@link isSettled}, named for the decision it drives.
 */
export function shouldRetain(outcome: any): boolean;
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
export function redeemInvitation(parsed: any, redeemer: any): Promise<{
    status: string;
    namespaceId: any;
    teamName: any;
    message?: undefined;
    reason?: undefined;
    retryable?: undefined;
} | {
    status: string;
    namespaceId: any;
    message: string;
    reason: any;
    retryable: boolean;
    teamName?: undefined;
}>;
