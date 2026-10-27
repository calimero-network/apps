/**
 * Getting an app's device key certified **by a wallet on another origin**.
 *
 * An app holds a device keypair and no account. It cannot certify that key
 * itself: certifying is a signature by an account root, and the root is the one
 * key in the system with nothing above it to revoke it — so a page that can
 * reach it can take the account for good. The whole design is that the app
 * never can.
 *
 * What separates them is the **same-origin policy**, and that is why this is a
 * redirect rather than a message, a popup API or a shared library. The wallet
 * keeps the root as a non-extractable key in *its* origin's IndexedDB; script
 * running on the app's origin cannot read another origin's storage, cannot read
 * its keys, and cannot draw its consent screen. Nothing weaker enforces that —
 * an iframe with a `postMessage` bridge would put the approval dialog inside a
 * document the app can style, overlay and click for you.
 *
 * So the shape is: send the person to the wallet naming the key you want
 * certified, they approve there, and the wallet redirects back with an
 * `AccountProof<DeviceCert>` over that key.
 *
 * ## The credential comes back in the FRAGMENT
 *
 * Same reason the cloud's link grant does — see `link-redirect.ts`. A fragment
 * is not sent to the server, so it lands in nobody's access log, no referrer
 * header and no proxy trace on the way. A query string would put a credential
 * into every log between here and the app's host.
 *
 * ## What the app must check before storing anything
 *
 * A fragment is written by whoever sent the person to this URL, which is not
 * necessarily the wallet. Three things therefore have to be checked locally:
 *
 * - the credential certifies **the key this app asked about** — otherwise the
 *   app stores a credential it cannot sign for, and every warrant it mints is
 *   refused somewhere far from here;
 * - the credential is **internally consistent** — the root signed it, the
 *   account it names is the one that root derives, and its device id was
 *   minted for that account ({@link verifyDeviceCredential});
 * - the account reported beside it is **the account the credential names** —
 *   the app shows that id to a person and keys state by it, so a mismatch is a
 *   credential filed under someone else's name.
 *
 * {@link completeDeviceEnrolment} does all three and throws on any of them,
 * before the caller has anything to store. What none of them establish is that
 * the account is the *person's* — anyone can mint a root offline and certify
 * any public key with it, and a device key is public once enrolled. That is
 * what the state narrows: {@link deviceEnrolmentUrl} remembers each request, and
 * {@link completeDeviceEnrolment} refuses an answer to a request this browser did
 * not start, rather than to a link someone sent.
 */
import { type DeviceCredential } from '../device-cert/index.js';
export interface DeviceEnrolmentOptions {
    /**
     * The wallet's origin — a different origin from this app's, and the reason
     * the flow exists. Pointing it at this app's own origin is accepted (a
     * wallet may be hosted anywhere) but certifies nothing the app could not
     * already do.
     */
    walletUrl: string;
    /** The device's ed25519 signing key to be certified, 64 hex. */
    devicePublicKey: string;
    /**
     * The device's X25519 key-delivery key, 64 hex.
     *
     * Required, not optional: a certificate covers both keys, and one minted
     * without a delivery key names a device no group key can ever be sealed to.
     * Generate it alongside the signing key rather than enrolling twice.
     */
    kemPublicKey: string;
    /**
     * Where the wallet sends them back. Must be `https:`, or `http:` on
     * localhost — see {@link assertSafeReturnTo}.
     */
    returnTo: string;
}
/**
 * The URL to send a person to.
 *
 * Built rather than documented as a string so the parameter names live in one
 * place: a wallet and an app that disagree about them fail as a blank consent
 * screen, which looks like an outage rather than a contract mismatch.
 *
 * Remembers the request under a fresh state the wallet echoes back, so
 * {@link completeDeviceEnrolment} can match the answer to it.
 */
export declare function deviceEnrolmentUrl(options: DeviceEnrolmentOptions): string;
/** Send the person to the wallet to approve this device. Does not return. */
export declare function beginDeviceEnrolment(options: DeviceEnrolmentOptions): never;
/** What came back in the fragment, unverified. */
export interface DeviceEnrolmentCallback {
    /** The `AccountProof<DeviceCert>`, hex borsh — as `signDeviceCert` returns it. */
    credential: string;
    /** The account the wallet says certified this device, 64 hex. */
    account: string;
    /** The device id the wallet minted, 64 hex. */
    device: string;
    /** The state the wallet echoed back from {@link deviceEnrolmentUrl}. */
    state?: string;
}
/**
 * Read an enrolment out of the current URL fragment, and strip it.
 *
 * Returns `null` on an ordinary page load, so a caller can run it
 * unconditionally at startup. Throws when the person declined, because that is
 * an outcome the app has to show rather than a state to wait in.
 *
 * Nothing is verified here — the shape is separated from the checking so a
 * caller can see what arrived (to log it, or to name the account in a refusal)
 * even when it goes on to be refused. Nothing read out of this belongs in
 * storage until {@link completeDeviceEnrolment} has passed.
 */
export declare function readEnrolmentCallback(location?: {
    hash: string;
}): DeviceEnrolmentCallback | null;
export interface CompleteDeviceEnrolmentOptions extends DeviceEnrolmentCallback {
    /**
     * The signing key this app asked to have certified, 64 hex.
     *
     * The binding that makes the returned credential usable: it must be *this*
     * app's key, held in this app, or nothing it signs verifies against the
     * certificate it presents.
     */
    devicePublicKey: string;
    /** The delivery key asked about, 64 hex. Checked when supplied. */
    kemPublicKey?: string;
}
/** A device this app may now sign as. */
export interface EnrolledDevice {
    /** The credential to present, hex — `RelayClientConfig.authorProof`. */
    credential: string;
    /** The account it belongs to, 64 hex. */
    account: string;
    /** The device id within that account, 64 hex. */
    device: string;
    /** Everything the certificate says, already checked. */
    certificate: DeviceCredential;
}
/**
 * Verify what came back, and refuse loudly rather than returning a half-checked
 * credential.
 *
 * Every throw here is a credential that must not reach storage. The order is
 * deliberate: the cheap local comparisons first, so a fragment aimed at the
 * wrong app is rejected without a signature verification, and the message names
 * what disagreed rather than reporting "invalid credential".
 *
 * The state is spent on the first call, so an answer is accepted at most once.
 */
export declare function completeDeviceEnrolment(options: CompleteDeviceEnrolmentOptions): Promise<EnrolledDevice>;
/**
 * Where a credential may be delivered.
 *
 * `https:` anywhere, `http:` only on loopback. Plain HTTP elsewhere would put
 * the fragment on a page any network position can rewrite, and the fragment is
 * the credential; loopback is exempt because it never leaves the machine and is
 * the only way to develop against a wallet at all.
 *
 * Everything else — `javascript:`, `data:`, a custom app scheme — is refused.
 * The first two are script the wallet would be asked to run; a custom scheme is
 * a legitimate thing to want for a native app, but which installed handler
 * claims it is not something this SDK can check, so it is refused here rather
 * than accepted on trust.
 */
/**
 * Is the credential coming back to somewhere other than the page that asked?
 *
 * Normally an app enrols its own device key and gets the answer back on its own
 * origin, so the two match. They can legitimately differ — a callback page on a
 * sibling host, an app mid-migration — which is why this is not refused.
 *
 * But it is the shape an abuse would also take: send someone to the real wallet
 * and have the credential delivered elsewhere. Nothing here can tell the two
 * apart, and a client-side check constrains nobody who did not call this
 * function anyway. What it is good for is the honest case — surfacing the
 * mismatch to whoever is building the app, and giving a wallet the same fact to
 * put in front of the person approving.
 *
 * Exported so a wallet can render it, rather than each caller re-deriving it.
 */
export declare function callbackIsForeign(returnTo: string, pageOrigin?: string): boolean;
