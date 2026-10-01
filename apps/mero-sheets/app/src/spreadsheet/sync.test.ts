import { describe, expect, it } from 'vitest';
import { syncInfoFrom, syncView } from './sync';

const status = (syncState: unknown, extra: Record<string, unknown> = {}) =>
  ({ type: 'SyncStatus', data: { syncState, failureCount: 0, ...extra } });

describe('syncInfoFrom', () => {
  it('reads the phase, failures and reason', () => {
    expect(syncInfoFrom(status({ state: 'receivingSnapshot', recordsReceived: 10, percent: 40 }))).toEqual({
      phase: { state: 'receivingSnapshot', percent: 40 }, failureCount: 0, lastError: null,
    });
    expect(syncInfoFrom(status({ state: 'backingOff', retryInSecs: 8 }, { failureCount: 2, lastError: 'No peers to sync with' })))
      .toEqual({ phase: { state: 'backingOff', retryInSecs: 8 }, failureCount: 2, lastError: 'No peers to sync with' });
  });
  it('ignores other events and unknown phases', () => {
    expect(syncInfoFrom({ type: 'StateMutation', data: {} })).toBeNull();
    expect(syncInfoFrom(status({ state: 'dancing' }))).toBeNull();
  });
});

describe('syncView', () => {
  const base = { connected: true, loaded: true, saving: false, info: null };
  it('puts being offline, loading and saving first', () => {
    expect(syncView({ ...base, connected: false }).label).toBe('Offline');
    expect(syncView({ ...base, loaded: false }).tone).toBe('busy');
    expect(syncView({ ...base, saving: true }).label).toBe('Saving…');
  });
  it('shows the sync phase', () => {
    expect(syncView(base)).toMatchObject({ label: 'Up to date', tone: 'ok' });
    expect(syncView({ ...base, info: syncInfoFrom(status({ state: 'receivingSnapshot', percent: 55 })) }).label).toBe('Syncing 55%');
    expect(syncView({ ...base, info: syncInfoFrom(status({ state: 'waitingForPeers' })) }).tone).toBe('warn');
    const back = syncView({ ...base, info: syncInfoFrom(status({ state: 'backingOff', retryInSecs: 4 }, { lastError: 'No peers to sync with' })) });
    expect(back).toMatchObject({ label: 'Retrying in 4s', tone: 'warn' });
    expect(back.detail).toContain('No peers to sync with');
  });
});
