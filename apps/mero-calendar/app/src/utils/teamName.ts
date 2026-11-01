// Labels for teams (orgs) and calendars (app instances). On Calimero 1.0 both
// carry their name on the cluster, which every member reads; the local cache is
// only a fallback for a name not read yet (the creator knows it at once).

function readName(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeName(key: string, name: string): void {
  if (!name?.trim()) return;
  try {
    localStorage.setItem(key, name.trim());
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function dropName(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const TEAM_KEY = (groupId: string) => `mc-team-name-${groupId}`;
const CALENDAR_KEY = (contextId: string) => `mc-calendar-name-${contextId}`;

export function setStoredTeamName(groupId: string, name: string): void {
  if (!groupId) return;
  writeName(TEAM_KEY(groupId), name);
}

export function getStoredTeamName(groupId: string): string {
  return groupId ? readName(TEAM_KEY(groupId)) : "";
}

/** Best display name for a team: server name → cached name → "Team abc123". */
export function teamLabel(groupId: string, serverName?: string): string {
  const s = serverName?.trim();
  if (s) return s;
  const cached = getStoredTeamName(groupId);
  if (cached) return cached;
  return `Team ${groupId.slice(0, 6)}`;
}

export function setStoredCalendarName(contextId: string, name: string): void {
  if (!contextId) return;
  writeName(CALENDAR_KEY(contextId), name);
}

export function getStoredCalendarName(contextId: string): string {
  return contextId ? readName(CALENDAR_KEY(contextId)) : "";
}

/**
 * Forget a calendar's cached name.
 *
 * Called when a context is deleted or left, so a later context that happens to
 * reuse the id can't inherit a stale label — and so the picker doesn't keep
 * offering a name for something that no longer exists.
 */
export function clearStoredCalendarName(contextId: string): void {
  if (contextId) dropName(CALENDAR_KEY(contextId));
}

/** Best display name for a calendar: cached name → "Calendar abc123". */
export function calendarLabel(contextId: string, serverName?: string): string {
  const s = serverName?.trim();
  if (s) return s;
  const cached = getStoredCalendarName(contextId);
  if (cached) return cached;
  return `Calendar ${contextId.slice(0, 6)}`;
}
