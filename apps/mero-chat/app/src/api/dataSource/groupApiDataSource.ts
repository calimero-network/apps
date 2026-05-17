import axios from "axios";
import bs58 from "bs58";
import { getNodeUrl as getAppEndpointKey } from "@calimero-network/mero-react";
import { getAuthConfig } from "../meroJsClient";
import type { ApiResponse } from "../types";
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

/** Direct blob upload via axios – bypasses the calimero-client SDK which misparses the server's `data` envelope. */
export async function uploadBlobDirect(file: File): ApiResponse<BlobUploadResult> {
  try {
    const buffer = await file.arrayBuffer();
    const response = await axios.put(
      `${getNodeEndpoint()}/admin-api/blobs`,
      buffer,
      { headers: { ...getAuthHeaders(), "Content-Type": "application/octet-stream" } },
    );
    const raw = response.data?.data ?? response.data;
    if (!raw?.blob_id) {
      return fail(500, "Upload succeeded but server returned no blob_id");
    }
    return ok({ blobId: raw.blob_id as string, size: raw.size as number });
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
      // Server expects `name` post-054a784f; keep `alias` for older nodes.
      const body = { ...request, name: request.alias };
      const response = await axios.post(`${this.base()}/namespaces`, body, {
        headers: getAuthHeaders(),
      });
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }
      const data = response.data.data;
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
      const response = await axios.get(`${this.base()}/groups/${groupId}`, {
        headers: getAuthHeaders(),
      });
      return response.status === 200
        ? ok(response.data.data)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("getGroup", error);
    }
  }

  async listGroups(): ApiResponse<GroupSummary[]> {
    try {
      // /namespaces is the correct endpoint (matches POST /namespaces in createGroup).
      // Fall back to /groups for older merod versions.
      let response;
      try {
        response = await axios.get(`${this.base()}/namespaces`, {
          headers: getAuthHeaders(),
        });
      } catch (firstError) {
        if (
          axios.isAxiosError(firstError) &&
          (firstError.response?.status === 404 || firstError.response?.status === 405)
        ) {
          response = await axios.get(`${this.base()}/groups`, {
            headers: getAuthHeaders(),
          });
        } else {
          throw firstError;
        }
      }

      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }

      // Normalise: server may nest under .namespaces / .groups, and use namespaceId vs groupId
      const raw: unknown[] = Array.isArray(response.data.data)
        ? response.data.data
        : Array.isArray(response.data.data?.namespaces)
          ? response.data.data.namespaces
          : Array.isArray(response.data.data?.groups)
            ? response.data.data.groups
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
      const response = await axios.delete(`${this.base()}/groups/${groupId}`, {
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        data: {},
      });
      return response.status === 200
        ? ok(response.data.data?.isDeleted ?? true)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("deleteGroup", error);
    }
  }

  async createInvitation(
    groupId: string,
    request?: CreateInvitationRequest,
  ): ApiResponse<CreateInvitationResponse> {
    try {
      const response = await axios.post(
        `${this.base()}/namespaces/${groupId}/invite`,
        request ?? {},
        { headers: getAuthHeaders() },
      );
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }

      const invitationPayload = normalizeGroupInvitationPayload(response.data.data);
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

      const response = await axios.post(
        `${this.base()}/namespaces/${namespaceId}/join`,
        { invitation: request.invitation },
        { headers: getAuthHeaders() },
      );
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }
      const data = response.data.data;
      const groupId = data?.namespaceId ?? data?.groupId ?? namespaceId;
      return ok({ groupId, memberIdentity: data?.memberIdentity ?? '' });
    } catch (error) {
      return catchError("joinGroup", error);
    }
  }

  async listMembers(
    groupId: string,
  ): ApiResponse<{ members: GroupMember[]; selfIdentity?: string }> {
    return cachedRequest(`listMembers:${groupId}`, async () => {
      try {
        const response = await axios.get(
          `${this.base()}/groups/${groupId}/members`,
          { headers: getAuthHeaders() },
        );
        if (response.status !== 200) {
          return httpFail(response.status, response.statusText);
        }
        // Handle both wrapped ({ data: { members, selfIdentity } }) and
        // unwrapped ({ members, selfIdentity }) API response shapes.
        const raw: unknown = response.data.data ?? response.data;
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

    // Prefer selfIdentity from the API — it's authoritative and avoids heuristic matching.
    const resolvedIdentity =
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
      const response = await axios.post(
        `${this.base()}/groups/${groupId}/members`,
        { members: [{ identity, role: "Member" }] },
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
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
      const response = await axios.post(
        `${this.base()}/groups/${groupId}/members/remove`,
        body,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("removeMember", error);
    }
  }

  async listGroupContexts(groupId: string): ApiResponse<GroupContextEntry[]> {
    return cachedRequest(`listGroupContexts:${groupId}`, async () => {
    try {
      const response = await axios.get(
        `${this.base()}/groups/${groupId}/contexts`,
        { headers: getAuthHeaders() },
      );
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }

      const rawContexts: unknown[] = Array.isArray(response.data.data)
        ? response.data.data
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
      const response = await axios.post(
        `${this.base()}/contexts/${contextId}/join`,
        {},
        { headers: getAuthHeaders() },
      );
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }
      const data = response.data.data;
      return ok({
        contextId: data?.contextId ?? contextId,
        memberPublicKey: data?.memberPublicKey ?? '',
      });
    } catch (error) {
      return catchError("joinGroupContext", error);
    }
  }

  async leaveContext(contextId: string): ApiResponse<LeaveContextResponse> {
    try {
      const normalizedId = normalizeContextId(contextId);
      const response = await axios.post(
        `${this.base()}/contexts/${normalizedId}/leave`,
        {},
        { headers: getAuthHeaders() },
      );
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }
      const data = response.data.data;
      return ok({
        contextId: data?.contextId ?? normalizedId,
        memberPublicKey: data?.memberPublicKey ?? "",
      });
    } catch (error) {
      return catchError("leaveContext", error);
    }
  }

  async leaveGroup(groupId: string): ApiResponse<LeaveGroupResponse> {
    try {
      const response = await axios.post(
        `${this.base()}/groups/${groupId}/leave`,
        {},
        { headers: getAuthHeaders() },
      );
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }
      const data = response.data.data;
      return ok({
        groupId: data?.groupId ?? groupId,
        memberPublicKey: data?.memberPublicKey ?? "",
      });
    } catch (error) {
      return catchError("leaveGroup", error);
    }
  }

  async leaveNamespace(namespaceId: string): ApiResponse<LeaveNamespaceResponse> {
    try {
      const response = await axios.post(
        `${this.base()}/namespaces/${namespaceId}/leave`,
        {},
        { headers: getAuthHeaders() },
      );
      if (response.status !== 200) {
        return httpFail(response.status, response.statusText);
      }
      const data = response.data.data;
      return ok({
        namespaceId: data?.namespaceId ?? namespaceId,
        memberPublicKey: data?.memberPublicKey ?? "",
      });
    } catch (error) {
      return catchError("leaveNamespace", error);
    }
  }

  async syncGroup(groupId: string): ApiResponse<SyncGroupResponse> {
    try {
      const response = await axios.post(
        `${this.base()}/groups/${groupId}/sync`,
        {},
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(response.data.data)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("syncGroup", error);
    }
  }

  async getContextVisibility(
    groupId: string,
    contextId: string,
  ): ApiResponse<ContextVisibility> {
    try {
      const response = await axios.get(
        `${this.base()}/groups/${groupId}/contexts/${contextId}/visibility`,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(response.data.data)
        : httpFail(response.status, response.statusText);
    } catch {
      // Endpoint not available on all merod versions — fail silently
      return fail(404, "getContextVisibility not supported");
    }
  }

  async setContextVisibility(
    groupId: string,
    contextId: string,
    request: SetContextVisibilityRequest,
  ): ApiResponse<void> {
    try {
      const response = await axios.put(
        `${this.base()}/groups/${groupId}/contexts/${contextId}/visibility`,
        request,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("setContextVisibility", error);
    }
  }

  async getContextAllowlist(
    groupId: string,
    contextId: string,
  ): ApiResponse<string[]> {
    try {
      const response = await axios.get(
        `${this.base()}/groups/${groupId}/contexts/${contextId}/allowlist`,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(response.data.data)
        : httpFail(response.status, response.statusText);
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
      const response = await axios.post(
        `${this.base()}/groups/${groupId}/contexts/${contextId}/allowlist`,
        request,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("manageContextAllowlist", error);
    }
  }

  async getMemberCapabilities(
    groupId: string,
    identity: string,
  ): ApiResponse<MemberCapabilities> {
    try {
      const response = await axios.get(
        `${this.base()}/groups/${groupId}/members/${identity}/capabilities`,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(response.data.data)
        : httpFail(response.status, response.statusText);
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
      const response = await axios.put(
        `${this.base()}/groups/${groupId}/members/${identity}/capabilities`,
        request,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
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
      const response = await axios.put(
        `${this.base()}/groups/${groupId}/members/${identity}/metadata`,
        { name: request.name },
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("setMemberMetadata", error);
    }
  }

  async setGroupMetadata(groupId: string, name: string): ApiResponse<void> {
    try {
      const response = await axios.put(
        `${this.base()}/groups/${groupId}/metadata`,
        { name },
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("setGroupMetadata", error);
    }
  }

  async setContextAlias(groupId: string, contextId: string, name: string): ApiResponse<void> {
    try {
      const response = await axios.put(
        `${this.base()}/groups/${groupId}/contexts/${contextId}/metadata`,
        { name },
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("setContextAlias", error);
    }
  }

  async setDefaultCapabilities(
    groupId: string,
    request: SetDefaultCapabilitiesRequest,
  ): ApiResponse<void> {
    try {
      const response = await axios.put(
        `${this.base()}/groups/${groupId}/settings/default-capabilities`,
        request,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("setDefaultCapabilities", error);
    }
  }

  async setSubgroupVisibility(
    groupId: string,
    request: SetSubgroupVisibilityRequest,
  ): ApiResponse<void> {
    try {
      const response = await axios.put(
        `${this.base()}/groups/${groupId}/settings/subgroup-visibility`,
        request,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined as void)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("setSubgroupVisibility", error);
    }
  }

  async listSubgroups(namespaceId: string): ApiResponse<SubgroupEntry[]> {
    try {
      const response = await axios.get(
        `${this.base()}/groups/${namespaceId}/subgroups`,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok((response.data.subgroups as Array<{ group_id?: string; groupId?: string; name?: string; alias?: string }>).map(s => ({
            groupId: (s.group_id ?? s.groupId) as string,
            // Server returns `name` post-054a784f (formerly `alias`).
            // Keep frontend field name as `alias` so display code stays put.
            alias: s.name ?? s.alias,
          })))
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("listSubgroups", error);
    }
  }

  async createSubgroup(
    namespaceId: string,
    request: CreateSubgroupRequest,
  ): ApiResponse<CreateSubgroupResponse> {
    try {
      // Two separate concerns:
      //   - groupAlias: routing identifier, no length cap (DM aliases are
      //     long and structural).
      //   - groupName : human-readable, stored in MetadataRecord, capped
      //     at 64 bytes server-side. Only send if the caller passed one.
      const body: Record<string, unknown> = {};
      if (request.groupName) body.groupName = request.groupName;
      if (request.name) body.groupName = request.name;
      const response = await axios.post(
        `${this.base()}/namespaces/${namespaceId}/groups`,
        body,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok({ groupId: response.data.data.groupId as string })
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("createSubgroup", error);
    }
  }

  async reparentGroup(
    groupId: string,
    request: ReparentGroupRequest,
  ): ApiResponse<void> {
    try {
      const response = await axios.post(
        `${this.base()}/groups/${groupId}/reparent`,
        { new_parent_id: request.newParentId },
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(undefined)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("reparentGroup", error);
    }
  }

  async triggerUpgrade(
    groupId: string,
    request: UpgradeGroupRequest,
  ): ApiResponse<UpgradeGroupResponse> {
    try {
      const response = await axios.post(
        `${this.base()}/groups/${groupId}/upgrade`,
        request,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(response.data.data)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("triggerUpgrade", error);
    }
  }

  async getUpgradeStatus(
    groupId: string,
  ): ApiResponse<GroupUpgradeStatus | null> {
    try {
      const response = await axios.get(
        `${this.base()}/groups/${groupId}/upgrade/status`,
        { headers: getAuthHeaders() },
      );
      return response.status === 200
        ? ok(response.data.data ?? null)
        : httpFail(response.status, response.statusText);
    } catch (error) {
      return catchError("getUpgradeStatus", error);
    }
  }
}
