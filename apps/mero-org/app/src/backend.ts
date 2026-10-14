import type {
  AccessView, ActivityPage, AppView, EnrolmentView, GroupView,
  MemberView, MeroOrgClient, OrgView, PlacementView,
} from "./generated/MeroOrgClient";

export type { AccessView, ActivityPage, AppView, EnrolmentView, GroupView, MemberView, OrgView, PlacementView };

export interface OrgBackend {
  org(): Promise<OrgView>;
  members(): Promise<MemberView[]>;
  member(account: string): Promise<MemberView | null>;
  groups(): Promise<GroupView[]>;
  groupMembers(group: string): Promise<MemberView[]>;
  apps(): Promise<AppView[]>;
  accessRows(): Promise<AccessView[]>;
  enrolments(): Promise<EnrolmentView[]>;
  myEnrolments(): Promise<EnrolmentView[]>;
  desiredPlacements(): Promise<PlacementView[]>;
  activity(before: number, limit: number): Promise<ActivityPage>;
  verifyActivity(): Promise<boolean>;
  claimMembership(displayName: string, handle: string): Promise<MemberView>;
  setMemberStatus(account: string, status: string): Promise<void>;
  updateProfile(p: { displayName: string; avatar: string }): Promise<void>;
  createGroup(name: string, parent: string): Promise<GroupView>;
  renameGroup(id: string, name: string): Promise<void>;
  moveGroup(id: string, parent: string): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  setMembership(group: string, account: string, role: "lead" | "member"): Promise<void>;
  removeMembership(group: string, account: string): Promise<void>;
  registerApp(a: { namespaceId: string; package: string; label: string; status: "ready" | "pending_admin" }): Promise<AppView>;
  setAppStatus(id: string, status: "ready" | "pending_admin"): Promise<void>;
  removeApp(id: string): Promise<void>;
  setAccess(group: string, app: string, capabilities: number): Promise<void>;
  removeAccess(group: string, app: string): Promise<void>;
  recordEnrolment(e: { account: string; app: string; state: string; invitation: string; invitationExpires: number; subgroups: string[]; note: string }): Promise<void>;
  grantAdmin(account: string): Promise<void>;
  revokeAdmin(account: string): Promise<void>;
  setSettings(name: string, icon: string): Promise<void>;
}

/** The screens' and the reconciler's one door to the contract. Argument names mirror the ABI (snake_case). */
export function nodeBackend(client: MeroOrgClient): OrgBackend {
  return {
    org: () => client.org(),
    members: () => client.members(),
    member: (account) => client.member({ account }),
    groups: () => client.groups(),
    groupMembers: (group) => client.groupMembers({ group }),
    apps: () => client.apps(),
    accessRows: () => client.accessRows(),
    enrolments: () => client.enrolments(),
    myEnrolments: () => client.myEnrolments(),
    desiredPlacements: () => client.desiredPlacements(),
    activity: (before, limit) => client.activity({ before, limit }),
    verifyActivity: () => client.verifyActivity(),
    claimMembership: (displayName, handle) => client.claimMembership({ display_name: displayName, handle }),
    setMemberStatus: (account, status) => client.setMemberStatus({ account, status }),
    updateProfile: (p) => client.updateProfile({ display_name: p.displayName, avatar: p.avatar }),
    createGroup: (name, parent) => client.createGroup({ name, parent }),
    renameGroup: (id, name) => client.renameGroup({ id, name }),
    moveGroup: (id, parent) => client.moveGroup({ id, parent }),
    deleteGroup: (id) => client.deleteGroup({ id }),
    setMembership: (group, account, role) => client.setMembership({ group, account, role }),
    removeMembership: (group, account) => client.removeMembership({ group, account }),
    registerApp: (a) => client.registerApp({ namespace_id: a.namespaceId, package: a.package, label: a.label, status: a.status }),
    setAppStatus: (id, status) => client.setAppStatus({ id, status }),
    removeApp: (id) => client.removeApp({ id }),
    setAccess: (group, app, capabilities) => client.setAccess({ group, app_id: app, capabilities }),
    removeAccess: (group, app) => client.removeAccess({ group, app_id: app }),
    recordEnrolment: (e) => client.recordEnrolment({ account: e.account, app_id: e.app, state: e.state, invitation: e.invitation, invitation_expires: e.invitationExpires, subgroups: e.subgroups, note: e.note }),
    grantAdmin: (account) => client.grantAdmin({ account }),
    revokeAdmin: (account) => client.revokeAdmin({ account }),
    setSettings: (name, icon) => client.setSettings({ name, icon }),
  };
}
