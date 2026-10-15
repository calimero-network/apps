/**
 * What to do about your name when a project opens.
 *
 * The name is per TEAM; a project's roster only needs to be told it.
 *
 * - `wait` — the roster or the team's names have not answered yet. Asking now
 *            would ask people who already have a name.
 * - `join` — you are not on this project yet and a name is known: join under it.
 * - `ask`  — you are not on it and nobody knows a name for you: ask, once.
 * - `none` — you are already on this project.
 */
export type ProjectNameAction = { kind: "wait" } | { kind: "join"; name: string } | { kind: "ask" } | { kind: "none" };

export function decideProjectName(args: {
  /** On this project's roster: null until `get_members` answers. */
  onProject: boolean | null;
  /** `useMyName(...).ready`. */
  teamReady: boolean;
  /** `useMyName(...).name`, "" when none. */
  teamName: string;
  /** A name this browser used before names were per team (`mp-username`). */
  legacyName: string;
}): ProjectNameAction {
  const { onProject, teamReady, teamName, legacyName } = args;
  if (onProject === null) return { kind: "wait" };
  if (onProject) return { kind: "none" };
  if (!teamReady) return { kind: "wait" };
  const known = teamName || legacyName.trim();
  return known ? { kind: "join", name: known } : { kind: "ask" };
}
