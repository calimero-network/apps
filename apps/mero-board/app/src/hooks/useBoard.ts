import { useCallback, useMemo, useState } from 'react';
import type { BoardDetail, CardView } from '../generated/BoardClient';
import { useBoardClient } from './useBoardClient';
import { useLiveRead, type LiveRead } from './useLiveRead';
import { byRank, rankAfter } from '../utils/rank';
import { groupCards } from '../utils/dragPlan';
import type { Workspace } from './useBoards';

export { groupCards };

export interface UseBoardReturn extends Omit<LiveRead<BoardDetail>, 'data' | 'patch'> {
  detail: BoardDetail | null;
  ready: boolean;
  /**
   * EVERY card grouped by list id (archived ones included), each group sorted
   * by rank, plus the `UNSORTED` bucket for cards with no live list. Use it for
   * rank neighbours; filter with `isShown` for display.
   */
  cardsByList: Map<string, CardView[]>;
  /** Whether archived cards are drawn on the board. */
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  /** Whether a card is drawn under the current `showArchived`. */
  isShown: (card: CardView) => boolean;
  createList: (name: string) => Promise<string | null>;
  renameList: (listId: string, name: string) => Promise<void>;
  /** Optimistic: the column moves on screen before the node answers. */
  moveList: (listId: string, rank: string) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  createCard: (listId: string, title: string) => Promise<string | null>;
  /** Optimistic: the card moves on screen before the node answers. */
  moveCard: (cardId: string, listId: string, rank: string) => Promise<void>;
}

export function useBoard(ws: Workspace, boardId: string | null): UseBoardReturn {
  const client = useBoardClient(ws.contextId, ws.executorPublicKey);
  const read = useMemo(
    () => (client && boardId ? () => client.getBoard({ board_id: boardId }) : null),
    [client, boardId],
  );
  const live = useLiveRead<BoardDetail>(ws.contextId, read);
  const { refresh: refreshLive, patch: patchLive } = live;
  const detail = live.data;
  const cardsByList = useMemo(() => groupCards(detail?.lists ?? [], detail?.cards ?? []), [detail]);
  const [showArchived, setShowArchived] = useState(false);
  const isShown = useCallback((c: CardView) => !c.archived || showArchived, [showArchived]);

  const after = useCallback(async (p: Promise<unknown>) => { await p; await refreshLive(); }, [refreshLive]);

  const createList = useCallback(async (name: string) => {
    if (!client || !boardId) return null;
    const lists = detail?.lists ?? [];
    const rank = rankAfter(lists.length ? lists[lists.length - 1].rank : null);
    const id = await client.createList({ board_id: boardId, name, rank });
    await refreshLive();
    return id;
  }, [client, boardId, detail, refreshLive]);

  const createCard = useCallback(async (listId: string, title: string) => {
    if (!client || !boardId) return null;
    // `rank: null`: the contract appends after every card in the list,
    // archived ones included, so the new rank never collides with a hidden one.
    const id = await client.createCard({
      board_id: boardId, list_id: listId, title, description: null, assignee: null, due_at: null, labels: [], rank: null,
    });
    await refreshLive();
    return id;
  }, [client, boardId, refreshLive]);

  const moveCard = useCallback(async (cardId: string, listId: string, rank: string) => {
    if (!client) return;
    patchLive((prev) => prev && {
      ...prev,
      cards: prev.cards.map((c) => (c.id === cardId ? { ...c, list_id: listId, rank } : c)),
    });
    try {
      await client.moveCard({ card_id: cardId, list_id: listId, rank });
    } finally {
      await refreshLive();
    }
  }, [client, patchLive, refreshLive]);

  const moveList = useCallback(async (listId: string, rank: string) => {
    if (!client) return;
    patchLive((prev) => prev && {
      ...prev,
      lists: prev.lists.map((l) => (l.id === listId ? { ...l, rank } : l)).sort(byRank),
    });
    try {
      await client.moveList({ list_id: listId, rank });
    } finally {
      await refreshLive();
    }
  }, [client, patchLive, refreshLive]);

  return {
    detail,
    cardsByList,
    showArchived,
    setShowArchived,
    isShown,
    loading: live.loading,
    error: live.error,
    warmingUp: live.warmingUp,
    refresh: live.refresh,
    ready: client !== null,
    createList,
    renameList: useCallback((list_id: string, name: string) => after(client!.renameList({ list_id, name })), [client, after]),
    moveList,
    deleteList: useCallback((list_id: string) => after(client!.deleteList({ list_id })), [client, after]),
    createCard,
    moveCard,
  };
}
