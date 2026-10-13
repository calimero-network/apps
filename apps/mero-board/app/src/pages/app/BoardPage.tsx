import React, { useCallback, useState } from 'react';
import styled from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, closestCorners, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useToast } from '@calimero-network/mero-ui';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useBoard } from '../../hooks/useBoard';
import { planCardDrop } from '../../utils/dragPlan';
import { describeError } from '../../utils/errors';
import ListColumn from '../../components/ListColumn';
import { CardDragPreview } from '../../components/CardTile';
import InlineForm from '../../components/InlineForm';
import CardModal from '../../components/CardModal';
import { useAppCtx } from './appContext';

/** One board: lists as columns, cards sortable within and across them. */
export default function BoardPage(): React.ReactElement {
  const { boardId = null, cardId = null } = useParams();
  const { ws, aliases, currentUser, members } = useAppCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const board = useBoard({ contextId: ws.contextId, executorPublicKey: ws.executorPublicKey }, boardId);
  const [addingList, setAddingList] = useState(false);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = useCallback((e: DragStartEvent) => setActiveCard(String(e.active.id)), []);
  const onDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveCard(null);
    if (!e.over) return;
    try {
      // Inside the try: rankFor throws if two neighbours share a rank.
      const plan = planCardDrop(board.cardsByList, String(e.active.id), String(e.over.id));
      if (!plan) return;
      await board.moveCard(String(e.active.id), plan.listId, plan.rank);
    } catch (err) {
      toast.show({ variant: 'error', description: describeError(err) });
    }
  }, [board, toast]);

  const detail = board.detail;
  const dragged = activeCard ? detail?.cards.find((c) => c.id === activeCard) ?? null : null;

  return (
    <Wrap data-testid="board-page">
      <Bar>
        <button className="back" data-testid="action-back" onClick={() => navigate(APP_ROUTE)}>← Boards</button>
        <h1 data-testid="board-name">{detail?.board.name ?? ''}</h1>
        {board.warmingUp && <span className="muted">syncing…</span>}
        {board.error && <span className="err">{describeError(board.error)}</span>}
      </Bar>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <Lists>
          {detail?.lists.map((l) => (
            <ListColumn
              key={l.id}
              list={l}
              cards={board.cardsByList.get(l.id) ?? []}
              aliases={aliases}
              onOpenCard={(id) => navigate(`${APP_ROUTE}/b/${boardId}/c/${id}`)}
              onCreateCard={(title) => board.createCard(l.id, title)}
              onRename={(name) => board.renameList(l.id, name)}
              onDelete={() => board.deleteList(l.id)}
            />
          ))}
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
          onClose={() => navigate(`${APP_ROUTE}/b/${boardId}`)}
          onChanged={board.refresh}
        />
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; flex: 1; min-height: 0;`;
const Bar = styled.div`
  display: flex; align-items: center; gap: 14px; padding: 14px 20px 6px;
  .back { background: transparent; border: 0; color: ${t.color.text2}; cursor: pointer; font-size: 13px; padding: 0; }
  h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -0.02em; }
  .muted { font-size: 12px; color: ${t.color.text3}; }
  .err { font-size: 12px; color: ${t.color.danger}; }
`;
const Lists = styled.div`
  display: flex; gap: 12px; padding: 12px 20px 30px; overflow-x: auto; flex: 1; align-items: flex-start; min-height: 0;
`;
const NewList = styled.div`
  flex: 0 0 272px; padding: 10px; border-radius: 10px; border: 1px dashed ${t.color.border};
  button { background: transparent; border: 0; color: ${t.color.text2}; cursor: pointer; font-size: 13px; width: 100%; text-align: left; }
`;
