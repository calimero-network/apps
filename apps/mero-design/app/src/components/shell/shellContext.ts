import { createContext, useContext } from "react";
import type { TeamList } from "../../hooks/useTeamList";
import type { BoardList } from "../../hooks/useBoardList";

/** Which settings section the panel shows; it lives in the URL (`?settings=`). */
export type SettingsSection = "team" | "board";

/**
 * What the shell shares with the screens inside it: the team list (the
 * switcher), the current team's boards (the rail, the team home grid), and the
 * shell's own surfaces (invite, settings).
 */
export interface ShellValue {
  teamId: string | null;
  projectId: string | null;
  teams: TeamList;
  boards: BoardList;
  /** Opens a team (and resumes its last board when `resume`). */
  openTeam: (teamId: string, opts?: { resume?: boolean }) => void;
  openBoard: (contextId: string) => void;
  openInvite: () => void;
  /** `board` defaults to the open board. */
  openSettings: (section: SettingsSection, board?: string) => void;
  /**
   * The top bar's board slot. A board portals its live members and Present
   * into it, so they sit in the one bar, next to Invite.
   */
  boardSlot: HTMLElement | null;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const v = useContext(ShellContext);
  if (!v) throw new Error("useShell() outside <DesignShell>");
  return v;
}

/** The shell, or null when a screen is rendered on its own (unit tests). */
export function useOptionalShell(): ShellValue | null {
  return useContext(ShellContext);
}
