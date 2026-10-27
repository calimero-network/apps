/**
 * Mint a creation warrant: the author's consent for one relay to create one
 * context in one group, once.
 *
 * The intent warrant in `warrant.ts` lets an account with no node *write* to a
 * context; this lets it *create* one. The relay executes the warrant and
 * publishes `GroupOp::ContextRegisteredOnBehalf` carrying it, and every peer
 * checks the **author's** `CAN_CREATE_CONTEXT` (or admin) — the relay needs no
 * create rights of its own, only standing to act for members. The app's `init`
 * runs as the author's account.
 *
 * Same primitives and the same two-widths trap as `warrant.ts`: counts **inside
 * the encoding** are borsh `u32`, counts the **signing preimage** hashes are
 * `u64`. The two `Option<String>` labels add a third shape: on the wire an
 * option is a one-byte tag followed (when present) by a `u32`-prefixed string,
 * while the preimage hashes the tag and the bytes as two separate parts, the
 * bytes empty when absent. That is what keeps `None` and `Some("")` distinct in
 * both.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/creation_wire_fixture.rs`, and this module's test
 * asserts the same vectors. A drift would surface at a relay as a 403.
 */
import { type Signer } from '../signer/signer.js';
/** What a creation warrant authorises. */
export interface CreationWarrantInput {
    /** The group the context is created in, hex (32 bytes). */
    group: string;
    /**
     * The seed the node derives the new context's id from, hex (32 bytes).
     *
     * Optional: when absent, 32 random bytes are drawn and returned alongside the
     * warrant. Pass one only to make the id predictable — reusing a seed asks for
     * a context that already exists.
     */
    seed?: string;
    /** The author's account, hex — whose consent this is, and who runs `init`. */
    authorAccount: string;
    /** The relay's account, hex: the subject its authorship grant is held by. */
    executor: string;
    /** The one signing key of `executor` that may carry it out, hex: discovery's `executorKey`. */
    executorKey: string;
    /** The application the context is created with, hex (32 bytes). */
    applicationId: string;
    /**
     * Which service of a multi-service bundle, or absent for the default.
     *
     * Absent and `""` are different values and sign differently. At most 256
     * UTF-8 bytes.
     */
    serviceName?: string;
    /** A display name for the context, or absent. At most 256 UTF-8 bytes. */
    name?: string;
    /**
     * The JSON the app's `init()` will receive.
     *
     * Committed to rather than carried: the relay is sent the same value
     * separately and the node checks it hashes to what was signed, so pass the
     * exact value you will send. See {@link creationInitHash}.
     */
    initArgs: unknown;
    /**
     * Monotonic per author **device**. Spent in the *new* context's warrant
     * ledger, so the same per-device nonce source `RelayClient` uses is correct.
     */
    nonce: number | bigint;
    /** Unix seconds after which the relay must refuse it. */
    notAfter: number | bigint;
    /** Account-log heads the author saw, each hex (32 bytes). At most 64. */
    accountHeads?: string[];
    /**
     * Governance heads the author's view descended from, each hex (32 bytes). At
     * most 64. The same caveat as the intent warrant's floor applies: one the
     * relay supplied is one the relay chose.
     */
    governanceFloor?: string[];
    /**
     * The author device's ed25519 signing secret, hex (32 bytes). Never sent.
     *
     * Mutually exclusive with {@link CreationWarrantInput.signer}: exactly one is required.
     * Prefer `signer` in a browser, since a secret held as a string is readable
     * by anything on the origin.
     */
    deviceSecret?: string;
    /**
     * The author device's signer, in place of {@link CreationWarrantInput.deviceSecret}: for a
     * key that cannot be exported to hex (a non-extractable WebCrypto key, a
     * passkey, a hardware or remote signer). Its `publicKey` becomes the
     * warrant's `author_device_key`, and it signs the 32-byte preimage as is.
     */
    signer?: Signer;
}
/** A signed creation warrant and the seed it commits to. */
export interface SignedCreationWarrant {
    /** Hex borsh `ContextCreationWarrant`, ready for the relay. */
    warrant: string;
    /** The seed, hex — the one passed in, or the one drawn when none was. */
    seed: string;
}
/** A creation warrant's fields, decoded from the wire encoding. */
export interface CreationWarrantFields {
    group: string;
    seed: string;
    authorAccount: string;
    /** The author device key: the signer's public key. */
    deviceKey: string;
    executor: string;
    executorKey: string;
    applicationId: string;
    /** `null` when absent — distinct from `""`. */
    serviceName: string | null;
    /** `null` when absent — distinct from `""`. */
    name: string | null;
    initHash: string;
    accountHeads: string[];
    governanceFloor: string[];
    nonce: bigint;
    notAfter: bigint;
    signature: string;
}
/**
 * The commitment a creation warrant carries in place of the init arguments.
 *
 * Hashes `JSON.stringify(initArgs)`, the same bytes `RelayClient.createContext`
 * sends, under its own domain.
 */
export declare function creationInitHash(initArgs: unknown): Promise<Uint8Array>;
/** The already-decoded fields the signature covers. Internal. */
export interface CreationPreimageParts {
    group: Uint8Array;
    seed: Uint8Array;
    authorAccount: Uint8Array;
    deviceKey: Uint8Array;
    executor: Uint8Array;
    executorKey: Uint8Array;
    applicationId: Uint8Array;
    serviceName: Uint8Array | null;
    name: Uint8Array | null;
    initHash: Uint8Array;
    accountHeads: Uint8Array[];
    governanceFloor: Uint8Array[];
    nonce: number | bigint;
    notAfter: number | bigint;
}
/**
 * The bytes the device key signs. Exported for the conformance test only — not
 * from the package root.
 */
export declare function creationWarrantPreimage(p: CreationPreimageParts): Promise<Uint8Array>;
/**
 * Sign a creation warrant and return it hex-encoded, with its seed.
 *
 * Returns the encoding rather than an object for the reason `signWarrant`
 * does: the signature covers exactly these bytes.
 */
export declare function signCreationWarrant(input: CreationWarrantInput): Promise<SignedCreationWarrant>;
/**
 * Decode a hex creation warrant back into its fields.
 *
 * Refuses truncated or trailing bytes rather than reading a neighbouring field.
 * Does not verify the signature.
 */
export declare function parseCreationWarrant(warrant: string): CreationWarrantFields;
