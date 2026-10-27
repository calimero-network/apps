/**
 * Minting a group invitation without a node.
 *
 * An invitation is not a governance op. Nothing is published when one is made:
 * it is a bearer credential, `GroupInvitationFromAdmin` borsh-encoded, hashed
 * with SHA-256 and signed by the inviter's key. A node mints one with its own
 * namespace key; an account with **no node** signs it here with its device key.
 *
 * Every peer that later folds the join resolves `inviter_identity` — the
 * signing key — to an account through the namespace's device bindings, and then
 * checks that account holds admin or `CAN_INVITE_MEMBERS` at the join's causal
 * cut. So the device key must be **bound** in the namespace first. It is when
 * the account joined through an invitation; an account that was added by
 * account (`MemberAdded`) has no binding, and a relay has to carry its device
 * link first — see `AdminApiClient.linkAccountDevice` and `signDeviceScope`.
 * Without that, every peer refuses the join as signed by a key "bound to no
 * account".
 *
 * Derived from core:
 *
 * - `GroupInvitationFromAdmin` / `SignedGroupOpenInvitation` —
 *   `crates/context/config/src/types.rs`
 * - the signing — `crates/context/src/handlers/create_group_invitation.rs`:
 *   `sign(sha256(borsh(invitation)))`
 * - the admitter default — `NamespaceMembershipService::default_admitters`
 *
 * The unit tests pin bytes and a signature produced by core's own types.
 */
import type { GroupInvitationFromAdmin, GroupMember, SignedGroupOpenInvitation } from '../admin-api/admin-types.js';
import { type Signer } from '../signer/signer.js';
/**
 * Core's `MAX_INVITATION_VALIDITY_SECS`: one day. Core clamps what a node mints
 * to it, and this does the same, so a leaked invitation is redeemable no longer
 * than one a node would have issued.
 */
export declare const MAX_INVITATION_VALIDITY_SECS: number;
/** `invited_role` values, as core numbers them. */
export declare const INVITED_ROLE: {
    readonly Admin: 0;
    readonly Member: 1;
    readonly ReadOnly: 2;
};
/** Borsh-encode the signed body of an invitation, field for field with core. */
export declare function encodeGroupInvitation(body: GroupInvitationFromAdmin): Uint8Array;
/** `sha256(borsh(invitation))`: the 32 bytes the inviter's key signs. */
export declare function groupInvitationHash(body: GroupInvitationFromAdmin): Promise<Uint8Array>;
/**
 * The admitters a node names when its caller names none: the group's admins,
 * sorted by account bytes and deduplicated, as core's `BTreeSet` leaves them.
 *
 * Core also adds TEE-admitted accounts, which a member list cannot tell apart
 * from members by role alone; name those in `admitters` explicitly.
 */
export declare function defaultAdmitters(members: readonly GroupMember[]): string[];
/** What {@link signGroupInvitation} needs. */
export interface GroupInvitationInput {
    /** The group (or namespace) invited to, 64 hex. */
    groupId: string;
    /**
     * The account the inviter acts as, 64 hex. An unsigned bootstrap hint the
     * joiner seeds the group's admin view from; it confers nothing.
     */
    inviterAccount: string;
    /** The device key as a {@link Signer}. Pass this or {@link deviceSecret}. */
    signer?: Signer;
    /** The device signing secret, 64 hex. Pass this or {@link signer}. */
    deviceSecret?: string;
    /**
     * Accounts permitted to admit a claim, 64 hex each. Signed.
     *
     * Omitted or empty, it defaults to the group's admins, which is what a node
     * does — pass {@link members} (from `listGroupMembers`) to derive them. An
     * empty list would mean *claimable by broadcast*, which publishes the
     * invitation to every subscriber of the namespace topic, so this never
     * produces one.
     */
    admitters?: readonly string[];
    /** The group's members, to default {@link admitters} from. */
    members?: readonly GroupMember[];
    /**
     * The role granted, as {@link INVITED_ROLE} numbers it. Defaults to Member.
     * Only an admin may invite an admin; peers refuse the join otherwise.
     */
    invitedRole?: number;
    /**
     * Seconds from now until it expires, clamped to
     * {@link MAX_INVITATION_VALIDITY_SECS} (also the default).
     */
    validForSecs?: number;
    /** Unix seconds to count from. Defaults to the clock; for tests. */
    now?: number;
    /** The 32-byte uniqueness nonce. Defaults to fresh random bytes. */
    nonce?: Uint8Array;
    /** Unsigned bootstrap: the group's application id, 64 hex. */
    applicationId?: string;
    /** Unsigned bootstrap: the group's `app_key` (core's `bytecode_id`), 64 hex. */
    appKey?: string;
    /** Unsigned bootstrap: multiaddrs for the admitters, `/p2p/<peer>` included. */
    admitterAddrs?: readonly string[];
}
/**
 * Sign a group invitation with a device key, returning it in the JSON shape a
 * node's `createGroupInvitation` returns — so it goes to `joinGroup`,
 * `signMemberJoinOp` and `admitJoin` unchanged.
 */
export declare function signGroupInvitation(input: GroupInvitationInput): Promise<SignedGroupOpenInvitation>;
