import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  boardName,
  createBoard as createBoardOnCluster,
  deleteBoard as deleteBoardOnCluster,
  listBoards,
  renameBoard as renameBoardOnCluster,
} from "../api/rpc";
import { peekApi } from "../api/client";
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
 * A team's boards: the instances of this app in the team's organization,
 * polled every 30 s.
 */
export function useBoardList(teamId: string | null): BoardList {
  const [boards, setBoards] = useState<Project[]>([]);
  const [listedFor, setListedFor] = useState<string | null>(null);
  // The team the current request is for: a slow answer for the team the user
  // just left must not land on the one they switched to.
  const current = useRef(teamId);
  current.current = teamId;

  const reload = useCallback(async () => {
    if (!teamId) return;
    try {
      const listed = await listBoards(teamId);
      const resolved: Project[] = listed.map((b) => ({
        contextId: b.contextId,
        groupId: b.groupId,
        name: b.name,
        owner: b.owner,
        description: "",
        isPublic: true,
      }));
      if (current.current !== teamId) return;
      setBoards((prev) =>
        // Keep a name already read from the contract: the listing has the name
        // the board was created with.
        resolved.map((b) => ({ ...b, name: prev.find((p) => p.contextId === b.contextId)?.name ?? b.name })),
      );
      setListedFor(teamId);

      // The board's own name wins over the instance's (a rename lands there).
      // Never blocks the list.
      for (const b of resolved) {
        void boardName(b.contextId).then((name) => {
          if (!name || current.current !== teamId) return;
          setBoards((prev) => prev.map((p) => (p.contextId === b.contextId && p.name !== name ? { ...p, name } : p)));
        }).catch(() => {});
      }
    } catch {
      // Keep what was listed; the next poll tries again.
    }
  }, [teamId]);

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
    const contextId = await createBoardOnCluster(teamId, name);
    const owner = peekApi()?.accountId;
    const board: Project = { contextId, groupId: teamId, name, ...(owner ? { owner } : {}), description: "", isPublic: true };
    if (current.current === teamId) setBoards((prev) => [...prev, board]);
    return board;
  }, [teamId]);

  const deleteBoard = useCallback(async (board: Project) => {
    await deleteBoardOnCluster(board.contextId);
    // Remove the card only once the delete went through: dropping it on a
    // refusal hid the failure until the next reload brought the board back.
    setBoards((prev) => prev.filter((p) => p.contextId !== board.contextId));
  }, []);

  const renameBoard = useCallback(async (board: Project, rawName: string) => {
    const name = rawName.trim();
    if (!name || name === board.name) return;
    await renameBoardOnCluster(board.contextId, name);
    setBoards((prev) => prev.map((p) => (p.contextId === board.contextId ? { ...p, name } : p)));
  }, []);

  return useMemo(
    () => ({ boards, listedFor, reload, createBoard, deleteBoard, renameBoard }),
    [boards, listedFor, reload, createBoard, deleteBoard, renameBoard],
  );
}
