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

/**
 * The team-wide name for an account (namespace member metadata), when one is
 * known. A board username is per board; this is the name the person set once
 * for every app on the team, so it names someone who never joined this board.
 */
export type TeamNameLookup = (account: string) => string | undefined;

export function resolveName(members: Member[], identity: string, teamName?: TeamNameLookup): string {
  const found = members.find((m) => m.id === identity);
  // The team name first: it is the one name a person has across every board,
  // and the only one they can change in one place.
  return teamName?.(identity) || found?.username?.trim() || shortIdentity(identity);
}

export function useMemberNames(members: Member[]): NameResolver {
  return useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m.username?.trim()]));
    return (identity: string) => byId.get(identity) || shortIdentity(identity);
  }, [members]);
}
