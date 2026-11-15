import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { CalimeroProvider, useLive } from '../react';

type Live = NonNullable<ReturnType<typeof useLive>>;

let source: string | { package: string; version?: string };
const client = {} as CalimeroClient;
const sync = () => {};
const passkey = () => ({});

vi.mock('../session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () => ({
    session: { status: 'signed-in', client, accountId: 'acct' },
    passkey,
    source,
    sync,
  }),
}));

function mount() {
  let held: Live | null = null;
  function Probe() {
    held = useLive();
    return null;
  }
  const tree = () => (
    <CalimeroProvider>
      <Probe />
    </CalimeroProvider>
  );
  const view = render(tree());
  return { live: () => held!, rerender: () => view.rerender(tree()) };
}

afterEach(cleanup);

describe('CalimeroProvider', () => {
  it('keeps the event and presence hubs when only the release the app creates from changes', () => {
    source = { package: 'network.calimero.docs' };
    const { live, rerender } = mount();
    const before = live();
    source = { package: 'network.calimero.docs', version: '2.0.0' };
    rerender();
    const after = live();
    expect(after.events).toBe(before.events);
    expect(after.presence).toBe(before.presence);
    expect(after.admin).not.toBe(before.admin);
  });
});
