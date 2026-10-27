import { type GovernanceOp } from '../warrant/index.js';
import { type DelegatedSession } from './session.js';
/**
 * What an account asks for when it creates a context: the fields of a node's
 * `CreateContextRequest` that have a place in the creation warrant
 * (mero-js `CreationWarrantInput`), plus which namespace to find the relay by.
 *
 * Intentionally NOT here, because the warrant has no field for it:
 * `identitySecret` — a node's key for its new member identity; the account IS
 * the member identity here (`init` runs as the author's account), so there is
 * nothing to derive one from.
 */
export interface CreateDelegatedContextRequest {
    readonly namespaceId: string;
    /** The group to create it in; the namespace itself when omitted. */
    readonly groupId?: string;
    readonly applicationId: string;
    /**
     * Which service of a multi-service bundle the context is for; absent for
     * the bundle's default service. Signed into the warrant: the relay runs THAT
     * service's `init`, so a bundle like mero-docs (`registry`, `docs`) creates
     * the right contract.
     */
    readonly serviceName?: string;
    /** The seed the context id is derived from, hex (32 bytes); random when absent. */
    readonly contextSeed?: string;
    readonly initializationParams?: number[];
    readonly name?: string;
}
export declare function createDelegatedContext(s: DelegatedSession, req: CreateDelegatedContextRequest, deps?: {
    fetch?: typeof fetch;
}): Promise<{
    contextId: string;
}>;
/** Publish one delegable governance op through the namespace's relay. */
export declare function delegatedGovernance(s: DelegatedSession, req: {
    namespaceId: string;
    group: string;
    op: GovernanceOp;
}, deps?: {
    fetch?: typeof fetch;
}): Promise<{
    groupId: string;
}>;
/**
 * A context only the author and `members` are in (a DM, a small room): a
 * restricted subgroup of the namespace (a root op, posted to the namespace),
 * each member added to it directly — they are in the namespace already, so
 * nobody is invited — and the context created inside it. The relay that
 * creates the subgroup is seated in it with CAN_AUTHOR_ON_BEHALF by core.
 */
export declare function createDelegatedPrivateContext(s: DelegatedSession, req: CreateDelegatedContextRequest & {
    readonly members: readonly string[];
}, deps?: {
    fetch?: typeof fetch;
}): Promise<{
    contextId: string;
    groupId: string;
}>;
/**
 * Found a namespace as the account, through a relay it already uses. The
 * account becomes founder, owner and admin; the relay is seated in it (and a
 * TEE relay admits itself as its first TEE), so contexts can be created in it
 * through the same relay straight away.
 *
 * The relay's executor account and key cannot be asked about a namespace that
 * does not exist yet; see {@link foundingExecutor} for where they come from.
 */
export declare function foundDelegatedNamespace(s: DelegatedSession, req?: {
    readonly defaultCapabilities?: number;
    /** The application the namespace runs; without one no context can be created in it. */
    readonly application?: {
        applicationId: string;
        package: string;
        version: string;
    };
}, deps?: {
    fetch?: typeof fetch;
    /** The cloud to enable HA on; mero-js's default when unset. */
    cloudBaseUrl?: string;
}): Promise<FoundedDelegatedNamespace>;
/** What {@link foundDelegatedNamespace} returns. */
export interface FoundedDelegatedNamespace {
    namespaceId: string;
    teeEnabled: boolean;
    /** Whether the cloud agreed to host the namespace (HA) right after founding. */
    haEnabled: boolean;
    /** Why `haEnabled` is `false`, in words a person can act on. */
    haError?: string;
}
/** What an app can tell a person whose account the cloud cannot place. */
export declare const HA_ACCOUNT_NOT_LINKED_MESSAGE = "link this account to your cloud user in the wallet so the cloud can host this namespace on its fleet";
/**
 * What to tell a person for each refusal the cloud names, keyed by its code.
 * Every one leaves the namespace founded; only hosting was refused.
 */
export declare const HA_REFUSAL_MESSAGES: Record<string, string>;
/**
 * The latest version of `pkg` the registry publishes. Used when the app names
 * its package but not a version. Same selection as the id derivation
 * ({@link selectLatestBundle}): the newest version that is not yanked.
 */
export declare function latestPublishedVersion(registryUrl: string, pkg: string, fetchFn?: typeof fetch): Promise<string>;
