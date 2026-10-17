import { useCallback, useMemo } from 'react';
import type { CardDetail } from '../generated/BoardClient';
import { useBoardClient } from './useBoardClient';
import { useLiveRead, type LiveRead } from './useLiveRead';
import { rankAfter } from '../utils/rank';
import type { Workspace } from './useBoards';

export interface UseCardReturn extends Omit<LiveRead<CardDetail>, 'data' | 'patch'> {
  detail: CardDetail | null;
  setTitle: (title: string) => Promise<void>;
  setDescription: (description: string) => Promise<void>;
  setAssignee: (assignee: string | null) => Promise<void>;
  setDue: (dueAt: number | null) => Promise<void>;
  setArchived: (archived: boolean) => Promise<void>;
  addLabel: (label: string) => Promise<void>;
  removeLabel: (label: string) => Promise<void>;
  addChecklistItem: (text: string) => Promise<void>;
  setItemText: (itemId: string, text: string) => Promise<void>;
  setItemDone: (itemId: string, done: boolean) => Promise<void>;
  moveItem: (itemId: string, rank: string) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  addComment: (body: string) => Promise<void>;
  editComment: (commentId: string, body: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  deleteCard: () => Promise<void>;
}

export function useCard(ws: Workspace, cardId: string | null): UseCardReturn {
  const client = useBoardClient(ws.contextId, ws.executorPublicKey);
  const read = useMemo(
    () => (client && cardId ? () => client.getCard({ card_id: cardId }) : null),
    [client, cardId],
  );
  const live = useLiveRead<CardDetail>(ws.contextId, read);
  const { refresh: refreshLive } = live;
  const detail = live.data;
  const id = cardId ?? '';
  const after = useCallback(async (p: Promise<unknown>) => { await p; await refreshLive(); }, [refreshLive]);

  const addChecklistItem = useCallback(async (text: string) => {
    if (!client) return;
    const items = detail?.checklist ?? [];
    const rank = rankAfter(items.length ? items[items.length - 1].rank : null);
    await after(client.addChecklistItem({ card_id: id, text, rank }));
  }, [client, detail, id, after]);

  return {
    detail,
    loading: live.loading,
    error: live.error,
    warmingUp: live.warmingUp,
    refresh: live.refresh,
    setTitle: useCallback((title: string) => after(client!.setCardTitle({ card_id: id, title })), [client, id, after]),
    setDescription: useCallback((description: string) => after(client!.setCardDescription({ card_id: id, description })), [client, id, after]),
    setAssignee: useCallback((assignee: string | null) => after(client!.setCardAssignee({ card_id: id, assignee })), [client, id, after]),
    setDue: useCallback((due_at: number | null) => after(client!.setCardDue({ card_id: id, due_at })), [client, id, after]),
    setArchived: useCallback((archived: boolean) => after(client!.setCardArchived({ card_id: id, archived })), [client, id, after]),
    addLabel: useCallback((label: string) => after(client!.addLabel({ card_id: id, label })), [client, id, after]),
    removeLabel: useCallback((label: string) => after(client!.removeLabel({ card_id: id, label })), [client, id, after]),
    addChecklistItem,
    setItemText: useCallback((item_id: string, text: string) => after(client!.setChecklistItemText({ item_id, text })), [client, after]),
    setItemDone: useCallback((item_id: string, done: boolean) => after(client!.setChecklistItemDone({ item_id, done })), [client, after]),
    moveItem: useCallback((item_id: string, rank: string) => after(client!.moveChecklistItem({ item_id, rank })), [client, after]),
    removeItem: useCallback((item_id: string) => after(client!.removeChecklistItem({ item_id })), [client, after]),
    addComment: useCallback((body: string) => after(client!.addComment({ card_id: id, body })), [client, id, after]),
    editComment: useCallback((comment_id: string, body: string) => after(client!.editComment({ comment_id, body })), [client, after]),
    deleteComment: useCallback((comment_id: string) => after(client!.deleteComment({ comment_id })), [client, after]),
    deleteCard: useCallback(() => client!.deleteCard({ card_id: id }).then(() => undefined), [client, id]),
  };
}
