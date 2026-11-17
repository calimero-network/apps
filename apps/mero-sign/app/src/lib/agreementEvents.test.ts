// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { accessLost, useAgreementEvents, type AgreementEventsSession } from './agreementEvents';

/** A client whose stream yields `events`, then stays open until aborted. */
function client(events: number, opts: { fail?: unknown; index?: number } = {}) {
  const from: number[] = [];
  const session: AgreementEventsSession = {
    client: {
      apps: { view: vi.fn(async () => ({ result: '', index: opts.index ?? 7 })) },
      events: (_app: string, start = 0, signal?: AbortSignal) => {
        from.push(start);
        return (async function* () {
          if (opts.fail) throw opts.fail;
          for (let i = 0; i < events; i++) yield { kind: 'DocumentUploaded', data: {} };
          await new Promise((r) => signal?.addEventListener('abort', r));
        })();
      },
    } as unknown as AgreementEventsSession['client'],
  };
  return { session, from };
}

describe('useAgreementEvents', () => {
  it('starts after the log head and re-reads once per burst of events', async () => {
    const { session, from } = client(3);
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useAgreementEvents(session, 'ctx', onChange));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(from).toEqual([8]);
    unmount();
  });

  it('stops and says so when the node refuses the agreement', async () => {
    const { session, from } = client(0, { fail: Object.assign(new Error('no such app'), { status: 404 }) });
    const onLost = vi.fn();
    const { unmount } = renderHook(() => useAgreementEvents(session, 'ctx', vi.fn(), onLost));
    await waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(from).toHaveLength(1);
    unmount();
  });

  it('does nothing without a session or an agreement', () => {
    const { session, from } = client(1);
    renderHook(() => useAgreementEvents(session, null, vi.fn()));
    renderHook(() => useAgreementEvents(null, 'ctx', vi.fn()));
    expect(from).toEqual([]);
  });
});

describe('accessLost', () => {
  it('is a 403 or a 404 only', () => {
    expect(accessLost({ status: 403 })).toBe(true);
    expect(accessLost({ status: 404 })).toBe(true);
    expect(accessLost({ status: 500 })).toBe(false);
    expect(accessLost(new Error('offline'))).toBe(false);
    expect(accessLost(null)).toBe(false);
  });
});
