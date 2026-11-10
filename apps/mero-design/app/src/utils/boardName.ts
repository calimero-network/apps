import { decideSelfName, lastUsedName } from "@calimero-apps/names";
import { useUsernameStore } from "../store/usernameStore";

/**
 * What to do about your name when a board opens.
 *
 * The name is per TEAM: asked when you create or join it, and kept in the
 * team's member metadata. A board only needs to be told it, so the board's own
 * roster (`boardName`) never decides whether to ask — only whether to join.
 *
 * - `wait`  — the team's names or the board's roster have not answered yet.
 *             Asking now would ask people who already have a name.
 * - `use`   — a name is known. `join` when the board does not show it yet;
 *             `adopt` when the team has none but the board or this browser
 *             does (named before names were per team): the team takes it,
 *             unasked.
 * - `ask`   — nobody knows a name for you (a team made before names were asked
 *             on create/join): ask, once, for the team.
 */
export type BoardNameAction =
  | { kind: "wait" }
  | { kind: "use"; name: string; join: boolean; adopt: boolean }
  | { kind: "ask"; suggestion: string };

export function decideBoardName(args: {
  /** `useMyName(...).ready`. */
  teamReady: boolean;
  /** `useMyName(...).name`, "" when none. */
  teamName: string;
  /** Your username on this board's roster: "" for none, null until known. */
  boardName: string | null;
  /** A name this browser kept before names were per team (`merodesign-usernames`). */
  legacyName?: string;
}): BoardNameAction {
  const { teamReady, teamName, boardName, legacyName } = args;
  if (boardName === null) return { kind: "wait" };
  const d = decideSelfName({ orgReady: teamReady, orgName: teamName, fallbacks: [boardName, legacyName] });
  if (d.kind === "wait" || d.kind === "ask") return d;
  return { kind: "use", name: d.name, join: boardName !== d.name, adopt: d.kind === "adopt" };
}

/** The name this browser kept for `identity` before names were per team, or "". */
export function legacyUsername(identity: string | null | undefined): string {
  if (!identity) return "";
  return useUsernameStore.getState().getUsername(identity)?.trim() ?? "";
}

/** What to offer when a new team asks for your name: the one used last. */
export function suggestedName(identity: string | null | undefined): string {
  return lastUsedName() || legacyUsername(identity);
}
