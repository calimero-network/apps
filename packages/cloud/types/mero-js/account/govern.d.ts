/**
 * An account's group management through a relay: one delegated governance op
 * per call (`RelayClient.govern`), posted to the relay that serves the group's
 * namespace.
 *
 * A group op goes to the group it acts on; a root op (create, delete, move a
 * subgroup; join an open one) goes to the NAMESPACE. The namespace of a
 * subgroup is remembered here per account: when this account created it, and
 * when the account admin asked the relay for it (`getGroupInfo`).
 */
import { type GovernanceOp } from '../warrant/index.js';
import { type DelegatedSession } from './session.js';
/** Record that `groupId` is a subgroup of `namespaceId`, for this account. */
export declare function rememberGroupNamespace(account: string, groupId: string, namespaceId: string): void;
/** The namespace a group belongs to: itself if it is a namespace this account is in, else what was remembered. */
export declare function namespaceOfGroup(s: DelegatedSession, groupId: string): string | undefined;
/** A group op (member, role, capabilities, metadata, visibility, detach) on `groupId`. */
export declare function governGroup(s: DelegatedSession, groupId: string, op: GovernanceOp): Promise<{
    groupId: string;
}>;
/** A root op, posted to the namespace `groupId` belongs to. */
export declare function governRoot(s: DelegatedSession, groupId: string, op: GovernanceOp): Promise<{
    groupId: string;
}>;
