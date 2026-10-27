/**
 * Sign a namespace governance op from the SDK — specifically the membership op a
 * keyholder needs to join without running a node.
 *
 * `admitJoin` carries an already-signed op to a node the inviter named as an
 * admitter. Producing that op is the piece a keyholder could not do before: the
 * op must be signed by the device key in the credential it carries, because every
 * peer checks `signer == credential.statement.sign_pk` when applying a join. An
 * admitter can relay it and can never author it.
 *
 * The encoding is borsh, hand-written to match core's structs. Correctness is not
 * asserted against bytes recorded here — a layout transcribed by eye is exactly
 * how a golden ends up confidently wrong. It is asserted by a node accepting the
 * op, which is what the e2e does.
 */
import type { SignedGroupOpenInvitation } from '../admin-api/admin-types.js';
import { type Signer } from '../signer/signer.js';
/**
 * Core's `SIGNED_NAMESPACE_OP_SCHEMA_VERSION`. A node refuses any other value.
 *
 * 15: core went to 13 (TEE rows locked to the TEE roles, a TEE's relay role
 * read at its namespace root row, inherited read-only roles read-only in Open
 * subgroups), then 14 (`GroupOp::ContextRegisteredOnBehalf`) and 15
 * (`GroupOp::OnBehalf` / `RootOp::OnBehalf`) for delegated context creation and
 * governance through a relay. None of these changes a layout this module
 * signs; the version moves with core's so nodes on different versions never
 * share a namespace.
 *
 * 16: a namespace can be founded through a relay (a delegated
 * `NamespaceCreatedV2`), and `GroupOp::FoundingRelayAttested` lets that relay
 * admit itself as the namespace's first TEE. Again no layout this module signs.
 *
 * 17: `RootOp::GroupCreated` carries a `salt`, and its `group_id` must be the
 * one `createdSubgroupId(admin, parentId, restricted, salt)` derives
 * (calimero-network/core#4244), so two concurrent creates for one id can never
 * name different creators. The layout of that variant changed.
 *
 * 18: owner-level ops need the account ROOT, not only a device of it
 * (calimero-network/core, root-guarded owner ops). `GroupOp::RootGuarded` and
 * `RootOp::RootGuarded` are appended and carry a root-signed proof, and the bare
 * `TransferOwnership`, `AdminChanged`, `GroupDelete` and TEE policy ops are
 * refused. No layout this module signs changes; see `../owner-op` for the proof.
 *
 * 19 is reserved for calimero-network/core#4269.
 *
 * 20: no layout change. A delegated `GroupCreated` whose executor is a TEE at
 * the namespace root now seats that TEE in the new subgroup
 * (calimero-network/core#4276), an apply-time rule older peers disagree on.
 * Core signs and checks at 20, so every op this module signs must too.
 *
 * 21: no layout change. An op concurrent with its signer's removal is void
 * (calimero-network/core#4275), an apply-time rule older peers disagree on.
 * Core signs and checks at 21 from 0.11.0-rc.75. 23.4.0 and 23.4.1 still sign
 * at 20, so against rc.75 every namespace op an account signs with them (a
 * join, a create, any governance op) is refused "schema version mismatch:
 * expected 21, got 20".
 *
 * 22: `GroupOp::SharedWritersRotated` is appended, a `SharedStorage` cell's
 * writer-set step (calimero-network/core#4263), and a capability revoke voids
 * the member's concurrent ops that needed a removed bit
 * (calimero-network/core#4453). No layout this module signs changes.
 *
 * 23: a TEE admission op carries the quote it was admitted on and a TEE
 * authority evidence op the credential it was made for
 * (calimero-network/core#4265). Neither is an op this module signs, so only
 * the version byte moves. Core signs and checks at 23 from 0.11.0-rc.81, the
 * first release with both 22 and 23.
 *
 * 24: no layout change. Only a subgroup's creator may open it - flip it to
 * `Open` (calimero-network/core#4522) - an apply-time rule older peers
 * disagree on, since they let any of its admins open it. A UI that offers
 * "make public" should offer it to the creator alone.
 *
 * 25: no layout change; refused device link/unlink/descope ops are never logged.
 *
 * 26: no layout change. A device link's scope is judged against every
 * application the group may have targeted at the link's cut, not its live
 * target (calimero-network/core#4603), so replicas agree on a link that races
 * a target change; older peers judge it by fold order.
 *
 * 27: no layout change. The namespace founder is seated as an admin by the
 * genesis op itself, so a founder who transfers ownership stays a member
 * (calimero-network/core#4625); older peers seat her from the root's current
 * owner and drop her.
 */
export declare const SIGNED_NAMESPACE_OP_SCHEMA_VERSION = 27;
/**
 * Borsh-encode a `SignedGroupOpenInvitation`.
 *
 * Re-encoded rather than passed through, because it has to go inside the op that
 * gets signed. That makes this function version-locked to core: a field added to
 * the invitation and omitted here produces an op whose inner invitation no longer
 * matches the inviter's signature over it. That exact drift, in client-py, broke
 * 93 scenarios — the failure surfaces as `invalid invitation signature` and points
 * nowhere near the encoder.
 */
export declare function encodeSignedInvitation(signed: SignedGroupOpenInvitation): Uint8Array;
export interface SignMemberJoinInput {
    /** The namespace being joined, 64 hex. */
    readonly namespaceId: string;
    /** The account joining, 64 hex — the subject of the credential. */
    readonly member: string;
    /** The invitation, as the admin API returned it. */
    readonly invitation: SignedGroupOpenInvitation;
    /**
     * The joiner's `AccountProof<DeviceCert>`, hex — from `signDeviceCert`.
     *
     * Its `sign_pk` must be the public key of `deviceSecret`; a peer checks that
     * when applying the join and refuses otherwise.
     */
    readonly credential: string;
    /**
     * The device signing secret, 64 hex. Must match the credential's `sign_pk`.
     *
     * Mutually exclusive with {@link SignMemberJoinInput.signer}. A browser should
     * prefer the signer: joining is the one governance op a keyholder signs for
     * itself, and it should not need the key in a form script can read.
     */
    readonly deviceSecret?: string;
    /**
     * The joiner's signer — use instead of
     * {@link SignMemberJoinInput.deviceSecret} when the key cannot be exported.
     */
    readonly signer?: Signer;
    /**
     * Heads this op is written against. Empty means "signed against an empty head"
     * — which is NOT the same as genesis, and a node with a non-empty head will
     * reject it as stale rather than treat it as a first op.
     */
    readonly parentOpHashes?: readonly string[];
    /** Anti-replay nonce; a node keeps a window per signer. */
    readonly nonce: number | bigint;
    /**
     * When the join happened, unix seconds. Defaults to now.
     *
     * Carried only by `MemberJoinedAt`, which is the variant used whenever the
     * invitation expires — and since core clamps every invitation to
     * `MAX_INVITATION_VALIDITY_SECS`, that is every invitation. The variant is
     * inferred from the invitation rather than selected by a flag: an expiring
     * invitation joined with plain `MemberJoined` is refused at apply with
     * "expiration is set but joined_at is absent", which is not a mistake worth
     * leaving available.
     */
    readonly joinedAt?: number | bigint;
}
/**
 * Sign a `MemberJoined` (or `MemberJoinedAt`) namespace op and return it
 * borsh-encoded and hex — the `signedOp` that `admitJoin` takes.
 */
export declare function signMemberJoinOp(input: SignMemberJoinInput): Promise<string>;
