/**
 * Which owner-level op a proof authorises. The value is the byte core signs,
 * its `OwnerOpKind` discriminant.
 */
export declare const OWNER_OP_KIND: {
    readonly transferOwnership: 0;
    readonly adminChanged: 1;
    readonly groupDelete: 2;
    readonly teeAdmissionPolicy: 3;
    readonly teeAuthoringPolicy: 4;
    readonly teeReleaseAdmissionPolicy: 5;
};
export type OwnerOpKind = keyof typeof OWNER_OP_KIND;
/** Which plane the op is on: a `GroupOp` on a group, or a `RootOp` on the namespace. */
export type OwnerOpPlane = 'group' | 'root';
/** An encoded owner-level op: its borsh bytes, its kind and its plane. */
export interface OwnerOp {
    kind: OwnerOpKind;
    plane: OwnerOpPlane;
    /** The op's borsh bytes: exactly what the node builds, and what the digest covers. */
    bytes: Uint8Array;
}
/** Hand the group to `newOwner` (an account, hex), who must already be an admin. */
export declare function transferOwnershipOp(newOwner: string): OwnerOp;
/** The owner-only deletion of a group that holds no contexts. */
export declare function groupDeleteOp(): OwnerOp;
/** Repoint the namespace's admin pin at `newAdmin` (an account, hex). A root op. */
export declare function adminChangedOp(newAdmin: string): OwnerOp;
/** The TEE authoring policy `PUT`/`DELETE …/settings/tee-authoring-policy` publishes. */
export declare function teeAuthoringPolicyOp(allowedMrtd: string[]): OwnerOp;
/** A measurement-list admission policy, as the node publishes it (the V2 form). */
export interface TeeAdmissionPolicyOpInput {
    allowedMrtd: string[];
    allowedRtmr0: string[];
    allowedRtmr1: string[];
    allowedRtmr2: string[];
    allowedRtmr3: string[];
    allowedTcbStatuses: string[];
    acceptMock: boolean;
    mode?: 'replica' | 'relay';
}
/**
 * The measurement-list admission policy `PUT …/settings/tee-admission-policy`
 * publishes. Pass the fields exactly as you send them: the node signs over the
 * op it builds from them, and any difference is a different op.
 */
export declare function teeAdmissionPolicyOp(input: TeeAdmissionPolicyOpInput): OwnerOp;
/** A signed-release admission policy, as the node publishes it (the V2 form). */
export interface TeeReleaseAdmissionPolicyOpInput {
    allowedProfiles: string[];
    /**
     * The oldest release admitted. Give it in the node's normalised form
     * (`X.Y.Z`, no tag prefix): the node normalises what it is sent before it
     * builds the op, and the proof must be for the op it builds.
     */
    minReleaseVersion?: string;
    allowedTcbStatuses: string[];
    acceptMock: boolean;
    mode?: 'replica' | 'relay';
}
/** The signed-release admission policy `PUT …/settings/tee-admission-policy` publishes. */
export declare function teeReleaseAdmissionPolicyOp(input: TeeReleaseAdmissionPolicyOpInput): OwnerOp;
/** core's `OwnerOpAuthorization::op_digest`: the op's bytes, hashed under the body domain. */
export declare function ownerOpDigest(opBytes: Uint8Array): Promise<Uint8Array>;
/** What an owner-op proof binds, apart from the op and the key that signs it. */
export interface OwnerOpProofInput {
    /** The account root's signing secret, 64 hex. Never sent anywhere. */
    rootSecret: string;
    /** The namespace the op is published in (`getGroupInfo(...).namespaceId`), hex. */
    namespaceId: string;
    /**
     * The group the op acts on, hex. For `adminChanged` and the TEE policies,
     * the namespace root.
     */
    groupId: string;
    /** The op, from one of the encoders here. */
    op: OwnerOp;
    /** The group's current guarded-op counter (`getGroupInfo(groupId).ownerOpCounter`). */
    counter: number | bigint;
    /**
     * The root epoch that signs, 0 for a root that has never been handed off.
     * A later epoch needs `chain`.
     */
    keyEpoch?: number;
    /**
     * The account's root-key handoffs, epoch 0 upward, each the hex borsh of a
     * `RootKeyHandoff` (account 32, from_epoch u32, new root key 32, signature
     * 64). It must reach at least `keyEpoch`, and at least the epoch the group
     * has recorded for the account, or the node refuses the proof.
     */
    chain?: string[];
}
/** core's `OwnerOpTerms::signing_payload`. */
export declare function ownerOpSigningPayload(input: {
    account: string;
    namespaceId: string;
    groupId: string;
    kind: OwnerOpKind;
    opDigest: Uint8Array;
    counter: number | bigint;
    keyEpoch: number;
}): Promise<Uint8Array>;
/**
 * Sign a root proof for `op` and return it as core's `rootProof`: the hex
 * borsh of an `AccountProof<OwnerOpAuthorization>`.
 *
 * Layout: `AccountGenesis` (version u8 + root pk 32), the handoff chain (u32
 * count + 132 bytes each), then `OwnerOpAuthorization` (account 32, namespace
 * 32, group 32, kind u8, op digest 32, counter u64, key epoch u32, signature
 * 64).
 */
export declare function signOwnerOpProof(input: OwnerOpProofInput): Promise<string>;
/**
 * The `RootGuarded` wrapper core publishes: the op and its proof, as one
 * `GroupOp` or `RootOp`. A client never sends this to a node (the endpoints
 * take the proof and build the wrapper); it is here so the whole encoding is
 * checkable against core's vector.
 */
export declare function rootGuardedOpBytes(op: OwnerOp, rootProof: string): Uint8Array;
