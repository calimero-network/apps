import { describe, expect, it, vi } from 'vitest';
import { fetchWhileSyncing } from './fetchWhileSyncing';

const fast = { windowMs: 1_000, firstDelayMs: 10, maxDelayMs: 40 };

describe('fetchWhileSyncing', () => {
  it('returns the first answer when it succeeds', async () => {
    const fetch = vi.fn().mockResolvedValue('bytes');
    await expect(fetchWhileSyncing(fetch, fast)).resolves.toBe('bytes');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // A node that has just restarted, or a document a peer uploaded a moment
  // ago, answers "not found" until the node has fetched the bytes from a peer.
  it('keeps asking while the node catches up, and returns once it has the bytes', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
      .mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
      .mockResolvedValue('bytes');
    await expect(fetchWhileSyncing(fetch, fast)).resolves.toBe('bytes');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('gives up with the last error once the window has passed', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('HTTP 404 Not Found'));
    await expect(
      fetchWhileSyncing(fetch, {
        windowMs: 60,
        firstDelayMs: 10,
        maxDelayMs: 20,
      }),
    ).rejects.toThrow('HTTP 404 Not Found');
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
  });

  it('stops at once when the caller is no longer waiting', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('HTTP 404 Not Found'));
    let stop = false;
    const done = fetchWhileSyncing(fetch, { ...fast, cancelled: () => stop });
    stop = true;
    await expect(done).rejects.toThrow('HTTP 404 Not Found');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error marked permanent', async () => {
    const permanent = Object.assign(new Error('no blob id'), {
      permanent: true,
    });
    const fetch = vi.fn().mockRejectedValue(permanent);
    await expect(fetchWhileSyncing(fetch, fast)).rejects.toBe(permanent);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
