/**
 * Linking an account to a cloud login **from a browser**.
 *
 * The cloud's own accounts screen says it plainly: *"The cloud cannot link an
 * account on your behalf: proving you own it is a signature by the account root
 * key, which the cloud never holds."* So the link needs two things that live in
 * different places — a cloud session, which only Google can mint, and a root
 * signature, which only the holder can make. Neither side can do it alone.
 *
 * The cloud already implements its half: send a person to
 * `?link-account=<id>&challenge=<sha256(verifier)>&callback-url=<url>`, it
 * shows a consent screen and redirects back with a **grant** — that login's
 * sealed consent to link one named account. This module is the missing other
 * half, and it is deliberately small: send them there, then spend what comes
 * back.
 *
 * ## Why a grant rather than a session
 *
 * A grant is spendable only with the account's root and the verifier this
 * browser kept when it began the link. That is what lets the page complete the
 * link while holding **no cloud session at all** - and it is why a wallet
 * should never be handed one. A session token is a credential for everything
 * that login can do; a grant is a credential for exactly one link, to exactly
 * one account, sealed at the moment the person read the id on screen and
 * agreed to it.
 *
 * ## The account id is chosen by us and read by them
 *
 * The cloud seals the account into the grant at consent time, and its own note
 * says why: the server can check that the key which later signs derives that
 * same account, but *"it cannot know whether the person meant this account"*.
 * The consent screen is that check. So show the same id the person will see,
 * before sending them — a wallet that hides it has removed the only safeguard.
 */
import type { CloudAccountLink } from './cloud-client.js';
import { type RootSource } from '../account/account.js';
export interface BeginCloudLinkOptions {
    /** The account to link — 64 hex. Show this to the person before redirecting. */
    accountId: string;
    /**
     * Where the cloud sends them back. Must be `https:`, or `http:` on localhost.
     *
     * The grant returns in the URL **fragment**, which is never sent to a server,
     * so it does not land in anyone's access log on the way.
     */
    returnTo: string;
    /** The cloud's web origin. Defaults to the hosted one. */
    cloudWebUrl?: string;
}
/**
 * The consent URL to send a person to. Remembers the link, and the verifier its
 * grant will be bound to, so only this browser can match the callback and spend it.
 */
export declare function cloudLinkUrl(options: BeginCloudLinkOptions): Promise<string>;
/** Send the person to the cloud to consent. Does not return. */
export declare function beginCloudLink(options: BeginCloudLinkOptions): Promise<never>;
/** What came back in the fragment, if anything. */
export interface CloudLinkCallback {
    grant: string;
    /** The account the cloud sealed into the grant. */
    account: string;
    /** The cloud login that consented. Show it before spending: anyone holding the consent URL could have answered it. */
    login: string;
    /** This browser's secret for the grant, kept from the redirect. Spend it with the grant. */
    verifier: string;
}
/**
 * Read a grant out of the current URL fragment, and strip it.
 *
 * Returns `null` when this is an ordinary page load, so a caller can run it
 * unconditionally at startup. Throws when declined or when this browser did not
 * begin the link.
 */
export declare function readCloudLinkCallback(location?: {
    hash: string;
    search?: string;
}): CloudLinkCallback | null;
export interface CompleteCloudLinkOptions extends CloudLinkCallback {
    /** The account root — a 64-hex secret, or a Signer over a key you cannot read. */
    root: RootSource;
    /** The **manager** API base, e.g. `https://manager.cloud.calimero.network`. */
    cloudBaseUrl?: string;
    fetch?: typeof fetch;
}
/**
 * Spend the grant: sign it with the root and hand it back to the cloud.
 *
 * Anonymous by construction — the client is built with no session, because the
 * whole point is that the page never needed one.
 *
 * @throws if the grant names a different account than the root derives, before
 * anything is sent. The cloud checks this too, but failing here says which two
 * accounts disagreed rather than returning a bare 403.
 */
export declare function completeCloudLink(options: CompleteCloudLinkOptions): Promise<CloudAccountLink>;
