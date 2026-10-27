/**
 * Sign the statement a device key presents to obtain a session on a node.
 *
 * This is the half of password-free login that has to run where the device key
 * lives, and for the case delegated execution exists for that is a browser tab.
 * Until this module, the only thing that could produce a login statement was
 * `merod account login-statement` — which is to say, a client had to hold a node
 * to ask a node for a session.
 *
 * **What this gets you, and what it does not.** A statement proves a device key
 * asked for this session. It says nothing about which account that device
 * belongs to: that is the `AccountProof` travelling beside it, which the node
 * checks separately. Signing here and presenting no proof gets a 401 that looks
 * exactly like a bad signature.
 *
 * **The session key is minted by the caller, not here.** The device key signs
 * once, over a short-lived key the caller generates and keeps; that key does the
 * talking for the rest of the session, which is what keeps the device key off
 * the wire. Passing a key you do not hold the private half of produces a session
 * you cannot speak on.
 *
 * **`node` must come from something you pinned.** Not from the challenge
 * response, and not from any field the node itself chose — an attacker who can
 * answer on the node's behalf would otherwise pick what your device signs about,
 * which is the whole reason the field exists. Read it out of band from the node
 * operator.
 *
 * **The byte contract is pinned in core**, at
 * `crates/account/src/tests/login_wire_fixture.rs`, for the same reason the
 * warrant one is: `AUTH_LOGIN_SIGN_DOMAIN` is `pub(crate)` there and the field
 * order is implicit in a `derive`, so nothing on that side forces anyone to
 * notice this file depends on both. This module's test asserts the same vectors.
 */
import { type Signer } from '../signer/signer.js';
/**
 * The client surface a session is bound to.
 *
 * A session minted for one surface cannot be presented from another, so a single
 * compromised surface does not yield sessions usable everywhere.
 */
export type Audience = {
    /**
     * A browser origin, spelled exactly as the browser spells it
     * (`https://host:port`, no trailing slash).
     *
     * Compared byte for byte by the node. Do not normalize it here: two
     * spellings of one origin would mean a verifier that disagrees with the
     * browser about which one a token was for. `location.origin` is already
     * the spelling you want.
     */
    kind: 'webOrigin';
    origin: string;
} | {
    /** A signed native client, named by its code-signing identity. */
    kind: 'codeSigningId';
    id: string;
} | {
    /**
     * A command-line client, which has no origin and no signing identity.
     *
     * Carries no payload deliberately: a string here would be an audience that
     * binds nothing while looking like it binds something.
     */
    kind: 'cli';
};
/** What a device is asking for. */
export interface LoginStatementInput {
    /**
     * The node this session is for, hex (32 bytes) — its identity public key, as
     * you pinned it. See the module note: this must not come from the node.
     */
    node: string;
    /** The client surface the session is bound to. */
    audience: Audience;
    /** The challenge this node issued, hex (32 bytes). Proves freshness. */
    challenge: string;
    /**
     * The public half of the ephemeral key this session will speak with, hex (32
     * bytes). Minted per session by the caller and thrown away with it.
     */
    sessionKey: string;
    /** Unix seconds at signing. */
    issuedAt: number | bigint;
    /** Unix seconds after which the node must refuse it. */
    expiresAt: number | bigint;
    /**
     * The device's ed25519 signing secret, hex (32 bytes).
     *
     * Never sent anywhere. It signs locally and only the signature travels, which
     * is what lets a statement be minted by something holding no node.
     *
     * Mutually exclusive with {@link LoginStatementInput.signer}, and the weaker
     * of the two in a browser: a secret that exists as a string can be read by
     * anything running on the origin.
     */
    deviceSecret?: string;
    /**
     * The device's signer — use instead of
     * {@link LoginStatementInput.deviceSecret} when the key cannot be exported.
     */
    signer?: Signer;
}
/**
 * Sign a login statement and return it hex-encoded, ready to present with an
 * account proof.
 *
 * Returns the encoding rather than an object for the reason `signWarrant` does:
 * the signature covers exactly these bytes, and a caller that rebuilt the fields
 * from JSON would have a second spelling able to disagree with what was signed.
 */
export declare function signLoginStatement(input: LoginStatementInput): Promise<string>;
