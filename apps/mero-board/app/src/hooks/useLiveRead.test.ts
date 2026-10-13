import { describe, expect, it, vi } from 'vitest';
import { coalesceReads } from './useLiveRead';

describe('coalesceReads', () => {
  it('runs one read at a time and re-runs once if asked while busy', async () => {
    let resolveFirst: () => void = () => {};
    const read = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }))
      .mockResolvedValue(undefined);
    const run = coalesceReads(read);
    const first = run();
    void run();
    void run();
    expect(read).toHaveBeenCalledTimes(1);
    resolveFirst();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(read).toHaveBeenCalledTimes(2);
  });
});
