import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createNamespace, deleteNamespace, leaveNamespace, listNamespaces } from "../api/rpc";
import { useApplicationId } from "./useApplicationId";
import { setStoredTeamName } from "../utils/teamName";
import type { Team } from "../types";

export interface CreatedTeam {
  id: string;
  /** Set when an account's team was created but the cloud declined to host it. */
  haError?: string;
}

export interface TeamList {
  teams: Team[];
  /** The node has answered at least once, empty or not. */
  listed: boolean;
  /** The last read failed (and nothing has been listed yet, or since). */
  error: boolean;
  reload: () => Promise<void>;
  /** Founds a team and adds it to the list; rejects with the node's reason. */
  createTeam: (name: string) => Promise<CreatedTeam>;
  /** Node-only. Rejects with the node's reason; the team stays listed then. */
  deleteTeam: (teamId: string) => Promise<void>;
  /** What a member who is not an admin does instead. The team stays listed when refused. */
  leaveTeam: (teamId: string) => Promise<void>;
}

/**
 * This app's teams on this node, polled every 30 s so a team joined or created
 * elsewhere shows up in the switcher without a reload.
 */
export function useTeamList(): TeamList {
  // MeroDesign's own application id — see hooks/useApplicationId.
  const ensureAppId = useApplicationId();
  const [teams, setTeams] = useState<Team[]>([]);
  const [listed, setListed] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  // Set in the body too: strict mode runs the cleanup once before the real mount.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reload = useCallback(async () => {
    try {
      const appId = await ensureAppId();
      const items = await listNamespaces(appId);
      if (!alive.current) return;
      setTeams(items.map((n) => ({ groupId: n.namespaceId, name: n.name ?? "" })));
      setListed(true);
      setError(false);
    } catch {
      // A failed re-read never blanks a list that has loaded.
      if (alive.current) setError(true);
    }
  }, [ensureAppId]);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const createTeam = useCallback(async (name: string): Promise<CreatedTeam> => {
    const appId = await ensureAppId();
    if (!appId) throw new Error("Select or install the Mero Design application first.");
    // On a node this is the node's own namespace; on an account the admin
    // founds it through the relay, as the account, and asks the cloud to host
    // it. The body is the same either way.
    const data = await createNamespace(appId, name);
    const id = data.namespaceId;
    // Cache the name so it survives even if the server later returns no alias,
    // and so it can be embedded in invitations for joiners.
    if (id) setStoredTeamName(id, name);
    setTeams((prev) => (prev.some((t) => t.groupId === id) ? prev : [...prev, { groupId: id, name }]));
    return { id, ...(data.haError ? { haError: data.haError } : {}) };
  }, [ensureAppId]);

  const deleteTeam = useCallback(async (teamId: string) => {
    await deleteNamespace(teamId);
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }, []);

  const leaveTeam = useCallback(async (teamId: string) => {
    await leaveNamespace(teamId);
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }, []);

  return useMemo(
    () => ({ teams, listed, error, reload, createTeam, deleteTeam, leaveTeam }),
    [teams, listed, error, reload, createTeam, deleteTeam, leaveTeam],
  );
}
