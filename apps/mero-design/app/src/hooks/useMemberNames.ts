import { useMemo } from "react";
import type { Member } from "../types";

/**
 * Resolves an identity to a display name.
 *
 * Items 8 and 12: comments, cursors, the members dropdown and project settings all
 * showed raw identity ids — "as then we dont know who the fuck is who". The names
 * already exist: `get_members` returns `{ id, username }` and `update_member_username`
 * maintains it. Nothing was joining the two.
 *
 * Falls back to a shortened id so an identity with no member record still renders
 * something recognisable instead of crashing or showing 64 characters of hex.
 */
export function shortIdentity(identity: string): string {
  if (!identity) return "unknown";
  return identity.length <= 10 ? identity : `${identity.slice(0, 4)}…${identity.slice(-4)}`;
}

export type NameResolver = (identity: string) => string;

export function resolveName(members: Member[], identity: string): string {
  const found = members.find((m) => m.id === identity);
  return found?.username?.trim() || shortIdentity(identity);
}

export function useMemberNames(members: Member[]): NameResolver {
  return useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m.username?.trim()]));
    return (identity: string) => byId.get(identity) || shortIdentity(identity);
  }, [members]);
}
