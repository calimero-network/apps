import type { CardView, ListView } from '../generated/BoardClient';
import { byRank, rankFor } from './rank';

export interface DropPlan { listId: string; rank: string }

/**
 * The bucket for cards whose `list_id` names no list of the board (empty when
 * a peer removed the card's shared row, or the id of a deleted list). Its lane
 * is a drag source only: nothing can be dropped into it.
 */
export const UNSORTED = '__unsorted__';

/**
 * Every card of the board, archived ones included, grouped by list id and
 * sorted by rank. Rank neighbours come from these full groups so a new rank
 * never collides with a hidden archived card. Cards with no live list land in
 * `UNSORTED`, which is always present (possibly empty) and always last.
 */
export function groupCards(lists: ListView[], cards: CardView[]): Map<string, CardView[]> {
  const out = new Map<string, CardView[]>(lists.map((l) => [l.id, []]));
  const orphans: CardView[] = [];
  for (const c of [...cards].sort(byRank)) {
    const bucket = out.get(c.list_id);
    if (bucket) bucket.push(c);
    else orphans.push(c);
  }
  out.set(UNSORTED, orphans);
  return out;
}

/**
 * Where a dragged card lands. `overId` is whatever dnd-kit reports under the
 * pointer: a card id (insert relative to it) or a list id (append to it).
 * Within the same list, dropping on a later card goes after it and on an
 * earlier card goes before it, which is how the pointer reads. The `UNSORTED`
 * lane, and any card in it, is never a target.
 */
export function planCardDrop(cardsByList: Map<string, CardView[]>, activeId: string, overId: string): DropPlan | null {
  if (activeId === overId || overId === UNSORTED) return null;
  if (cardsByList.has(overId)) {
    const siblings = (cardsByList.get(overId) ?? []).filter((c) => c.id !== activeId);
    return { listId: overId, rank: rankFor(siblings, siblings.length) };
  }
  for (const [listId, cards] of cardsByList) {
    if (listId === UNSORTED) continue;
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

/**
 * The rank for appending a card to `listId`, computed over every card already
 * in it (archived ones included) except the card itself.
 */
export function appendRank(cardsByList: Map<string, CardView[]>, listId: string, cardId: string): string {
  const siblings = (cardsByList.get(listId) ?? []).filter((c) => c.id !== cardId);
  return rankFor(siblings, siblings.length);
}

/**
 * The new rank for a list dragged onto another list's column. `lists` must be
 * sorted by rank. Dropping on a later list goes after it, on an earlier one
 * before it. Returns null for a no-op or an unknown id.
 */
export function planListDrop(lists: ReadonlyArray<ListView>, activeId: string, overId: string): string | null {
  if (activeId === overId) return null;
  const activeIndex = lists.findIndex((l) => l.id === activeId);
  const overIndex = lists.findIndex((l) => l.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;
  const others = lists.filter((l) => l.id !== activeId);
  const overInOthers = others.findIndex((l) => l.id === overId);
  return rankFor(others, activeIndex < overIndex ? overInOthers + 1 : overInOthers);
}
