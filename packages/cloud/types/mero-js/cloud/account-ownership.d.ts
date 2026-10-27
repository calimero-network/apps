import { type Signer } from '../signer/signer.js';
/**
 * The `ownership_proof` body for `POST /api/cloud/me/namespaces/{ns}/enable-ha`
 * and for `POST /api/cloud/accounts/{account}/namespaces/{ns}/enable-ha`.
 */
export interface AccountOwnershipProof {
    kind: 'account';
    /** hex `AccountProof<DeviceCert>`, the account's credential. */
    credential: string;
    /** base64 UTF-8 JSON, the claim. */
    signed_payload: string;
    /** base64 ed25519 by the certified device key. */
    signature: string;
}
/** What every account claim needs; the audience and `subject` differ per route. */
interface AccountClaimBase {
    /** The namespace, hex: the id `foundNamespace` returned. */
    namespaceId: string;
    /** The founding account, hex. */
    accountId: string;
    /** The salt `foundNamespace` returned, hex (32 bytes). */
    salt: string;
    /** The account's credential, hex `AccountProof<DeviceCert>`. */
    credential: string;
    deviceSecret?: string;
    signer?: Signer;
    /** Lifetime in ms; default one minute, at most five. */
    ttlMs?: number;
    /** For tests. */
    now?: () => number;
}
export interface AccountOwnershipClaimInput extends AccountClaimBase {
    /** The cloud login's email: the claim is for this login only. */
    subject: string;
}
/**
 * Input for {@link signAccountHaClaim}: the same as the session claim, minus
 * `subject` — there is no login to bind it to.
 */
export interface AccountHaClaimInput extends AccountClaimBase {
    /**
     * The relay that founded the namespace (the delegated session's `relayUrl`).
     * Signed into the claim so nobody forwarding it can swap it: the cloud
     * resolves it to one of its own fleet relays and hands that relay's
     * addresses to the fleet node as its admitter. Leave it out when unknown.
     */
    relayUrl?: string;
}
/** The audience of the session route's claim (`/api/cloud/me/...`). */
export declare const ACCOUNT_OWNERSHIP_AUDIENCE = "mdma:enable-ha-namespace";
/** The audience of the anonymous account route's claim (`/api/cloud/accounts/...`). */
export declare const ACCOUNT_HA_AUDIENCE = "mdma:enable-ha-namespace-as-account";
/** The founder's claim for the SESSION route, bound to one cloud login (`subject`). */
export declare function signAccountOwnershipClaim(input: AccountOwnershipClaimInput): Promise<AccountOwnershipProof>;
/**
 * The founder's claim for the ANONYMOUS account route
 * (`POST /api/cloud/accounts/{account}/namespaces/{ns}/enable-ha`): no cloud
 * session, so no `subject`, and its own audience so a claim minted for one
 * route can never be replayed on the other. The cloud finds the user to bill
 * through the account's wallet link instead.
 */
export declare function signAccountHaClaim(input: AccountHaClaimInput): Promise<AccountOwnershipProof>;
export {};
