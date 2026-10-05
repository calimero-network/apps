import { HTTPError, type AdminApiClient } from "@calimero-network/mero-js";
import { getAccessToken, getMeroClient } from "../lib/mero";
import { requireHexId } from "./ids";

// ── Admin API, through mero-js ───────────────────────────────────────────────
//
// Every function here used to be a `fetch` to `{nodeUrl}/admin-api/…` with the
// bearer token read out of localStorage. They now call the SDK's
// `AdminApiClient` (`getMeroClient().admin`) — the same routes and bodies on
// the wire, so the Playwright suite's `page.route()` mocks keep matching, but
// one implementation of URL joining, auth and token refresh, and no raw node
// HTTP in the app.
//
// What is kept from the hand-rolled version is the part the SDK does not do:
// the 401 → "sign out" hook that `App.tsx` installs, the readable error text
// (the node's own words, with Rust debug noise stripped), and the tolerant
// readers for responses whose shape has moved between node versions.

let _onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  _onUnauthorized = fn;
}

export function notifyUnauthorized(): void {
  _onUnauthorized?.();
}

export interface NamespaceRecord {
  namespaceId: string;
  targetApplicationId: string;
  memberCount: number;
  contextCount: number;
  alias?: string;
}

export interface ContextRecord {
  id: string;
  applicationId: string;
}

function parseAdminError(status: number, body: string): string {
  let msg = body;
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    msg = parsed.error ?? parsed.message ?? body;
  } catch { /* not JSON, use raw body */ }

  // Strip internal Rust debug representations like 'ContextGroupId(Identity([...bytes...]))'
  msg = msg.replace(/'[A-Za-z]+\(Identity\(\[[^\]]*\]\)\)'/g, "");
  // Normalize leftover punctuation from the stripped part
  msg = msg.replace(/\s*''\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // Capitalize first letter
  if (msg) msg = msg[0].toUpperCase() + msg.slice(1);

  const label = status >= 500 ? "Server error" : "Request failed";
  return msg ? `${label}: ${msg}` : `${label} (${status})`;
}

/** The signed-in admin client, or a thrown explanation of what is missing. */
function admin(): AdminApiClient {
  const client = getMeroClient();
  if (!client) throw new Error("Node URL not set — connect to a node first");
  // Token presence, not validity: an expired-but-refreshable token is the SDK's
  // to refresh on the 401, not ours to refuse up front.
  if (!getAccessToken()) throw new Error("Not authenticated — no access token");
  return client.admin;
}

/**
 * Run one admin call, turning the SDK's `HTTPError` into the message this app
 * has always shown and firing the sign-out hook on a 401.
 */
async function adminCall<T>(fn: (api: AdminApiClient) => Promise<T>): Promise<T> {
  try {
    return await fn(admin());
  } catch (err) {
    if (err instanceof HTTPError) {
      if (err.status === 401) {
        notifyUnauthorized();
        throw new Error("Unauthorized");
      }
      throw new Error(parseAdminError(err.status, err.bodyText ?? ""));
    }
    throw err;
  }
}

// ─── Contexts ────────────────────────────────────────────────────────────────

export async function listContexts(): Promise<ContextRecord[]> {
  const body = await adminCall((api) => api.getContexts());
  return (body?.contexts ?? []).map((c) => ({ id: c.id, applicationId: c.applicationId }));
}

export async function createContext(
  applicationId: string,
  groupId: string,
): Promise<{ contextId: string }> {
  // Same field, same node-side check — and a bare 500 here is ALSO what a wrong
  // `init` parameter set looks like, so ruling the id out first keeps those two
  // apart.
  const appId = requireHexId("applicationId", applicationId);
  const body = await adminCall((api) =>
    api.createContext({ applicationId: appId, groupId, initializationParams: [] }),
  );
  const contextId = body?.contextId;
  if (!contextId) throw new Error(`createContext: no contextId in response: ${JSON.stringify(body)}`);
  return { contextId };
}

export async function getContextIdentities(contextId: string): Promise<string[]> {
  const body = await adminCall((api) => api.getContextIdentitiesOwned(contextId));
  return body?.identities ?? [];
}

export async function getAllContextIdentities(contextId: string): Promise<string[]> {
  const body = await adminCall((api) => api.getContextIdentities(contextId));
  return body?.identities ?? [];
}

// `createContextInvitation` (POST /admin-api/contexts/{id}/invitations) and
// `joinContext` (POST /admin-api/contexts/join) used to live here. Neither
// route exists on the node this app targets — rc.34 serves exactly
// `POST /admin-api/contexts/{context_id}/join` for a context and mints
// invitations at the NAMESPACE (`POST /admin-api/namespaces/{id}/invite`), so
// both were a 404 rather than a join. Nothing in the app called either one,
// which is why no scenario ever went red; they were removed rather than
// repointed, because `joinContextById` below is the route that works and is
// what SetupWizard already uses.

// Join a context directly by ID (after already being a namespace member).
// Node B calls this after joinNamespace() to become a context member.
export async function joinContextById(contextId: string): Promise<void> {
  await adminCall((api) => api.joinContext(contextId));
}

export async function deleteContext(contextId: string): Promise<void> {
  await adminCall((api) => api.deleteContext(contextId));
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export interface GroupRecord {
  groupId: string;
  alias?: string;
  memberCount?: number;
  contextCount?: number;
}

export async function listGroups(namespaceId: string): Promise<GroupRecord[]> {
  // The SDK types this as `SubgroupEntry[]`; older nodes wrapped it in
  // `{ groups }` and spelled the name `alias`, so read it tolerantly.
  const body = await adminCall((api) => api.listNamespaceGroups(namespaceId)) as unknown;
  const arr = Array.isArray(body)
    ? body
    : ((body as { groups?: unknown[] } | null)?.groups ?? []);
  return arr.flatMap((raw) => {
    const g = (raw ?? {}) as Record<string, unknown>;
    if (typeof g.groupId !== "string") return [];
    const alias = g.alias ?? g.name;
    return [{
      groupId: g.groupId,
      ...(typeof alias === "string" ? { alias } : {}),
      ...(typeof g.memberCount === "number" ? { memberCount: g.memberCount } : {}),
      ...(typeof g.contextCount === "number" ? { contextCount: g.contextCount } : {}),
    }];
  });
}

// The body is `groupName` and/or `visibility` — `CreateGroupInNamespaceBody`,
// which is `deny_unknown_fields`. It is NOT `CreateGroupApiRequest`: the
// namespace-scoped subgroup route is a different, much smaller shape than
// `POST /groups`. This used to send `{ alias }`, which the node refuses with
//   unknown field `alias`, expected `groupName` or `visibility`
export async function createGroup(
  namespaceId: string,
  groupName?: string,
): Promise<{ groupId: string }> {
  const body = await adminCall((api) =>
    api.createGroupInNamespace(
      namespaceId,
      groupName ? { groupName, visibility: "open" } : { visibility: "open" },
    ),
  );
  const groupId = body?.groupId;
  if (!groupId) throw new Error(`createGroup: no groupId in response: ${JSON.stringify(body)}`);
  return { groupId };
}

export async function deleteGroup(groupId: string): Promise<void> {
  await adminCall((api) => api.deleteGroup(groupId));
}

// ─── Applications ─────────────────────────────────────────────────────────────

/** One installed application, as much of it as any node version reports. */
export interface ApplicationRecord {
  id: string;
  package?: string;
}

/**
 * Applications installed on this node.
 *
 * The wrapper key has moved between node versions (`apps`, `applications`,
 * `items`, or a bare array) and the package name has lived under three
 * spellings, so both are read tolerantly: an unrecognised shape yields an empty
 * list rather than an exception, because this is used to ANSWER "which app am
 * I" and failing to answer must not take the page down with it.
 */
export async function listApplications(): Promise<ApplicationRecord[]> {
  const data = await adminCall((api) => api.listApplications()) as unknown;
  const obj = (data ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(data)
    ? data
    : ((obj.apps ?? obj.applications ?? obj.items ?? []) as unknown[]);
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((raw) => {
    const a = (raw ?? {}) as Record<string, unknown>;
    const id = a.id ?? a.applicationId ?? a.application_id;
    if (typeof id !== "string" || !id) return [];
    const pkg = a.package ?? a.packageName ?? a.package_name;
    return [{ id, package: typeof pkg === "string" ? pkg : undefined }];
  });
}

// ─── Namespaces ───────────────────────────────────────────────────────────────

export async function listNamespaces(): Promise<NamespaceRecord[]> {
  const body = await adminCall((api) => api.listNamespaces()) as unknown;
  return Array.isArray(body) ? (body as NamespaceRecord[]) : [];
}

// No `upgradePolicy` in the body: core#3393 deleted the upgrade policy concept
// in rc.21 (`Automatic` had no receiver-side implementation and permanently
// gated sync on affected peers, so lazy-on-access is the only behaviour now).
// It was a REQUIRED field on rc.20 and is absent from the request type on
// rc.21+, so this body is the one that works on the node this app targets.
export async function createNamespace(
  applicationId: string,
): Promise<{ namespaceId: string }> {
  // Checked here rather than at the two call sites, so every caller gets the
  // same message. Unchecked, a wrong shape comes back as serde's
  // "applicationId: expected 64 hex characters (32 bytes) at line 1 column 28",
  // which names a JSON column and not the text box the value came from.
  const appId = requireHexId("applicationId", applicationId);
  const body = await adminCall((api) => api.createNamespace({ applicationId: appId }));
  const namespaceId = body?.namespaceId;
  if (!namespaceId) throw new Error(`createNamespace: no namespaceId in response: ${JSON.stringify(body)}`);
  return { namespaceId };
}

export async function deleteNamespace(namespaceId: string): Promise<void> {
  await adminCall((api) => api.deleteNamespace(namespaceId));
}

// Generate a namespace invitation for another node to join.
// Returns the raw invitation object — serialize to JSON and share with Node B.
export async function createNamespaceInvitation(
  namespaceId: string,
): Promise<object> {
  const body = await adminCall((api) => api.createNamespaceInvitation(namespaceId)) as
    | { invitation?: object }
    | undefined;
  const invitation = body?.invitation ?? body;
  if (!invitation) throw new Error(`createNamespaceInvitation: no invitation in response: ${JSON.stringify(body)}`);
  return invitation as object;
}

// Node B: join a namespace with an invitation from Node A.
// invitation = the object from createNamespaceInvitation() above.
export async function joinNamespace(
  namespaceId: string,
  invitation: object,
): Promise<void> {
  await adminCall((api) =>
    api.joinNamespace(namespaceId, {
      invitation: invitation as Parameters<AdminApiClient["joinNamespace"]>[1]["invitation"],
    }),
  );
}
