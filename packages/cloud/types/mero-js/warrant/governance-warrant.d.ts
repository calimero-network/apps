/**
 * Mint a governance warrant: the author's consent for one relay to publish one
 * governance op in the author's name, once.
 *
 * The intent warrant lets an account with no node write to a context and the
 * creation warrant lets it create one. This covers the governance around them:
 * adding the other person to a DM, creating a channel's subgroup, changing a
 * role. The relay wraps the op in `OnBehalf` and publishes it; every peer applies
 * the inner op **as the author**, so the author's own authority decides
 * (`MANAGE_MEMBERS` to add a member, `CAN_CREATE_SUBGROUP` to create a subgroup,
 * and so on) and the relay needs only standing to act for members.
 *
 * **It commits to the op's bytes.** The warrant carries
 * `H(kind || op bytes)` over the op's delegable form (see `governance-op.ts`), so
 * what the op does, to whom and where is signed byte for byte and the relay
 * chooses nothing about it. `kind` is inside the commitment, so a group op can
 * never be presented as a root op whose bytes happen to coincide.
 *
 * **`scope` is where the op is published**: the group itself for a group op,
 * the namespace for a root op.
 *
 * Same primitives and the same two-widths trap as `warrant.ts`: counts inside
 * the encoding are borsh `u32`, counts in the signing preimage are `u64`.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/governance_wire_fixture.rs`, and this module's test
 * asserts the same vectors. A drift would surface at a relay as a 400.
 */
import { type Signer } from '../signer/signer.js';
import type { GovernanceOp, GovernanceOpKind } from './governance-op.js';
/** What a governance warrant authorises. */
export interface GovernanceWarrantInput {
    /**
     * Where the op is published, hex (32 bytes): the group for a group op, the
     * namespace for a root op. The relay refuses a warrant presented anywhere else.
     */
    scope: string;
    /** The op, from one of the encoders in `governance-op.ts`. Its kind is signed over. */
    op: GovernanceOp;
    /** The author's account, hex: whose authority the op is applied under. */
    authorAccount: string;
    /** The relay's account, hex: the subject its authorship grant is held by. */
    executor: string;
    /** The one signing key of `executor` that may publish it, hex: discovery's `executorKey`. */
    executorKey: string;
    /**
     * Monotonic per author **device**, spent in a per-group ledger. The same
     * nonce source `RelayClient` uses for every other warrant is correct.
     */
    nonce: number | bigint;
    /** Unix seconds after which the relay must refuse it. */
    notAfter: number | bigint;
    /** Account-log heads the author saw, each hex (32 bytes). At most 64. */
    accountHeads?: string[];
    /** Governance heads the author's view descended from, each hex (32 bytes). At most 64. */
    governanceFloor?: string[];
    /**
     * The author device's ed25519 signing secret, hex (32 bytes). Never sent.
     *
     * Mutually exclusive with {@link GovernanceWarrantInput.signer}: exactly one is required.
     * Prefer `signer` in a browser, since a secret held as a string is readable
     * by anything on the origin.
     */
    deviceSecret?: string;
    /**
     * The author device's signer, in place of {@link GovernanceWarrantInput.deviceSecret}: for a
     * key that cannot be exported to hex (a non-extractable WebCrypto key, a
     * passkey, a hardware or remote signer). Its `publicKey` becomes the
     * warrant's `author_device_key`, and it signs the 32-byte preimage as is.
     */
    signer?: Signer;
}
/** A governance warrant's fields, decoded from the wire encoding. */
export interface GovernanceWarrantFields {
    scope: string;
    kind: GovernanceOpKind;
    authorAccount: string;
    /** The author device key: the signer's public key. */
    deviceKey: string;
    executor: string;
    executorKey: string;
    opHash: string;
    accountHeads: string[];
    governanceFloor: string[];
    nonce: bigint;
    notAfter: bigint;
    signature: string;
}
/**
 * The commitment a governance warrant carries in place of the op:
 * `H(kind || op bytes)` under its own domain.
 */
export declare function governanceOpHash(op: GovernanceOp): Promise<Uint8Array>;
/** The already-decoded fields the signature covers. Internal. */
export interface GovernancePreimageParts {
    scope: Uint8Array;
    kind: GovernanceOpKind;
    authorAccount: Uint8Array;
    deviceKey: Uint8Array;
    executor: Uint8Array;
    executorKey: Uint8Array;
    opHash: Uint8Array;
    accountHeads: Uint8Array[];
    governanceFloor: Uint8Array[];
    nonce: number | bigint;
    notAfter: number | bigint;
}
/**
 * The bytes the device key signs. Exported for the conformance test only, not
 * from the package root.
 */
export declare function governanceWarrantPreimage(p: GovernancePreimageParts): Promise<Uint8Array>;
/**
 * Sign a governance warrant and return it hex-encoded (borsh
 * `GovernanceWarrant`), ready for the relay alongside the op's own bytes.
 */
export declare function signGovernanceWarrant(input: GovernanceWarrantInput): Promise<string>;
/**
 * Decode a hex governance warrant back into its fields.
 *
 * Refuses truncated or trailing bytes and an unknown kind. Does not verify the
 * signature.
 */
export declare function parseGovernanceWarrant(warrant: string): GovernanceWarrantFields;
