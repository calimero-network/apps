// A team's (org's) name comes from the cluster. This browser also caches the
// name of a team it created, so the card has a name before the first read.

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

/** Best display name for a team: server name → cached name → "Team abc123". */
export function teamLabel(groupId: string, serverName?: string): string {
  const s = serverName?.trim();
  if (s) return s;
  const cached = getStoredTeamName(groupId);
  if (cached) return cached;
  return `Team ${groupId.slice(0, 6)}`;
}
