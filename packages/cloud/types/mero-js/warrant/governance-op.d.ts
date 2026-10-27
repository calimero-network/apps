/**
 * Encode the governance ops a member may have a relay publish for them.
 *
 * A governance warrant commits to an op's **borsh bytes**, not to a description
 * of it, so the client has to produce exactly the bytes the node decodes. These
 * encoders cover the delegable ops (core's `GroupOp::delegable_form` and
 * `RootOp::delegable_form`) that a keyholder app is likely to need. Every
 * discriminant is a variant's position in core's enum, which is how borsh
 * encodes a Rust enum; they are pinned against core's own vectors in the test.
 *
 * **Delegable form.** A removal, a leave and a cascade delete carry fields only
 * the publisher can compute (post-state hashes, the enumerated subtree). The
 * member signs them cleared, and these encoders only ever produce the cleared
 * form, which is the one a relay accepts. The relay fills them in afterwards.
 *
 * Sources in core, for the next person to check a discriminant:
 * `crates/governance-types/src/lib.rs` (`GroupOp`, `RootOp`),
 * `crates/primitives/src/context.rs` (`GroupMemberRole`),
 * `crates/account/src/namespace_id.rs` (`founded_namespace_id`), and the vectors in
 * `crates/governance-types/src/tests.rs` (`delegated_governance_op_vectors_are_stable`).
 */
/**
 * Which plane an op is published on: `group` is a `GroupOp` on the group's own
 * log, `root` a `RootOp` on the namespace log. The kind is signed over, so
 * consent to one can never be presented as the other.
 */
export type GovernanceOpKind = 'group' | 'root';
/** An encoded governance op and the plane it belongs to. */
export interface GovernanceOp {
    kind: GovernanceOpKind;
    /** The op's borsh bytes in delegable form: what the warrant commits to. */
    bytes: Uint8Array;
}
/** A group member's role. Borsh discriminants follow core's `GroupMemberRole`. */
export type GovernanceMemberRole = 'Admin' | 'Member' | 'ReadOnly';
/**
 * Add `member` (an account, hex) to the group with `role`.
 *
 * Applied as the author: adding a `Member` needs `MANAGE_MEMBERS` or admin,
 * adding an `Admin` needs admin.
 */
export declare function memberAddedOp(member: string, memberRole: GovernanceMemberRole): GovernanceOp;
/**
 * Remove `member` (an account, hex) from the group, in delegable form: both
 * post-state claims cleared, for the relay to compute from its own view.
 */
export declare function memberRemovedOp(member: string): GovernanceOp;
/**
 * The author leaves the group, in delegable form. The node applies it only when
 * `member` is the author's own account.
 */
export declare function memberLeftOp(member: string): GovernanceOp;
/** Set `member`'s role (an account, hex). */
export declare function memberRoleSetOp(member: string, memberRole: GovernanceMemberRole): GovernanceOp;
/**
 * The id `admin` derives for a subgroup under `parentId` with birth visibility
 * `restricted` and `salt` (all hex), as core's `created_subgroup_id` does:
 * `domain_hash("calimero.subgroup.id.v1", [admin, parentId, [restricted], salt])`.
 *
 * A subgroup's id is bound to its create, so nobody but its creator can name
 * it: a node refuses a `GroupCreated` whose fields do not reproduce its id.
 * That is what stops a second member racing a concurrent create for an id it
 * saw gossiped.
 */
export declare function createdSubgroupId(admin: string, parentId: string, restricted: boolean, salt: string): Promise<string>;
/**
 * Choose the application a group runs (`GroupOp::TargetApplicationSet`), in
 * its delegable form: `bytecode_id` is left for the relay to fill (32 zero
 * bytes), resolved from `package@version` in the registry. The member signs
 * the application id, package and version, so the relay can pick no other
 * build; the application id binds package and signer, and every node checks
 * the bundle's signature.
 *
 * Through a relay this is accepted only as a group's FIRST application, on a
 * group that targets none yet (a namespace an account founded). Moving an
 * existing target is an upgrade, which never goes through a relay.
 */
export declare function targetApplicationSetOp(input: {
    applicationId: string;
    package: string;
    version: string;
}): GovernanceOp;
export declare function defaultCapabilitiesSetOp(capabilities: number): GovernanceOp;
/** What a subgroup is created with. */
export interface GroupCreatedInput {
    /**
     * The new subgroup's id, hex (32 bytes). It must be
     * `createdSubgroupId(admin, parentId, restricted, salt)`; a node refuses any
     * other. {@link subgroupCreation} draws the salt and derives it for you.
     */
    groupId: string;
    /** The group it is nested under, hex: the namespace root or an existing subgroup. */
    parentId: string;
    /** `true` for a Restricted subgroup, `false` for born-Open (the default). */
    restricted: boolean;
    /**
     * The subgroup's founding admin, hex: the **author's** account. The node
     * refuses any other, since the op is applied as the author.
     */
    admin: string;
    /** The salt `groupId` was derived with, hex (32 bytes). Random; need not be kept. */
    salt: string;
}
/**
 * Create a subgroup under `parentId`, a root op published on the namespace.
 *
 * Needs `CAN_CREATE_SUBGROUP` or admin on the parent; the author, not the
 * relay, becomes the new subgroup's admin.
 */
export declare function groupCreatedOp(input: GroupCreatedInput): GovernanceOp;
/** A new subgroup's create: its derived id, the salt it was derived with, and the op. */
export interface SubgroupCreation {
    groupId: string;
    salt: string;
    op: GovernanceOp;
}
/**
 * Create a subgroup under `parentId`: draws a fresh salt (unless one is given),
 * derives the id with {@link createdSubgroupId}, and encodes the op.
 */
export declare function subgroupCreation(input: Omit<GroupCreatedInput, 'groupId' | 'salt'> & {
    salt?: string;
}): Promise<SubgroupCreation>;
/** Move `childGroupId` under `newParentId`, a root op. */
export declare function groupReparentedOp(childGroupId: string, newParentId: string): GovernanceOp;
/**
 * Delete `rootGroupId` and its subtree, in delegable form: both cascade lists
 * empty, for the relay to enumerate.
 */
export declare function groupDeletedOp(rootGroupId: string): GovernanceOp;
/**
 * The id of the namespace `founder` founds with `salt`: core's
 * `founded_namespace_id`, `domain_hash("calimero.namespace.id.v1", [founder, salt])`.
 *
 * Anyone holding the pair can recompute it, and only the founder's account
 * hashes to it, which is why a relay founding a namespace for a member cannot
 * choose the id: the member computes it and signs it.
 */
export declare function foundedNamespaceId(founder: string, salt: string): Promise<string>;
/** What a namespace is founded with. */
export interface NamespaceCreatedInput {
    /** The founding account, hex: the **author's**. It becomes founder, owner and admin. */
    founder: string;
    /**
     * The founder's `AccountProof<DeviceCert>`, hex: the credential the author
     * already presents as `authorProof`. Its account must be `founder` and its
     * device key the one that signs the warrant; the genesis apply checks both
     * and binds the founder's device from it.
     */
    credential: string;
    /**
     * The salt the namespace id is derived with, hex (32 bytes). Choose it at
     * random; {@link foundedNamespaceId} gives the id it yields.
     */
    salt: string;
}
/**
 * Found a namespace: core's `RootOp::NamespaceCreatedV2` genesis, a root op
 * published on the new namespace's own log.
 *
 * Its delegable form is the op itself, nothing cleared, so the author signs the
 * exact genesis. Borsh is `[9] || founder || credential || salt`: the credential
 * is a nested struct, not a length-prefixed byte string, so it is written
 * inline. The warrant's scope must be {@link foundedNamespaceId}`(founder, salt)`.
 */
export declare function namespaceCreatedOp(input: NamespaceCreatedInput): GovernanceOp;
/** Set `member`'s capabilities in the group (`GroupOp::MemberCapabilitySet`). Bit 9 is refused. */
export declare function memberCapabilitySetOp(member: string, capabilities: number): GovernanceOp;
/** Detach a context from the group (`GroupOp::ContextDetached`). */
export declare function contextDetachedOp(contextId: string): GovernanceOp;
/** Make a subgroup open (members of the parent may join it themselves) or restricted. */
export declare function subgroupVisibilitySetOp(mode: 'open' | 'restricted'): GovernanceOp;
/** Name the group, with optional key/value data (`GroupOp::GroupMetadataSet`). */
export declare function groupMetadataSetOp(input?: {
    name?: string;
    data?: Record<string, string>;
}): GovernanceOp;
/** Name a member in the group (`GroupOp::MemberMetadataSet`). */
export declare function memberMetadataSetOp(member: string, input?: {
    name?: string;
    data?: Record<string, string>;
}): GovernanceOp;
/** Name a context in the group (`GroupOp::ContextMetadataSet`). */
export declare function contextMetadataSetOp(contextId: string, input?: {
    name?: string;
    data?: Record<string, string>;
}): GovernanceOp;
/** Grant `member` a per-context capability (`GroupOp::ContextCapabilityGranted`). */
export declare function contextCapabilityGrantedOp(contextId: string, member: string, capability: number): GovernanceOp;
/** Revoke a per-context capability from `member` (`GroupOp::ContextCapabilityRevoked`). */
export declare function contextCapabilityRevokedOp(contextId: string, member: string, capability: number): GovernanceOp;
/**
 * Join an open subgroup yourself (`RootOp::MemberJoinedOpen`), a root op posted
 * to the namespace. `member` must be the author; `credential` is the author's
 * own `AccountProof<DeviceCert>`, hex, carried as-is. The author's
 * `CAN_JOIN_OPEN_SUBGROUPS` and the open inheritance path are checked as usual.
 */
export declare function memberJoinedOpenOp(input: {
    member: string;
    groupId: string;
    credential: string;
}): GovernanceOp;
