/**
 * Proving an account to the cloud for the one read a joiner cannot avoid.
 *
 * `GET /api/cloud/namespaces/{ns}/admitters` answers where to send a signed
 * membership op. A joiner needs it and *cannot* hold a cloud login: it is by
 * construction not the namespace owner, and not needing an account on the cloud
 * is the entire point of the path — a keyholder mints a root, certifies a
 * device and signs its own join offline, and this read is the only thing that
 * tells it where to post the result.
 *
 * So the caller proves possession of the credential it already holds. The cloud
 * mints a sealed, namespace-bound nonce; the device signs it; the read carries
 * the certificate and that signature.
 *
 * ## What this establishes, and what it does not
 *
 * It establishes that the caller holds a device key certified by some account
 * root, and *which* account that is. It does **not** establish that the account
 * was invited to the namespace, nor that it is a member — the cloud cannot
 * check either, because membership is governance state held by the nodes.
 * Anyone can mint an account root offline, so this is not a wall. It buys
 * attribution (every read names an account and can be rate-limited) and it ends
 * anonymous bulk discovery. Authorization stays where it always was: at the
 * node, on the signed op.
 *
 * ## Why the DEVICE signs, not the root
 *
 * The opposite choice from {@link signAccountLink}, deliberately. That one
 * exists for the device-loss case, so only the root will do. This one runs on
 * every routing read from a browser that discards the root immediately after
 * certifying its device — requiring the root would mean re-entering a 24-word
 * phrase to look up a URL.
 *
 * The certificate alone is not enough and the signature is not redundant with
 * it: a certificate travels in the clear inside every device-link op, so anyone
 * who has seen one can replay it. Only the nonce signature binds the presenter
 * to the device.
 */
/**
 * The credential a routing read presents: a certificate, and the key to sign
 * the challenge with.
 *
 * `credential` is the 237-byte `AccountProof<DeviceCert>` as hex — exactly what
 * {@link signDeviceCert} returns, and the same string a login statement and a
 * warrant carry. It is public by construction.
 *
 * `deviceSecret` never leaves the process. It signs the challenge locally and
 * only the signature travels.
 */
export interface RoutingCredential {
    /** The `AccountProof<DeviceCert>`, hex borsh, as `signDeviceCert` returns it. */
    credential: string;
    /** The certified device's ed25519 signing secret, hex (32 bytes). */
    deviceSecret: string;
}
/** A challenge to sign, as the cloud minted it. */
export interface RoutingChallenge {
    namespaceId: string;
    /** Opaque and sealed — the client neither parses nor constructs this. */
    nonce: string;
    /** Epoch **milliseconds**, as MDMA reports it. Nonces live about two minutes. */
    expiresAtMs: number;
}
/**
 * A challenge bound to an ACCOUNT rather than a namespace, for asking which
 * relays serve that account.
 *
 * Separate from {@link RoutingChallenge} because the binding is the security
 * property, not a field name: MDMA seals the account into this one and the
 * namespace into that one, and refuses each at the other's route. Keeping the
 * TypeScript types distinct is what stops a caller passing the wrong one and
 * learning about it as a 403.
 */
export interface DiscoveryChallenge {
    accountId: string;
    /** Opaque and sealed — the client neither parses nor constructs this. */
    nonce: string;
    /** Epoch **milliseconds**, as MDMA reports it. Nonces live about two minutes. */
    expiresAtMs: number;
}
/**
 * The three header values a proven routing read carries.
 *
 * Intersected with `Record<string, string>` rather than declared as a plain
 * interface so it drops straight into a headers bag: an interface has no index
 * signature, so TypeScript refuses it where `Record<string, string>` is wanted
 * even though every field is a string.
 */
export type RoutingProofHeaders = Record<string, string> & {
    'X-Calimero-Credential': string;
    'X-Calimero-Nonce': string;
    'X-Calimero-Signature': string;
};
/**
 * Sign a routing challenge with the device key.
 *
 * Returns base64, which is what the header carries and what MDMA's verifier
 * decodes — the one place this SDK does not spell a signature as hex, because
 * the wire format is not ours to choose.
 */
export declare function signRoutingChallenge(nonce: string, deviceSecret: string): Promise<string>;
/**
 * Build the headers for one routing read, from a challenge the cloud minted.
 *
 * Separated from the request so a caller that fetches its own challenge — a
 * test, or a client batching several reads against one nonce — can use the same
 * encoding rather than a second spelling of it.
 *
 * Takes either challenge kind: only the nonce is signed and both are signed
 * over the same domain, so one encoder serves both. What separates them is what
 * MDMA sealed inside, which is checked server-side.
 */
export declare function routingProofHeaders(challenge: RoutingChallenge | DiscoveryChallenge, credential: RoutingCredential): Promise<RoutingProofHeaders>;
