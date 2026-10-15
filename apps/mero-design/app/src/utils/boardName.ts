/**
 * What to do about your name when a board opens.
 *
 * The name is per TEAM. A board only needs to be told it, so the board's own
 * roster (`boardName`) never decides whether to ask — only whether to join.
 *
 * - `wait`  — the team's names or the board's roster have not answered yet.
 *             Asking now would ask people who already have a name.
 * - `join`  — you have a team name the board does not show yet: join under it.
 * - `adopt` — no team name, but this board knows one (named on a board before
 *             names were per team): make it the team's.
 * - `ask`   — nobody knows a name for you: ask, once, for the team.
 * - `none`  — the board already shows your team name.
 */
export type BoardNameAction =
  | { kind: "wait" }
  | { kind: "join"; name: string }
  | { kind: "adopt"; name: string }
  | { kind: "ask" }
  | { kind: "none" };

export function decideBoardName(args: {
  /** `useMyName(...).ready`. */
  teamReady: boolean;
  /** `useMyName(...).name`, "" when none. */
  teamName: string;
  /** Your username on this board's roster: "" for none, null until known. */
  boardName: string | null;
}): BoardNameAction {
  const { teamReady, teamName, boardName } = args;
  if (!teamReady || boardName === null) return { kind: "wait" };
  if (teamName) return boardName === teamName ? { kind: "none" } : { kind: "join", name: teamName };
  if (boardName) return { kind: "adopt", name: boardName };
  return { kind: "ask" };
}
