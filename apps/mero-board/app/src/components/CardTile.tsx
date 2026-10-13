import React from 'react';
import styled from 'styled-components';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CardView } from '../generated/BoardClient';
import { tokens as t } from '../theme';
import LabelChip from './LabelChip';
import AvatarGlyph from './AvatarGlyph';
import { formatDate } from '../utils/display';
import type { UseAliasesReturn } from '../hooks/useAliases';

interface Props {
  card: CardView;
  aliases: UseAliasesReturn;
  onOpen: () => void;
}

/** A card in a list column: sortable within and across lists. */
export default function CardTile({ card, aliases, onOpen }: Props): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card' } });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <Tile ref={setNodeRef} style={style} {...attributes} {...listeners}
      data-testid="item-card" data-card-id={card.id} onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}>
      <CardFace card={card} aliases={aliases} testIds />
    </Tile>
  );
}

/**
 * The card as it follows the pointer. Presentational only: a component that
 * calls useSortable must not render inside DragOverlay (it would register the
 * same id twice), and the overlay copy carries no test ids so tests never see
 * the card twice.
 */
export function CardDragPreview({ card, aliases }: { card: CardView; aliases: UseAliasesReturn }): React.ReactElement {
  return <Tile><CardFace card={card} aliases={aliases} testIds={false} /></Tile>;
}

function CardFace({ card, aliases, testIds }: { card: CardView; aliases: UseAliasesReturn; testIds: boolean }): React.ReactElement {
  const overdue = card.due_at !== null && card.due_at < Date.now();
  return (
    <>
      {card.labels.length > 0 && (
        <div className="labels">{card.labels.slice(0, 3).map((l) => <LabelChip key={l} label={l} />)}</div>
      )}
      <div className="title" data-testid={testIds ? 'card-title' : undefined}>{card.title || 'Untitled'}</div>
      <div className="meta">
        {card.due_at !== null && <span className={overdue ? 'due overdue' : 'due'}>{formatDate(card.due_at)}</span>}
        {card.checklist_total > 0 && <span className="check">{card.checklist_done}/{card.checklist_total}</span>}
        {card.assignee && (
          <AvatarGlyph
            seed={aliases.hasAlias(card.assignee) ? aliases.resolve(card.assignee) : card.assignee}
            size="sm"
            title={aliases.resolve(card.assignee)}
            keyFallback={!aliases.hasAlias(card.assignee)}
          />
        )}
      </div>
    </>
  );
}

const Tile = styled.div`
  background: ${t.color.raised}; border: 1px solid ${t.color.border}; border-radius: 8px;
  padding: 10px 11px; cursor: grab; display: flex; flex-direction: column; gap: 6px; touch-action: none;
  &:hover { border-color: ${t.color.accent}; }
  .labels { display: flex; gap: 4px; flex-wrap: wrap; }
  .title { font-size: 13.5px; line-height: 1.35; }
  .meta { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: ${t.color.text3}; min-height: 18px; }
  .meta > :last-child { margin-left: auto; }
  .overdue { color: ${t.color.danger}; }
`;
