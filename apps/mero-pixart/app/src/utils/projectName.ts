import { decideSelfName } from "@calimero-apps/names";

/**
 * What to do about your name when a project opens.
 *
 * The name is per TEAM: asked when you create or join it, and kept in the
 * team's member metadata. A project's roster only needs to be told it.
 *
 * - `wait` — the roster or the team's names have not answered yet. Asking now
 *            would ask people who already have a name.
 * - `use`  — a name is known. `join` when you are not on this project's roster
 *            yet; `adopt` when the team has no name for you but the roster or
 *            the old `mp-username` key does, so the team takes it, unasked.
 * - `ask`  — nobody knows a name for you (a team made before names were asked
 *            on create/join): ask once, for the team.
 */
export type ProjectNameAction =
  | { kind: "wait" }
  | { kind: "use"; name: string; join: boolean; adopt: boolean }
  | { kind: "ask"; suggestion: string };

export function decideProjectName(args: {
  /** On this project's roster: null until `get_members` answers. */
  onProject: boolean | null;
  /** Your name on this project's roster, "" when none. */
  rosterName?: string;
  /** `useMyName(...).ready`. */
  teamReady: boolean;
  /** `useMyName(...).name`, "" when none. */
  teamName: string;
  /** A name this browser used before names were per team (`mp-username`). */
  legacyName: string;
}): ProjectNameAction {
  const { onProject, rosterName = "", teamReady, teamName, legacyName } = args;
  if (onProject === null) return { kind: "wait" };
  const d = decideSelfName({ orgReady: teamReady, orgName: teamName, fallbacks: [rosterName, legacyName] });
  if (d.kind === "wait" || d.kind === "ask") return d;
  return { kind: "use", name: d.name, join: !onProject, adopt: d.kind === "adopt" };
}

/** The name this browser used before names were per team (`mp-username`), or "". */
export function legacyUsername(): string {
  try {
    return localStorage.getItem("mp-username")?.trim() ?? "";
  } catch {
    return "";
  }
}
