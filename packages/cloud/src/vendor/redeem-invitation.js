// Vendored from @calimero-network/mero-js 26.9.1 (MIT): pure helpers apps already
// rely on, unchanged except for import paths. The transport they once sat on is
// gone; see ../backend.ts for the release-v2 implementation.

// ── Redeeming an invitation: joining once, and knowing whether it worked ──────
//
// Deciding "did we join?" by whether the join request resolved is the wrong
// question, and on a real node (core rc.41, 2026-09-22) it failed two ways:
//
//   1. The desktop proxy aborts every admin request at 30s. A namespace join
//      whose members are all offline waits for one to appear — measured at 95s.
//      So the request failed, the join landed anyway, and the app reported
//      "could not join" for a namespace it was already in. It kept the
//      invitation, and replayed it on every load.
//
//   2. A refresh after the join shared its `try`, so a refresh that threw
//      turned a real join into a reported failure.
//
// So membership is the question, and there are two independent proofs of it:
// the request resolving, and the namespace being listed. Either one is enough,
// which matters because either one can be missing.
import { classifyError, messageOf } from './classify.js';
import { RelayLoginError } from './errors.js';
/** Whether an outcome means the invitation is finished with. */
export function isSettled(outcome) {
    return outcome.status !== 'failed' || !outcome.retryable;
}
/**
 * Whether the invitation should be kept for another attempt later.
 *
 * The inverse of {@link isSettled}, named for the decision it drives.
 */
export function shouldRetain(outcome) {
    return !isSettled(outcome);
}
/**
 * The refusal codes a join route answers with beside `error` (core's
 * `join_refusal_code`), and what each one tells a person.
 *
 * `join_refused_by_member` is absent on purpose: a member that refused may only
 * be behind, so it says nothing final on its own, and the member's own words
 * (in the message) are read by {@link reasonFromMessage} instead.
 */
const REASON_FOR_CODE = {
    invitation_expired: 'expired',
    invitation_invalid: 'invalid',
    invitation_already_used: 'already-used',
    removed_from_group: 'removed',
    reentry_blocked: 'refused',
};
/**
 * The machine-readable `code` a node put beside its `error`, if any: on
 * mero-js's `HTTPError` it is in the body text, on an axios-style error in
 * `response.data`.
 */
function refusalCodeOf(err) {
    if (!err || typeof err !== 'object')
        return undefined;
    const shaped = err;
    if (typeof shaped.response?.data?.code === 'string')
        return shaped.response.data.code;
    if (typeof shaped.bodyText !== 'string')
        return undefined;
    try {
        const body = JSON.parse(shaped.bodyText);
        return typeof body?.code === 'string' ? body.code : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Which reason the message alone names, for a node that answers without a
 * useful status — older than rc.56, where every refusal was a bare 500 — or
 * without a `code`, or for a member's refusal quoted inside a retryable answer.
 *
 * Kept narrow on purpose. Anything not recognised here stays retryable, because
 * the cost of retrying a dead link is one more attempt, while the cost of
 * discarding a live one is someone who cannot join at all.
 */
function reasonFromMessage(message) {
    const m = message.toLowerCase();
    if (m.includes('invitation has expired') ||
        m.includes('invitation expired') ||
        // Core rc.56+ names the group between the words: "invitation for group
        // <id> expired at <secs>".
        /\binvitation for group .+? expired at \d+/.test(m)) {
        return 'expired';
    }
    if (m.includes('malformed') ||
        m.includes('does not match namespace_id') ||
        m.includes('invalid invitation') ||
        /\binvitation for group .+? is invalid:/.test(m)) {
        return 'invalid';
    }
    // Core's own words for a spent link and a removal (`MembershipError`), which a
    // refusing member also quotes back to the joiner.
    if (m.includes('has already used this invitation'))
        return 'already-used';
    if (/\bwas removed from group\b/.test(m))
        return 'removed';
    return null;
}
/**
 * The reasons that are final whatever status carried them: no later attempt
 * with this link can succeed for this person.
 */
const FINAL_FROM_TEXT = new Set(['already-used', 'removed']);
/**
 * Why a join failed, and whether a later attempt could work.
 *
 * The status decides where there is one. A 4xx the node chose is a definitive
 * answer about this invitation or this person, so it is not retried; a 5xx or
 * no answer at all is about the moment, so it is. Two exceptions keep an
 * invitation that is still good: a 401 is the client's session, not the
 * invitation, and a 404 is not specific enough to throw a link away on.
 */
function classifyJoinFailure(err, message) {
    // The join never left: the relay session it needed could not be minted. Says
    // nothing about the invitation, which is kept for after a sign-in or a retry.
    if (err instanceof RelayLoginError) {
        return { reason: err.kind === 'signed-out' ? 'signed-out' : 'node-unreachable', retryable: true };
    }
    const { kind, status } = classifyError(err);
    const fromText = reasonFromMessage(message);
    // A code is the node naming the refusal itself: nothing below can know better.
    const code = refusalCodeOf(err);
    const fromCode = code ? REASON_FOR_CODE[code] : undefined;
    if (fromCode)
        return { reason: fromCode, retryable: false };
    // A spent link or a removal is final even when a member said it inside a
    // retryable answer (a 503 for a join every peer refused): asking again only
    // asks the same members, who will say the same.
    if (fromText && FINAL_FROM_TEXT.has(fromText))
        return { reason: fromText, retryable: false };
    // Any other member refusal is not "no one is online": someone answered, and
    // their words are the message. Kept, since a member behind on the team's
    // history refuses what it has not seen yet.
    if (code === 'join_refused_by_member')
        return { reason: 'unknown', retryable: true };
    if (status === 401)
        return { reason: 'signed-out', retryable: true };
    if (status === 400)
        return { reason: fromText ?? 'invalid', retryable: false };
    if (status === 410)
        return { reason: 'expired', retryable: false };
    if (status === 403)
        return { reason: 'refused', retryable: false };
    // An expired invitation, a spent one, a member who was removed or blocked:
    // every 409 a join can answer is final.
    if (status === 409)
        return { reason: fromText ?? 'refused', retryable: false };
    if (kind === 'unavailable')
        return { reason: 'no-one-online', retryable: true };
    if (kind === 'unreachable')
        return { reason: 'node-unreachable', retryable: true };
    // A 500 from a node older than rc.56 may still be a refusal in disguise;
    // anything else has only its message to go on.
    if (fromText)
        return { reason: fromText, retryable: false };
    return { reason: 'unknown', retryable: true };
}
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
export async function redeemInvitation(parsed, redeemer) {
    const { namespaceId, invitation, teamName } = parsed;
    let joinError = null;
    try {
        await redeemer.join(namespaceId, invitation);
    }
    catch (err) {
        joinError = err;
    }
    // The request resolving is proof on its own, so this must not be able to
    // demote a real join: a `memberships()` that throws is "could not tell".
    let listed = null;
    try {
        listed = (await redeemer.memberships()).includes(namespaceId);
    }
    catch {
        listed = null;
    }
    if (joinError === null) {
        return { status: 'joined', namespaceId, teamName };
    }
    if (listed === true) {
        // The join landed despite the error — an aborted request, or a link
        // followed twice.
        return { status: 'already-member', namespaceId, teamName };
    }
    const message = messageOf(joinError, 'Could not join. Check the invitation.');
    const { reason, retryable } = classifyJoinFailure(joinError, message);
    return { status: 'failed', namespaceId, message, reason, retryable };
}
