/**
 * Bootstrapping an account that is a member of nothing, from an invitation.
 *
 * # The one missing step
 *
 * A freshly enrolled account holds a certified device and belongs to no
 * namespace, so `CloudClient.getAccountRelays` answers `[]` — correctly, because
 * nothing serves an account that is a member of nothing. It is still signed in;
 * what it has no way to do is write. An invitation is what changes that, and the
 * chain is:
 *
 *     invitation → namespaceId → a node URL
 *                → POST the signed join to that node  → the account is a member
 *                → that same node is the relay, from this moment
 *                → a fleet relay writes the recovery envelope asynchronously,
 *                  and getAccountRelays() agrees from then on
 *
 * The session does not wait for the cloud to catch up. The node that carried the
 * join is known to serve the namespace now; the lookup will agree later.
 *
 * # Where the node URL comes from, in preference order
 *
 * 1. one the caller passes in, such as an operator's or a local rig's;
 * 2. the cloud's `/api/cloud/namespaces/{ns}/admitters`, intersected with the
 *    invitation's signed `admitters`, see `resolveRelayFromInvitation`.
 *
 * Never from the invitation, signed or not: the inviter may be the attacker.
 *
 * # Nothing here is minted, weakened or worked around
 *
 * The credential and the device secret come from the enrolment the wallet
 * already performed. The op is signed by that device key, which is what stops an
 * admitter substituting a different member. The admitters intersection is done in
 * `resolveRelayFromInvitation` and is never relaxed.
 */
import type { SignedGroupOpenInvitation } from '../admin-api/index.js';
import type { DelegatedCredential, DelegatedSession } from './session.js';
import { joinWithNode, type JoinWithNodeStep } from './join-with-node.js';
import { resolveRelayFromInvitation, type RelayResolutionStep, type ResolvedInvitationRelay } from './relay-from-invitation.js';
/**
 * Which step failed. One exhaustive list to branch on: the relay-resolution
 * steps, the two `joinWithNode` reports, and the one only a hook can hit.
 *
 * - `no-credential` — this tab holds no enrolled account, so there is nothing to
 *   admit. Only {@link useDelegatedBootstrap} can report it;
 *   `bootstrapFromInvitation` is handed the credential as an argument.
 */
export type BootstrapStep = RelayResolutionStep | JoinWithNodeStep | 'no-credential';
export interface BootstrapSuccess {
    readonly ok: true;
    /** The session to connect with — hand it straight to `connectWithAccount`. */
    readonly session: DelegatedSession;
    /**
     * How the node was chosen, when the cloud chose it.
     *
     * `null` when the caller named the node itself, because then there was no
     * routing read to report — not because anything was skipped.
     */
    readonly relay: ResolvedInvitationRelay | null;
    /**
     * Whether the admitter said it published the op.
     *
     * NOT "you are a member": membership lands when peers apply the op, which the
     * admitter neither performs nor waits for. `false` with no error means the node
     * took the call and did not publish — worth surfacing rather than treating as
     * success.
     */
    readonly published: boolean;
}
export interface BootstrapFailure {
    readonly ok: false;
    readonly step: BootstrapStep;
    readonly reason: string;
    /** The HTTP status, when the failing step was an HTTP call. */
    readonly status?: number;
}
export type BootstrapResult = BootstrapSuccess | BootstrapFailure;
export interface BootstrapFromInvitationInput {
    /** The namespace the invitation admits you to, 64 hex. */
    readonly namespaceId: string;
    /** The invitation, exactly as the inviter's node returned it. */
    readonly invitation: SignedGroupOpenInvitation;
    /** The enrolled account, its certificate, and the device secret. */
    readonly credential: DelegatedCredential;
    /**
     * A node to present the join to, skipping the cloud lookup.
     *
     * For a node the caller already knows (an operator's, a local rig); never one
     * from the invitation. Without it the cloud's lookup answers, narrowed by the signed admitters.
     */
    readonly nodeUrl?: string;
    /** Point at a cloud other than the hosted manager. For local rigs. */
    readonly cloudBaseUrl?: string;
    /** Injected in tests. */
    readonly deps?: {
        readonly resolve?: typeof resolveRelayFromInvitation;
        readonly join?: typeof joinWithNode;
        readonly fetch?: typeof fetch;
        readonly nonce?: () => Promise<bigint>;
    };
}
/**
 * Resolve a node from the invitation, present the signed join to it, and return
 * the session to connect with.
 *
 * Never throws for an expected failure: every one of them is a different thing
 * for the person to do, so they come back as `{ ok: false, step, reason }`. A
 * generic "could not join" is exactly what this shape exists to prevent.
 */
export declare function bootstrapFromInvitation(input: BootstrapFromInvitationInput): Promise<BootstrapResult>;
