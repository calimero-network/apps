// ── Where you were last ─────────────────────────────────────────────────────
//
// Opening the app used to land on the teams list every time, then a team, then
// a board: three screens to get back to the board you closed. The shell now
// resumes there instead.
//
// What is remembered is scoped to the NODE: one browser can sign in to several
// nodes, and a team id from one means nothing on another. It is only a hint:
// every read is checked against what this node lists right now, so a team you
// have since left, or a board someone deleted, falls back instead of opening a
// screen that can only fail (the rule mero-issue-tracker's `activeNamespace`
// uses for its workspace).

export interface LastVisit {
  /** The team open last. */
  team?: string;
  /** The board open last in each team, by team id. */
  boards?: Record<string, string>;
  /** Which team each board was opened in, so a link naming only a board finds its team. */
  boardTeams?: Record<string, string>;
}

const PREFIX = "md-last-visit:";

/** The storage key for one node. Exported for tests. */
export function lastVisitKey(nodeUrl: string | null | undefined): string {
  return `${PREFIX}${(nodeUrl ?? "").replace(/\/+$/, "") || "local"}`;
}

export function readLastVisit(nodeUrl: string | null | undefined): LastVisit {
  try {
    const raw = localStorage.getItem(lastVisitKey(nodeUrl));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LastVisit) : {};
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

export function rememberTeam(nodeUrl: string | null | undefined, teamId: string): void {
  if (!teamId) return;
  const cur = readLastVisit(nodeUrl);
  if (cur.team === teamId) return;
  write(nodeUrl, { ...cur, team: teamId });
}

export function rememberBoard(nodeUrl: string | null | undefined, teamId: string, boardId: string): void {
  if (!teamId || !boardId) return;
  const cur = readLastVisit(nodeUrl);
  if (cur.team === teamId && cur.boards?.[teamId] === boardId && cur.boardTeams?.[boardId] === teamId) return;
  write(nodeUrl, {
    ...cur,
    team: teamId,
    boards: { ...cur.boards, [teamId]: boardId },
    boardTeams: { ...cur.boardTeams, [boardId]: teamId },
  });
}

/** Forget a board (it was deleted), so nothing tries to resume into it. */
export function forgetBoard(nodeUrl: string | null | undefined, teamId: string, boardId: string): void {
  const cur = readLastVisit(nodeUrl);
  if (cur.boards?.[teamId] !== boardId && !cur.boardTeams?.[boardId]) return;
  const boards = { ...cur.boards };
  if (boards[teamId] === boardId) delete boards[teamId];
  const boardTeams = { ...cur.boardTeams };
  delete boardTeams[boardId];
  write(nodeUrl, { ...cur, boards, boardTeams });
}

/**
 * The team to open when the URL names none: the remembered one if this node
 * still lists it, else the first listed, else none.
 */
export function pickTeam(listed: readonly string[], remembered: string | undefined): string | null {
  if (remembered && listed.includes(remembered)) return remembered;
  return listed[0] ?? null;
}

/**
 * The board to resume in a team: the remembered one if the team still lists
 * it. Never a guess — with nothing remembered the team's home shows every board.
 */
export function pickBoard(listed: readonly string[], remembered: string | undefined): string | null {
  return remembered && listed.includes(remembered) ? remembered : null;
}
