/**
 * An account's admin API: the same method names and types as mero-js's
 * `AdminApiClient`, so an app written against a node's admin needs no second
 * code path. Reads go to the relay's caller-scoped admin client; writes go
 * through the relay as governance ops, delegated context and namespace
 * creation, or an invitation the account signs itself. A write with no
 * account form (upgrades, installs) is refused by name.
 */
import { type AdminApiClient, type SignedGroupOpenInvitation } from '../admin-api/index.js';
import { signGroupInvitation } from '../invitation/index.js';
import type { DelegatedSession } from './session.js';
import { governGroup, governRoot } from './govern.js';
import { createDelegatedContext, foundDelegatedNamespace } from './create-context.js';
export declare class NotForAccountError extends Error {
    readonly method: string;
    constructor(method: string);
}
/**
 * An account that has enrolled but joined nothing has no relay: nothing serves
 * it yet. Its listings are empty, which is true; anything else names this.
 */
export declare class NoRelayError extends Error {
    readonly method: string;
    constructor(method: string);
}
/**
 * Why an account's invitation was not minted: nobody its claimant could reach
 * would admit them. A claimant with no node finds its admitter through the
 * cloud's routing, intersected with the invitation's signed admitters, so an
 * invitation the cloud routes to none of them can only fail in their hands.
 *
 * - `not-hosted` - the cloud lists no node holding the namespace. A relay it
 *   does not list cannot stand in: an address on the invitation is unsigned.
 * - `no-named-node` — the cloud's nodes are not among the admitters this
 *   invitation would name.
 */
export declare class InvitationNotClaimableError extends Error {
    readonly namespaceId: string;
    readonly reason: 'not-hosted' | 'no-named-node';
    constructor(namespaceId: string, reason: 'not-hosted' | 'no-named-node');
}
export interface AccountAdminDeps {
    govern?: {
        group: typeof governGroup;
        root: typeof governRoot;
    };
    createContext?: typeof createDelegatedContext;
    found?: typeof foundDelegatedNamespace;
    latestVersion?: (registryUrl: string, pkg: string) => Promise<string>;
    signInvitation?: typeof signGroupInvitation;
    /**
     * Redeem an invitation for this account: resolve the relay the invitation
     * names, have it admit the account, and switch the session onto that relay.
     * The provider supplies it (it owns the session); without it a join is
     * refused by name. Rejects with the refusal's reason and HTTP `status`.
     */
    join?: (namespaceId: string, invitation: SignedGroupOpenInvitation) => Promise<{
        namespaceId: string;
    }>;
    /**
     * The cloud's routing for a namespace (`CloudClient.getNamespaceRouting`):
     * the nodes a node-less invitee can be admitted through. Given, an
     * invitation is minted only if one of them is an admitter it names; a lookup
     * that fails does not block minting. The provider supplies it.
     */
    routing?: (namespaceId: string) => Promise<{
        nodes: ReadonlyArray<{
            account: string | null;
        }>;
    }>;
}
export declare function createAccountAdmin(input: {
    session: DelegatedSession;
    read: AdminApiClient | null;
    app: {
        packageName?: string;
        packageVersion?: string;
        registryUrl?: string;
    };
}, deps?: AccountAdminDeps): AdminApiClient;
