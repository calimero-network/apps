import type { CardView } from '../generated/BoardClient';
import { rankFor } from './rank';

export interface DropPlan { listId: string; rank: string }

/**
 * Where a dragged card lands. `overId` is whatever dnd-kit reports under the
 * pointer: a card id (insert relative to it) or a list id (append to it).
 * Within the same list, dropping on a later card goes after it and on an
 * earlier card goes before it, which is how the pointer reads.
 */
export function planCardDrop(cardsByList: Map<string, CardView[]>, activeId: string, overId: string): DropPlan | null {
  if (activeId === overId) return null;
  if (cardsByList.has(overId)) {
    const siblings = (cardsByList.get(overId) ?? []).filter((c) => c.id !== activeId);
    return { listId: overId, rank: rankFor(siblings, siblings.length) };
  }
  for (const [listId, cards] of cardsByList) {
    const overIndex = cards.findIndex((c) => c.id === overId);
    if (overIndex < 0) continue;
    const activeIndex = cards.findIndex((c) => c.id === activeId);
    const siblings = cards.filter((c) => c.id !== activeId);
    const overInSiblings = siblings.findIndex((c) => c.id === overId);
    const after = activeIndex >= 0 && activeIndex < overIndex;
    return { listId, rank: rankFor(siblings, after ? overInSiblings + 1 : overInSiblings) };
  }
  return null;
}
