import type { GroupMember } from "../api/groupApi";

export type GroupMemberIdentityResolutionSource =
  | "stored"
  | "single-member"
  | "unresolved";

export interface GroupMemberIdentityResolution {
  memberIdentity: string;
  source: GroupMemberIdentityResolutionSource;
}

export function resolveCurrentGroupMemberIdentity(params: {
  members: GroupMember[];
  storedMemberIdentity?: string;
}): GroupMemberIdentityResolution {
  const { members, storedMemberIdentity = "" } = params;

  if (
    storedMemberIdentity &&
    members.some((member) => member.identity === storedMemberIdentity)
  ) {
    return {
      memberIdentity: storedMemberIdentity,
      source: "stored",
    };
  }

  if (members.length === 1) {
    return {
      memberIdentity: members[0].identity,
      source: "single-member",
    };
  }

  return {
    memberIdentity: "",
    source: "unresolved",
  };
}
