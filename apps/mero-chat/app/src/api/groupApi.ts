import type { ApiResponse } from "./types";

export type VisibilityMode = "open" | "restricted";
export type GroupMemberRole = "Admin" | "Member";
export type UpgradePolicy =
  | "Automatic"
  | "LazyOnAccess"
  | { Coordinated: { deadline: number } };

export interface CreateGroupRequest {
  applicationId: string;
  upgradePolicy: UpgradePolicy;
  alias?: string;
}

export interface CreateGroupResponse {
  groupId: string;
}

export interface GroupInvitationFromAdmin {
  inviter_identity: string;
  group_id: string;
  expiration_height: number;
  secret_salt: number[];
  protocol: string;
  network: string;
  contract_id: string;
}

export interface SignedGroupOpenInvitation {
  invitation: GroupInvitationFromAdmin;
  inviter_signature: string;
}

export interface GroupInfo {
  groupId: string;
  alias?: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: UpgradePolicy;
  memberCount: number;
  contextCount: number;
  activeUpgrade: GroupUpgradeStatus | null;
  defaultCapabilities: number;
  subgroupVisibility: VisibilityMode;
}

export interface GroupSummary {
  groupId: string;
  alias?: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: UpgradePolicy;
  createdAt: number;
}

export interface GroupMember {
  identity: string;
  alias?: string;
  role: GroupMemberRole;
}

export interface GroupUpgradeStatus {
  fromVersion: string;
  toVersion: string;
  initiatedAt: number;
  initiatedBy: string;
  status: string;
  total: number | null;
  completed: number | null;
  failed: number | null;
  completedAt: number | null;
}

export interface GroupContextEntry {
  contextId: string;
  alias?: string;
  sharedContextType?: "Channel" | "Dm";
  memberIdentities?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateInvitationRequest {
  requester?: string;
  expirationBlockHeight?: number;
}

export interface CreateInvitationResponse {
  invitation: SignedGroupOpenInvitation;
  groupAlias?: string;
}

export interface JoinGroupRequest {
  invitation: SignedGroupOpenInvitation;
  groupAlias?: string;
}

export interface JoinGroupResponse {
  groupId: string;
  memberIdentity: string;
}

export interface JoinGroupContextRequest {
  contextId: string;
}

export interface JoinGroupContextResponse {
  contextId: string;
  memberPublicKey: string;
}

export interface LeaveContextResponse {
  contextId: string;
  memberPublicKey: string;
}

export interface LeaveGroupResponse {
  groupId: string;
  memberPublicKey: string;
}

export interface LeaveNamespaceResponse {
  namespaceId: string;
  memberPublicKey: string;
}

export interface SyncGroupResponse {
  groupId: string;
  appKey: string;
  targetApplicationId: string;
  memberCount: number;
  contextCount: number;
}

export interface ContextVisibility {
  mode: VisibilityMode;
  creator: string;
}

export interface RemoveMemberRequest {
  members: string[];
}

export interface ManageAllowlistRequest {
  add?: string[];
  remove?: string[];
}

export interface SetMemberCapabilitiesRequest {
  capabilities: number;
}

export interface SetMemberMetadataRequest {
  name: string;
}

export interface MemberCapabilities {
  capabilities: number;
}

export interface SetDefaultCapabilitiesRequest {
  defaultCapabilities: number;
}

export interface SubgroupEntry {
  groupId: string;
  alias?: string;
}

export interface CreateSubgroupRequest {
  /** Routing identifier — may be long (e.g. `DM_CONTEXT_<id>_<id>`). */
  groupName?: string;
  /** Human-readable display name stored in the subgroup's MetadataRecord.
   *  Capped at 64 bytes server-side. Omit for DM subgroups whose alias is
   *  structural and not user-facing. */
  name?: string;
}

export interface CreateSubgroupResponse {
  groupId: string;
}

export interface SetSubgroupVisibilityRequest {
  subgroupVisibility: VisibilityMode;
}

export interface SetContextVisibilityRequest {
  mode: VisibilityMode;
}

export interface UpgradeGroupRequest {
  targetApplicationId: string;
  migrateMethod?: string;
}

export interface UpgradeGroupResponse {
  groupId: string;
  status: string;
  total: number | null;
  completed: number | null;
  failed: number | null;
}

export interface ReparentGroupRequest {
  /// New parent (hex group id). Must be a non-cycle ancestor.
  newParentId: string;
}

export interface GroupApi {
  createGroup(
    request: CreateGroupRequest,
  ): ApiResponse<CreateGroupResponse>;
  getGroup(groupId: string): ApiResponse<GroupInfo>;
  listGroups(): ApiResponse<GroupSummary[]>;
  deleteGroup(groupId: string): ApiResponse<boolean>;

  createInvitation(
    groupId: string,
    request?: CreateInvitationRequest,
  ): ApiResponse<CreateInvitationResponse>;
  joinGroup(
    request: JoinGroupRequest,
  ): ApiResponse<JoinGroupResponse>;
  listMembers(groupId: string): ApiResponse<{ members: GroupMember[]; selfIdentity?: string }>;
  addGroupMember(groupId: string, identity: string): ApiResponse<void>;
  removeMember(
    groupId: string,
    memberIdentity: string,
  ): ApiResponse<void>;
  listGroupContexts(groupId: string): ApiResponse<GroupContextEntry[]>;
  joinGroupContext(
    groupId: string,
    request: JoinGroupContextRequest,
  ): ApiResponse<JoinGroupContextResponse>;
  leaveContext(contextId: string): ApiResponse<LeaveContextResponse>;
  leaveGroup(groupId: string): ApiResponse<LeaveGroupResponse>;
  leaveNamespace(namespaceId: string): ApiResponse<LeaveNamespaceResponse>;
  syncGroup(groupId: string): ApiResponse<SyncGroupResponse>;

  getContextVisibility(
    groupId: string,
    contextId: string,
  ): ApiResponse<ContextVisibility>;
  setContextVisibility(
    groupId: string,
    contextId: string,
    request: SetContextVisibilityRequest,
  ): ApiResponse<void>;
  getContextAllowlist(
    groupId: string,
    contextId: string,
  ): ApiResponse<string[]>;
  manageContextAllowlist(
    groupId: string,
    contextId: string,
    request: ManageAllowlistRequest,
  ): ApiResponse<void>;

  getMemberCapabilities(
    groupId: string,
    identity: string,
  ): ApiResponse<MemberCapabilities>;
  setMemberCapabilities(
    groupId: string,
    identity: string,
    request: SetMemberCapabilitiesRequest,
  ): ApiResponse<void>;
  setMemberMetadata(
    groupId: string,
    identity: string,
    request: SetMemberMetadataRequest,
  ): ApiResponse<void>;
  setDefaultCapabilities(
    groupId: string,
    request: SetDefaultCapabilitiesRequest,
  ): ApiResponse<void>;
  setSubgroupVisibility(
    groupId: string,
    request: SetSubgroupVisibilityRequest,
  ): ApiResponse<void>;
  listSubgroups(namespaceId: string): ApiResponse<SubgroupEntry[]>;
  createSubgroup(
    namespaceId: string,
    request: CreateSubgroupRequest,
  ): ApiResponse<CreateSubgroupResponse>;
  /// Atomic edge swap: moves `groupId` under `newParentId`. Replaces the
  /// older nest+unnest pair and prevents orphan state.
  reparentGroup(
    groupId: string,
    request: ReparentGroupRequest,
  ): ApiResponse<void>;

  triggerUpgrade(
    groupId: string,
    request: UpgradeGroupRequest,
  ): ApiResponse<UpgradeGroupResponse>;
  getUpgradeStatus(
    groupId: string,
  ): ApiResponse<GroupUpgradeStatus | null>;
}
