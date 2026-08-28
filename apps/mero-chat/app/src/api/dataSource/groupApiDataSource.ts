import axios from "axios";
import bs58 from "bs58";
import { getNodeUrl as getAppEndpointKey } from "@calimero-network/mero-react";
import { getAuthConfig, getMeroJs } from "../meroJsClient";
import {
  getSelfAccountHex,
  hexToBase58,
  loadSelfAccountIdentity,
} from "../../utils/accountIdentity";
import type { ApiResponse } from "../types";
import { groupNameError } from "../../utils/groupName";
import type {
  ContextVisibility,
  CreateGroupRequest,
  CreateGroupResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  GroupApi,
  GroupContextEntry,
  GroupInfo,
  SignedGroupOpenInvitation,
  GroupMember,
  GroupSummary,
  GroupUpgradeStatus,
  JoinGroupContextRequest,
  JoinGroupContextResponse,
  JoinGroupRequest,
  JoinGroupResponse,
  LeaveContextResponse,
  LeaveGroupResponse,
  LeaveNamespaceResponse,
  ManageAllowlistRequest,
  MemberCapabilities,
  RemoveMemberRequest,
  SetContextVisibilityRequest,
  SetDefaultCapabilitiesRequest,
  SetSubgroupVisibilityRequest,
  SubgroupEntry,
  CreateSubgroupRequest,
  CreateSubgroupResponse,
  ReparentGroupRequest,
  SetMemberMetadataRequest,
  SetMemberCapabilitiesRequest,
  SyncGroupResponse,
  UpgradeGroupRequest,
  UpgradeGroupResponse,
  VisibilityMode,
} from "../groupApi";
import {
  parseGroupInvitationPayload,
  type GroupInvitationPayload,
} from "../../utils/invitation";
import { resolveCurrentGroupMemberIdentity } from "../../utils/groupMemberIdentity";

const DEFAULT_NODE_ENDPOINT = "http://localhost:2428";

function getNodeEndpoint(): string {
  return getAppEndpointKey() || DEFAULT_NODE_ENDPOINT;
}

function getAuthHeaders(): Record<string, string> {
  const authConfig = getAuthConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authConfig?.jwtToken) {
    headers["Authorization"] = `Bearer ${authConfig.jwtToken}`;
  }
  return headers;
}

type Result<T> = Awaited<ApiResponse<T>>;

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}

// ─── Simple in-process dedup cache ───────────────────────────────────────────
// Deduplicates concurrent identical requests (same key within TTL) so that
// multiple hooks mounting simultaneously don't fan out into N identical calls.
const CACHE_TTL_MS = 5_000;

interface CacheEntry<T> {
  promise: Promise<Result<T>>;
  expiresAt: number;
}

const pendingCache = new Map<string, CacheEntry<unknown>>();

function cachedRequest<T>(key: string, fetch: () => Promise<Result<T>>): Promise<Result<T>> {
  const now = Date.now();
  const existing = pendingCache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }
  const promise = fetch().finally(() => {
    const entry = pendingCache.get(key);
    if (entry && entry.promise === promise) {
      pendingCache.delete(key);
    }
  });
  pendingCache.set(key, { promise: promise as Promise<Result<unknown>>, expiresAt: now + CACHE_TTL_MS });
  return promise;
}
// ─────────────────────────────────────────────────────────────────────────────

function fail<T>(code: number, message: string): Result<T> {
  return { data: null, error: { code, message } };
}

function httpFail<T>(status: number, statusText: string): Result<T> {
  return fail(status, statusText);
}

function isHexContextId(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

function normalizeContextId(value: string): string {
  if (!isHexContextId(value)) {
    return value;
  }

  try {
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < value.length; index += 2) {
      bytes[index / 2] = parseInt(value.slice(index, index + 2), 16);
    }
    return bs58.encode(bytes);
  } catch {
    return value;
  }
}

function normalizeGroupContextEntry(entry: unknown): GroupContextEntry | null {
  if (typeof entry === "string") {
    return { contextId: normalizeContextId(entry) };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const typedEntry = entry as {
    contextId?: unknown;
    alias?: unknown;
    name?: unknown;
    contextType?: unknown;
    context_type?: unknown;
    memberIdentities?: unknown;
    members?: unknown;
    participants?: unknown;
    metadata?: unknown;
  };
  if (typeof typedEntry.contextId !== "string") {
    return null;
  }

  const metadata =
    typedEntry.metadata && typeof typedEntry.metadata === "object"
      ? (typedEntry.metadata as Record<string, unknown>)
      : undefined;

  const sharedContextTypeValue =
    typedEntry.contextType ?? typedEntry.context_type ?? metadata?.contextType ?? metadata?.context_type;
  const sharedContextType =
    sharedContextTypeValue === "Dm" || sharedContextTypeValue === "Channel"
      ? sharedContextTypeValue
      : typeof sharedContextTypeValue === "string"
        ? sharedContextTypeValue.toLowerCase() === "dm"
          ? "Dm"
          : sharedContextTypeValue.toLowerCase() === "channel"
            ? "Channel"
            : undefined
        : undefined;

  const memberIdentitiesValue =
    typedEntry.memberIdentities ??
    typedEntry.members ??
    typedEntry.participants ??
    metadata?.memberIdentities ??
    metadata?.members ??
    metadata?.participants;
  const memberIdentities = Array.isArray(memberIdentitiesValue)
    ? memberIdentitiesValue.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : undefined;

  // Post-054a784f the server returns `name` on context entries; older
  // shapes still carried `alias`. Either is accepted; we expose it under
  // the frontend's `alias` key so consumers don't have to branch.
  return {
    contextId: normalizeContextId(typedEntry.contextId),
    alias:
      typeof typedEntry.name === "string"
        ? typedEntry.name
        : typeof typedEntry.alias === "string"
          ? typedEntry.alias
          : undefined,
    sharedContextType,
    memberIdentities: memberIdentities && memberIdentities.length > 0 ? memberIdentities : undefined,
    metadata,
  };
}

function isSignedGroupOpenInvitation(
  value: unknown,
): value is SignedGroupOpenInvitation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const typedValue = value as {
    invitation?: Record<string, unknown>;
    inviterSignature?: unknown;
    inviter_signature?: unknown;
  };

  return (
    (typeof typedValue.inviterSignature === "string" ||
      typeof typedValue.inviter_signature === "string") &&
    !!typedValue.invitation &&
    typeof typedValue.invitation === "object"
  );
}

function normalizeGroupInvitationPayload(
  value: unknown,
): GroupInvitationPayload | null {
  if (isSignedGroupOpenInvitation(value)) {
    return { invitation: value };
  }

  if (typeof value === "string") {
    return parseGroupInvitationPayload(value);
  }

  if (value && typeof value === "object") {
    const typedValue = value as {
      invitation?: unknown;
      payload?: unknown;
      groupAlias?: unknown;
      groupName?: unknown;
    };
    if (typedValue.invitation && isSignedGroupOpenInvitation(typedValue.invitation)) {
      return {
        invitation: typedValue.invitation,
        // groupName (mero-js ≥2.1) takes precedence; groupAlias kept for older nodes
        groupAlias:
          typeof typedValue.groupName === "string"
            ? typedValue.groupName
            : typeof typedValue.groupAlias === "string"
              ? typedValue.groupAlias
              : undefined,
      };
    }
    if (typeof typedValue.payload === "string") {
      return parseGroupInvitationPayload(typedValue.payload);
    }
  }

  return null;
}

function catchError<T>(context: string, error: unknown): Result<T> {
  // mero-js throws HTTPError (which carries `status`) rather than returning a
  // status code. Map it first so callers that branch on 404/405 — listGroups'
  // fallback to the legacy /groups route, for one — keep working after the
  // transport moved off axios.
  const sdkStatus = (error as { status?: number })?.status;
  if (typeof sdkStatus === "number" && !axios.isAxiosError(error)) {
    const message =
      error instanceof Error
        ? error.message
        : `An unexpected error occurred during ${context}`;
    console.error(`${context} failed:`, error);
    return fail(sdkStatus, message);
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 500;
    const responseError = error.response?.data?.error;
    const message =
      typeof responseError === "string"
        ? responseError
        : error.message || `An unexpected error occurred during ${context}`;
    console.error(`${context} failed:`, error);
    return fail(status, message);
  }

  const message =
    error instanceof Error
      ? error.message
      : `An unexpected error occurred during ${context}`;
  console.error(`${context} failed:`, error);
  return fail(500, message);
}

export interface BlobUploadResult {
  blobId: string;
  size: number;
}

/**
 * Blob upload. The axios version existed because the OLD calimero-client
 * misparsed the server's `data` envelope; mero-js unwraps it correctly, so this
 * now goes through the SDK. Core answers with snake_case `blob_id`, which the
 * SDK response type does not model, hence the widened read below.
 */
export async function uploadBlobDirect(
  file: File,
  /**
   * Context to announce the blob to. Without it core stores the bytes locally
   * but never advertises them, so a peer that later asks for the blob has no
   * way to discover who holds it — the image stays stuck on "loading" for
   * everyone except the uploader. `downloadBlob` has always passed a context;
   * this is the missing other half.
   */
  contextId?: string,
): ApiResponse<BlobUploadResult> {
  try {
    const buffer = await file.arrayBuffer();
    const raw = (await getMeroJs().admin.uploadBlob({
      data: buffer,
      ...(contextId ? { contextId } : {}),
    })) as unknown as
      | { blob_id?: string; blobId?: string; size?: number }
      | undefined;
    const blobId = raw?.blob_id ?? raw?.blobId;
    if (!blobId) {
      return fail(500, "Upload succeeded but server returned no blob_id");
    }
    return ok({ blobId, size: raw?.size ?? 0 });
  } catch (error) {
    return catchError("uploadBlobDirect", error);
  }
}

export class GroupApiDataSource implements GroupApi {
  private base(): string {
    return `${getNodeEndpoint()}/admin-api`;
  }

  async createGroup(
    request: CreateGroupRequest,
  ): ApiResponse<CreateGroupResponse> {
    try {
      // Same 64-byte metadata cap as a subgroup's name: over it, the server
      // keeps the namespace and drops the name, with no error to notice.
      //
      // Only when a name was actually supplied — a namespace may be created
      // without one, and rejecting that would refuse a legitimate call.
      if (request.alias) {
        const problem = groupNameError(request.alias);
        if (problem) {
          return { data: null, error: { code: 400, message: problem } };
        }
      }

      // Server expects `name` post-054a784f; keep `alias` for older nodes.
      const body = { ...request, name: request.alias };
      const data = (await getMeroJs().admin.createNamespace(
        body as unknown as Parameters<
          ReturnType<typeof getMeroJs>["admin"]["createNamespace"]
        >[0],
      )) as unknown as { namespaceId?: string; groupId?: string; id?: string };
      const groupId = data?.namespaceId ?? data?.groupId ?? data?.id;
      if (!groupId) {
        return fail(500, "Namespace creation response missing ID");
      }
      return ok({ groupId });
    } catch (error) {
      return catchError("createGroup", error);
    }
  }

  async getGroup(groupId: string): ApiResponse<GroupInfo> {
    try {
      return ok(
        (await getMeroJs().admin.getGroupInfo(groupId)) as unknown as GroupInfo,
      );
    } catch (error) {
      return catchError("getGroup", error);
    }
  }

  async listGroups(): ApiResponse<GroupSummary[]> {
    try {
      // /namespaces is the correct endpoint (matches POST /namespaces in createGroup).
      // Fall back to /groups for older merod versions.
      const admin = getMeroJs().admin;
      const appId = import.meta.env.VITE_APPLICATION_ID as string | undefined;
      let payload: unknown;
      try {
        payload = appId
          ? await admin.listNamespacesForApplication(appId)
          : await admin.listNamespaces();
      } catch (firstError) {
        // Older merod does not serve /namespaces; fall back to the legacy
        // /groups route. mero-js throws HTTPError carrying `status`.
        const status = (firstError as { status?: number })?.status;
        if (status !== 404 && status !== 405) throw firstError;
        const legacy = await axios.get(`${this.base()}/groups`, {
          headers: getAuthHeaders(),
        });
        if (legacy.status !== 200) {
          return httpFail(legacy.status, legacy.statusText);
        }
        payload = legacy.data.data;
      }

      // Normalise: server may nest under .namespaces / .groups, and use namespaceId vs groupId
      const p = payload as {
        namespaces?: unknown[];
        groups?: unknown[];
      } | null;
      const raw: unknown[] = Array.isArray(payload)
        ? (payload as unknown[])
        : Array.isArray(p?.namespaces)
          ? p!.namespaces
          : Array.isArray(p?.groups)
            ? p!.groups
            : [];

      const groups: GroupSummary[] = raw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          groupId: String(item.groupId ?? item.namespaceId ?? item.id ?? ""),
          // Server returns `name` post-054a784f; fall back to `alias` for older nodes.
          alias:
            typeof item.name === "string"
              ? item.name
              : typeof item.alias === "string"
                ? item.alias
                : undefined,
          appKey: String(item.appKey ?? item.app_key ?? ""),
          targetApplicationId: String(
            item.targetApplicationId ?? item.target_application_id ?? "",
          ),
          upgradePolicy: (item.upgradePolicy ??
            item.upgrade_policy ??
            "Automatic") as GroupSummary["upgradePolicy"],
          createdAt:
            typeof item.createdAt === "number"
              ? item.createdAt
              : Math.floor(Date.now() / 1000),
        }))
        .filter((g) => g.groupId.length > 0);

      return ok(groups);
    } catch (error) {
      return catchError("listGroups", error);
    }
  }

  async deleteGroup(groupId: string): ApiResponse<boolean> {
    try {
      // Server uses ValidatedJson<DeleteGroupApiRequest> even on DELETE
      // (delete_group.rs:22), so it rejects with "Expected request with
      // Content-Type: application/json" unless we send both the header and
      // a JSON body. Both fields on DeleteGroupApiRequest are optional, so
      // an empty `{}` body is accepted.
      const data = await getMeroJs().admin.deleteGroup(groupId, {});
      return ok(data?.isDeleted ?? true);
    } catch (error) {
      return catchError("deleteGroup", error);
    }
  }

  async createInvitation(
    groupId: string,
    request?: CreateInvitationRequest,
  ): ApiResponse<CreateInvitationResponse> {
    try {
      const created = await getMeroJs().admin.createNamespaceInvitation(
        groupId,
        request as unknown as Parameters<
          ReturnType<typeof getMeroJs>["admin"]["createNamespaceInvitation"]
        >[1],
      );

      const invitationPayload = normalizeGroupInvitationPayload(created);
      if (!invitationPayload) {
        return fail(500, "Invalid workspace invitation response");
      }

      return ok({
        invitation: invitationPayload.invitation,
        groupAlias: invitationPayload.groupAlias,
      });
    } catch (error) {
      return catchError("createInvitation", error);
    }
  }

  async joinGroup(
    request: JoinGroupRequest,
  ): ApiResponse<JoinGroupResponse> {
    try {
      // Extract namespace ID from the invitation's group_id (may be string or byte array)
      const inv = request.invitation.invitation as unknown as Record<string, unknown>;
      const rawGroupId = inv.group_id ?? inv.groupId;
      const namespaceId = Array.isArray(rawGroupId)
        ? (rawGroupId as number[]).map(b => b.toString(16).padStart(2, '0')).join('')
        : String(rawGroupId ?? '');

      if (!namespaceId) {
        return fail(400, "Could not extract namespace ID from invitation");
      }

      const data = (await getMeroJs().admin.joinNamespace(namespaceId, {
        invitation: request.invitation,
      } as unknown as Parameters<
        ReturnType<typeof getMeroJs>["admin"]["joinNamespace"]
      >[1])) as unknown as {
        namespaceId?: string;
        groupId?: string;
        memberIdentity?: string;
      };
      const groupId = data?.namespaceId ?? data?.groupId ?? namespaceId;
      return ok({ groupId, memberIdentity: data?.memberIdentity ?? "" });
    } catch (error) {
      return catchError("joinGroup", error);
    }
  }

  async listMembers(
    groupId: string,
  ): ApiResponse<{ members: GroupMember[]; selfIdentity?: string }> {
    return cachedRequest(`listMembers:${groupId}`, async () => {
      try {
        // mero-js unwraps the `{ data: ... }` envelope, but the shape below
        // still tolerates both a bare array and a `{ members, selfIdentity }`
        // object, because core has served each at different versions.
        const raw: unknown = await getMeroJs().admin.listGroupMembers(groupId);
        const rawMembers: Array<{ identity: string; role: string; name?: string; alias?: string }> = Array.isArray(raw)
          ? (raw as Array<{ identity: string; role: string; name?: string; alias?: string }>)
          : Array.isArray((raw as { members?: unknown })?.members)
            ? ((raw as { members: Array<{ identity: string; role: string; name?: string; alias?: string }> }).members)
            : [];
        // Post-054a784f the server returns `name` (not `alias`). Map to the
        // frontend's `alias` field — keeps every display-chain callsite
        // (`useChannelMembers`, MembersTab, AddMember dropdown, DM picker)
        // working without touching them.
        const members: GroupMember[] = rawMembers.map((m) => ({
          identity: m.identity,
          role: m.role as GroupMember["role"],
          alias: m.name ?? m.alias,
        }));
        const selfIdentity: string | undefined =
          raw && typeof raw === "object" && "selfIdentity" in raw
            ? String((raw as { selfIdentity: unknown }).selfIdentity)
            : undefined;
        return ok({ members, selfIdentity });
      } catch (error) {
        return catchError("listMembers", error);
      }
    });
  }

  async resolveCurrentMemberIdentity(
    groupId: string,
    storedMemberIdentity = "",
  ): ApiResponse<{ memberIdentity: string; members: GroupMember[] }> {
    const membersResponse = await this.listMembers(groupId);

    // If the members endpoint fails but we already have a stored identity for this
    // namespace, use it — avoids blocking workspace entry on merod versions that
    // return 405 for GET /admin-api/groups/{id}/members.
    if (membersResponse.error || !membersResponse.data) {
      if (storedMemberIdentity) {
        return ok({ memberIdentity: storedMemberIdentity, members: [] });
      }
      return {
        data: null,
        error: membersResponse.error ?? { code: 500, message: "Failed to list namespace members" },
      };
    }

    const { members, selfIdentity } = membersResponse.data;

    // Members are keyed by ACCOUNT. This node's own account is the
    // authoritative answer to "which row is me", and unlike a device key it is
    // stable across every device the same person signs in from — which is the
    // whole point of the account/device split.
    //
    // It has to win over `selfIdentity`: core does not always send that field,
    // and where it does it is still a PublicKey, so comparing it to an
    // account-keyed row never matches. Falling through to the stored identity
    // is worse still — that is a device key, which is how members ended up
    // nameless (setMemberMetadata rejects a device key with "Invalid account
    // format: expected 64 hex characters").
    if (!getSelfAccountHex()) {
      await loadSelfAccountIdentity();
    }
    const selfAccount = getSelfAccountHex();
    const selfRow = selfAccount
      ? members.find(
          (m) => m.identity.toLowerCase() === selfAccount.toLowerCase(),
        )
      : undefined;

    const resolvedIdentity =
      selfRow?.identity ||
      selfIdentity ||
      resolveCurrentGroupMemberIdentity({ members, storedMemberIdentity }).memberIdentity;

    if (!resolvedIdentity) {
      return fail(
        404,
        "Could not resolve identity for this namespace. Make sure you joined it on this device.",
      );
    }

    return ok({ memberIdentity: resolvedIdentity, members });
  }

  async addGroupMember(groupId: string, identity: string): ApiResponse<void> {
    try {
      await getMeroJs().admin.addGroupMembers(groupId, {
        members: [{ identity, role: "Member" }],
      });
      return ok(undefined as void);
    } catch (error) {
      return catchError("addGroupMember", error);
    }
  }

  async removeMember(
    groupId: string,
    memberIdentity: string,
  ): ApiResponse<void> {
    try {
      const body: RemoveMemberRequest = { members: [memberIdentity] };
      await getMeroJs().admin.removeGroupMembers(groupId, body);
      return ok(undefined as void);
    } catch (error) {
      return catchError("removeMember", error);
    }
  }

  async listGroupContexts(groupId: string): ApiResponse<GroupContextEntry[]> {
    return cachedRequest(`listGroupContexts:${groupId}`, async () => {
    try {
      const listed = await getMeroJs().admin.listGroupContexts(groupId);
      const rawContexts: unknown[] = Array.isArray(listed)
        ? (listed as unknown[])
        : Array.isArray((listed as { contexts?: unknown[] })?.contexts)
          ? ((listed as { contexts: unknown[] }).contexts)
          : [];
      const contexts = rawContexts
        .map((entry: unknown) => normalizeGroupContextEntry(entry))
        .filter((entry: GroupContextEntry | null): entry is GroupContextEntry => entry !== null)

      return ok(contexts);
    } catch (error) {
      return catchError("listGroupContexts", error);
    }
    });
  }

  async joinGroupContext(
    _groupId: string,
    request: JoinGroupContextRequest,
  ): ApiResponse<JoinGroupContextResponse> {
    try {
      const contextId = normalizeContextId(request.contextId);
      const data = await getMeroJs().admin.joinContext(contextId);
      return ok({
        contextId: data?.contextId ?? contextId,
        memberPublicKey: data?.memberPublicKey ?? "",
      });
    } catch (error) {
      return catchError("joinGroupContext", error);
    }
  }

  async leaveContext(contextId: string): ApiResponse<LeaveContextResponse> {
    try {
      const normalizedId = normalizeContextId(contextId);
      // mero-js returns void here; the response body was never read by any
      // caller (`memberPublicKey` is only consumed off a JOIN result), so the
      // envelope keeps its shape with the id echoed back.
      await getMeroJs().admin.leaveContext(normalizedId);
      return ok({ contextId: normalizedId, memberPublicKey: "" });
    } catch (error) {
      return catchError("leaveContext", error);
    }
  }

  async leaveGroup(groupId: string): ApiResponse<LeaveGroupResponse> {
    try {
      await getMeroJs().admin.leaveGroup(groupId);
      return ok({ groupId, memberPublicKey: "" });
    } catch (error) {
      return catchError("leaveGroup", error);
    }
  }

  async leaveNamespace(namespaceId: string): ApiResponse<LeaveNamespaceResponse> {
    try {
      await getMeroJs().admin.leaveNamespace(namespaceId);
      return ok({ namespaceId, memberPublicKey: "" });
    } catch (error) {
      return catchError("leaveNamespace", error);
    }
  }

  async syncGroup(groupId: string): ApiResponse<SyncGroupResponse> {
    try {
      return ok(
        (await getMeroJs().admin.syncGroup(
          groupId,
        )) as unknown as SyncGroupResponse,
      );
    } catch (error) {
      return catchError("syncGroup", error);
    }
  }

  /**
   * Core is 1-group-per-context: `get_group_for_context` returns a single
   * group id. Per-context visibility and allowlists were not removed in
   * 40639c13 so much as re-addressed — they are the visibility and membership
   * of the context's OWN group, reached through that group rather than through
   * a (group, context) pair.
   */
  /**
   * The members of the group backing `contextId`, with the names governance
   * holds for them.
   *
   * Exists so callers can get a channel's roster without reaching for
   * `contextGroupId`, which stays private — the context-to-group mapping is an
   * implementation detail of this data source, and every caller that has
   * grabbed it so far has had to remember the hex/base58 normalisation that
   * goes with it.
   *
   * Returns an empty list rather than throwing when no group backs the context
   * (legacy channels predate the 1-group-per-context model): the caller's
   * fallback is the contract's profiles, which still work.
   */
  async listContextMembers(contextId: string): ApiResponse<GroupMember[]> {
    try {
      const cgid = await this.contextGroupId(contextId);
      const listed = await this.listMembers(cgid);
      return ok(listed.data?.members ?? []);
    } catch (error) {
      return catchError("listContextMembers", error);
    }
  }

  private async contextGroupId(contextId: string): Promise<string> {
    const groupId = await getMeroJs().admin.getContextGroup(
      normalizeContextId(contextId),
    );
    const resolved =
      typeof groupId === "string"
        ? groupId
        : ((groupId as { data?: string } | null)?.data ?? "");
    if (!resolved) {
      throw new Error(`No group backs context ${contextId}`);
    }
    return resolved;
  }

  async getContextVisibility(
    groupId: string,
    contextId: string,
  ): ApiResponse<ContextVisibility> {
    try {
      const cgid = await this.contextGroupId(contextId);
      const info = await getMeroJs().admin.getGroupInfo(cgid);
      return ok({
        mode: (info as { subgroupVisibility?: VisibilityMode })
          .subgroupVisibility as VisibilityMode,
        // The old per-context payload carried a creator; group info does not
        // expose one, and no caller reads it.
        creator: "",
      });
    } catch (error) {
      return catchError("getContextVisibility", error);
    }
  }

  async setContextVisibility(
    groupId: string,
    contextId: string,
    request: SetContextVisibilityRequest,
  ): ApiResponse<void> {
    try {
      const cgid = await this.contextGroupId(contextId);
      // The group-level request names the field `subgroupVisibility`; the
      // per-context one called the same value `mode`.
      await getMeroJs().admin.setSubgroupVisibility(cgid, {
        subgroupVisibility: request.mode,
      });
      return ok(undefined as void);
    } catch (error) {
      return catchError("setContextVisibility", error);
    }
  }

  async getContextAllowlist(
    groupId: string,
    contextId: string,
  ): ApiResponse<string[]> {
    try {
      const cgid = await this.contextGroupId(contextId);
      // The allowlist IS the membership of the context's own group.
      const listed = await getMeroJs().admin.listGroupMembers(cgid);
      const members = Array.isArray(listed)
        ? (listed as Array<{ identity: string }>)
        : ((listed as { members?: Array<{ identity: string }> })?.members ?? []);
      return ok(members.map((m) => m.identity));
    } catch (error) {
      return catchError("getContextAllowlist", error);
    }
  }

  async manageContextAllowlist(
    groupId: string,
    contextId: string,
    request: ManageAllowlistRequest,
  ): ApiResponse<void> {
    try {
      const cgid = await this.contextGroupId(contextId);
      // `listGroupMembers` (and therefore getContextAllowlist) reports
      // identities HEX-encoded, but the membership writes decode them as
      // base58 — feeding a read straight back into a write 400s with
      // "buffer provided to decode base58 encoded string into was too small".
      // Normalise so the read/write round-trip closes.
      const toBase58 = (identity: string) =>
        /^[0-9a-f]{64}$/i.test(identity) ? hexToBase58(identity) : identity;

      if (request.add?.length) {
        await getMeroJs().admin.addGroupMembers(cgid, {
          members: request.add.map((identity) => ({
            identity: toBase58(identity),
            role: "Member" as const,
          })),
        });
      }
      if (request.remove?.length) {
        await getMeroJs().admin.removeGroupMembers(cgid, {
          members: request.remove.map(toBase58),
        });
      }
      return ok(undefined as void);
    } catch (error) {
      return catchError("manageContextAllowlist", error);
    }
  }

  async getMemberCapabilities(
    groupId: string,
    identity: string,
  ): ApiResponse<MemberCapabilities> {
    try {
      return ok(
        (await getMeroJs().admin.getMemberCapabilities(
          groupId,
          identity,
        )) as unknown as MemberCapabilities,
      );
    } catch (error) {
      return catchError("getMemberCapabilities", error);
    }
  }

  async setMemberCapabilities(
    groupId: string,
    identity: string,
    request: SetMemberCapabilitiesRequest,
  ): ApiResponse<void> {
    try {
      await getMeroJs().admin.setMemberCapabilities(groupId, identity, request);
      return ok(undefined as void);
    } catch (error) {
      return catchError("setMemberCapabilities", error);
    }
  }

  async setMemberMetadata(
    groupId: string,
    identity: string,
    request: SetMemberMetadataRequest,
  ): ApiResponse<void> {
    try {
      await getMeroJs().admin.setMemberMetadata(groupId, identity, {
        name: request.name,
      });
      return ok(undefined as void);
    } catch (error) {
      return catchError("setMemberMetadata", error);
    }
  }

  async setGroupMetadata(groupId: string, name: string): ApiResponse<void> {
    try {
      await getMeroJs().admin.setGroupMetadata(groupId, { name });
      return ok(undefined as void);
    } catch (error) {
      return catchError("setGroupMetadata", error);
    }
  }

  async setContextAlias(groupId: string, contextId: string, name: string): ApiResponse<void> {
    try {
      await getMeroJs().admin.setContextMetadata(groupId, contextId, { name });
      return ok(undefined as void);
    } catch (error) {
      return catchError("setContextAlias", error);
    }
  }

  async setDefaultCapabilities(
    groupId: string,
    request: SetDefaultCapabilitiesRequest,
  ): ApiResponse<void> {
    try {
      await getMeroJs().admin.setDefaultCapabilities(groupId, request);
      return ok(undefined as void);
    } catch (error) {
      return catchError("setDefaultCapabilities", error);
    }
  }

  async setSubgroupVisibility(
    groupId: string,
    request: SetSubgroupVisibilityRequest,
  ): ApiResponse<void> {
    try {
      await getMeroJs().admin.setSubgroupVisibility(groupId, request);
      return ok(undefined as void);
    } catch (error) {
      return catchError("setSubgroupVisibility", error);
    }
  }

  async listSubgroups(namespaceId: string): ApiResponse<SubgroupEntry[]> {
    try {
      // mero-js returns the array directly; core has also served it wrapped
      // as `{ subgroups: [...] }`, so accept either.
      const listed = await getMeroJs().admin.listSubgroups(namespaceId);
      const rawSubgroups = (Array.isArray(listed)
        ? listed
        : ((listed as unknown as { subgroups?: unknown[] })?.subgroups ??
          [])) as Array<{ group_id?: string; groupId?: string; name?: string; alias?: string }>;
      return ok(rawSubgroups.map((s) => ({
            groupId: (s.group_id ?? s.groupId) as string,
            // Server returns `name` post-054a784f (formerly `alias`).
            // Keep frontend field name as `alias` so display code stays put.
        alias: s.name ?? s.alias,
      })));
    } catch (error) {
      return catchError("listSubgroups", error);
    }
  }

  async createSubgroup(
    namespaceId: string,
    request: CreateSubgroupRequest,
  ): ApiResponse<CreateSubgroupResponse> {
    try {
      // `groupName` is human-readable and stored in a MetadataRecord capped at
      // 64 BYTES. Over that the server drops the name and still returns 200, so
      // an over-long name is not an error anyone sees — it is a group that
      // quietly has no name. Refuse it here instead.
      //
      // (An earlier comment described a separate uncapped `groupAlias` for long
      // structural identifiers. No such field is sent — both inputs below map
      // to `groupName` — which is how a 140-byte DM alias came to be written
      // into a 64-byte field on every DM ever created.)
      const requestedName = request.groupName ?? request.name;
      if (requestedName) {
        const problem = groupNameError(requestedName);
        if (problem) {
          return { data: null, error: { code: 400, message: problem } };
        }
      }

      const body: Record<string, unknown> = {};
      if (requestedName) body.groupName = requestedName;
      const data = await getMeroJs().admin.createGroupInNamespace(
        namespaceId,
        body,
      );
      return ok({ groupId: (data as { groupId: string }).groupId });
    } catch (error) {
      return catchError("createSubgroup", error);
    }
  }

  async reparentGroup(
    groupId: string,
    request: ReparentGroupRequest,
  ): ApiResponse<void> {
    try {
      // Core takes snake_case here; the SDK request type mirrors the wire.
      await getMeroJs().admin.reparentGroup(groupId, {
        new_parent_id: request.newParentId,
      } as unknown as Parameters<
        ReturnType<typeof getMeroJs>["admin"]["reparentGroup"]
      >[1]);
      return ok(undefined);
    } catch (error) {
      return catchError("reparentGroup", error);
    }
  }

  async triggerUpgrade(
    groupId: string,
    request: UpgradeGroupRequest,
  ): ApiResponse<UpgradeGroupResponse> {
    try {
      const data = await getMeroJs().admin.upgradeGroup(
        groupId,
        request as unknown as Parameters<
          ReturnType<typeof getMeroJs>["admin"]["upgradeGroup"]
        >[1],
      );
      return ok(data as unknown as UpgradeGroupResponse);
    } catch (error) {
      return catchError("triggerUpgrade", error);
    }
  }

  async getUpgradeStatus(
    groupId: string,
  ): ApiResponse<GroupUpgradeStatus | null> {
    try {
      const data = await getMeroJs().admin.getGroupUpgradeStatus(groupId);
      return ok((data ?? null) as unknown as GroupUpgradeStatus | null);
    } catch (error) {
      return catchError("getUpgradeStatus", error);
    }
  }
}
