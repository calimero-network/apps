import { rankFor, byRank } from './rank.ts';

export type Position = 'top' | 'bottom' | `after:${string}`;

export interface Ranked {
  id: string;
  list_id: string;
  rank: string;
}

/** The rank for placing a card in `listId` at `position`, ignoring `movingId`. */
export function resolveRank(cards: Ranked[], listId: string, position: Position, movingId?: string): string {
  const siblings = cards.filter((c) => c.list_id === listId && c.id !== movingId).sort(byRank);
  if (position === 'top') return rankFor(siblings, 0);
  if (position === 'bottom') return rankFor(siblings, siblings.length);
  const afterId = position.slice('after:'.length);
  const idx = siblings.findIndex((c) => c.id === afterId);
  if (idx < 0) throw new Error(`card ${afterId} is not in list ${listId}`);
  return rankFor(siblings, idx + 1);
}

export const positionSchemaDescription =
  "Where to place it: 'top', 'bottom', or 'after:<card id>' (a card already in the target list).";
