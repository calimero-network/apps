import { RpcError, type SignedGroupOpenInvitation } from "@calimero-network/mero-js";
import { getApi } from "./client";
import { getCachedBlob, setCachedBlob } from "../utils/blobCache";
import { fromWire, metaOf, packLabel, toWire } from "../utils/elementMeta";
import { useCanvasStore } from "../store/canvasStore";
import type { Element } from "../types";

// ── Contract calls ───────────────────────────────────────────────────────────
//
// Every call goes through the session's `rpc` transport (see `client.tsx`):
// JSON-RPC `execute` against a node on a node login, a warrant through the
// relay on an account session. The call sites do not know which — the same
// `rpcCall(contextId, method, args)` serves both.

/**
 * Fold the client-side element extras into `label` on the way out.
 *
 * Only the two methods that write a label carry them — see
 * `utils/elementMeta.ts`. A label rename looks the element up in the store so a
 * rename never strips its dash style or sticky-ness; a caller that is changing
 * the extras themselves passes the updated element as `__element`, because the
 * store write it just made may not be the one this reads.
 */
export function packArgs(method: string, args: Record<string, unknown>): Record<string, unknown> {
  if (method === "add_element" && args.element && typeof args.element === "object") {
    return { ...args, element: toWire(args.element as Element) };
  }
  if (method === "add_elements" && Array.isArray(args.elements)) {
    return { ...args, elements: (args.elements as Element[]).map(toWire) };
  }
  if (method === "update_element_label") {
    const { __element, ...rest } = args as { __element?: Element } & Record<string, unknown>;
    const source = __element
      ?? useCanvasStore.getState().elements.find((e) => e.id === rest.id);
    const label = (rest.label as string | null | undefined) ?? null;
    return { ...rest, label: source ? packLabel(label, metaOf(source)) : label };
  }
  if (method === "update_element_labels" && Array.isArray(args.labels)) {
    // Same packing as the single rename, one lookup table for the whole batch.
    const byId = new Map(useCanvasStore.getState().elements.map((e) => [e.id, e] as const));
    const labels = (args.labels as { id: string; label?: string | null }[]).map(({ id, label }) => {
      const source = byId.get(id);
      const plain = label ?? null;
      return { id, label: source ? packLabel(plain, metaOf(source)) : plain };
    });
    return { ...args, labels };
  }
  return args;
}

/** Unpack every element a read returns — the inverse of `packArgs`. */
export function unpackResult<T>(method: string, value: T): T {
  if ((method === "get_elements" || method === "get_elements_by_ids") && Array.isArray(value)) {
    return value.map((el) => fromWire(el as Element)) as T;
  }
  if (method === "get_element" && value && typeof value === "object") {
    return fromWire(value as unknown as Element) as T;
  }
  return value;
}

/**
 * What a contract method returned, whatever shape the transport handed back.
 *
 * A node's `execute` answers `{ output, logs }` and mero-js returns `output`
 * verbatim: older nodes encode it as a `u8[]` of JSON text, newer ones as the
 * parsed value (string, object, array of objects). The relay answers the
 * parsed `returns`. Handle all of them.
 */
export function decodeOutput<T>(out: unknown): T {
  if (out === null || out === undefined) return null as T;
  if (typeof out === "string") {
    try { return JSON.parse(out) as T; } catch { return out as T; }
  }
  if (Array.isArray(out)) {
    if (out.length === 0) return null as T;
    if (typeof out[0] !== "number") return out as T; // already JSON values
    // Legacy byte-array format
    const text = new TextDecoder().decode(new Uint8Array(out as number[]));
    return JSON.parse(text) as T;
  }
  if (typeof out === "object") return out as T;
  // A bare number or boolean is already the value.
  return out as T;
}

/**
 * A readable message for a failed contract call: the WASM's own reason when
 * the RPC error carries one, else the RPC-level message.
 */
function rpcFailure(err: unknown): Error {
  if (err instanceof RpcError) {
    const data = err.data;
    if (typeof data === "string" && data) return new Error(data);
    if (data && typeof data === "object") {
      const inner = (data as { data?: unknown; message?: unknown });
      if (typeof inner.data === "string" && inner.data) return new Error(inner.data);
      if (typeof inner.message === "string" && inner.message) return new Error(inner.message);
    }
    return new Error(err.message || JSON.stringify(data ?? err));
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function rpcCall<T>(
  contextId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { rpc } = getApi();
  let out: unknown;
  try {
    out = await rpc.execute<unknown>({ contextId, method, argsJson: packArgs(method, args) });
  } catch (err) {
    throw rpcFailure(err);
  }
  return unpackResult(method, decodeOutput<T>(out));
}

// ── Admin API ────────────────────────────────────────────────────────────────
//
// Thin, typed wrappers over the session's admin client. They exist so pages
// and tests have one seam (`../api/rpc`) rather than reaching for the client
// everywhere, and so the shapes the pages read are normalised in one place.

/** What `admin.getNodeIdentity()` answers with. */
export interface NodeIdentity {
  /** The person: 64 hex characters. What member listings name members by. */
  accountId: string;
  /** This installation, when the node reports one. */
  deviceId?: string | null;
  publicKey?: string;
}

/**
 * Ask the session who it is.
 *
 * core 0.11.0-rc.23 (#3522) deleted `GET /namespaces/:id/identity` and dropped
 * `selfIdentity` from the group member listing — "who am I" was always a
 * node-level question, and one identity is shared across namespaces. Compare
 * `accountId` against a member's `identity`, which rc.23 also made an account.
 * On an account session the account admin answers with the account itself.
 */
export async function getNodeIdentity(): Promise<NodeIdentity> {
  const me = await getApi().admin.getNodeIdentity();
  return { accountId: me.accountId ?? "", deviceId: me.deviceId, publicKey: me.publicKey };
}

export interface NamespaceEntry {
  namespaceId: string;
  name?: string;
}

function httpStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

/**
 * This app's namespaces. Scoped to the application so only Mero Design's
 * teams come back (instead of every namespace the session can see). Falls
 * back to the unscoped listing on older nodes that lack the scoped route
 * (404/405).
 */
export async function listNamespaces(applicationId?: string): Promise<NamespaceEntry[]> {
  const { admin } = getApi();
  let raw: unknown;
  if (applicationId) {
    try {
      raw = await admin.listNamespacesForApplication(applicationId);
    } catch (err) {
      const status = httpStatus(err);
      if (status !== 404 && status !== 405) throw err;
      raw = await admin.listNamespaces();
    }
  } else {
    raw = await admin.listNamespaces();
  }
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { namespaces?: unknown[]; data?: unknown[] } | null)?.namespaces
        ?? (raw as { data?: unknown[] } | null)?.data
        ?? []);
  return (list as Record<string, unknown>[])
    .map((n) => ({
      namespaceId: String(n.namespaceId ?? n.groupId ?? n.id ?? ""),
      name: (typeof n.name === "string" ? n.name : typeof n.alias === "string" ? n.alias : "") || undefined,
    }))
    .filter((n) => n.namespaceId);
}

export interface CreatedNamespace {
  namespaceId: string;
  /**
   * An account founds through the relay and asks the cloud to host the new
   * team (HA). When the cloud declined — typically the account is not linked
   * to a cloud user yet — `haError` says why, and invitations minted for the
   * team will not be claimable until that is fixed. A node never sets these.
   */
  haEnabled?: boolean;
  haError?: string;
}

/**
 * Found a team. The body is EXACTLY `applicationId` + `name`:
 * `CreateNamespaceApiRequest` is `deny_unknown_fields`, so an extra key is a
 * 400 for the whole create.
 */
export async function createNamespace(applicationId: string, name: string): Promise<CreatedNamespace> {
  const data = await getApi().admin.createNamespace({ applicationId, name });
  const extra = data as { haEnabled?: boolean; haError?: string };
  return {
    namespaceId: data.namespaceId ?? "",
    ...(extra.haEnabled !== undefined ? { haEnabled: extra.haEnabled } : {}),
    ...(extra.haError ? { haError: extra.haError } : {}),
  };
}

/** Node-only: an account cannot delete a namespace. Callers hide the control. */
export async function deleteNamespace(namespaceId: string): Promise<void> {
  await getApi().admin.deleteNamespace(namespaceId);
}

/**
 * Mint an invitation to a team. Returned as the raw response object so the
 * token the inviter shares is exactly what the node (or the account) signed;
 * the joiner's parser reads `invitation` out of it.
 */
export async function createNamespaceInvitation(namespaceId: string): Promise<Record<string, unknown>> {
  const data = await getApi().admin.createNamespaceInvitation(namespaceId);
  return (data ?? {}) as unknown as Record<string, unknown>;
}

/** Redeem an invitation. `invitation` is the signed struct, not the whole token. */
export async function joinNamespace(namespaceId: string, invitation: unknown): Promise<void> {
  await getApi().admin.joinNamespace(namespaceId, {
    invitation: invitation as SignedGroupOpenInvitation,
  });
}

export interface SubgroupInfo {
  groupId: string;
  name?: string;
}

/** The subgroups of a team — one per project. */
export async function listSubgroups(groupId: string): Promise<SubgroupInfo[]> {
  const raw: unknown = await getApi().admin.listSubgroups(groupId);
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { subgroups?: unknown[]; data?: unknown[] } | null)?.subgroups
        ?? (raw as { data?: unknown[] } | null)?.data
        ?? []);
  return (list as Record<string, unknown>[])
    .map((s) => ({
      groupId: String(s.groupId ?? s.group_id ?? s.id ?? ""),
      name: (typeof s.name === "string" ? s.name : typeof s.alias === "string" ? s.alias : "") || undefined,
    }))
    .filter((s) => s.groupId);
}

export interface GroupContextInfo {
  contextId: string;
  name?: string;
}

/** The contexts in a group — a project's board lives in its subgroup. */
export async function listGroupContexts(groupId: string): Promise<GroupContextInfo[]> {
  const raw: unknown = await getApi().admin.listGroupContexts(groupId);
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { contexts?: unknown[]; items?: unknown[]; data?: unknown[] } | null)?.contexts
        ?? (raw as { items?: unknown[] } | null)?.items
        ?? (raw as { data?: unknown[] } | null)?.data
        ?? []);
  return (list as Record<string, unknown>[])
    .map((c) => ({
      contextId: String(c.contextId ?? c.context_id ?? c.id ?? ""),
      name: (typeof c.name === "string" ? c.name : typeof c.alias === "string" ? c.alias : "") || undefined,
    }))
    .filter((c) => c.contextId);
}

/**
 * A project's subgroup. `CreateGroupInNamespaceBody` accepts `groupName` and
 * `visibility`, nothing else, and is `deny_unknown_fields`.
 */
export async function createSubgroup(namespaceId: string, groupName: string): Promise<string> {
  const data = await getApi().admin.createGroupInNamespace(namespaceId, { groupName });
  const raw = data as unknown as { groupId?: string; group_id?: string; id?: string };
  return raw.groupId ?? raw.group_id ?? raw.id ?? "";
}

export async function setSubgroupVisibility(groupId: string, subgroupVisibility: "open" | "restricted"): Promise<void> {
  await getApi().admin.setSubgroupVisibility(groupId, { subgroupVisibility });
}

/**
 * A project's board. `CreateContextRequest` is `deny_unknown_fields` and
 * accepts only applicationId / serviceName / contextSeed / initializationParams
 * / groupId / identitySecret / name.
 */
export async function createContext(input: {
  applicationId: string;
  groupId: string;
  name: string;
  initializationParams: number[];
}): Promise<string> {
  const data = await getApi().admin.createContext(input);
  const raw = data as unknown as { contextId?: string; id?: string };
  return raw.contextId ?? raw.id ?? "";
}

/** Node-only: an account cannot delete a context. Callers hide the control. */
export async function deleteContext(contextId: string): Promise<void> {
  await getApi().admin.deleteContext(contextId);
}

/**
 * Join a context this session is entitled to but hasn't joined yet (e.g. a
 * project created on a peer after we joined the team). Idempotent.
 */
export async function joinContext(contextId: string): Promise<{ memberPublicKey?: string }> {
  const data = await getApi().admin.joinContext(contextId);
  return { memberPublicKey: data?.memberPublicKey };
}

/** The identities this session holds in a context — its member key(s). */
export async function getContextIdentitiesOwned(contextId: string): Promise<string[]> {
  const res: unknown = await getApi().admin.getContextIdentitiesOwned(contextId);
  if (Array.isArray(res)) return res.filter((x): x is string => typeof x === "string");
  const obj = res as { identities?: unknown[]; items?: unknown[] } | null;
  const list = obj?.identities ?? obj?.items ?? [];
  return (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === "string");
}

export interface GroupMemberInfo {
  identity: string;
  role: string;
  name?: string;
}

export async function listGroupMembers(groupId: string): Promise<GroupMemberInfo[]> {
  const raw: unknown = await getApi().admin.listGroupMembers(groupId);
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { members?: unknown[]; data?: unknown[] } | null)?.members
        ?? (raw as { data?: unknown[] } | null)?.data
        ?? []);
  return (list as Record<string, unknown>[])
    .map((m) => ({
      identity: String(m.identity ?? m.memberId ?? m.id ?? ""),
      role: typeof m.role === "string" ? m.role : "Member",
      name: (typeof m.name === "string" ? m.name.trim() : "") || undefined,
    }))
    .filter((m) => m.identity);
}

export async function updateMemberRole(groupId: string, identity: string, role: string): Promise<void> {
  await getApi().admin.updateMemberRole(groupId, identity, { role });
}

// ── Blobs ────────────────────────────────────────────────────────────────────
//
// `contextId` is REQUIRED on both calls. On a node it makes the upload announce
// the blob to the context's peers at once, and the read do P2P discovery for
// a blob a peer holds and we do not (without it the node only checks local
// storage and 404s — exactly the receiver-side error for peer-uploaded
// images). On a relay the account's blob requests are refused outright
// without one.

export async function uploadBlob(data: ArrayBuffer | Uint8Array, contextId: string): Promise<{ blobId: string }> {
  if (!contextId) throw new Error("uploadBlob needs the board's context id");
  const res = await getApi().admin.uploadBlob({ data, contextId });
  return { blobId: res?.blobId ?? "" };
}

export async function getBlob(blobId: string, contextId: string): Promise<ArrayBuffer> {
  const cached = await getCachedBlob(blobId);
  if (cached) return cached;
  if (!contextId) throw new Error("getBlob needs the board's context id");

  // Core's blob discovery sweep runs to a 30 s deadline before the transfer
  // starts (probe-based discovery, rc.39 / core#3831); mero-js's read budget
  // is sized for that, so no extra client-side timeout here.
  const t0 = performance.now();
  const buf = await getApi().admin.getBlob(blobId, { contextId });
  const ms = Math.round(performance.now() - t0);
  const kb = Math.round(buf.byteLength / 1024);
  if (ms > 500) console.warn(`[MeroDesign] slow blob fetch: ${blobId.slice(0, 8)}… ${kb} KB in ${ms}ms`);
  setCachedBlob(blobId, buf); // fire-and-forget, non-blocking
  return buf;
}
