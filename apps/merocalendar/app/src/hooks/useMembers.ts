import { useMemo } from "react";
import { useTypedSelector } from "./useTypedSelector";
import { Member } from "../types/event";

/** Short display for an unknown / unnamed public key: first 6 chars + ellipsis. */
export function shortPk(pk: string): string {
  if (!pk) return "";
  return pk.length > 8 ? `${pk.slice(0, 6)}…` : pk;
}

/**
 * FEATURE (missing names): expose team members + a pubkey→display-name resolver.
 * Owners and peers are stored as base58 public keys; `displayName(pk)` returns
 * the member's username when known, falling back to a short pubkey.
 */
export function useMembers() {
  const members = useTypedSelector(({ events }) => events.members) as Member[];

  const byId = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const displayName = useMemo(
    () => (pk: string): string => {
      const m = byId.get(pk);
      if (m && m.username?.trim()) return m.username.trim();
      return shortPk(pk);
    },
    [byId],
  );

  return { members, byId, displayName };
}
