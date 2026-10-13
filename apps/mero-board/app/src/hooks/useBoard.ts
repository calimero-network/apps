import { useCallback, useMemo } from 'react';
import type { BoardDetail, CardView, ListView } from '../generated/BoardClient';
import { useBoardClient } from './useBoardClient';
import { useLiveRead, type LiveRead } from './useLiveRead';
import { byRank, rankAfter } from '../utils/rank';
import type { Workspace } from './useBoards';

export interface UseBoardReturn extends Omit<LiveRead<BoardDetail>, 'data' | 'patch'> {
  detail: BoardDetail | null;
  ready: boolean;
  /** Cards grouped by list id, each group sorted by rank. */
  cardsByList: Map<string, CardView[]>;
  createList: (name: string) => Promise<string | null>;
  renameList: (listId: string, name: string) => Promise<void>;
  moveList: (listId: string, rank: string) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  createCard: (listId: string, title: string) => Promise<string | null>;
  /** Optimistic: the card moves on screen before the node answers. */
  moveCard: (cardId: string, listId: string, rank: string) => Promise<void>;
}

export function groupCards(lists: ListView[], cards: CardView[]): Map<string, CardView[]> {
  const out = new Map<string, CardView[]>(lists.map((l) => [l.id, []]));
  for (const c of [...cards].sort(byRank)) {
    const bucket = out.get(c.list_id);
    if (bucket) bucket.push(c);
  }
  return out;
}

export function useBoard(ws: Workspace, boardId: string | null): UseBoardReturn {
  const client = useBoardClient(ws.contextId, ws.executorPublicKey);
  const read = useMemo(
    () => (client && boardId ? () => client.getBoard({ board_id: boardId }) : null),
    [client, boardId],
  );
  const live = useLiveRead<BoardDetail>(ws.contextId, read);
  const detail = live.data;
  const cardsByList = useMemo(() => groupCards(detail?.lists ?? [], detail?.cards ?? []), [detail]);

  const after = useCallback(async (p: Promise<unknown>) => { await p; await live.refresh(); }, [live]);

  const createList = useCallback(async (name: string) => {
    if (!client || !boardId) return null;
    const lists = detail?.lists ?? [];
    const rank = rankAfter(lists.length ? lists[lists.length - 1].rank : null);
    const id = await client.createList({ board_id: boardId, name, rank });
    await live.refresh();
    return id;
  }, [client, boardId, detail, live]);

  const createCard = useCallback(async (listId: string, title: string) => {
    if (!client || !boardId) return null;
    const siblings = cardsByList.get(listId) ?? [];
    const rank = rankAfter(siblings.length ? siblings[siblings.length - 1].rank : null);
    const id = await client.createCard({
      board_id: boardId, list_id: listId, title, description: null, assignee: null, due_at: null, labels: [], rank,
    });
    await live.refresh();
    return id;
  }, [client, boardId, cardsByList, live]);

  const moveCard = useCallback(async (cardId: string, listId: string, rank: string) => {
    if (!client) return;
    live.patch((prev) => prev && {
      ...prev,
      cards: prev.cards.map((c) => (c.id === cardId ? { ...c, list_id: listId, rank } : c)),
    });
    try {
      await client.moveCard({ card_id: cardId, list_id: listId, rank });
    } finally {
      await live.refresh();
    }
  }, [client, live]);

  return {
    detail,
    cardsByList,
    loading: live.loading,
    error: live.error,
    warmingUp: live.warmingUp,
    refresh: live.refresh,
    ready: client !== null,
    createList,
    renameList: useCallback((list_id: string, name: string) => after(client!.renameList({ list_id, name })), [client, after]),
    moveList: useCallback((list_id: string, rank: string) => after(client!.moveList({ list_id, rank })), [client, after]),
    deleteList: useCallback((list_id: string) => after(client!.deleteList({ list_id })), [client, after]),
    createCard,
    moveCard,
  };
}
