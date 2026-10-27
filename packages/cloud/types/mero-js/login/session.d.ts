/**
 * Obtain a session on a node using only a device key — the handshake around
 * {@link signLoginStatement}.
 *
 * Signing a statement was never the whole job. A client also has to fetch a
 * challenge, mint a session keypair, assemble a request body whose shape it
 * cannot see from here, and read a token out of the reply. Until now every
 * consumer wrote those two HTTP calls by hand, which is how the same three
 * mistakes kept being available to make:
 *
 * 1. **Asking for permissions.** `POST /auth/token` takes an optional
 *    `permissions` list. Left unset, the node grants the account-proof
 *    provider's own scopes — `context:intent`, `context:query`,
 *    `context:subscribe` — which are the whole delegated surface and
 *    deliberately nothing above it. This module never sends the field.
 *    `authenticate()` in this same package hardcodes `['admin']` (#84); a
 *    device-key session would be refused for that and should never ask.
 * 2. **Learning the node's key from the node.** {@link LoginConfig.node} is
 *    required and has no default, because a value read from the challenge
 *    response would let whoever answered choose what the device signs about.
 *    That is the whole attack the field exists to stop, so the awkwardness of
 *    having to supply it is the point rather than something to smooth away.
 * 3. **Losing the refresh token.** A browser tab outlives a short-lived
 *    session, so both tokens are returned. Nothing here refreshes on a timer
 *    (#87, #88 track that); this only makes it possible without a second
 *    breaking change.
 *
 * **The session key never leaves.** It is minted here, the device key signs
 * over it once, and the secret half is handed back to the caller. That is what
 * keeps a device key off the wire for the life of a session: a leaked token
 * cannot be escalated into use of the key that authorised it.
 */
import { type Audience } from './login.js';
import { type Signer } from '../signer/signer.js';
/** A freshly minted ephemeral keypair, hex-encoded. */
export interface SessionKeyPair {
    /** The public half — what the statement is signed over. */
    publicKey: string;
    /** The private half. Held by the caller; never sent anywhere. */
    secret: string;
}
/**
 * Mint the ephemeral keypair a session speaks with.
 *
 * An ed25519 secret *is* 32 random bytes, so this needs no key generation
 * ceremony — `getRandomValues` and the same derivation every other signer here
 * uses. Exported because a caller that wants to persist a session across a page
 * reload needs to mint the pair itself and keep the secret.
 */
export declare function generateSessionKey(): Promise<SessionKeyPair>;
/** What a device needs in order to ask for a session. */
export interface LoginConfig {
    /** The node's base URL, e.g. `https://node.example`. */
    nodeUrl: string;
    /**
     * The node's device signing key, hex (32 bytes), **as this client pinned it**.
     *
     * Learn it out of band — from the node's operator, or a certificate you
     * already trust. Never from the node you are about to log in to: see the
     * module note.
     */
    node: string;
    /**
     * The device's ed25519 signing secret, hex (32 bytes). Never sent.
     *
     * Mutually exclusive with {@link LoginConfig.signer}, and the weaker of the
     * two in a browser — see {@link Signer}.
     */
    deviceSecret?: string;
    /**
     * The device's signer — use instead of {@link LoginConfig.deviceSecret} when
     * the key cannot be exported to hex.
     */
    signer?: Signer;
    /**
     * The device's account proof, hex — the credential certifying that this
     * device belongs to its account.
     *
     * Travels beside the statement and is what settles *which account* is asking.
     * The statement alone proves only that a device key asked, so logging in
     * without this yields a 401 that looks exactly like a bad signature.
     */
    accountProof: string;
    /** The client surface this session is bound to. */
    audience: Audience;
    /**
     * The token request's `client_name`. Defaults to {@link LoginConfig.nodeUrl}.
     *
     * mero-auth records this value as the session's `node_url` and, on every
     * later request, refuses one whose Host is not that URL's host ("Token is not
     * valid for this host"). So it must name the node being logged in to — which
     * is what core's own clients send. The audience is not a substitute: a browser
     * page's origin is a different host from the relay it talks to, and a token
     * bound to the page's host is refused on the first call.
     */
    clientName?: string;
    /** Seconds the statement stays valid. Defaults to {@link DEFAULT_TTL_SECONDS}. */
    ttlSeconds?: number;
    /** Injectable for tests and non-browser runtimes. */
    fetch?: typeof fetch;
    /** Per-request timeout. Defaults to 10s. */
    timeoutMs?: number;
}
/** A session minted without a password. */
export interface DelegatedSession {
    /** Bearer token for the delegated surface. */
    accessToken: string;
    /** Presented to renew the access token. See #87/#88 — nothing here schedules it. */
    refreshToken: string;
    /** The session's public half, as the node knows it. */
    sessionKey: string;
    /** The session's private half. The caller keeps this; it was never sent. */
    sessionSecret: string;
}
/**
 * Log in with a device key and return the session.
 *
 * The challenge is fetched immediately before signing on purpose: it is
 * single-use and short-lived, so a statement minted against a stale one is
 * refused before any signature work is done.
 *
 * @throws {HTTPError} if the node refuses the challenge or the token request.
 */
export declare function login(config: LoginConfig): Promise<DelegatedSession>;
