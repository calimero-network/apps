import { type Signer } from '../signer/signer.js';
/**
 * Core's `ACCOUNT_GENESIS_VERSION`. It is part of the `AccountId` preimage, so
 * this value decides which account a root key names — a mismatch does not fail
 * as a version error at the edge, it silently derives a different account and
 * core refuses the credential as unverifiable.
 *
 * `2` since the genesis dropped its per-namespace nonce. This was `1`, which
 * produced credentials current core rejects outright; the shape was already v2,
 * only the tag was stale.
 */
export declare const ACCOUNT_GENESIS_VERSION = 2;
/** What a root certifies about one device. */
export interface DeviceCertInput {
    /**
     * The account root's signing secret, 64 hex. Signs the certificate.
     *
     * Mutually exclusive with {@link DeviceCertInput.signer}, and the weaker of
     * the two in a browser: this is the one key in the system with nothing above
     * it to revoke it, so a page that can read it can take the account for good.
     * Prefer `signer` anywhere the root is held rather than loaded.
     */
    rootSecret?: string;
    /**
     * The account root's signer — use instead of {@link DeviceCertInput.rootSecret}
     * when the root is a key this page may use and cannot read.
     *
     * This is what lets the certifying page keep its root as a non-extractable
     * `CryptoKey`: {@link accountRootSignerFromPhrase} hands one back, and script
     * injected into the page can then mint certificates only while the page is
     * open, rather than walking off with the account.
     */
    signer?: Signer;
    /** The device being certified, 64 hex — see {@link mintDeviceId}. */
    device: string;
    /** The key that device signs with, 64 hex. */
    signPublicKey: string;
    /** The key the group key is delivered to, 64 hex (X25519). */
    kemPublicKey: string;
    /**
     * Must strictly exceed any epoch already folded for this device.
     *
     * The projection refuses a link that does not advance it, so a re-issued
     * certificate reusing an epoch is inert rather than a rollback.
     */
    deviceEpoch: number;
}
/**
 * Mint a device id: `nonce ‖ H(DEVICE_ID_DOMAIN, account ‖ nonce)[..16]`.
 *
 * Derived from the account and a fresh nonce rather than from the device's keys,
 * so rotating a keypair keeps the replica identity - and with it the counter
 * slots and HLC lineage - intact. The hash half binds the id to its account:
 * core refuses a certificate naming an id minted for another account.
 */
export declare function mintDeviceId(account: string, nonce: Uint8Array): Promise<string>;
/**
 * The 32 bytes a root signs to certify a device.
 *
 * Both keys are covered, so neither the signing key nor the delivery key can be
 * substituted into a certificate that otherwise verifies — which is what stops a
 * relay carrying someone's credential from making itself the reader.
 */
export declare function deviceCertPayload(input: {
    account: string;
    device: string;
    signPublicKey: string;
    kemPublicKey: string;
    keyEpoch: number;
    deviceEpoch: number;
}): Promise<Uint8Array>;
/**
 * Borsh-encode an `AccountProof<DeviceCert>` — what core calls a
 * `JoinAccountCredential`.
 *
 * Extracted so the device-cert path and the namespace-op signer encode this from
 * one implementation. Two copies of a borsh layout drift silently: the encoding
 * is only checked by a peer rejecting a signature, which points at the signature
 * rather than at whichever copy went stale.
 *
 * Layout is `AccountProof { genesis, chain, statement }`:
 * `AccountGenesis` (version u8 + root pk 32) + `chain` (empty Vec, u32 len) +
 * `DeviceCert` (account 32 + device 32 + sign pk 32 + kem pk 32 + key_epoch u32
 * + device_epoch u32 + signature 64) = 237 bytes with an empty chain.
 */
export declare function accountProofBytes(input: {
    rootPublicKey: Uint8Array;
    account: string;
    device: string;
    signPublicKey: string;
    kemPublicKey: string;
    keyEpoch: number;
    deviceEpoch: number;
    signature: Uint8Array;
}): Uint8Array;
/**
 * Certify a device, returning the hex credential `merod account sign-cert`
 * prints — a borsh-encoded `AccountProof<DeviceCert>`.
 *
 * The layout, field for field, is core's:
 *
 * ```
 * AccountProof { genesis: AccountGenesis, chain: Vec<RootKeyHandoff>, statement: DeviceCert }
 *   AccountGenesis { version: u8, root_sign_pk: [u8; 32] }
 *   chain          → u32-LE count, then that many handoffs
 *   DeviceCert     { account, device, sign_pk, kem_pk: [u8; 32] x4,
 *                    key_epoch: u32, device_epoch: u32, signature: [u8; 64] }
 * ```
 *
 * Borsh for plain fixed-width data is concatenation; the only variable part is
 * the chain's length prefix. `chain` is empty here for the same reason it is in
 * `sign-cert`: a root that has never been handed off signs directly, and a
 * handoff chain is only needed once it has.
 *
 * `keyEpoch` is 0 for the same reason — it names the root epoch that signed, and
 * an un-rotated root is at 0. Re-signing after a handoff is a separate flow that
 * needs the chain, so this deliberately does not take it as an argument rather
 * than accepting a value it would then have to ignore.
 */
export declare function signDeviceCert(input: DeviceCertInput): Promise<string>;
/** A credential read back apart, field for field. */
export interface DeviceCredential {
    /** The account root that signed, 64 hex — `AccountGenesis::root_sign_pk`. */
    rootPublicKey: string;
    /** The account the certificate names, 64 hex. */
    account: string;
    /** The device it certifies, 64 hex. */
    device: string;
    /** That device's ed25519 signing key, 64 hex. */
    signPublicKey: string;
    /** That device's X25519 key-delivery key, 64 hex. */
    kemPublicKey: string;
    keyEpoch: number;
    deviceEpoch: number;
    /** The root's signature over {@link deviceCertPayload}, 128 hex. */
    signature: string;
}
/**
 * Read an `AccountProof<DeviceCert>` back apart — the inverse of
 * {@link accountProofBytes}, and deliberately in the same file as it.
 *
 * A decoder that lives away from its encoder drifts: the layout is only checked
 * by a peer rejecting a signature, which points at the signature rather than at
 * whichever copy went stale.
 *
 * This checks the *shape* and nothing else — it says what the bytes claim, not
 * whether the claim is true. {@link verifyDeviceCredential} is the one that
 * answers that, and it is the one a caller acting on a credential from another
 * origin wants.
 *
 * @throws on a wrong genesis version, a non-empty handoff chain, or trailing
 * bytes. A non-empty chain is refused rather than skipped: verifying a handed-off
 * root means walking the chain, and a decoder that returned the statement while
 * ignoring who was entitled to sign it would hand a verifier the wrong root.
 */
export declare function parseDeviceCredential(credential: string): DeviceCredential;
/**
 * Check that a credential says what it claims: the root signed it, the
 * account it names is the one that root derives, and the device id was minted
 * for that account.
 *
 * The first two matter and neither implies the other. The signature says the
 * genesis root consented to these exact keys; the account derivation says the
 * certificate cannot have been re-pointed at a different account while keeping a
 * signature that verifies. A caller that checked only the first would accept a
 * certificate naming an account whose root never signed anything. The third
 * stops a root claiming a device id minted for another account.
 *
 * What it does **not** establish is that the account is one the caller wanted.
 * Anyone can mint a root offline and certify any public key with it, so a
 * credential arriving from elsewhere proves a *consistent* account, not *your*
 * account — see `cloud/enrol-redirect.ts` for the binding that closes that.
 *
 * @throws with which check failed, rather than returning false — every failure
 * here is a credential that must not be stored, and a boolean gets ignored.
 */
export declare function verifyDeviceCredential(credential: string): Promise<DeviceCredential>;
/** The account this root owns — the content address of its genesis. */
export declare function accountForRoot(rootSecret: string): Promise<string>;
/**
 * The same account id, from the root's **public** half.
 *
 * The form a root that cannot be exported needs. It is also the honest shape of
 * the derivation: an account id is a function of the public key, and asking for
 * the secret only ever meant "let me derive the public key first".
 *
 * @param rootPublicKey the root's ed25519 public key, 64 hex
 */
export declare function accountForRootPublicKey(rootPublicKey: string): Promise<string>;
