import { useMemo } from "react";
import { useTeamScope } from "../api/teamScope";
import { useTypedSelector } from "./useTypedSelector";
import { Member } from "../types/event";

/** An account id, shortened for display. */
export function shortPk(pk: string): string {
  if (!pk) return "";
  return pk.length > 8 ? `${pk.slice(0, 6)}…` : pk;
}

/**
 * The calendar's members (who set a calendar username) and a name for any
 * account: its calendar username, else the name it set on the team, else a
 * short id.
 */
export function useMembers() {
  const members = useTypedSelector(({ events }) => events.members) as Member[];
  const { names } = useTeamScope();

  const byId = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const displayName = useMemo(
    () =>
      (pk: string): string => {
        const m = byId.get(pk);
        if (m && m.username?.trim()) return m.username.trim();
        return names.get(pk) || shortPk(pk);
      },
    [byId, names],
  );

  return { members, byId, displayName };
}
