import { describe, expect, it } from 'vitest';
import { UNSORTED, appendRank, groupCards, planCardDrop, planListDrop } from './dragPlan';
import type { CardView, ListView } from '../generated/BoardClient';

const card = (id: string, list_id: string, rank: string, archived = false): CardView => ({
  id, board_id: 'b', list_id, rank, title: id, description: '', assignee: null, due_at: null,
  archived, labels: [], checklist_done: 0, checklist_total: 0, created_by: 'me', created_at: 0,
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

const list = (id: string, rank: string): ListView => ({ id, board_id: 'b', name: id, rank });

describe('groupCards', () => {
  const lists = [list('todo', 'i'), list('doing', 'r')];
  const cards = [
    card('b', 'todo', 'r'), card('a', 'todo', 'i', true), card('o', '', 'n'),
    card('g', 'list-gone', 'i'), card('d', 'doing', 'i'),
  ];
  const grouped = groupCards(lists, cards);
  it('keeps archived cards in their list, sorted by rank', () => {
    expect(grouped.get('todo')!.map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('puts cards with no live list in the unsorted bucket, last', () => {
    expect([...grouped.keys()]).toEqual(['todo', 'doing', UNSORTED]);
    expect(grouped.get(UNSORTED)!.map((c) => c.id)).toEqual(['g', 'o']);
  });
  it('always has an unsorted bucket', () => {
    expect(groupCards(lists, []).get(UNSORTED)).toEqual([]);
  });
});

describe('planCardDrop with archived and orphan cards', () => {
  const withHidden = new Map<string, CardView[]>([
    ['todo', [card('a', 'todo', 'i'), card('h', 'todo', 'n', true), card('b', 'todo', 'r')]],
    ['doing', [card('d', 'doing', 'i'), card('x', 'doing', 'r', true)]],
    [UNSORTED, [card('o', '', 'n')]],
  ]);
  it('appending to a list goes after its archived last card', () => {
    const p = planCardDrop(withHidden, 'a', 'doing')!;
    expect(p.listId).toBe('doing');
    expect(p.rank > 'r').toBe(true);
  });
  it('rank neighbours include hidden archived cards, so a rank never equals one', () => {
    const p = planCardDrop(withHidden, 'd', 'a')!;
    expect(p.listId).toBe('todo');
    expect(p.rank < 'i').toBe(true);
    const todo = [card('z', 'todo', 'd'), ...withHidden.get('todo')!];
    const q = planCardDrop(new Map([['todo', todo]]), 'z', 'a')!;
    expect(q.rank > 'i' && q.rank < 'n').toBe(true);
  });
  it('a card dragged out of the unsorted lane lands in a real list', () => {
    expect(planCardDrop(withHidden, 'o', 'todo')).toEqual({ listId: 'todo', rank: rankAfterAll(withHidden.get('todo')!) });
    const p = planCardDrop(withHidden, 'o', 'b')!;
    expect(p.listId).toBe('todo');
    expect(p.rank > 'n' && p.rank < 'r').toBe(true);
  });
  it('nothing can be dropped into the unsorted lane', () => {
    expect(planCardDrop(withHidden, 'a', UNSORTED)).toBeNull();
    expect(planCardDrop(withHidden, 'a', 'o')).toBeNull();
  });
  it('appendRank uses every card in the target list except the moved one', () => {
    expect(appendRank(withHidden, 'doing', 'o') > 'r').toBe(true);
    expect(appendRank(withHidden, 'doing', 'x') > 'i').toBe(true);
  });
});

function rankAfterAll(cards: CardView[]): string {
  return planCardDrop(new Map([['t', cards]]), '__none__', 't')!.rank;
}

describe('planListDrop', () => {
  const lists = [list('l1', 'i'), list('l2', 'n'), list('l3', 'r')];
  it('dragging the third list onto the first puts it in front', () => {
    const rank = planListDrop(lists, 'l3', 'l1')!;
    expect(rank < 'i').toBe(true);
  });
  it('dragging the first list onto the last puts it at the end', () => {
    expect(planListDrop(lists, 'l1', 'l3')! > 'r').toBe(true);
  });
  it('dragging onto a middle list from the left goes after it', () => {
    const rank = planListDrop(lists, 'l1', 'l2')!;
    expect(rank > 'n' && rank < 'r').toBe(true);
  });
  it('dragging onto a middle list from the right goes before it', () => {
    const rank = planListDrop(lists, 'l3', 'l2')!;
    expect(rank > 'i' && rank < 'n').toBe(true);
  });
  it('a drop on itself or an unknown list is a no-op', () => {
    expect(planListDrop(lists, 'l1', 'l1')).toBeNull();
    expect(planListDrop(lists, 'l1', 'card-x')).toBeNull();
    expect(planListDrop(lists, 'nope', 'l1')).toBeNull();
  });
});
