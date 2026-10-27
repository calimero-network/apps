import { type Signer } from '../signer/signer.js';
/** An account root: the secret, the key it derives, and the account it names. */
export interface AccountRoot {
    /**
     * The root signing secret, 64 hex.
     *
     * The whole account. It signs device certificates and cloud links, and there
     * is no recovery path that does not go through it or its phrase — so it is
     * never sent anywhere, and in a browser it does not belong in `localStorage`.
     */
    secret: string;
    /** The root's ed25519 public key, 64 hex. Safe to publish. */
    publicKey: string;
    /** The account this root names, 64 hex — the content address of its genesis. */
    accountId: string;
}
/** An account root together with the phrase that restores it. */
export interface RecoverableAccountRoot extends AccountRoot {
    /**
     * A 24-word BIP39 English recovery phrase, single-space separated.
     *
     * Show it once, have the holder write it down, and do not keep it: it is the
     * secret in a form a person can copy by hand without transcription errors.
     */
    phrase: string;
}
/**
 * Mint a brand-new account root from the platform CSPRNG.
 *
 * This is the "generate a new key" half of cloud registration — the other half
 * being a root the holder already has, on a desktop app or a hardware key, which
 * signs without this ever running.
 *
 * **Interop note, and it matters.** The phrase encodes the root secret as BIP39
 * *entropy*, not as a BIP39 *seed*. A tool restoring it must call the equivalent
 * of `mnemonicToEntropy(phrase)` — 32 bytes — and use those bytes as the ed25519
 * secret directly. `mnemonicToSeed(phrase)`, which most wallet libraries reach
 * for first, runs PBKDF2 and returns 64 different bytes; feeding those in names
 * a different account and fails as "wrong account", not as a decoding error.
 * There is no passphrase and no BIP32 derivation path: the 24 words are the key.
 */
export declare function generateAccountRoot(): Promise<RecoverableAccountRoot>;
/**
 * Restore an account root from its recovery phrase.
 *
 * Whitespace and case are normalised, so a phrase pasted out of a text editor
 * with a trailing newline or a stray double space restores fine. A word outside
 * the list, a wrong word count, or a failed checksum throws rather than
 * returning some other account — a single mistyped word is the common case, and
 * BIP39's checksum catches all but 1 in 256 of them.
 */
export declare function accountRootFromPhrase(phrase: string): Promise<RecoverableAccountRoot>;
/** The public half of a root you already hold, without re-deriving it by hand. */
export declare function accountRootFromSecret(secret: string): Promise<AccountRoot>;
/** An account root held as a key this page may use and cannot read. */
export interface AccountRootSigner {
    /** The root's ed25519 public key, 64 hex. Safe to publish. */
    readonly publicKey: string;
    /** The account this root names, 64 hex. */
    readonly accountId: string;
    /**
     * Signs for the root. Pass it to `signDeviceCert({ signer })`.
     *
     * There is deliberately no `secret` beside this: the point of the shape is
     * that nothing downstream of here can be handed the account.
     */
    readonly signer: Signer;
}
/** A freshly minted root, with the phrase that is its only backup. */
export interface NewAccountRootSigner extends AccountRootSigner {
    /**
     * The 24-word phrase. Show it **once**, and store it nowhere.
     *
     * Unlike {@link RecoverableAccountRoot.phrase} this is the only copy that will
     * ever exist: the signer beside it cannot be exported, so a holder who does
     * not write these words down has no path back to the account from another
     * browser — and neither does anyone else, which is the trade.
     */
    readonly phrase: string;
}
/**
 * Mint a root that stays in this page and hand back its recovery phrase.
 *
 * The enrolment-time counterpart to {@link generateAccountRoot}: same BIP39
 * entropy, same account derivation, but the secret never leaves as a string a
 * caller could persist. What survives a reload is the `CryptoKey` inside the
 * signer — structured-clone it into IndexedDB — and what survives losing the
 * browser is the phrase.
 *
 * **On scrubbing.** The entropy is zeroed and the seed is imported
 * unexportable, but deriving the public half needs the seed as hex for an
 * instant, and a JS string cannot be wiped. So this narrows the window from
 * "for as long as the account exists" to "during this call" — a real
 * improvement, and not the same claim as "the secret never exists".
 */
export declare function createAccountRootSigner(): Promise<NewAccountRootSigner>;
/**
 * Restore the same root in another browser from its phrase.
 *
 * This is what makes the design portable: the phrase names the entropy, the
 * entropy names the root, and the root names the account — so the same 24 words
 * reach the same account id on any device, with no server involved and nothing
 * to migrate.
 *
 * Throws on a bad word count, an unknown word, or a failed checksum rather than
 * returning some other account — see {@link accountRootFromPhrase}.
 */
export declare function accountRootSignerFromPhrase(phrase: string): Promise<AccountRootSigner>;
/**
 * The account root, in either form a caller may hold it.
 *
 * Exists because the cloud entry points take the root **positionally** — the
 * whole argument is "the root" — so the two forms cannot be separate optional
 * fields the way {@link AccountLinkInput} has them.
 *
 * A `string` is the 64-hex secret. A {@link Signer} is a root this process may
 * use and cannot read: pass the `signer` from
 * {@link accountRootSignerFromPhrase}.
 */
export type RootSource = string | Signer;
/** A root's identity and how it signs, however the caller supplied it. */
export interface ResolvedRoot {
    signer: Signer;
    /** The root's ed25519 public key, 64 hex. */
    publicKey: string;
    /** The account it names, 64 hex. */
    accountId: string;
}
/** What a root is, however it was supplied: who it is, and how it signs. */
export declare function resolveRoot(source: RootSource): Promise<ResolvedRoot>;
/**
 * The same, for entry points that take the two forms as separate optional
 * fields. Exactly one must be present — see {@link resolveSigner}.
 */
export declare function resolveRootPair(rootSecret: string | undefined, signer: Signer | undefined): Promise<ResolvedRoot>;
/** What {@link signAccountLink} needs. */
export interface AccountLinkInput {
    /**
     * The account root's signing secret, 64 hex.
     *
     * Mutually exclusive with {@link AccountLinkInput.signer}. Prefer the signer
     * in a browser: this is the account, and nothing above it can revoke it.
     */
    rootSecret?: string;
    /** The root's signer — use instead of {@link AccountLinkInput.rootSecret}. */
    signer?: Signer;
    /**
     * The challenge from `GET /api/cloud/me/accounts/challenge`, verbatim.
     *
     * Signed as its UTF-8 bytes, not decoded first: mdma seals it as an opaque
     * string and verifies over the same string it issued.
     */
    nonce: string;
}
/**
 * Sign a cloud link challenge with the account root. Returns base64.
 *
 * Standard base64, not base64url — mdma decodes it with `validate=True`, so the
 * `-`/`_` alphabet is rejected outright rather than silently mis-decoded.
 *
 * Root-signed rather than device-signed on purpose: this is the credential
 * someone still holds after losing a device, which is the case linking exists to
 * serve.
 */
export declare function signAccountLink(input: AccountLinkInput): Promise<string>;
/** What {@link signAccountLogin} needs. */
export interface AccountLoginInput {
    /**
     * The account root's signing secret, 64 hex.
     *
     * Mutually exclusive with {@link AccountLoginInput.signer}.
     */
    rootSecret?: string;
    /** The root's signer — use instead of {@link AccountLoginInput.rootSecret}. */
    signer?: Signer;
    /** The challenge from `GET /api/auth/account/challenge`, verbatim UTF-8. */
    nonce: string;
}
/**
 * Sign a cloud login challenge with the account root. Returns base64.
 *
 * The statement this makes is *"I hold the root of account X"*, and it is the
 * one statement a device credential can never make. A routing read proves the
 * caller holds a device the root certified — the credential carries the root's
 * signature over that device — but a certificate is public and travels in the
 * clear inside every device-link op, so anyone who has seen one can say "a
 * device of X is asking". Only the root can say the account is theirs.
 *
 * Which is why this is worth doing **once**: the cloud records the claim, and
 * from then on it knows the account behind a device proof was proven by its
 * owner. The session it also mints is the ordinary MDMA session token, accepted
 * everywhere a Google-issued one is.
 *
 * Standard base64, not base64url — mdma decodes with `validate=True`.
 */
export declare function signAccountLogin(input: AccountLoginInput): Promise<string>;
