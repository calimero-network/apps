import { describe, expect, it } from 'vitest';

import { contextRows } from './defaultContextService';

// ── The shape that broke every private-context call ────────────────────────
//
// ⚠️ `getContexts()` resolves to `{contexts: [...]}`, NOT an array, and the
// rows are keyed `id`, not `contextId`. `ensureDefaultContext` did
//
//     for (const context of contexts)   // contexts = {contexts: [...]}
//
// which throws `contexts is not iterable` on the first iteration, straight
// into the outer catch — so it returned `{success: false}` EVERY time and the
// private context was never found. Reported as, on three separate screens:
//
//     Default context not found. Please ensure you are connected to Calimero
//     and have a default context initialized.
//
// Measured against merod 0.11.0-rc.41: `typeof res = object`, `isArray =
// false`, `keys = ["contexts"]`, `row.contextId = undefined`, `row.id =
// "10cabd89…"`.

const ROW = {
  id: '10cabd899593e028039cfa55a427491467aa8dd00cd613d8fc7f4cd22a9809be',
  applicationId:
    '93827bc46ed927df64bc0c6b086b1dbccf8dd3250ed7ca44e385df50b406b1cf',
  contextStateHash: 'e1cf14d2',
};

describe('contextRows', () => {
  it('unwraps the {contexts} envelope the node actually sends', () => {
    const rows = contextRows({ contexts: [ROW] });
    expect(rows).toHaveLength(1);
    expect(rows[0].contextId).toBe(ROW.id);
    expect(rows[0].applicationId).toBe(ROW.applicationId);
  });

  it('reads `id`, which is the key the row really has', () => {
    // `contextId` is undefined on every row. Looking it up by that name is
    // how each candidate was checked against nothing.
    expect(contextRows({ contexts: [ROW] })[0].contextId).toBe(ROW.id);
  });

  it('still accepts a bare array, and the `contextId` spelling', () => {
    // This listing has had both shapes across releases; neither is worth
    // failing on.
    const rows = contextRows([{ contextId: 'abc', applicationId: 'app' }]);
    expect(rows[0].contextId).toBe('abc');
  });

  it('returns an empty list rather than throwing, for anything else', () => {
    // The old code threw here. An empty list is a state the caller already
    // handles — it creates the context.
    for (const junk of [null, undefined, 42, 'nope', {}, { contexts: null }]) {
      expect(contextRows(junk)).toEqual([]);
    }
  });

  it('drops rows with no id rather than carrying an empty one forward', () => {
    expect(contextRows({ contexts: [{ applicationId: 'app' }, ROW] })).toEqual([
      { contextId: ROW.id, applicationId: ROW.applicationId },
    ]);
  });
});
