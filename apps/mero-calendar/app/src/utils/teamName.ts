// Human names for teams (namespaces) aren't always available from the server on
// the node that *joined* a team — the namespace metadata may not have synced yet,
// so the team would otherwise render as a raw ID. We cache the name locally:
//   - when a team is created (the creator knows the name)
//   - when a team is joined (the inviter embeds the name in the invitation)
// and fall back to it when the server returns no alias/name.

const KEY = (groupId: string) => `mc-team-name-${groupId}`;

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
