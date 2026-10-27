/**
 * Redirects this browser began, so a callback can be matched to one. `localStorage`,
 * not `sessionStorage`: consent opens in a `noopener` tab with empty session storage.
 */
export declare const ACCOUNT_HEX: RegExp;
export declare const VERIFIER_HEX: RegExp;
/** Remember `payload` in the `key` store under a fresh random state, and return the state. */
export declare function beginState<T extends object>(key: string, payload: T): string;
/** Removes and returns what `state` was begun with, or null when this browser did not begin it. */
export declare function takeState<T extends object>(key: string, state: string | null | undefined): T | null;
/** What a link grant claims, read without its seal, which only the cloud can check. */
export interface LinkGrantClaims {
    /** The cloud login that consented. */
    login: string;
    account: string;
    challenge: string;
}
/** The challenge a verifier commits to: sha256 of its bytes, hex. */
export declare function linkChallenge(verifier: string): Promise<string>;
/**
 * Remember a link for `account` under a fresh verifier. Returns `returnTo`
 * carrying its state, and the challenge to send the cloud in place of the verifier.
 */
export declare function beginLinkState(account: string, returnTo: string): Promise<{
    callbackUrl: string;
    challenge: string;
}>;
/**
 * Removes the link a callback answers and returns its verifier, or null when
 * this browser did not begin a link for `account` with this state.
 */
export declare function takeLinkVerifier(search: string, account: string | null): string | null;
/** The claims of a link grant, or null when `grant` is not one. */
export declare function linkGrantClaims(grant: string): LinkGrantClaims | null;
/** The query with the link state removed, for rewriting the address bar. */
export declare function withoutLinkState(search: string): string;
