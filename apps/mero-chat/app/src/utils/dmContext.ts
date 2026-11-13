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
  otherIdentity: string;
  contextApi: {
    createGroupContext(params: {
      applicationId: string;
      groupId: string;
      initializationParams: Record<string, unknown>;
      identitySecret?: string;
    }): ApiResponse<CreateContextResponse>;
  };
  groupApi: {
    createSubgroup(
      namespaceId: string,
      request: { groupName?: string; visibility?: "open" | "restricted" },
    ): ApiResponse<{ groupId: string }>;
    setSubgroupVisibility(
      groupId: string,
      request: { subgroupVisibility: "open" | "restricted" },
    ): ApiResponse<void>;
    addGroupMember(
      groupId: string,
      identity: string,
    ): ApiResponse<void>;
  };
  onWarning?: (message: string) => void;
}

export interface CreateDmContextResult {
  data: CreateContextResponse | null;
  error: string;
  alias: string;
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

/** A short, order-independent tag for a DM subgroup.
 *
 * This used to be `DM_CONTEXT_<identityA>_<identityB>`. Two account ids are 44
 * characters each, so that name was 100 bytes against a 64-byte cap.
 *
 * The server does NOT refuse it — measured against a live node, the create
 * returns 200 and the name is stored as the EMPTY STRING. So the subgroup was
 * made and the DM simply never appeared, which reads from the outside as a
 * button that does nothing. An over-long name is dropped, not rejected and not
 * truncated.
 *
 * It also does not want to be participant-derived at all. The pairing is the
 * social graph, and a group name is not the place to publish it. Discovery moved
 * to subgroup MEMBERSHIP (see `resolveDmCounterpart`), so nothing needs to read
 * the participants back out of a name.
 *
 * The digest keeps the tag stable for a given pair, which makes a DM
 * recognisable across reloads without naming anyone. It is not an identifier:
 * the subgroup id is.
 */
export function buildDmAlias(identityA: string, identityB: string): string {
  const ordered = [identityA.trim(), identityB.trim()].sort((left, right) =>
    left.localeCompare(right),
  );

  // FNV-1a, 32-bit. Not a security boundary — a name nobody resolves an identity
  // from does not need one — and synchronous, unlike crypto.subtle.
  let hash = 0x811c9dc5;
  const joined = ordered[0] + "\u0000" + ordered[1];
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${DM_CONTEXT_ALIAS_PREFIX}${hash.toString(16).padStart(8, "0")}`;
}

/// Recovers the pair from a LEGACY `DM_CONTEXT_<a>_<b>` alias.
///
/// Nothing writes that shape any more — see `buildDmAlias`, where the name
/// stopped carrying participants — so for a DM created by this build it returns
/// null and callers fall through to subgroup membership, which is the source of
/// truth. Kept for aliases written before the change.
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

/**
 * The label of a DM: the other person's name in the workspace (its member
 * metadata, `otherAlias`), else a truncated account. A DM carries no name of
 * its own: what its creator wrote at creation could not follow a rename.
 */
export function getDmDisplayName(params: {
  otherAlias?: string;
  otherIdentity?: string;
  contextId: string;
}): string {
  const alias = params.otherAlias?.trim();
  if (alias) return alias;
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
    visibility: "restricted",
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

  // 3) The DM's single context inside the new subgroup. It holds no names:
  //    both sides read each other's from the workspace's member metadata.
  const createResponse = await params.contextApi.createGroupContext({
    applicationId: params.applicationId,
    groupId: dmSubgroupId,
    initializationParams: {
      name: "DM",
      context_type: "Dm",
      description: "",
      created_at: Date.now(),
      creator_username: "",
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
