import { getAccessToken, getNodeUrl, nodeEndpoint } from "../lib/mero";

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

async function adminFetch(path: string, opts?: RequestInit): Promise<unknown> {
  const baseUrl = getNodeUrl();
  const token = getAccessToken();
  if (!baseUrl) throw new Error("Node URL not set — connect to a node first");
  if (!token) throw new Error("Not authenticated — no access token");

  // Naive `${baseUrl}${path}` concatenation produced `//admin-api/...` whenever
  // the stored node URL ended in a slash. `nodeEndpoint` normalises the base and
  // preserves a path prefix.
  const res = await fetch(nodeEndpoint(baseUrl, path.replace(/^\//, "")), {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    notifyUnauthorized();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(parseAdminError(res.status, text));
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 204 || !contentType.includes("application/json")) {
    return undefined;
  }
  return res.json();
}

// ─── Contexts ────────────────────────────────────────────────────────────────

export async function listContexts(): Promise<ContextRecord[]> {
  const body = await adminFetch("/admin-api/contexts") as {
    data?: { contexts?: ContextRecord[] };
  };
  return body?.data?.contexts ?? [];
}

export async function createContext(
  applicationId: string,
  groupId: string,
): Promise<{ contextId: string }> {
  const body = await adminFetch("/admin-api/contexts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, groupId, initializationParams: [] }),
  }) as { data?: { contextId?: string } };
  const contextId = body?.data?.contextId;
  if (!contextId) throw new Error(`createContext: no contextId in response: ${JSON.stringify(body)}`);
  return { contextId };
}

export async function getContextIdentities(contextId: string): Promise<string[]> {
  const body = await adminFetch(`/admin-api/contexts/${contextId}/identities-owned`) as {
    data?: { identities?: string[] };
  };
  return body?.data?.identities ?? [];
}

export async function getAllContextIdentities(contextId: string): Promise<string[]> {
  const body = await adminFetch(`/admin-api/contexts/${contextId}/identities`) as {
    data?: { identities?: string[] };
  };
  return body?.data?.identities ?? [];
}

export async function createContextInvitation(contextId: string): Promise<string> {
  const body = await adminFetch(`/admin-api/contexts/${contextId}/invitations`, {
    method: "POST",
  }) as { data?: { invitePayload?: string } | string };

  if (typeof body === "object" && body !== null && "data" in body) {
    const data = (body as { data?: { invitePayload?: string } | string }).data;
    if (typeof data === "string") return data;
    if (typeof data === "object" && data !== null && "invitePayload" in data) {
      return (data as { invitePayload: string }).invitePayload;
    }
  }
  throw new Error(`createContextInvitation: unexpected response: ${JSON.stringify(body)}`);
}

export async function joinContext(invitePayload: string): Promise<void> {
  await adminFetch("/admin-api/contexts/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitePayload }),
  });
}

// Join a context directly by ID (after already being a namespace member).
// Node B calls this after joinNamespace() to become a context member.
export async function joinContextById(contextId: string): Promise<void> {
  await adminFetch(`/admin-api/contexts/${contextId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function deleteContext(contextId: string): Promise<void> {
  await adminFetch(`/admin-api/contexts/${contextId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export interface GroupRecord {
  groupId: string;
  alias?: string;
  memberCount?: number;
  contextCount?: number;
}

export async function listGroups(namespaceId: string): Promise<GroupRecord[]> {
  const body = await adminFetch(`/admin-api/namespaces/${namespaceId}/groups`) as {
    data?: GroupRecord[] | { groups?: GroupRecord[] };
  };
  if (Array.isArray(body?.data)) return body.data as GroupRecord[];
  return (body?.data as { groups?: GroupRecord[] })?.groups ?? [];
}

export async function createGroup(
  namespaceId: string,
  alias?: string,
): Promise<{ groupId: string }> {
  const body = await adminFetch(`/admin-api/namespaces/${namespaceId}/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(alias ? { alias } : {}),
  }) as { data?: { groupId?: string } };
  const groupId = body?.data?.groupId;
  if (!groupId) throw new Error(`createGroup: no groupId in response: ${JSON.stringify(body)}`);
  return { groupId };
}

export async function deleteGroup(groupId: string): Promise<void> {
  await adminFetch(`/admin-api/groups/${groupId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

// ─── Namespaces ───────────────────────────────────────────────────────────────

export async function listNamespaces(): Promise<NamespaceRecord[]> {
  const body = await adminFetch("/admin-api/namespaces") as {
    data?: NamespaceRecord[];
  };
  return body?.data ?? [];
}

// No `upgradePolicy` in the body: core#3393 deleted the upgrade policy concept
// in rc.21 (`Automatic` had no receiver-side implementation and permanently
// gated sync on affected peers, so lazy-on-access is the only behaviour now).
// It was a REQUIRED field on rc.20 and is absent from the request type on
// rc.21+, so this body is the one that works on the node this app targets.
export async function createNamespace(
  applicationId: string,
): Promise<{ namespaceId: string }> {
  const body = await adminFetch("/admin-api/namespaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId }),
  }) as { data?: { namespaceId?: string } };
  const namespaceId = body?.data?.namespaceId;
  if (!namespaceId) throw new Error(`createNamespace: no namespaceId in response: ${JSON.stringify(body)}`);
  return { namespaceId };
}

export async function deleteNamespace(namespaceId: string): Promise<void> {
  await adminFetch(`/admin-api/namespaces/${namespaceId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

// Generate a namespace invitation for another node to join.
// Returns the raw invitation object — serialize to JSON and share with Node B.
export async function createNamespaceInvitation(
  namespaceId: string,
): Promise<object> {
  const body = await adminFetch(`/admin-api/namespaces/${namespaceId}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }) as { data?: { invitation?: object } };
  const invitation = body?.data?.invitation ?? body?.data;
  if (!invitation) throw new Error(`createNamespaceInvitation: no invitation in response: ${JSON.stringify(body)}`);
  return invitation as object;
}

// Node B: join a namespace with an invitation from Node A.
// invitation = the object from createNamespaceInvitation() above.
export async function joinNamespace(
  namespaceId: string,
  invitation: object,
): Promise<void> {
  await adminFetch(`/admin-api/namespaces/${namespaceId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitation }),
  });
}
