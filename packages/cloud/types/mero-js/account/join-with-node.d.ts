/**
 * Present a signed join to ONE named node.
 *
 * This is the whole of admission for a caller with no node of its own: sign the
 * membership op with the device key the account certified, and POST it to a node
 * the invitation named as an admitter.
 *
 *     POST /admin-api/namespaces/{namespaceId}/admit
 *     { "invitation": SignedGroupOpenInvitation, "signedOp": "<hex borsh SignedNamespaceOp>" }
 *
 * Verified against core at rc.43 — `crates/server/src/admin/handlers/namespaces/
 * admit_join.rs`, request type `AdmitJoinApiRequest` in
 * `crates/server/primitives/src/admin/mod.rs`. The handler also refuses a
 * mismatch between the invitation's `group_id` and the namespace in the path, so
 * the two are never allowed to disagree here.
 *
 * ## Why it needs no token and no proof
 *
 * The joiner's signature IS the authorization. The op is signed by the device
 * key named in the credential it carries, and every peer checks
 * `signer == credential.statement.sign_pk` before applying a join — so an
 * admitter can carry this and can never author it: it cannot admit a different
 * account, change the group, or grant a role. It can refuse, and that is all.
 * This is also why core serves the route without a credential (it sits on the
 * public admin router, beside `/health` and the intent routes, on every node
 * whatever its auth mode), why the fleet ingress exempts the one anchored path,
 * and why this posts with `fetch` rather than through `AdminApiClient`, which is
 * built around a node credential this caller does not have. A node that predates
 * that change and runs embedded auth answers 401 here; the failure is reported at
 * the `admit` step like any other refusal.
 *
 * ## Why the op has no parents
 *
 * A keyholder holds no node, so it has no view of the namespace DAG and cannot
 * name its heads. Empty parents is the only thing it *can* sign, and the direct
 * admission path exists precisely for callers in that position.
 */
import { type SignedGroupOpenInvitation } from '../admin-api/index.js';
import type { DelegatedCredential, DelegatedSession } from './session.js';
/** Which step failed, when one did. */
export type JoinWithNodeStep = 
/** The op could not be signed. Local, deterministic, and nothing was sent. */
'sign'
/** The node refused it, or could not be reached. */
 | 'admit';
export interface JoinWithNodeSuccess {
    readonly ok: true;
    /**
     * Whether the admitter said it published the op.
     *
     * NOT "you are a member": membership lands when peers apply the op, which the
     * admitter neither performs nor waits for.
     */
    readonly published: boolean;
    /**
     * The session to connect with — the admitting node, used immediately.
     *
     * Deliberately not waiting for `getAccountRelays` to answer: the fleet writes
     * the account's recovery envelope asynchronously, so the cloud lookup lags the
     * admission by an unpredictable amount. The node that just carried the join is
     * known to serve this namespace right now, which is a better answer than a
     * lookup that will agree later.
     */
    readonly session: DelegatedSession;
}
export interface JoinWithNodeFailure {
    readonly ok: false;
    readonly step: JoinWithNodeStep;
    readonly reason: string;
    /** The HTTP status, when the node answered with one. */
    readonly status?: number;
}
export type JoinWithNodeResult = JoinWithNodeSuccess | JoinWithNodeFailure;
export interface JoinWithNodeInput {
    /**
     * The node to present the join to — its admin API origin.
     *
     * Resolved from the cloud's `/admitters` lookup or supplied by the caller;
     * never read off the invitation, signed or not: the inviter may be the attacker.
     */
    readonly nodeUrl: string;
    /**
     * The exact URL to POST to, when something already knows it.
     *
     * The cloud hands back a ready-made `admit_url` which need not be a path on
     * `nodeUrl`'s origin, and rebuilding it from a guess is how a working
     * admission becomes a 404. Omitted, the documented route on `nodeUrl` is used.
     */
    readonly admitUrl?: string;
    /** The namespace being joined, 64 hex. Must match the invitation's group. */
    readonly namespaceId: string;
    /**
     * The invitation, exactly as the inviter's node returned it.
     *
     * Passed through unchanged and never rebuilt field by field: the signature
     * covers the body, and re-modelling it through a local type drops the unsigned
     * bootstrap fields and invalidates the signature with them.
     */
    readonly invitation: SignedGroupOpenInvitation;
    /** The enrolled account, its certificate, and the device secret that signs. */
    readonly credential: DelegatedCredential;
    /** Injected in tests. */
    readonly deps?: {
        readonly fetch?: typeof fetch;
        readonly nonce?: () => Promise<bigint>;
    };
}
/**
 * Sign the membership op and present it to `nodeUrl`.
 *
 * Resolves rather than throws for every expected refusal, because they are
 * different things for the person to do: a malformed op is final, an unreachable
 * node is a retry, and a 409 means pick another admitter.
 */
export declare function joinWithNode(input: JoinWithNodeInput): Promise<JoinWithNodeResult>;
