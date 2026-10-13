import React, { useCallback, useState } from 'react';
import styled from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useBoard } from '../../hooks/useBoard';
import { useBoards } from '../../hooks/useBoards';
import { UNSORTED, appendRank, planCardDrop, planListDrop } from '../../utils/dragPlan';
import { describeError } from '../../utils/errors';
import ListColumn from '../../components/ListColumn';
import CardTile, { CardDragPreview } from '../../components/CardTile';
import InlineForm from '../../components/InlineForm';
import CardModal from '../../components/CardModal';
import BoardMenu from '../../components/BoardMenu';
import { useAppCtx } from './appContext';

/**
 * While a list is dragged only list columns are targets, so the pointer over a
 * card still resolves to that card's column. A card drag sees everything.
 */
const collision: CollisionDetection = (args) => {
  if (args.active.data.current?.type !== 'list') return closestCorners(args);
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === 'list'),
  });
};

/** One board: lists as sortable columns, cards sortable within and across them. */
export default function BoardPage(): React.ReactElement {
  const { boardId = null, cardId = null } = useParams();
  const { ws, aliases, currentUser, members } = useAppCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const wsRef = { contextId: ws.contextId, executorPublicKey: ws.executorPublicKey };
  const board = useBoard(wsRef, boardId);
  const boards = useBoards(wsRef, true);
  const [addingList, setAddingList] = useState(false);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = useCallback((e: DragStartEvent) => {
    if (e.active.data.current?.type === 'card') setActiveCard(String(e.active.id));
  }, []);
  const onDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveCard(null);
    if (!e.over) return;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    try {
      // Inside the try: rankFor throws if two neighbours share a rank.
      if (e.active.data.current?.type === 'list') {
        const rank = planListDrop(board.detail?.lists ?? [], activeId, overId);
        if (rank) await board.moveList(activeId, rank);
        return;
      }
      const plan = planCardDrop(board.cardsByList, activeId, overId);
      if (!plan) return;
      await board.moveCard(activeId, plan.listId, plan.rank);
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  }, [board, toast]);

  const detail = board.detail;
  const dragged = activeCard ? detail?.cards.find((c) => c.id === activeCard) ?? null : null;
  const shown = (listId: string) => (board.cardsByList.get(listId) ?? []).filter(board.isShown);
  const unsorted = shown(UNSORTED);
  const openCard = (id: string) => navigate(`${APP_ROUTE}/b/${boardId}/c/${id}`);

  return (
    <Wrap data-testid="board-page">
      <Bar>
        <button className="back" data-testid="action-back" onClick={() => navigate(APP_ROUTE)}>← Boards</button>
        <h1 data-testid="board-name">{detail?.board.name ?? ''}</h1>
        {detail?.board.archived && <span className="tag" data-testid="board-archived-tag">archived</span>}
        {detail && boardId && (
          <BoardMenu board={detail.board} testId="board-menu" canDelete={detail.board.created_by === currentUser}
            onRename={async (name) => { await boards.renameBoard(boardId, name); await board.refresh(); }}
            onArchive={async (archived) => { await boards.archiveBoard(boardId, archived); await board.refresh(); }}
            onDelete={async () => { await boards.deleteBoard(boardId); navigate(APP_ROUTE); }} />
        )}
        <span className="spacer" />
        <label className="toggle">
          <input type="checkbox" data-testid="toggle-archived-cards" checked={board.showArchived}
            onChange={(e) => board.setShowArchived(e.target.checked)} />
          Show archived cards
        </label>
        {board.warmingUp && <span className="muted">syncing…</span>}
        {board.error && <span className="err">{describeError(board.error)}</span>}
      </Bar>
      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <Lists>
          <SortableContext items={detail?.lists.map((l) => l.id) ?? []} strategy={horizontalListSortingStrategy}>
            {detail?.lists.map((l) => (
              <ListColumn
                key={l.id}
                list={l}
                cards={shown(l.id)}
                aliases={aliases}
                onOpenCard={openCard}
                onCreateCard={(title) => board.createCard(l.id, title)}
                onRename={(name) => board.renameList(l.id, name)}
                onDelete={() => board.deleteList(l.id)}
              />
            ))}
          </SortableContext>
          {unsorted.length > 0 && (
            <Unsorted data-testid="list-unsorted">
              <div className="head">
                <span className="name">Unsorted</span>
                <span className="count">{unsorted.length}</span>
              </div>
              <p className="hint">These cards lost their list. Drag one onto a list, or pick a list in the card.</p>
              <SortableContext items={unsorted.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <div className="cards">
                  {unsorted.map((c) => <CardTile key={c.id} card={c} aliases={aliases} onOpen={() => openCard(c.id)} />)}
                </div>
              </SortableContext>
            </Unsorted>
          )}
          <NewList>
            {addingList ? (
              <InlineForm placeholder="List name" submitLabel="Add list" testId="list-create"
                onSubmit={async (name) => { await board.createList(name); }} onCancel={() => setAddingList(false)} />
            ) : (
              <button type="button" data-testid="list-create-btn" disabled={!board.ready || !detail} onClick={() => setAddingList(true)}>+ Add a list</button>
            )}
          </NewList>
        </Lists>
        <DragOverlay>{dragged ? <CardDragPreview card={dragged} aliases={aliases} /> : null}</DragOverlay>
      </DndContext>
      {cardId && boardId && (
        <CardModal
          cardId={cardId}
          ws={ws}
          aliases={aliases}
          currentUser={currentUser}
          members={members}
          lists={detail?.lists ?? []}
          onMoveToList={(listId) => board.moveCard(cardId, listId, appendRank(board.cardsByList, listId, cardId))}
          onClose={() => navigate(`${APP_ROUTE}/b/${boardId}`)}
          onChanged={board.refresh}
        />
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; flex: 1; min-height: 0;`;
const Bar = styled.div`
  display: flex; align-items: center; gap: 14px; padding: 14px 20px 6px; flex-wrap: wrap;
  .back { background: transparent; border: 0; color: ${t.color.text2}; cursor: pointer; font-size: 13px; padding: 0; }
  h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -0.02em; }
  .tag { font-size: 11px; color: ${t.color.text3}; border: 1px solid ${t.color.border}; border-radius: 999px; padding: 1px 8px; }
  .spacer { flex: 1; }
  .toggle { font-size: 12.5px; color: ${t.color.text2}; display: flex; gap: 6px; align-items: center; }
  .muted { font-size: 12px; color: ${t.color.text3}; }
  .err { font-size: 12px; color: ${t.color.danger}; }
`;
const Lists = styled.div`
  display: flex; gap: 12px; padding: 12px 20px 30px; overflow-x: auto; flex: 1; align-items: flex-start; min-height: 0;
`;
const Unsorted = styled.div`
  flex: 0 0 272px; display: flex; flex-direction: column; gap: 8px; padding: 10px; max-height: 100%;
  border-radius: 10px; border: 1px dashed ${t.color.border}; background: transparent;
  .head { display: flex; align-items: center; gap: 8px; padding: 2px 4px; }
  .name { font-size: 13px; font-weight: 600; flex: 1; }
  .count { font-size: 11.5px; color: ${t.color.text3}; }
  .hint { margin: 0; font-size: 12px; color: ${t.color.text3}; padding: 0 4px; }
  .cards { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
`;
const NewList = styled.div`
  flex: 0 0 272px; padding: 10px; border-radius: 10px; border: 1px dashed ${t.color.border};
  button { background: transparent; border: 0; color: ${t.color.text2}; cursor: pointer; font-size: 13px; width: 100%; text-align: left; }
`;
