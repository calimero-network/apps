import { useCallback, useMemo } from 'react';
import type { BoardView } from '../generated/BoardClient';
import { useBoardClient } from './useBoardClient';
import { useLiveRead, type LiveRead } from './useLiveRead';
import { rankAfter } from '../utils/rank';

export type Workspace = { contextId: string | null; executorPublicKey: string | null };

export interface UseBoardsReturn extends Omit<LiveRead<BoardView[]>, 'data' | 'patch'> {
  boards: BoardView[];
  ready: boolean;
  createBoard: (name: string) => Promise<string | null>;
  renameBoard: (boardId: string, name: string) => Promise<void>;
  archiveBoard: (boardId: string, archived: boolean) => Promise<void>;
  moveBoard: (boardId: string, rank: string) => Promise<void>;
  deleteBoard: (boardId: string) => Promise<void>;
}

export function useBoards(ws: Workspace, includeArchived = false): UseBoardsReturn {
  const client = useBoardClient(ws.contextId, ws.executorPublicKey);
  const read = useMemo(
    () => (client ? () => client.listBoards({ include_archived: includeArchived }) : null),
    [client, includeArchived],
  );
  const live = useLiveRead<BoardView[]>(ws.contextId, read);
  const boards = live.data ?? [];

  const after = useCallback(async (p: Promise<unknown>) => { await p; await live.refresh(); }, [live]);

  const createBoard = useCallback(async (name: string) => {
    if (!client) return null;
    const rank = rankAfter(boards.length ? boards[boards.length - 1].rank : null);
    const id = await client.createBoard({ name, rank });
    await live.refresh();
    return id;
  }, [client, boards, live]);

  return {
    boards,
    loading: live.loading,
    error: live.error,
    warmingUp: live.warmingUp,
    refresh: live.refresh,
    ready: client !== null,
    createBoard,
    renameBoard: useCallback((board_id: string, name: string) => after(client!.renameBoard({ board_id, name })), [client, after]),
    archiveBoard: useCallback((board_id: string, archived: boolean) => after(client!.setBoardArchived({ board_id, archived })), [client, after]),
    moveBoard: useCallback((board_id: string, rank: string) => after(client!.moveBoard({ board_id, rank })), [client, after]),
    deleteBoard: useCallback((board_id: string) => after(client!.deleteBoard({ board_id })), [client, after]),
  };
}
