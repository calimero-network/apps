// ── Where you were last ─────────────────────────────────────────────────────
//
// Signing in, or reloading the desktop window (which opens at `/`), used to
// land on the teams list every time, then a team, then a vault: three screens
// to get back to the vault you closed. The landing redirect now resumes there.
//
// What is remembered is scoped to the NODE: one browser can sign in to several
// nodes, and a team id from one means nothing on another. It is only a hint:
// every read is checked against what this node lists right now, so a team you
// have since left, or a vault someone deleted, falls back to the list instead
// of opening a screen that can only fail. Same rules as mero-design's
// `utils/lastVisit`.
//
// ⚠️ Resuming happens only from the landing redirect, which marks its
// navigation `state.resume`. `/teams` reached any other way — the rail, the
// brand, a "Vaults" back link — is the list, so you can always get back to it.

export interface LastVisit {
  /** The team open last, or the team of the vault open last. */
  team?: string;
  /** The vault (its context id) open last, when that was the last screen. */
  vault?: string;
}

const PREFIX = 'mero-pass:last-visit:';

/** The storage key for one node. Exported for tests. */
export function lastVisitKey(nodeUrl: string | null | undefined): string {
  return `${PREFIX}${(nodeUrl ?? '').replace(/\/+$/, '') || 'local'}`;
}

export function readLastVisit(nodeUrl: string | null | undefined): LastVisit {
  try {
    const raw = localStorage.getItem(lastVisitKey(nodeUrl));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LastVisit) : {};
  } catch {
    // Blocked storage or a corrupt entry is a cold start, not a failure.
    return {};
  }
}

function write(nodeUrl: string | null | undefined, next: LastVisit): void {
  try {
    localStorage.setItem(lastVisitKey(nodeUrl), JSON.stringify(next));
  } catch {
    /* quota / private mode: forgetting is fine */
  }
}

/** The team screen is now the last place: a vault left for it is not resumed. */
export function rememberTeam(
  nodeUrl: string | null | undefined,
  teamId: string,
): void {
  if (!teamId) return;
  const cur = readLastVisit(nodeUrl);
  if (cur.team === teamId && !cur.vault) return;
  write(nodeUrl, { team: teamId });
}

export function rememberVault(
  nodeUrl: string | null | undefined,
  teamId: string,
  vaultId: string,
): void {
  if (!teamId || !vaultId) return;
  const cur = readLastVisit(nodeUrl);
  if (cur.team === teamId && cur.vault === vaultId) return;
  write(nodeUrl, { team: teamId, vault: vaultId });
}

/**
 * Forget every node's last visit, at logout. The next person at this browser
 * is not a member of those teams, and an id is not something to hand them.
 */
export function forgetLastVisits(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* storage unavailable: nothing was remembered either */
  }
}

/**
 * The team to resume: the remembered one if this node still lists it. Never a
 * guess — with nothing remembered the list shows every team.
 */
export function pickTeam(
  listed: readonly string[],
  remembered: string | undefined,
): string | null {
  return remembered && listed.includes(remembered) ? remembered : null;
}

/** The vault to resume in a team: the remembered one if the team still lists it. */
export function pickVault(
  listed: readonly string[],
  remembered: string | undefined,
): string | null {
  return remembered && listed.includes(remembered) ? remembered : null;
}
