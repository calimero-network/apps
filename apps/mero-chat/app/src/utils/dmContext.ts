import type { ApiResponse } from "../api/types";
import type { GroupContextEntry } from "../api/groupApi";
import type { CreateContextResponse } from "../api/nodeApi";
import type { ContextInfo } from "../types/Common";

export const DM_CONTEXT_ALIAS_PREFIX = "DM_CONTEXT_";

export interface SharedDmDiscovery {
  source: "metadata" | "alias";
  memberIdentities: [string, string];
  otherIdentity: string;
}

interface CreateDmContextParams {
  applicationId: string;
  /** The namespace id — the new DM subgroup is created directly under it. */
  groupId: string;
  myIdentity: string;
  myUsername?: string;
  otherIdentity: string;
  otherUsername?: string;
  contextApi: {
    createGroupContext(params: {
      applicationId: string;
      protocol: string;
      groupId: string;
      initializationParams: Record<string, unknown>;
      identitySecret?: string;
      alias?: string;
    }): ApiResponse<CreateContextResponse>;
  };
  groupApi: {
    createSubgroup(
      namespaceId: string,
      request: { groupName?: string },
    ): ApiResponse<{ groupId: string }>;
    setSubgroupVisibility(
      groupId: string,
      request: { subgroupVisibility: "open" | "restricted" },
    ): ApiResponse<void>;
    addGroupMember(
      groupId: string,
      identity: string,
    ): ApiResponse<void>;
    setMemberMetadata(
      groupId: string,
      identity: string,
      request: { name: string },
    ): ApiResponse<void>;
  };
  onWarning?: (message: string) => void;
}

export interface CreateDmContextResult {
  data: CreateContextResponse | null;
  error: string;
  alias: string;
}

function normalizeIdentityForAlias(identity: string): string {
  return encodeURIComponent(identity.trim()).split("_").join("%5F");
}

function decodeIdentityFromAlias(value: string): string {
  return decodeURIComponent(value.split("%5F").join("_"));
}

function normalizeContextType(
  value: unknown,
): ContextInfo["context_type"] | undefined {
  if (value === "Dm" || value === "Channel") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "dm") {
      return "Dm";
    }
    if (normalized === "channel") {
      return "Channel";
    }
  }

  return undefined;
}

function normalizeMemberIdentities(value: unknown): [string, string] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const identities = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );

  if (identities.length !== 2) {
    return null;
  }

  return [identities[0], identities[1]];
}

function getMetadataValue(
  entry: GroupContextEntry,
  key: "contextType" | "context_type" | "memberIdentities" | "members" | "participants",
): unknown {
  const typedEntry = entry as GroupContextEntry & Record<string, unknown>;
  const metadata =
    typedEntry.metadata && typeof typedEntry.metadata === "object"
      ? (typedEntry.metadata as Record<string, unknown>)
      : null;

  return typedEntry[key] ?? metadata?.[key];
}

export function buildDmAlias(identityA: string, identityB: string): string {
  const ordered = [identityA.trim(), identityB.trim()].sort((left, right) =>
    left.localeCompare(right),
  );

  return `${DM_CONTEXT_ALIAS_PREFIX}${normalizeIdentityForAlias(ordered[0])}_${normalizeIdentityForAlias(ordered[1])}`;
}

export function parseDmAlias(
  alias?: string,
): { memberIdentities: [string, string] } | null {
  if (!alias?.startsWith(DM_CONTEXT_ALIAS_PREFIX)) {
    return null;
  }

  const encodedMembers = alias
    .slice(DM_CONTEXT_ALIAS_PREFIX.length)
    .split("_");

  if (encodedMembers.length !== 2) {
    return null;
  }

  try {
    return {
      memberIdentities: [
        decodeIdentityFromAlias(encodedMembers[0]),
        decodeIdentityFromAlias(encodedMembers[1]),
      ],
    };
  } catch {
    return null;
  }
}

export function getSharedDmMetadata(entry: GroupContextEntry): {
  contextType?: ContextInfo["context_type"];
  memberIdentities: [string, string] | null;
} {
  const contextType =
    normalizeContextType(getMetadataValue(entry, "contextType")) ??
    normalizeContextType(getMetadataValue(entry, "context_type")) ??
    entry.sharedContextType;

  const memberIdentities =
    normalizeMemberIdentities(getMetadataValue(entry, "memberIdentities")) ??
    normalizeMemberIdentities(getMetadataValue(entry, "members")) ??
    normalizeMemberIdentities(getMetadataValue(entry, "participants")) ??
    (entry.memberIdentities && entry.memberIdentities.length === 2
      ? [entry.memberIdentities[0], entry.memberIdentities[1]]
      : null);

  return {
    contextType,
    memberIdentities,
  };
}

export function resolveSharedDmDiscovery(
  entry: GroupContextEntry,
  currentMemberIdentity: string,
): SharedDmDiscovery | null {
  const metadata = getSharedDmMetadata(entry);
  if (
    metadata.contextType === "Dm" &&
    metadata.memberIdentities?.includes(currentMemberIdentity)
  ) {
    const otherIdentity = metadata.memberIdentities.find(
      (identity) => identity !== currentMemberIdentity,
    );
    if (otherIdentity) {
      return {
        source: "metadata",
        memberIdentities: metadata.memberIdentities,
        otherIdentity,
      };
    }
  }

  const aliasData = parseDmAlias(entry.alias);
  if (!aliasData?.memberIdentities.includes(currentMemberIdentity)) {
    return null;
  }

  const otherIdentity = aliasData.memberIdentities.find(
    (identity) => identity !== currentMemberIdentity,
  );

  if (!otherIdentity) {
    return null;
  }

  return {
    source: "alias",
    memberIdentities: aliasData.memberIdentities,
    otherIdentity,
  };
}

export function isDmContextCandidate(params: {
  entry: GroupContextEntry;
  info?: ContextInfo | null;
}): boolean {
  if (params.info?.context_type === "Dm") {
    return true;
  }

  const metadata = getSharedDmMetadata(params.entry);
  if (metadata.contextType === "Dm") {
    return true;
  }

  return parseDmAlias(params.entry.alias) !== null;
}

export function getDmDisplayName(params: {
  otherUsername?: string;
  otherAlias?: string;
  otherIdentity?: string;
  contextId: string;
}): string {
  // Display chain — both sources are inherently per-viewer:
  //   - otherUsername: from the WASM `get_profiles` query on this node,
  //     filtered to the participant who isn't our own joined identity.
  //   - otherAlias:    from `listMembers(namespace)` on this node,
  //     looked up by the participant's namespace identity.
  // We deliberately do NOT consult the DM context's WASM `info.name`,
  // because it's stamped once at create time by the inviter as
  // `"DM: <otherUsername>"` and replicates as the same string to both
  // parties — using it would make the recipient see their own name as
  // the DM title instead of the inviter's.
  const username = params.otherUsername?.trim();
  if (username) {
    return username;
  }

  const alias = params.otherAlias?.trim();
  if (alias) {
    return alias;
  }

  // Both per-viewer sources empty → governance sync hasn't propagated yet.
  // Use a truncated identity so the DM is at least identifiable.
  const id = params.otherIdentity?.trim();
  if (id && id.length >= 8) {
    return `${id.slice(0, 4)}…${id.slice(-4)}`;
  }
  return id || params.contextId.slice(0, 8);
}

export async function createDmContextInGroup(
  params: CreateDmContextParams,
): Promise<CreateDmContextResult> {
  const alias = buildDmAlias(params.myIdentity, params.otherIdentity);

  // 1) Create a restricted subgroup under the namespace for the DM.
  const sgResponse = await params.groupApi.createSubgroup(params.groupId, {
    groupName: alias,
  });
  if (sgResponse.error || !sgResponse.data) {
    return {
      data: null,
      error: sgResponse.error?.message || "Failed to create DM subgroup",
      alias,
    };
  }
  const dmSubgroupId = sgResponse.data.groupId;

  const visResponse = await params.groupApi.setSubgroupVisibility(dmSubgroupId, {
    subgroupVisibility: "restricted",
  });
  if (visResponse.error) {
    params.onWarning?.(
      `Failed to set DM subgroup visibility: ${visResponse.error.message}`,
    );
  }

  // 2) Add the other identity as a member of the DM subgroup. Creator is
  //    already admin/owner of the new subgroup automatically.
  const addMemberResponse = await params.groupApi.addGroupMember(
    dmSubgroupId,
    params.otherIdentity,
  );
  if (addMemberResponse.error) {
    params.onWarning?.(
      `Failed to add member to DM subgroup: ${addMemberResponse.error.message}`,
    );
  }

  // 2b) Record both parties' display names as namespace-level member aliases
  // so listMembers(namespaceId) returns them immediately after governance
  // sync — no WASM state required. This is what useDMs reads for the DM list.
  if (params.otherUsername) {
    params.groupApi
      .setMemberMetadata(params.groupId, params.otherIdentity, { name: params.otherUsername })
      .catch(() => {/* best-effort */});
  }
  if (params.myUsername) {
    params.groupApi
      .setMemberMetadata(params.groupId, params.myIdentity, { name: params.myUsername })
      .catch(() => {/* best-effort */});
  }

  // 3) Create the DM's single context inside the new subgroup.
  // Encode both participant names in description so any node can derive the
  // display name from get_info without needing get_profiles or gossip of
  // namespace aliases. Format: JSON { c: creatorName, o: otherName }.
  // Each side compares info.creator to its own joined identity to know which
  // slot is "them" and which is "the other person".
  const participantMeta = JSON.stringify({
    c: params.myUsername || "",
    o: params.otherUsername || "",
  });
  const createResponse = await params.contextApi.createGroupContext({
    applicationId: params.applicationId,
    protocol: "near",
    groupId: dmSubgroupId,
    alias,
    initializationParams: {
      name: params.otherUsername
        ? `DM: ${params.otherUsername}`
        : `DM: ${params.otherIdentity}`,
      context_type: "Dm",
      description: participantMeta,
      created_at: Date.now(),
      creator_username: params.myUsername || "",
    },
  });

  if (createResponse.error || !createResponse.data) {
    return {
      data: null,
      error: createResponse.error?.message || "Failed to create DM context",
      alias,
    };
  }

  return {
    data: createResponse.data,
    error: "",
    alias,
  };
}
