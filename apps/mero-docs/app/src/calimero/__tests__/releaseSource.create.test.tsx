import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type {
  CalimeroClient,
  CalimeroSession,
} from '@calimero-network/mero-js';
import {
  SessionStore,
  resolveTarget,
  type ConnectEnv,
} from '@calimero-apps/connect';
import { SessionProvider, APP, type SessionDeps } from '../session';
import { CalimeroProvider, useLive } from '../react';

const ENV: ConnectEnv = { DEV: true };
const SESSION: CalimeroSession = {
  accountId: 'acct',
  sessionToken: 's',
  refreshToken: 'r',
  expiresAt: 9e12,
};
const ORG = {
  orgId: 'org-1',
  name: 'W',
  members: { acct: 'owner' },
  teams: {},
  defaultCapabilities: 0,
  capabilities: {},
  metadata: {},
  memberMetadata: {},
  mode: null,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('creating the registry instance', () => {
  it('uses the release the newest read resolved', async () => {
    new SessionStore(APP, resolveTarget(ENV), localStorage).save(SESSION);
    const create = vi.fn(async (_input: unknown) => ({ appId: 'app-1' }));
    let session: CalimeroSession | undefined;
    const client = {
      nodeUrl: 'http://127.0.0.1:2501',
      get session() {
        return session;
      },
      useSession: (s: CalimeroSession) => {
        session = s;
      },
      signOut: async () => {
        session = undefined;
      },
      verification: () => undefined,
      verify: () => new Promise(() => {}),
      packages: { get: async () => ({ latest: '2.0.0' }) },
      orgs: { get: async () => ORG, metadata: async () => ({}) },
      apps: { create },
    } as unknown as CalimeroClient;
    const deps: SessionDeps = {
      env: ENV,
      makeClient: async () => client,
      passkey: () => ({}) as never,
      storage: localStorage,
    };
    let admin: ReturnType<typeof useLive> = null;
    function Probe() {
      admin = useLive();
      return null;
    }
    render(
      <SessionProvider deps={deps}>
        <CalimeroProvider>
          <Probe />
        </CalimeroProvider>
      </SessionProvider>,
    );
    await waitFor(() => expect(admin).not.toBeNull());
    await waitFor(async () => {
      await admin!.admin.org('org-1');
      await admin!.admin.createContext({ groupId: 'org-1', name: 'Registry' });
      expect(create.mock.lastCall?.[0]).toMatchObject({
        package: 'com.calimero.mero-drive-docs',
        version: '2.0.0',
      });
    });
  });
});
