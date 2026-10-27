/**
 * Who signs, separated from what is signed.
 *
 * Every signing entry point in this package used to take 32 hex bytes. That is
 * fine for a CLI or a server holding a key file, and it is the one thing a
 * browser must not do: a secret that exists as a string can be read by anything
 * running on the origin, and a stolen account key is the account — permanently,
 * because unlike a device key there is nothing above it to revoke it with.
 *
 * WebCrypto can hold an Ed25519 key that **signs but cannot be exported**
 * (`generateKey(..., extractable: false, ...)`). Such a key has no hex
 * representation to pass, so it could not be used with this package at all —
 * which pushed consumers into reimplementing core's wire formats around their
 * own key. That is the failure `crates/account/src/tests/sdk_credential_fixture.rs`
 * exists to document: a second implementation of a byte contract agreed with
 * itself for a full release while core rejected every credential it produced.
 *
 * So the interface is the key's *capability*, not its material:
 *
 * ```ts
 * const signer = await signerFromSecret(deviceSecret);           // as before
 * const signer = await signerFromCryptoKey(privateKey, pubKey);  // unexportable
 * await signWarrant({ ...terms, signer });
 * ```
 *
 * `deviceSecret` and `rootSecret` keep working everywhere they did. They are
 * now one way of producing a `Signer` rather than the only way, and callers
 * that pass a secret get a signer built for them.
 */
/**
 * Something that can produce Ed25519 signatures and name the key they verify
 * against.
 *
 * Deliberately the smallest surface that works: a signature and the public key
 * it belongs to. Anything larger would start describing *how* the key is held,
 * which is the detail this exists to hide — a hex seed, a non-extractable
 * `CryptoKey`, a hardware token behind an async prompt, and a remote signing
 * service all satisfy it.
 */
export interface Signer {
    /**
     * The public half, 64 hex characters.
     *
     * Carried rather than derived on demand because a non-extractable private key
     * cannot produce it: the public half has to be captured when the key is
     * generated. A signer that could not name its key would force every caller to
     * pass the public key alongside it, and the two could then disagree.
     */
    readonly publicKey: string;
    /**
     * Sign `payload` — the exact bytes, with no hashing or framing added.
     *
     * Every caller in this package passes a 32-byte domain-separated digest it
     * has already computed, and an implementation that hashed again would produce
     * signatures that verify nowhere.
     */
    sign(payload: Uint8Array): Promise<Uint8Array>;
}
/**
 * A signer over a raw 32-byte Ed25519 seed, hex.
 *
 * The public half is derived from the seed rather than accepted alongside it,
 * for the reason core does the same: a caller able to name a key it does not
 * hold could produce a statement it cannot sign, and the field would stop
 * meaning "who authorised this".
 *
 * @param secret the seed, 64 hex characters
 * @param label what to call it in an error — `deviceSecret`, `rootSecret`
 */
export declare function signerFromSecret(secret: string, label?: string): Promise<Signer>;
/**
 * A signer over a `CryptoKey` this process may use and cannot read.
 *
 * The point of the whole interface. Generate the key with
 * `generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])`, keep the pair's
 * private half (structured-clone it into IndexedDB if it must survive a reload),
 * and pass it here with its public half.
 *
 * @param privateKey the signing key — extractable or not, it is never exported
 * @param publicKey its public half: 64 hex, or the pair's `publicKey` (which
 *   WebCrypto leaves exportable even when the private half is not)
 */
export declare function signerFromCryptoKey(privateKey: CryptoKey, publicKey: string | CryptoKey): Promise<Signer>;
/**
 * Resolve the signer an input describes, accepting either form.
 *
 * Internal. Every signing entry point takes an optional secret *and* an
 * optional signer, and exactly one must be present — passing both is refused
 * rather than silently preferring one, because the two could name different
 * keys and the caller would have no way to tell which signed.
 */
export declare function resolveSigner(secret: string | undefined, signer: Signer | undefined, label: string): Promise<Signer>;
