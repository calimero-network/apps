import { describe, expect, it } from 'vitest';
import { settleInPool } from '../pool';

describe('settleInPool', () => {
  it('never runs more than the limit at once, and runs every item', async () => {
    let running = 0;
    let peak = 0;
    const results = await settleInPool(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      4,
      async (n) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, n % 3));
        running--;
        return n * 2;
      },
    );
    expect(peak).toBe(4);
    expect(results.map((r) => r.status === 'fulfilled' && r.value)).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16, 18, 20,
    ]);
  });

  it('keeps every failure in input order and carries on past it', async () => {
    const boom = new Error('boom');
    const results = await settleInPool(['a', 'b', 'c'], 2, async (s) => {
      if (s === 'a') throw boom;
      return s;
    });
    expect(results).toEqual([
      { status: 'rejected', reason: boom },
      { status: 'fulfilled', value: 'b' },
      { status: 'fulfilled', value: 'c' },
    ]);
  });

  it('settles at once for no items', async () => {
    expect(await settleInPool([], 4, async () => 1)).toEqual([]);
  });
});
