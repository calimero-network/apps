import type { GroupMember } from "../api/groupApi";
import { isSelfSender } from "./selfIdentity";

/**
 * The member row that belongs to THIS node, or undefined.
 *
 * Not an `===` against `selfIdentity`, because the server can answer the two
 * halves of that comparison in different identity spaces. On core master
 * `GroupMemberEntry.identity` is an `AccountId` while
 * `ListGroupMembersResponse.self_identity` is still a `PublicKey`, and an
 * account is a one-way hash of the key — so a direct comparison is not merely
 * wrong, it is unsatisfiable. Every role check keyed off it then fails closed:
 * an admin reads as a plain user and a joined channel reads as not-joined.
 * See calimero-network/core#3402.
 *
 * `isSelfSender` matches against every identity this node owns — the account
 * ids registered by `loadSelfAccountIdentity` as well as the device/signing
 * keys — so it is correct on both the current wire shape (rc.20: both fields
 * are the signing key) and the one that replaces it. Extra candidates cannot
 * produce a false match: they are all this node's own keys, so another
 * member's row can never look like ours.
 */
export function findSelfMember(params: {
  members: GroupMember[];
  /** Whatever the server called "me" — a signing key today, an account later. */
  selfIdentity?: string;
  /** Scopes the per-context identity candidates when the caller has one. */
  contextId?: string;
}): GroupMember | undefined {
  const { members, selfIdentity = "", contextId = "" } = params;

  return members.find((member) =>
    isSelfSender(member.identity, contextId, selfIdentity),
  );
}

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
