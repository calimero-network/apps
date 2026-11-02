import { useEffect, useState } from "react";

import { useSignedIn } from "../sessionContext";

// A team (org) knows its own name, but a page opened by deep link shows the
// URL's id until the org has answered; this browser remembers the names it has
// seen, so the header does not flash `Team fb884a` on the next open.

const KEY = (groupId: string) => `mp-team-name-${groupId}`;

export function setStoredTeamName(groupId: string, name: string): void {
  if (!groupId || !name?.trim()) return;
  try {
    localStorage.setItem(KEY(groupId), name.trim());
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function getStoredTeamName(groupId: string): string {
  if (!groupId) return "";
  try {
    return localStorage.getItem(KEY(groupId))?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Best display name for a team: the org's name → cached name → "Team abc123". */
export function teamLabel(groupId: string, serverName?: string): string {
  const s = serverName?.trim();
  if (s) return s;
  const cached = getStoredTeamName(groupId);
  if (cached) return cached;
  return `Team ${groupId.slice(0, 6)}`;
}

/** A team's name for rendering: the org's own, once it answers; until then the cache. */
export function useTeamName(groupId: string | undefined): string {
  const { client, after } = useSignedIn();
  const [name, setName] = useState(() => (groupId ? teamLabel(groupId) : "Team"));
  useEffect(() => {
    if (!groupId) return;
    let live = true;
    setName(teamLabel(groupId));
    client
      .getOrg(groupId)
      .then((o) => {
        const n = typeof o.name === "string" ? o.name : "";
        if (!live || !n) return;
        setStoredTeamName(groupId, n);
        setName(n);
      })
      .catch(() => {})
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, groupId, after]);
  return name;
}
