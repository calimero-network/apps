import { describe, expect, it } from 'vitest';
import { planCardDrop } from './dragPlan';
import type { CardView } from '../generated/BoardClient';

const card = (id: string, list_id: string, rank: string): CardView => ({
  id, board_id: 'b', list_id, rank, title: id, description: '', assignee: null, due_at: null,
  archived: false, labels: [], checklist_done: 0, checklist_total: 0, created_by: 'me', created_at: 0,
});

const byList = new Map<string, CardView[]>([
  ['todo', [card('a', 'todo', 'i'), card('b', 'todo', 'r'), card('c', 'todo', 'v')]],
  ['doing', [card('d', 'doing', 'i')]],
  ['empty', []],
]);

describe('planCardDrop', () => {
  it('dropping on an empty list appends there', () => {
    expect(planCardDrop(byList, 'a', 'empty')).toEqual({ listId: 'empty', rank: 'i' });
  });
  it('dropping on a list id lands at its end', () => {
    const p = planCardDrop(byList, 'a', 'doing')!;
    expect(p.listId).toBe('doing');
    expect(p.rank > 'i').toBe(true);
  });
  it('dropping on a later card in the same list goes after it', () => {
    const p = planCardDrop(byList, 'a', 'c')!;
    expect(p.listId).toBe('todo');
    expect(p.rank > 'v').toBe(true);
  });
  it('dropping on an earlier card in the same list goes before it', () => {
    const p = planCardDrop(byList, 'c', 'a')!;
    expect(p.listId).toBe('todo');
    expect(p.rank < 'i').toBe(true);
  });
  it('dropping on a card in another list goes before that card', () => {
    const p = planCardDrop(byList, 'a', 'd')!;
    expect(p.listId).toBe('doing');
    expect(p.rank < 'i').toBe(true);
  });
  it('dropping on itself or an unknown target is a no-op', () => {
    expect(planCardDrop(byList, 'a', 'a')).toBeNull();
    expect(planCardDrop(byList, 'a', 'nope')).toBeNull();
  });
});
