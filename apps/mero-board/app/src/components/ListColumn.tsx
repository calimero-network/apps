import React, { useState } from 'react';
import styled from 'styled-components';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { CardView, ListView } from '../generated/BoardClient';
import { tokens as t } from '../theme';
import CardTile from './CardTile';
import InlineForm from './InlineForm';
import type { UseAliasesReturn } from '../hooks/useAliases';

interface Props {
  list: ListView;
  cards: CardView[];
  aliases: UseAliasesReturn;
  onOpenCard: (cardId: string) => void;
  onCreateCard: (title: string) => Promise<unknown>;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}

export default function ListColumn({ list, cards, aliases, onOpenCard, onCreateCard, onRename, onDelete }: Props): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: list.id, data: { type: 'list' } });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Col ref={setNodeRef} data-testid="item-list" data-list-id={list.id} $over={isOver}>
      <Head>
        {renaming ? (
          <InlineForm initial={list.name} placeholder="List name" submitLabel="Save" testId="list-rename"
            onSubmit={async (n) => { await onRename(n); setRenaming(false); }} onCancel={() => setRenaming(false)} />
        ) : (
          <>
            <span className="name" data-testid="list-title" onDoubleClick={() => setRenaming(true)}>{list.name}</span>
            <span className="count">{cards.length}</span>
            <details className="menu" data-testid="list-menu">
              <summary aria-label="List actions">…</summary>
              <button type="button" data-testid="list-rename" onClick={() => setRenaming(true)}>Rename</button>
              <button type="button" data-testid="list-delete" onClick={() => { setError(null); onDelete().catch((e) => setError(String(e?.message ?? e))); }}>Delete list</button>
            </details>
          </>
        )}
      </Head>
      {error && <p className="err" data-testid="list-error">{error}</p>}
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <Cards>
          {cards.map((c) => <CardTile key={c.id} card={c} aliases={aliases} onOpen={() => onOpenCard(c.id)} />)}
        </Cards>
      </SortableContext>
      {adding ? (
        <InlineForm placeholder="Card title" submitLabel="Add card" testId="card-create"
          onSubmit={async (title) => { await onCreateCard(title); }} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className="add" data-testid="card-create-btn" onClick={() => setAdding(true)}>+ Add a card</button>
      )}
    </Col>
  );
}

const Col = styled.div<{ $over: boolean }>`
  flex: 0 0 272px; display: flex; flex-direction: column; gap: 8px; padding: 10px;
  background: ${t.color.panel}; border-radius: 10px; border: 1px solid ${(p) => (p.$over ? t.color.accent : 'transparent')};
  max-height: 100%;
  .add { background: transparent; border: 0; color: ${t.color.text2}; text-align: left; padding: 6px 4px; cursor: pointer; font-size: 13px; }
  .add:hover { color: ${t.color.text}; }
  .err { margin: 0; font-size: 12px; color: ${t.color.danger}; }
`;
const Head = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 2px 4px;
  .name { font-size: 13px; font-weight: 600; flex: 1; }
  .count { font-size: 11.5px; color: ${t.color.text3}; }
  .menu summary { list-style: none; cursor: pointer; color: ${t.color.text3}; padding: 0 4px; }
  .menu { position: relative; }
  .menu[open] > button { display: block; }
  .menu button { display: none; position: relative; width: 100%; text-align: left; background: ${t.color.panel}; border: 1px solid ${t.color.border}; color: ${t.color.text}; padding: 6px 8px; font-size: 12.5px; cursor: pointer; }
`;
const Cards = styled.div`
  display: flex; flex-direction: column; gap: 8px; min-height: 24px; overflow-y: auto;
`;
