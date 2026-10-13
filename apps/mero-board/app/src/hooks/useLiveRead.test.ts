import { describe, expect, it, vi } from 'vitest';
import { coalesceReads, generationRunner } from './useLiveRead';

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

describe('generationRunner', () => {
  const sink = () => ({ start: vi.fn(), data: vi.fn(), error: vi.fn(), settle: vi.fn() });

  it('drops a result whose generation went stale while it was in flight', async () => {
    let generation = 1;
    let resolveOld: (v: string) => void = () => {};
    const oldSink = sink();
    const oldRun = generationRunner<string>(
      () => () => new Promise<string>((r) => { resolveOld = r; }),
      () => generation === 1,
      oldSink,
    );
    const newSink = sink();
    const newRun = generationRunner<string>(() => async () => 'new', () => generation === 2, newSink);

    const inFlight = oldRun();
    generation = 2;
    await newRun();
    resolveOld('old');
    await inFlight;

    expect(newSink.data).toHaveBeenCalledWith('new');
    expect(oldSink.data).not.toHaveBeenCalled();
    expect(oldSink.settle).not.toHaveBeenCalled();
  });

  it('drops a stale failure too', async () => {
    let current = true;
    const s = sink();
    const run = generationRunner<string>(() => async () => { current = false; throw new Error('boom'); }, () => current, s);
    await run();
    expect(s.error).not.toHaveBeenCalled();
  });

  it('delivers a current result', async () => {
    const s = sink();
    await generationRunner<number>(() => async () => 7, () => true, s)();
    expect(s.start).toHaveBeenCalled();
    expect(s.data).toHaveBeenCalledWith(7);
    expect(s.settle).toHaveBeenCalled();
  });
});
