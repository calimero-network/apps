import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRank } from './position.ts';

const cards = [
  { id: 'a', list_id: 'todo', rank: 'i' },
  { id: 'b', list_id: 'todo', rank: 'r' },
  { id: 'd', list_id: 'doing', rank: 'i' },
];

test('bottom appends after the last card in the list', () => {
  assert.ok(resolveRank(cards, 'todo', 'bottom') > 'r');
});
test('top goes before the first card in the list', () => {
  assert.ok(resolveRank(cards, 'todo', 'top') < 'i');
});
test('after:<id> goes between that card and the next', () => {
  const r = resolveRank(cards, 'todo', 'after:a');
  assert.ok(r > 'i' && r < 'r');
});
test('the moving card is ignored as a neighbour', () => {
  assert.ok(resolveRank(cards, 'todo', 'bottom', 'b') > 'i');
  assert.equal(resolveRank(cards, 'doing', 'bottom', 'd'), 'i');
});
test('after:<id> outside the list throws', () => {
  assert.throws(() => resolveRank(cards, 'todo', 'after:d'), /not in list/);
  assert.throws(() => resolveRank(cards, 'todo', 'after:nope'), /not in list/);
});
test('an empty list gives the first rank', () => {
  assert.equal(resolveRank(cards, 'empty', 'bottom'), 'i');
});
test('get_board includes archived cards, so a rank never lands on a hidden neighbour', () => {
  // h is archived and sits between the visible a and b; get_board returns it.
  const withArchived = [
    { id: 'a', list_id: 'todo', rank: 'i' },
    { id: 'h', list_id: 'todo', rank: 'n', archived: true },
    { id: 'b', list_id: 'todo', rank: 'r' },
  ];
  const r = resolveRank(withArchived, 'todo', 'after:a');
  assert.ok(r > 'i' && r < 'n', r);
  assert.ok(resolveRank(withArchived, 'todo', 'after:h') > 'n');
});
