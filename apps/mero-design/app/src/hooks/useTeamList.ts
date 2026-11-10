import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LeftApp } from "@calimero-apps/connect";
import {
  createTeam as createOrg,
  deleteTeam as deleteOrg,
  leaveTeam as leaveOrg,
  leaveTeamOrg,
  listTeams,
} from "../api/rpc";
import { getApi } from "../api/client";
import { publishMyName } from "../api/names";
import { setStoredTeamName } from "../utils/teamName";
import type { Team } from "../types";

export interface CreatedTeam {
  id: string;
  /** Set when the team was created but members could not be let create boards and invite. */
  warning?: string;
}

export interface TeamList {
  teams: Team[];
  /** The node has answered at least once, empty or not. */
  listed: boolean;
  /** The last read failed (and nothing has been listed yet, or since). */
  error: boolean;
  reload: () => Promise<void>;
  /**
   * Founds a team and adds it to the list; rejects with the node's reason.
   * `myName` is your name in it, asked in the same step so no board asks.
   */
  createTeam: (name: string, myName?: string) => Promise<CreatedTeam>;
  /** Its owner only (a passkey step-up). Rejects with the node's reason; the team stays listed then. */
  deleteTeam: (teamId: string) => Promise<void>;
  /** What a member who is not an admin does instead. The team stays listed when refused. */
  /**
   * Leaves the team: in an org that keeps its apps apart, Mero Design only
   * (`lastApp` when it was the last app there: offer {@link leaveOrganization}).
   */
  leaveTeam: (teamId: string) => Promise<LeftApp>;
  /** Leaves the organization altogether, every app in it. */
  leaveOrganization: (teamId: string) => Promise<void>;
}

/**
 * This account's teams (organizations), polled every 30 s so a team joined or
 * created elsewhere shows up in the switcher without a reload.
 */
export function useTeamList(): TeamList {
  const [teams, setTeams] = useState<Team[]>([]);
  const [listed, setListed] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  // Only the newest read is applied: one started under an earlier app id (or
  // none) can answer after the read that replaced it.
  const generation = useRef(0);
  // Set in the body too: strict mode runs the cleanup once before the real mount.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const items = await listTeams();
      if (!alive.current || gen !== generation.current) return;
      setTeams(items.map((n) => ({ groupId: n.namespaceId, name: n.name ?? "" })));
      setListed(true);
      setError(false);
    } catch {
      // A failed re-read never blanks a list that has loaded.
      if (alive.current && gen === generation.current) setError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const createTeam = useCallback(async (name: string, myName?: string): Promise<CreatedTeam> => {
    const data = await createOrg(name);
    const id = data.namespaceId;
    // Best effort: refused, the team's first board asks for it, once.
    if (id && myName?.trim()) await publishMyName(id, getApi().accountId, myName).catch(() => {});
    // Cache the name so it survives even if the server later returns no alias,
    // and so it can be embedded in invitations for joiners.
    if (id) setStoredTeamName(id, name);
    setTeams((prev) => (prev.some((t) => t.groupId === id) ? prev : [...prev, { groupId: id, name }]));
    return { id, ...(data.warning ? { warning: data.warning } : {}) };
  }, []);

  const deleteTeam = useCallback(async (teamId: string) => {
    await deleteOrg(teamId);
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }, []);

  const leaveTeam = useCallback(async (teamId: string) => {
    const left = await leaveOrg(teamId);
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    return left;
  }, []);

  const leaveOrganization = useCallback(async (teamId: string) => {
    await leaveTeamOrg(teamId);
  }, []);

  return useMemo(
    () => ({ teams, listed, error, reload, createTeam, deleteTeam, leaveTeam, leaveOrganization }),
    [teams, listed, error, reload, createTeam, deleteTeam, leaveTeam, leaveOrganization],
  );
}
