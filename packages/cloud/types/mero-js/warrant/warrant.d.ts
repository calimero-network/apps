/**
 * Mint a warrant: the author's consent for one relay to run one intent, once.
 *
 * This exists because the case delegated authorship is *for* is an account that
 * holds no node — a browser tab, a Node service, a bot. Every one of those is a
 * JS runtime, and until now the only thing that could mint a warrant was `merod`,
 * so "a member with no node" in practice meant "a member with a node it is not
 * allowed to use for anything else".
 *
 * **No dependencies, and that is not incidental.** The primitives are all built
 * in: `crypto.subtle.digest('SHA-256')` for the hash, `crypto.subtle` Ed25519
 * for the signature, and `DataView` for the integers.
 *
 * Warrant v2 (core#3933) gave up the fixed-width encoding that used to make this
 * pure concatenation: `method` travels in the clear as a string and each cited
 * head list is a vector, so three borsh `u32` counts now sit inside the bytes.
 * Two widths to keep straight, and they are not the same: the counts **inside
 * the encoding** are `u32`, while the counts the **signing preimage** hashes are
 * `u64`. Same numbers, different serialization — reusing one for the other
 * produces a warrant that is well-formed and verifies nowhere.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/warrant_wire_fixture.rs`. The domain strings below
 * are `pub(crate)` there, so nothing in that repository forces anyone to notice
 * this file depends on them — which is exactly why the fixture lives on that side
 * and this module's test asserts the same vectors. A drift would otherwise leave
 * this producing well-formed warrants whose signatures verify nowhere, surfacing
 * at a relay as a 403: an authorization refusal, nowhere near the cause.
 */
import { type Signer } from '../signer/signer.js';
/** Ed25519 PKCS#8 prefix, so a raw 32-byte seed can be imported by WebCrypto. */
/** What a warrant authorises. */
export interface WarrantInput {
    /**
     * The context, hex — the same string every other method here takes.
     *
     * Hex like everything else on this interface. It was base58 while the node
     * spelled `ContextId` and `PublicKey` that way and `AccountId` and `DeviceId`
     * in hex; that split is gone, so this module no longer needs a rule per field
     * and no longer needs a base58 decoder to enforce one.
     */
    context: string;
    /** The author's account, hex — whose consent this is. */
    authorAccount: string;
    /** The relay's account, hex: the subject its authorship grant is held by. */
    executor: string;
    /**
     * The one signing key of `executor` that may spend this warrant, hex: the
     * relay's `executorKey` from discovery. Any other key of the account is refused.
     */
    executorKey: string;
    /**
     * The blob id of the release the context's group names, hex (32 bytes): the
     * relay's `releaseBytecodeId` from discovery.
     *
     * Pins the code, so a relay cannot wait for an upgrade that widens what
     * `method` does and then spend a warrant signed against the narrower one. The
     * relay refuses a warrant pinning any release other than the one it runs.
     */
    releaseBytecodeId: string;
    /**
     * That release's semver, discovery's `releaseVersion`: signed, never compared,
     * at most 256 bytes of UTF-8. Defaults to empty, as `merod account warrant` does.
     */
    releaseVersion?: string;
    /**
     * The method the relay may run.
     *
     * Carried in the clear as of v2, so a peer can select a per-method write-set
     * without reversing a hash against the app's ABI. The *arguments* are still
     * committed to rather than carried — see {@link intentHash}.
     */
    method: string;
    /** Its arguments, as the JSON the guest will receive. */
    argsJson: unknown;
    /**
     * Monotonic per author **device**.
     *
     * Per device rather than per account because two devices of one account are
     * independent replicas: they cannot coordinate on a counter, so an
     * account-scoped sequence would have them refusing each other's warrants.
     */
    nonce: number | bigint;
    /**
     * Account-log heads this author saw when signing, each hex (32 bytes).
     *
     * Empty by default, and empty is the honest answer for a client that tracks
     * no log — a fabricated view is worse than none. At most
     * {@link MAX_CITED_HEADS}.
     */
    accountHeads?: string[];
    /**
     * Governance heads this author's view descended from, each hex (32 bytes).
     *
     * **Where these come from decides whether they mean anything.** A floor the
     * relay supplied is a floor the relay chose: a relay that withholds a
     * governance op can hand you a stale view and collect a warrant citing it.
     * Take the value from the account's own devices or a co-signing peer outside
     * the relay's operator. As it stands this detects an honest relay's staleness
     * and does not constrain a dishonest one.
     */
    governanceFloor?: string[];
    /** Unix seconds after which the relay must refuse it. */
    notAfter: number | bigint;
    /**
     * The author device's ed25519 signing secret, hex (32 bytes).
     *
     * Never sent anywhere. It signs locally and only the signature travels, which
     * is the whole reason a warrant can be minted by something holding no node.
     *
     * Mutually exclusive with {@link WarrantInput.signer}: exactly one is
     * required. Prefer `signer` in a browser, since a secret held as a string is
     * readable by anything on the origin.
     */
    deviceSecret?: string;
    /**
     * The author device's signer, in place of {@link WarrantInput.deviceSecret}:
     * for a key that cannot be exported to hex (a non-extractable WebCrypto key,
     * a passkey, a hardware or remote signer).
     */
    signer?: Signer;
}
/**
 * The commitment a warrant carries in place of the intent itself.
 *
 * Its own domain, distinct from the signing one, so a value computed for one
 * purpose cannot be presented for the other.
 */
export declare function intentHash(method: string, argsJson: unknown): Promise<Uint8Array>;
/**
 * Sign a warrant and return it hex-encoded, ready for `performIntent`.
 *
 * Returns the encoding rather than an object because the signature covers
 * exactly these bytes: a caller that rebuilt the fields from JSON would have a
 * second spelling able to disagree with what was signed.
 */
export declare function signWarrant(input: WarrantInput): Promise<string>;
/**
 * Decode a cited-head list, refusing one longer than a node will accept.
 * Shared with `creation-warrant.ts`; internal, not exported from the package root.
 */
/**
 * A signer's output, refused unless it is a 64-byte Ed25519 signature.
 *
 * The signature is spliced into the encoding at a fixed width, so a signer that
 * returned anything else would yield a warrant that parses as garbage at a
 * relay, far from the signer at fault. Internal.
 */
export declare function checkedSignature(signature: Uint8Array): Uint8Array;
/** A release version as UTF-8, refused past what a node accepts. Shared with `RelayClient`; internal. */
export declare function releaseVersionBytes(version: string): Uint8Array;
export declare function citedHeads(heads: string[] | undefined, label: string): Uint8Array[];
/** A warrant's fields, as hex, decoded from the wire encoding. */
export interface WarrantFields {
    context: string;
    authorAccount: string;
    /** The author device key `signWarrant` derived from the secret. */
    deviceKey: string;
    executor: string;
    executorKey: string;
    releaseBytecodeId: string;
    /** UTF-8, as hex like `method`. */
    releaseVersion: string;
    method: string;
    intentHash: string;
    accountHeads: string[];
    governanceFloor: string[];
    /** u64 little-endian, as it sits on the wire. */
    nonce: string;
    /** u64 little-endian, as it sits on the wire. */
    notAfter: string;
    signature: string;
}
/**
 * Decode a hex warrant back into its fields.
 *
 * Exists because v2's offsets are no longer constants: `method` is a string and
 * the head lists are vectors, so everything after `releaseBytecodeId` moves with
 * the release version's and the method's lengths. Anything reading a warrant by
 * fixed offset - a test, a client inspecting one it was handed - silently reads
 * the wrong field instead of failing, which is how the three call sites that did
 * so passed while comparing the method's length prefix to a nonce.
 *
 * One copy of the layout, beside the encoder that produces it, so the two cannot
 * drift. Internal: not exported from the package root, because a client that
 * needs a warrant's fields has the input it signed.
 */
export declare function parseWarrant(warrant: string): WarrantFields;
