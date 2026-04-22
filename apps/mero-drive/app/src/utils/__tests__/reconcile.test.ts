import { describe, it, expect } from 'vitest';
import { computeReconcileActions } from '../reconcile';

describe('reconcile', () => {
  const adminGroups = [
    { id: 'r', parent_id: null, alias: 'root' },
    { id: 'a', parent_id: 'r', alias: 'A' },
    { id: 'b', parent_id: 'r', alias: 'B' },
  ];

  it('registers folders admin has that registry lacks', () => {
    const registry = [{ id: 'a', parent_id: 'r' }];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.register).toEqual([{ id: 'b', parent_id: 'r' }]);
    expect(actions.unregister).toEqual([]);
  });

  it('unregisters folders registry has but admin does not', () => {
    const registry = [
      { id: 'a', parent_id: 'r' },
      { id: 'b', parent_id: 'r' },
      { id: 'ghost', parent_id: 'r' },
    ];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.unregister).toEqual(['ghost']);
  });

  it('moves folders whose parent changed', () => {
    const registry = [
      { id: 'a', parent_id: 'r' },
      { id: 'b', parent_id: 'a' }, // registry thinks b is under a; admin says r
    ];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.move).toEqual([{ id: 'b', new_parent_id: 'r' }]);
  });

  it('zero writes on healthy workspace', () => {
    const registry = [
      { id: 'a', parent_id: 'r' },
      { id: 'b', parent_id: 'r' },
    ];
    const actions = computeReconcileActions(adminGroups, registry, 'r');
    expect(actions.register.length + actions.unregister.length + actions.move.length).toBe(0);
  });
});
