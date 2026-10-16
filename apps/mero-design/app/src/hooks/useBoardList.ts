import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { fetchGroupName, rememberGroupName } from "@calimero-apps/names";
import {
  createContext,
  createSubgroup,
  deleteContext,
  deleteGroup,
  listGroupContexts,
  listSubgroups,
  renameBoard as renameBoardOnNode,
  setSubgroupVisibility,
} from "../api/rpc";
import { useApplicationId } from "./useApplicationId";
import type { Project } from "../types";

export interface BoardList {
  boards: Project[];
  /** The team whose boards last came back from the node, empty or not. */
  listedFor: string | null;
  reload: () => Promise<void>;
  /** A new board in the team; rejects with the node's reason. */
  createBoard: (name: string) => Promise<Project>;
  /** Deletes the board for the whole team. It stays listed when refused. */
  deleteBoard: (board: Project) => Promise<void>;
  renameBoard: (board: Project, name: string) => Promise<void>;
}

/**
 * A team's boards. A board is a subgroup of the team with one context in it,
 * so this is two hops (subgroups, then each one's context), polled every 30 s.
 */
export function useBoardList(teamId: string | null): BoardList {
  const { admin } = useMero();
  const ensureAppId = useApplicationId();
  const [boards, setBoards] = useState<Project[]>([]);
  const [listedFor, setListedFor] = useState<string | null>(null);
  // The team the current request is for: a slow answer for the team the user
  // just left must not land on the one they switched to.
  const current = useRef(teamId);
  current.current = teamId;

  const reload = useCallback(async () => {
    if (!teamId) return;
    try {
      const subgroups = await listSubgroups(teamId);
      const resolved: Project[] = [];
      for (const sg of subgroups) {
        try {
          const ctxs = await listGroupContexts(sg.groupId);
          if (ctxs.length === 0) continue;
          const ctx = ctxs[0];
          resolved.push({
            contextId: ctx.contextId || sg.groupId,
            groupId: sg.groupId,
            name: ctx.name ?? sg.name ?? sg.groupId.slice(0, 8),
            description: "",
            isPublic: true,
          });
        } catch {
          // no context yet
        }
      }
      if (current.current !== teamId) return;
      setBoards(resolved);
      setListedFor(teamId);

      // The replicated name wins over the listing's (a rename lands there).
      // Cached, so a poll costs nothing new; never blocks the list.
      if (!admin) return;
      for (const b of resolved) {
        void fetchGroupName(admin, b.groupId, b.contextId).then((name) => {
          if (!name || current.current !== teamId) return;
          setBoards((prev) => prev.map((p) => (p.contextId === b.contextId && p.name !== name ? { ...p, name } : p)));
        });
      }
    } catch {
      // Keep what was listed; the next poll tries again.
    }
  }, [teamId, admin]);

  // A different team starts from nothing, never from the last team's boards.
  useEffect(() => {
    setBoards([]);
    setListedFor(null);
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [teamId, reload]);

  const createBoard = useCallback(async (rawName: string): Promise<Project> => {
    const name = rawName.trim();
    if (!teamId) throw new Error("Open a team first.");
    // Resolve the app id up front. Never POST an empty one — the node rejects
    // it ("applicationId: invalid length 0").
    const appId = await ensureAppId();
    if (!appId) throw new Error("Select or install the Mero Design application first.");

    // A project is a subgroup of the team with one context (the board) in it.
    const subgroupId = await createSubgroup(teamId, name);
    if (subgroupId) await setSubgroupVisibility(subgroupId, "open").catch(() => {});

    const initBytes = Array.from(new TextEncoder().encode(JSON.stringify({ name, description: "" })));
    const contextId = await createContext({
      applicationId: appId,
      groupId: subgroupId || teamId,
      name,
      initializationParams: initBytes,
    });
    // Store the same group the context was created under (`subgroupId || teamId`).
    // An empty groupId would make Settings fall back to the contextId for
    // `/groups/{id}/members`, which the admin API rejects.
    const board: Project = { contextId, groupId: subgroupId || teamId, name, description: "", isPublic: true };
    if (current.current === teamId) setBoards((prev) => [...prev, board]);
    return board;
  }, [teamId, ensureAppId]);

  const deleteBoard = useCallback(async (board: Project) => {
    // Through the board's subgroup, which takes it out of every listing for
    // the whole team. Core's group delete only UNREGISTERS the context (its
    // data stays on the node), so the context goes first wherever it can —
    // best-effort: the app's token has no `context:delete` (the node answers
    // 403) and an account has no form of it, and neither may stop the delete.
    // A board created straight in the team has no subgroup: the context alone.
    if (board.groupId && board.groupId !== teamId) {
      await deleteContext(board.contextId).catch(() => {});
      await deleteGroup(board.groupId);
    } else {
      await deleteContext(board.contextId);
    }
    // Remove the card only once the delete went through: dropping it on a
    // refusal hid the failure until the next reload brought the board back.
    setBoards((prev) => prev.filter((p) => p.contextId !== board.contextId));
  }, [teamId]);

  const renameBoard = useCallback(async (board: Project, rawName: string) => {
    const name = rawName.trim();
    if (!name || name === board.name) return;
    await renameBoardOnNode(board.groupId, board.contextId, name);
    rememberGroupName(board.groupId, name, board.contextId);
    setBoards((prev) => prev.map((p) => (p.contextId === board.contextId ? { ...p, name } : p)));
  }, []);

  return useMemo(
    () => ({ boards, listedFor, reload, createBoard, deleteBoard, renameBoard }),
    [boards, listedFor, reload, createBoard, deleteBoard, renameBoard],
  );
}
