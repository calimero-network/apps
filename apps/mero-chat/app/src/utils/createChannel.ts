import { ContextApiDataSource } from "../api/dataSource/nodeApiDataSource";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { getApplicationId, setContextMemberIdentity } from "../constants/config";
import { getMessengerDisplayName } from "./messengerName";
import { log } from "./logger";

/** The channel every workspace starts with, so a member who joins lands somewhere. */
export const GENERAL_CHANNEL = "general";

/** The node calls creating a channel makes, so tests can drive them without a node. */
export interface ChannelCreationApi {
  createSubgroup: GroupApiDataSource["createSubgroup"];
  setSubgroupVisibility: GroupApiDataSource["setSubgroupVisibility"];
  createGroupContext: ContextApiDataSource["createGroupContext"];
  joinChat: ClientApiDataSource["joinChat"];
}

export interface CreatedChannel {
  contextId: string;
  /** This node's identity in the channel's context; empty when the node did not say. */
  memberKey: string;
}

function defaultApi(): ChannelCreationApi {
  const groupApi = new GroupApiDataSource();
  const nodeApi = new ContextApiDataSource();
  const clientApi = new ClientApiDataSource();
  return {
    createSubgroup: (...args) => groupApi.createSubgroup(...args),
    setSubgroupVisibility: (...args) => groupApi.setSubgroupVisibility(...args),
    createGroupContext: (...args) => nodeApi.createGroupContext(...args),
    joinChat: (...args) => clientApi.joinChat(...args),
  };
}

/**
 * Create a channel in a workspace.
 *
 * 1-group-per-context model (rc.37+): each channel is its own subgroup under
 * the namespace root, with one context inside. Subgroup visibility
 * (open|restricted) IS the channel's public/private flag, and is set
 * deterministically via the SubgroupVisibilitySet op (encrypted to the
 * subgroup's members). Non-admin members can create+manage their own
 * channel-groups thanks to the CAN_CREATE_SUBGROUP / CAN_MANAGE_VISIBILITY
 * namespace caps.
 *
 * Shared by the "Create channel" popup and workspace creation, which makes
 * #general the same way.
 */
export async function createChannel(
  namespaceId: string,
  channelName: string,
  isPublic: boolean,
  api: ChannelCreationApi = defaultApi(),
): Promise<{ error: string } | CreatedChannel> {
  // 1) The channel's subgroup under the namespace root. For user-created
  //    channels the alias and the display name are the same string (and
  //    short — UI input is constrained well under the 64-byte cap). Born with
  //    the chosen visibility: a public channel created Restricted and flipped
  //    Open strands every namespace member outside it.
  const sgResp = await api.createSubgroup(namespaceId, {
    groupName: channelName,
    name: channelName,
    visibility: isPublic ? "open" : "restricted",
  });
  if (sgResp.error || !sgResp.data) {
    const msg = sgResp.error?.message || "A channel with this name may already exist";
    log.error("createChannel", "Failed to create channel subgroup", sgResp.error);
    return { error: msg };
  }
  const channelGroupId = sgResp.data.groupId;

  // 2) Set the subgroup's visibility explicitly as well.
  const visResp = await api.setSubgroupVisibility(channelGroupId, {
    subgroupVisibility: isPublic ? "open" : "restricted",
  });
  if (visResp.error) {
    log.warn("createChannel", "Failed to set subgroup visibility (non-fatal)", visResp.error);
  }

  // 3) The channel's single context inside the new subgroup.
  const createResp = await api.createGroupContext({
    applicationId: getApplicationId(),
    groupId: channelGroupId,
    name: channelName,
    initializationParams: {
      name: channelName,
      context_type: "Channel",
      description: "",
      created_at: Math.floor(Date.now() / 1000),
      creator_username: "",
    },
  });
  if (createResp.error || !createResp.data) {
    const msg = createResp.error?.message || "Failed to create channel context";
    log.error("createChannel", "Failed to create channel context", createResp.error);
    return { error: msg };
  }

  const contextId = createResp.data.contextId;
  const memberKey = createResp.data.memberPublicKey ?? "";
  if (memberKey) {
    setContextMemberIdentity(contextId, memberKey);
    // Your name in THIS workspace — not the one you are looking at, which is
    // still the previous workspace while a new one is being created.
    const username = getMessengerDisplayName(namespaceId);
    if (username) {
      api
        .joinChat({ contextId, executorPublicKey: memberKey, username })
        .catch((e) => log.warn("createChannel", "set_profile failed on new channel", e));
    } else {
      // No name in this workspace yet (it is asked right after creating it):
      // the profile is written once it is chosen (`joinPendingChannels`).
      addPending(namespaceId, { contextId, memberKey });
    }
  }
  return { contextId, memberKey };
}

// ── Channels made before your name in the workspace was chosen ───────────────

interface Pending {
  contextId: string;
  memberKey: string;
}

const PENDING_KEY = (namespaceId: string) => `chat-pending-profiles:${namespaceId}`;

function readPending(namespaceId: string): Pending[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY(namespaceId));
    const list = raw ? (JSON.parse(raw) as Pending[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && p.contextId && p.memberKey) : [];
  } catch {
    return [];
  }
}

function addPending(namespaceId: string, entry: Pending): void {
  try {
    const list = readPending(namespaceId).filter((p) => p.contextId !== entry.contextId);
    localStorage.setItem(PENDING_KEY(namespaceId), JSON.stringify([...list, entry]));
  } catch {
    /* storage unavailable: the channel shows you by identity until you rename */
  }
}

/**
 * Write `username` as your profile in the channels this workspace got before
 * you chose a name there (#general, made with the workspace). Best effort.
 */
export async function joinPendingChannels(
  namespaceId: string,
  username: string,
  api: Pick<ChannelCreationApi, "joinChat"> = defaultApi(),
): Promise<void> {
  const name = username.trim();
  const pending = readPending(namespaceId);
  if (!name || pending.length === 0) return;
  try {
    localStorage.removeItem(PENDING_KEY(namespaceId));
  } catch {
    /* ignore */
  }
  await Promise.all(
    pending.map((p) =>
      api
        .joinChat({ contextId: p.contextId, executorPublicKey: p.memberKey, username: name })
        .catch((e) => log.warn("createChannel", "set_profile failed on a channel made before the name", e)),
    ),
  );
}
