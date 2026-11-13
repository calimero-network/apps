// v1's group API (namespaces, subgroups, their contexts and members) on
// Calimero 1.0's orgs and app instances. The mapping is in `../platform.ts`;
// this file keeps the `{ data, error }` envelope and the method names every
// hook and screen calls, so they are unchanged.
import { uploadBlob, type BlobUploadResult } from "../blobs";
export type { BlobUploadResult };
import { getAccountId } from "../calimero";
import { describeError, type OtherOrg } from "@calimero-apps/connect";
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
  addToChat,
  appMembers,
  changeChannelMembers,
  channelManagedInHome,
  channelRows,
  channelVisibility,
  chatMembers,
  chatTeamId,
  createOrg,
  createPendingChannel,
  deleteChannel,
  deleteOrg,
  getAppRecord,
  getOrgRecord,
  inviteToken,
  leaveChat,
  leaveChatOrg,
  invalidate,
  isOrg,
  listChannels,
  listChatApps,
  memberName,
  memberRole,
  chatOrgs,
  otherChatOrgs,
  pendingChannel,
  redeemInvite,
  removeFromChat,
  renameChannel,
  setCapabilities,
  setMemberName,
  setMemberRole,
  setOrgName,
  setVisibility,
} from "../platform";
import { DEFAULT_MEMBER_CAPABILITIES } from "../../utils/groupCapabilities";

type Result<T> = Awaited<ApiResponse<T>>;

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}

function fail<T>(code: number, message: string): Result<T> {
  return { data: null, error: { code, message } };
}

function catchError<T>(context: string, error: unknown): Result<T> {
  console.error(`${context} failed:`, error);
  const status = (error as { status?: unknown })?.status;
  return fail(typeof status === "number" ? status : 500, describeError(error));
}

/** Every capability: what an owner or admin holds. */
const ALL_CAPABILITIES = 0xff;

/**
 * Bytes as a blob of conversation `contextId` (its app instance), in the
 * `{ data, error }` envelope this module's callers expect.
 */
export async function uploadBlobDirect(
  file: File,
  contextId: string,
): ApiResponse<BlobUploadResult> {
  try {
    return ok(await uploadBlob(await file.arrayBuffer(), contextId));
  } catch (error) {
    return catchError("uploadBlobDirect", error);
  }
}

export class GroupApiDataSource implements GroupApi {
  /** A workspace: an org whose members may create channels and invite. */
  async createGroup(request: CreateGroupRequest): ApiResponse<CreateGroupResponse> {
    try {
      const name = (request.name ?? "").trim();
      if (name) {
        const problem = groupNameError(name);
        if (problem) return fail(400, problem);
      }
      // v1 gave members these capabilities on a new namespace; on 1.0 it is a
      // passkey step-up. Declined, the workspace stays, and only its owner and
      // admins create channels and invite until an admin allows members to.
      // Chat's own app team comes with it, open; declined, or a node without
      // app teams, the workspace is a legacy one, as every workspace was before.
      const groupId = await createOrg(name || "Workspace", DEFAULT_MEMBER_CAPABILITIES);
      return ok({ groupId });
    } catch (error) {
      return catchError("createGroup", error);
    }
  }

  /** A workspace (org) or a channel (app instance), in v1's `GroupInfo` shape. */
  async getGroup(groupId: string): ApiResponse<GroupInfo> {
    try {
      if (await isOrg(groupId)) {
        const org = await getOrgRecord(groupId);
        const apps = (await listChatApps()).filter((a) => a.org === groupId);
        return ok({
          groupId,
          alias: org.name,
          appKey: "",
          targetApplicationId: "",
          upgradePolicy: "Automatic",
          memberCount: chatMembers(org).length,
          contextCount: apps.length,
          activeUpgrade: null,
          defaultCapabilities: org.defaultCapabilities,
          subgroupVisibility: "open",
        });
      }
      const pending = pendingChannel(groupId);
      if (pending && !pending.appId) {
        return ok({
          groupId,
          alias: pending.name,
          appKey: "",
          targetApplicationId: "",
          upgradePolicy: "Automatic",
          memberCount: pending.accounts.length + 1,
          contextCount: 0,
          activeUpgrade: null,
          defaultCapabilities: 0,
          subgroupVisibility: pending.visibility,
        });
      }
      const app = await getAppRecord(pending?.appId ?? groupId);
      const members = await appMembers(app);
      return ok({
        groupId,
        alias: app.name,
        appKey: "",
        targetApplicationId: "",
        upgradePolicy: "Automatic",
        memberCount: members.length,
        contextCount: 1,
        activeUpgrade: null,
        defaultCapabilities: 0,
        subgroupVisibility: await channelVisibility(app),
      });
    } catch (error) {
      return catchError("getGroup", error);
    }
  }

  /**
   * The workspaces: the orgs this account is in that hold chat. An org made
   * for another app is left out (see {@link listOtherOrgs}).
   */
  async listGroups(): ApiResponse<GroupSummary[]> {
    try {
      const orgs = await chatOrgs();
      return ok(
        orgs.map((o) => ({
          groupId: o.orgId,
          alias: o.name,
          appKey: "",
          targetApplicationId: "",
          upgradePolicy: "Automatic" as const,
          createdAt: 0,
        })),
      );
    } catch (error) {
      return catchError("listGroups", error);
    }
  }

  /**
   * The account's other orgs, where chat may be added: what "Connect to an
   * existing organization" lists. Throws when they cannot be read.
   */
  listOtherOrgs(): Promise<OtherOrg[]> {
    return otherChatOrgs();
  }

  /**
   * Deletes a channel or DM (its team, which takes its instance; a passkey
   * step-up), or the workspace (its org, a passkey step-up).
   */
  async deleteGroup(groupId: string): ApiResponse<boolean> {
    try {
      if (await isOrg(groupId)) {
        await deleteOrg(groupId);
      } else {
        await deleteChannel(groupId);
      }
      return ok(true);
    } catch (error) {
      return catchError("deleteGroup", error);
    }
  }

  /**
   * An invite token into the workspace (a passkey step-up for the inviter),
   * naming chat's app team where it has one: in a shared org it gives Chat
   * and no other app (`chatOnly`).
   */
  async createInvitation(
    groupId: string,
    _request?: CreateInvitationRequest,
  ): ApiResponse<CreateInvitationResponse> {
    try {
      const { token: invitation, appOnly: chatOnly } = await inviteToken(groupId);
      const org = await getOrgRecord(groupId).catch(() => null);
      return ok({ invitation, groupAlias: org?.name, ...(chatOnly ? { chatOnly } : {}) });
    } catch (error) {
      return catchError("createInvitation", error);
    }
  }

  /** Redeems an invite token: the account joins the org. */
  async joinGroup(request: JoinGroupRequest): ApiResponse<JoinGroupResponse> {
    try {
      const groupId = await redeemInvite(request.invitation);
      if (!groupId) return fail(400, "The invitation did not name a workspace");
      return ok({ groupId, memberIdentity: getAccountId() });
    } catch (error) {
      return catchError("joinGroup", error);
    }
  }

  /** The members of a workspace (org), or of a channel (who its access reaches). */
  async listMembers(groupId: string): ApiResponse<{
    members: GroupMember[];
    teeMembers: GroupMember[];
    selfIdentity?: string;
  }> {
    try {
      const self = getAccountId() || undefined;
      if (await isOrg(groupId)) {
        // The workspace's people are Chat's: its app team where it has one.
        const org = await getOrgRecord(groupId);
        const members = chatMembers(org).map((identity) => ({
          identity,
          role: memberRole(org.members[identity]),
          alias: memberName(org, identity),
        }));
        return ok({ members, teeMembers: [], selfIdentity: self });
      }
      const pending = pendingChannel(groupId);
      if (pending && !pending.appId) {
        const ids = [getAccountId(), ...pending.accounts].filter(Boolean);
        return ok({
          members: ids.map((identity) => ({ identity, role: "Member" as const })),
          teeMembers: [],
          selfIdentity: self,
        });
      }
      const app = await getAppRecord(pending?.appId ?? groupId);
      const org = app.org ? await getOrgRecord(app.org).catch(() => null) : null;
      const members = (await appMembers(app)).map((identity) => ({
        identity,
        role: identity === app.owner ? ("Admin" as const) : memberRole(org?.members[identity]),
        alias: org ? memberName(org, identity) : undefined,
      }));
      return ok({ members, teeMembers: [], selfIdentity: self });
    } catch (error) {
      return catchError("listMembers", error);
    }
  }

  /** The caller's identity in a workspace: the account. */
  async resolveCurrentMemberIdentity(
    groupId: string,
    _storedMemberIdentity = "",
  ): ApiResponse<{ memberIdentity: string; members: GroupMember[] }> {
    const listed = await this.listMembers(groupId);
    const memberIdentity = getAccountId();
    if (!memberIdentity) return fail(401, "Sign in first.");
    return ok({ memberIdentity, members: listed.data?.members ?? [] });
  }

  /**
   * Adds a person to a channel or DM (a row on its team; a passkey step-up),
   * or to a pending one; or someone in the org to Chat in a workspace.
   */
  async addGroupMember(groupId: string, identity: string): ApiResponse<void> {
    try {
      const pending = pendingChannel(groupId);
      if (pending && !pending.appId) {
        if (!pending.accounts.includes(identity)) pending.accounts.push(identity);
        return ok(undefined);
      }
      if (await isOrg(groupId)) {
        const org = await getOrgRecord(groupId);
        if (chatTeamId(org) && org.members[identity]) {
          // Someone in the org but not in Chat: a row on chat's app team.
          await addToChat(groupId, identity);
        } else {
          await setMemberRole(groupId, identity, "member");
        }
      } else {
        await changeChannelMembers(pending?.appId ?? groupId, [identity]);
      }
      return ok(undefined);
    } catch (error) {
      return catchError("addGroupMember", error);
    }
  }

  /**
   * Removes a person from a workspace (a passkey step-up) or a channel or DM
   * (off its team; a passkey step-up). In a shared org that is Chat only (its app team, and the private
   * channels this account may change); the organization and its other apps
   * are Calimero Home's. Elsewhere it is the organization, as before.
   */
  async removeMember(groupId: string, memberIdentity: string): ApiResponse<void> {
    try {
      if (await isOrg(groupId)) {
        await removeFromChat(groupId, memberIdentity);
      } else {
        const pending = pendingChannel(groupId);
        if (pending && !pending.appId) {
          pending.accounts = pending.accounts.filter((a) => a !== memberIdentity);
        } else {
          await changeChannelMembers(pending?.appId ?? groupId, [], [memberIdentity]);
        }
      }
      return ok(undefined);
    } catch (error) {
      return catchError("removeMember", error);
    }
  }

  /** Admin or member of the workspace (a passkey step-up). */
  async updateMemberRole(
    groupId: string,
    identity: string,
    role: "Admin" | "Member",
  ): ApiResponse<void> {
    try {
      await setMemberRole(groupId, identity, role === "Admin" ? "admin" : "member");
      return ok(undefined);
    } catch (error) {
      return catchError("updateMemberRole", error);
    }
  }

  /**
   * The context of a channel: the channel's own instance. A workspace has no
   * contexts of its own (v1's root contexts predate one-group-per-context).
   */
  async listGroupContexts(groupId: string): ApiResponse<GroupContextEntry[]> {
    try {
      if (await isOrg(groupId)) return ok([]);
      const pending = pendingChannel(groupId);
      if (pending && !pending.appId) return ok([]);
      const app = await getAppRecord(pending?.appId ?? groupId);
      const members = await appMembers(app);
      const restricted = (await channelVisibility(app)) === "restricted";
      return ok([
        {
          contextId: app.appId,
          alias: app.name,
          memberIdentities: restricted ? members : undefined,
          metadata: app.metadata ?? undefined,
        },
      ]);
    } catch (error) {
      return catchError("listGroupContexts", error);
    }
  }

  /** Nothing to join: an account reaches every instance its access names. */
  async joinGroupContext(
    _groupId: string,
    request: JoinGroupContextRequest,
  ): ApiResponse<JoinGroupContextResponse> {
    try {
      await getAppRecord(request.contextId);
      return ok({ contextId: request.contextId, memberPublicKey: getAccountId() });
    } catch (error) {
      return catchError("joinGroupContext", error);
    }
  }

  /** Leaving a channel is local (the sidebar hides it); access is the owner's to change. */
  async leaveContext(contextId: string): ApiResponse<LeaveContextResponse> {
    return ok({ contextId, memberPublicKey: getAccountId() });
  }

  async leaveGroup(groupId: string): ApiResponse<LeaveGroupResponse> {
    return ok({ groupId, memberPublicKey: getAccountId() });
  }

  /** Leaves the workspace (removes the caller from the org; a passkey step-up). */
  async leaveNamespace(namespaceId: string): ApiResponse<LeaveNamespaceResponse> {
    try {
      // In a shared org, Chat only; when that was the person's last app
      // there, `lastApp` lets the caller offer to leave the org too.
      const { left, lastApp } = await leaveChat(namespaceId);
      return ok({ namespaceId, memberPublicKey: getAccountId(), left, lastApp });
    } catch (error) {
      return catchError("leaveNamespace", error);
    }
  }

  /** Leaves the organization altogether (offered after leaving Chat, the last app there). */
  async leaveOrganization(namespaceId: string): ApiResponse<void> {
    try {
      await leaveChatOrg(namespaceId);
      return ok(undefined);
    } catch (error) {
      return catchError("leaveOrganization", error);
    }
  }

  async deleteNamespace(namespaceId: string): ApiResponse<boolean> {
    try {
      await deleteOrg(namespaceId);
      return ok(true);
    } catch (error) {
      return catchError("deleteNamespace", error);
    }
  }

  /** Nothing replicates on the client's behalf any more: a fresh read. */
  async syncGroup(groupId: string): ApiResponse<SyncGroupResponse> {
    invalidate(groupId);
    const info = await this.getGroup(groupId);
    if (info.error || !info.data) return { data: null, error: info.error ?? { code: 500, message: "syncGroup" } };
    return ok({
      groupId,
      appKey: "",
      targetApplicationId: "",
      memberCount: info.data.memberCount,
      contextCount: info.data.contextCount,
    });
  }

  /** The people a channel reaches, with the names they set for the workspace. */
  async listContextMembers(contextId: string): ApiResponse<GroupMember[]> {
    const listed = await this.listMembers(contextId);
    if (listed.error) return { data: null, error: listed.error };
    return ok(listed.data?.members ?? []);
  }

  /**
   * Whether this channel's people are managed in Calimero Home (one made
   * before channels had teams), so its member controls say so.
   */
  async channelManagedInHome(groupId: string): Promise<boolean> {
    return channelManagedInHome(groupId).catch(() => false);
  }

  async getContextVisibility(_groupId: string, contextId: string): ApiResponse<ContextVisibility> {
    try {
      const app = await getAppRecord(contextId);
      return ok({ mode: await channelVisibility(app), creator: app.owner });
    } catch (error) {
      return catchError("getContextVisibility", error);
    }
  }

  async setContextVisibility(
    _groupId: string,
    contextId: string,
    request: SetContextVisibilityRequest,
  ): ApiResponse<void> {
    try {
      await setVisibility(contextId, request.mode);
      return ok(undefined);
    } catch (error) {
      return catchError("setContextVisibility", error);
    }
  }

  async getContextAllowlist(_groupId: string, contextId: string): ApiResponse<string[]> {
    try {
      return ok(await channelRows(contextId));
    } catch (error) {
      return catchError("getContextAllowlist", error);
    }
  }

  async manageContextAllowlist(
    _groupId: string,
    contextId: string,
    request: ManageAllowlistRequest,
  ): ApiResponse<void> {
    try {
      await changeChannelMembers(contextId, request.add ?? [], request.remove ?? []);
      return ok(undefined);
    } catch (error) {
      return catchError("manageContextAllowlist", error);
    }
  }

  async getMemberCapabilities(groupId: string, identity: string): ApiResponse<MemberCapabilities> {
    try {
      const org = await getOrgRecord(groupId);
      const role = org.members[identity];
      if (role === "owner" || role === "admin") return ok({ capabilities: ALL_CAPABILITIES });
      return ok({ capabilities: org.capabilities[identity] ?? org.defaultCapabilities });
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
      await setCapabilities(groupId, request.capabilities, identity);
      return ok(undefined);
    } catch (error) {
      return catchError("setMemberCapabilities", error);
    }
  }

  /** The name a member goes by in the workspace (org member metadata). */
  async setMemberMetadata(
    groupId: string,
    identity: string,
    request: SetMemberMetadataRequest,
  ): ApiResponse<void> {
    try {
      let org = groupId;
      if (!(await isOrg(groupId))) {
        const app = await getAppRecord(pendingChannel(groupId)?.appId ?? groupId).catch(() => null);
        org = app?.org ?? pendingChannel(groupId)?.org ?? "";
      }
      if (!org) return ok(undefined);
      await setMemberName(org, identity, request.name);
      return ok(undefined);
    } catch (error) {
      return catchError("setMemberMetadata", error);
    }
  }

  /** The workspace's name: its metadata `name`, else the org's own name. */
  async getGroupMetadata(groupId: string): ApiResponse<{ name?: string } | null> {
    try {
      const org = await getOrgRecord(groupId);
      const name = typeof org.metadata?.name === "string" && org.metadata.name ? org.metadata.name : org.name;
      return ok(name ? { name } : null);
    } catch (error) {
      return catchError("getGroupMetadata", error);
    }
  }

  async setGroupMetadata(groupId: string, name: string): ApiResponse<void> {
    try {
      await setOrgName(groupId, name);
      return ok(undefined);
    } catch (error) {
      return catchError("setGroupMetadata", error);
    }
  }

  async setContextAlias(_groupId: string, contextId: string, name: string): ApiResponse<void> {
    try {
      await renameChannel(contextId, name);
      return ok(undefined);
    } catch (error) {
      return catchError("setContextAlias", error);
    }
  }

  async setDefaultCapabilities(
    groupId: string,
    request: SetDefaultCapabilitiesRequest,
  ): ApiResponse<void> {
    try {
      await setCapabilities(groupId, request.defaultCapabilities);
      return ok(undefined);
    } catch (error) {
      return catchError("setDefaultCapabilities", error);
    }
  }

  /** Open (everyone in Chat) or restricted (the people with a row): the channel team's `join`. */
  async setSubgroupVisibility(
    groupId: string,
    request: SetSubgroupVisibilityRequest,
  ): ApiResponse<void> {
    try {
      const pending = pendingChannel(groupId);
      if (pending && !pending.appId) {
        pending.visibility = request.subgroupVisibility;
        return ok(undefined);
      }
      await setVisibility(pending?.appId ?? groupId, request.subgroupVisibility);
      return ok(undefined);
    } catch (error) {
      return catchError("setSubgroupVisibility", error);
    }
  }

  /**
   * The workspace's channels and DMs: the teams below chat's app team this
   * account is in and their instances, and the chat instances made before
   * channels had teams.
   */
  async listSubgroups(namespaceId: string): ApiResponse<SubgroupEntry[]> {
    try {
      const channels = await listChannels(namespaceId);
      return ok(channels.map((a) => ({ groupId: a.appId, alias: a.name })));
    } catch (error) {
      return catchError("listSubgroups", error);
    }
  }

  /**
   * The first step of a channel or DM: kept here until its context is created
   * (`ContextApiDataSource.createGroupContext`), which creates the instance.
   */
  async createSubgroup(
    namespaceId: string,
    request: CreateSubgroupRequest,
  ): ApiResponse<CreateSubgroupResponse> {
    const requestedName = (request.groupName ?? request.name ?? "").trim();
    if (requestedName) {
      const problem = groupNameError(requestedName);
      if (problem) return fail(400, problem);
    }
    return ok({
      groupId: createPendingChannel(namespaceId, requestedName, request.visibility ?? "open"),
    });
  }

  /** Channels do not nest on Calimero 1.0. */
  async reparentGroup(_groupId: string, _request: ReparentGroupRequest): ApiResponse<void> {
    return fail(501, "Channels cannot be moved between workspaces.");
  }

  /**
   * Upgrades are by package release now: the workspace's owner (or a holder
   * of MANAGE_APPLICATION) upgrades the org's chat instances to a release.
   */
  async triggerUpgrade(
    groupId: string,
    request: UpgradeGroupRequest,
  ): ApiResponse<UpgradeGroupResponse> {
    void groupId;
    void request;
    return fail(501, "Upgrade chat from its package release in the Calimero console.");
  }

  async getUpgradeStatus(_groupId: string): ApiResponse<GroupUpgradeStatus | null> {
    return ok(null);
  }
}
