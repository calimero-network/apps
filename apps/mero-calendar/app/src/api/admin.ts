import type { AdminApiClient } from "@calimero-network/mero-js";
import {
  contextsForThisApp,
  namespacesForThisApp,
  type ContextRecord,
  type NamespaceRecord,
} from "./appScope";

// ── The admin API, through the session-aware client ──────────────────────────
//
// Every helper here takes `admin` = `useMero().admin`: the node's own admin
// client on a node login, and on an account the account admin, which founds,
// invites and governs through the relay under the account's device
// certificate. It is NOT `mero.admin` — on a delegated session that is the
// relay's node route under the account's bearer token, which carries no
// `namespace:manage`, and every write there is a 403.
//
// The hand-rolled `adminGet`/`adminPost` over axios + the stored JWT that these
// replace could only ever reach a node. A delegated session has no node URL and
// no node token, so the teams page was dead for an account before it sent its
// first request.

/** HTTP status off a mero-js error, when it carries one. */
export function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** True for the two ways an older node says "that route does not exist". */
function routeMissing(err: unknown): boolean {
  const status = statusOf(err);
  return status === 404 || status === 405;
}

/**
 * Pull a list out of whatever core wrapped it in.
 *
 * What a route returns differs: a bare array for namespaces, `{contexts: [...]}`
 * for the context routes. Anything unrecognised becomes an empty list rather
 * than a crash — these lists drive a picker, and a picker with no options is
 * readable while a thrown TypeError blanks the page.
 */
export function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["contexts", "namespaces", "items", "data"]) {
      const val = obj[key];
      if (Array.isArray(val)) return val as T[];
      if (val && typeof val === "object") {
        const nested = unwrapList<T>(val);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

/**
 * List the namespaces that target a single application.
 *
 * Never widens to the whole node. Without an application id there is no correct
 * answer, so the answer is an empty list: showing another application's
 * namespaces as Mero Calendar teams dead-ends on an opaque 500 the moment one
 * is opened.
 *
 * Older merod builds lack the scoped route; there the unscoped list is filtered
 * client-side on `targetApplicationId`, the same field core's scoped handler
 * filters on and one it always serializes on both routes. (On an account the
 * account admin's scoped list is already the account's own, filtered the same
 * way.)
 */
export async function listNamespaces(
  admin: AdminApiClient,
  applicationId?: string,
): Promise<NamespaceRecord[]> {
  const appId = applicationId?.trim();
  if (!appId) return [];

  try {
    const scoped = await admin.listNamespacesForApplication(appId);
    return namespacesForThisApp(unwrapList<NamespaceRecord>(scoped), appId);
  } catch (err) {
    if (!routeMissing(err)) throw err;
  }

  const all = await admin.listNamespaces();
  return namespacesForThisApp(unwrapList<NamespaceRecord>(all), appId);
}

/**
 * List the contexts running a single application, across every namespace.
 *
 * Same contract as `listNamespaces`: no application id means an empty list.
 */
export async function listContextsForApplication(
  admin: AdminApiClient,
  applicationId?: string,
): Promise<ContextRecord[]> {
  const appId = applicationId?.trim();
  if (!appId) return [];

  try {
    const scoped = await admin.getContextsForApplication(appId);
    return contextsForThisApp(unwrapList<ContextRecord>(scoped), appId);
  } catch (err) {
    if (!routeMissing(err)) throw err;
  }

  const all = await admin.getContexts();
  return contextsForThisApp(unwrapList<ContextRecord>(all), appId);
}

/** List the contexts inside one group (a team root or a calendar subgroup). */
export async function listGroupContexts(
  admin: AdminApiClient,
  groupId: string,
): Promise<ContextRecord[]> {
  return unwrapList<ContextRecord>(await admin.listGroupContexts(groupId));
}

/** The ids of a team's subgroups. Tolerates the older `{subgroups}` envelope. */
export async function listSubgroupIds(
  admin: AdminApiClient,
  groupId: string,
): Promise<string[]> {
  const raw: unknown = await admin.listSubgroups(groupId);
  const rows = Array.isArray(raw)
    ? raw
    : unwrapList<unknown>(
        (raw as { subgroups?: unknown } | null)?.subgroups ?? raw,
      );
  return rows
    .map((sg) => {
      const r = sg as { groupId?: string; group_id?: string; id?: string };
      return (r.groupId ?? r.group_id ?? r.id ?? "").trim();
    })
    .filter(Boolean);
}

// ── Replicated names (group metadata) ────────────────────────────────────────
//
// ⚠️ Why this exists at all: a calendar's name used to live ONLY in the
// creator's `localStorage` (see utils/teamName). Every other member of the team
// therefore saw the raw context id.
//
// Core's metadata ops are the right home: `ContextMetadataSet` is group-scoped
// and replicates to exactly the members of that group, and the name comes back
// on `listGroupContexts` for everyone. Setting it needs either group admin or
// the `CAN_MANAGE_METADATA` capability (1 << 8) — which is why the Admin role
// grants that bit as well as the right to create calendars.
//
// Server-enforced limit: `name` is at most 64 bytes. Longer names are refused
// by core rather than truncated, so the UI caps the input instead.

/** Publish a calendar's name to every member of the team. */
export async function setContextName(
  admin: AdminApiClient,
  groupId: string,
  contextId: string,
  name: string,
): Promise<void> {
  await admin.setContextMetadata(groupId, contextId, { name });
}

/** Publish a team's own name to its members. */
export async function setGroupName(
  admin: AdminApiClient,
  groupId: string,
  name: string,
): Promise<void> {
  await admin.setGroupMetadata(groupId, { name });
}

// ── Members and capabilities ─────────────────────────────────────────────────

/** One member row. `identity` is an ACCOUNT, 64 hex. */
export interface GroupMemberRow {
  identity: string;
  role?: string;
  name?: string;
}

export async function listGroupMembers(
  admin: AdminApiClient,
  groupId: string,
): Promise<GroupMemberRow[]> {
  const raw = (await admin.listGroupMembers(groupId)) as
    | { members?: GroupMemberRow[]; data?: GroupMemberRow[] }
    | GroupMemberRow[];
  if (Array.isArray(raw)) return raw;
  return raw?.members ?? raw?.data ?? [];
}

/**
 * A member's capability bitmask.
 *
 * ⚠️ `identity` is the member's ACCOUNT, as `listGroupMembers` returns — NOT a
 * signing key. Both are 64 hex characters and the server accepts either
 * without complaint, so passing a key here names a principal that does not
 * exist and reads back as 0 capabilities.
 */
export async function getMemberCapabilities(
  admin: AdminApiClient,
  groupId: string,
  identity: string,
): Promise<number> {
  const raw = (await admin.getMemberCapabilities(groupId, identity)) as
    | { capabilities?: number }
    | number;
  if (typeof raw === "number") return raw;
  return raw?.capabilities ?? 0;
}

export async function setMemberCapabilities(
  admin: AdminApiClient,
  groupId: string,
  identity: string,
  capabilities: number,
): Promise<void> {
  await admin.setMemberCapabilities(groupId, identity, { capabilities });
}

/**
 * The capabilities a member gets when their own row cannot be read.
 *
 * An account's read of a member's capabilities can still 403 on today's relay
 * (core#4483 lands the fix). That must not read as "no permission": the group
 * admin is an admin whatever the capability route says, and everyone else
 * holds at least the group's defaults. Falls back to 0 only when the group
 * info cannot be read either — never upward.
 */
export async function fallbackCapabilities(
  admin: AdminApiClient,
  groupId: string,
  row: GroupMemberRow,
  adminMask: number,
): Promise<number> {
  if (/^(admin|owner)$/i.test(row.role ?? "")) return adminMask;
  try {
    const info = (await admin.getGroupInfo(groupId)) as {
      defaultCapabilities?: number;
    };
    return info?.defaultCapabilities ?? 0;
  } catch {
    return 0;
  }
}
