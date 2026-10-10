/**
 * The admin writes behind "create a workspace" and "add a organisation", kept free
 * of React so they can be exercised against a fake admin client.
 *
 * Every call here goes through the SESSION's admin (`useMero().admin`), never
 * the raw client's `mero.admin`. On a node login the two are the same client.
 * On a delegated (account) session they are not: the raw client's admin is the
 * relay's node route under the account's token, and `POST /admin-api/namespaces`,
 * `PUT /admin-api/groups/{ns}/metadata`, `PUT .../capabilities/default`,
 * `POST /admin-api/contexts` and `PUT .../contexts/{ctx}/metadata` all answer
 * 403 there. The account admin signs the same intent as a governance op the
 * relay applies on the account's behalf (apps#348, apps#352).
 */
import type { AdminApiClient } from '@calimero-network/mero-js';
import { MEMBER_CAPABILITIES } from './roles';

/** The admin calls founding a workspace makes, narrowed. */
export type FoundAdmin = Pick<
  AdminApiClient,
  'createNamespace' | 'setGroupMetadata' | 'setDefaultCapabilities'
>;

/** The admin calls adding a organisation makes, narrowed. */
export type ContextAdmin = Pick<
  AdminApiClient,
  'createContext' | 'setContextMetadata' | 'createContextAlias'
>;

export interface FoundedWorkspace {
  namespaceId: string;
  /**
   * Set when an ACCOUNT founded the workspace but no fleet node could be
   * admitted for it - the account is not linked to a cloud user, so an
   * invitation minted here is not hosted anywhere a joiner can reach. The
   * namespace itself exists and works; the person should hear this now, not
   * at invite time. A node login never sets it.
   */
  haError: string | null;
}

/** `haError` rides on the account admin's response (`FoundedDelegatedNamespace`); a node's has none. */
function haErrorOf(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null;
  const { haError } = res as { haError?: unknown };
  return typeof haError === 'string' && haError.trim() ? haError : null;
}

/**
 * Create the namespace, pin its name into the group metadata record and set
 * the app's member baseline as the group default.
 */
export async function foundWorkspace(
  admin: FoundAdmin,
  input: { applicationId: string; name: string },
): Promise<FoundedWorkspace> {
  // No `upgradePolicy` here: core stopped accepting it on this endpoint and
  // mero-js 13 dropped it from CreateNamespaceRequest. Upgrades are driven
  // per-group now (useUpgradeGroup / useGroupUpgradeStatus), not fixed at
  // namespace creation.
  const ns = await admin.createNamespace({
    applicationId: input.applicationId,
    name: input.name,
  });
  if (!ns?.namespaceId) throw new Error('createNamespace returned no namespaceId');
  // Pin the name into the group's metadata record as well as the create call.
  // `Namespace.name` is served FROM that record, so the two agree on a node
  // that honours `createNamespace({name})` - and on one that does not, this
  // is what stops the workspace from showing up as a hex id. Best-effort; the
  // create call's name already covers the common case.
  try {
    await admin.setGroupMetadata(ns.namespaceId, { name: input.name });
  } catch { /* createNamespace's own name stands */ }
  // What every member of this workspace may do: add a organisation and invite
  // people (MEMBER_CAPABILITIES, defined once in utils/roles). This is the
  // DEFAULT, so it applies to members who join later, not retroactively.
  try {
    await admin.setDefaultCapabilities(ns.namespaceId, {
      defaultCapabilities: MEMBER_CAPABILITIES,
    });
  } catch {
    // Keep core's built-in default. Swallowing this used to be invisible and
    // permanent: every member invited to the workspace could open it and do
    // nothing else, forever, with nothing anywhere saying why. The members
    // page now DETECTS that state and offers to repair it, which is what
    // makes this catch acceptable rather than a silent failure.
  }
  return { namespaceId: ns.namespaceId, haError: haErrorOf(ns) };
}

/** Create one context (a organisation) inside the workspace and return its id. */
export async function createWorkspaceContext(
  admin: Pick<ContextAdmin, 'createContext'>,
  input: { applicationId: string; groupId: string; serviceName: string; name: string },
): Promise<string> {
  const ctx = await admin.createContext({
    applicationId: input.applicationId,
    groupId: input.groupId,
    serviceName: input.serviceName,
    initializationParams: [],
    name: input.name,
  });
  if (!ctx?.contextId) throw new Error('createContext returned no contextId');
  return ctx.contextId;
}

/**
 * Publish a context's name where every OTHER member can read it, and - on a
 * node - give it a local alias too.
 *
 * `createContext({name})` gives the context a label on the CREATOR's node and
 * travels nowhere; the context metadata record is a CRDT against the managing
 * group, so it reaches everyone the namespace does. Without this an invited
 * teammate sees `a1b2c3d4` where the creator sees the organisation's name.
 *
 * Both writes are best-effort: a nameless organisation still works, and neither is
 * worth failing an otherwise-created organisation over.
 */
export async function publishContextName(
  admin: Pick<ContextAdmin, 'setContextMetadata' | 'createContextAlias'>,
  input: { groupId: string; contextId: string; name: string },
  session: { isDelegated: boolean },
): Promise<void> {
  try {
    await admin.setContextMetadata(input.groupId, input.contextId, { name: input.name });
  } catch { /* the local label still names it on the creator's node */ }
  // An alias is a node's own lookup table (`/admin-api/alias/...`), so tools
  // on that node can resolve the organisation by name. An account has no node of
  // its own to keep one in, and the account admin refuses the call by name
  // (`NotForAccountError`) - skip it rather than ask and swallow.
  if (session.isDelegated) return;
  try {
    await admin.createContextAlias({ alias: input.name, contextId: input.contextId });
  } catch { /* convenience only */ }
}
