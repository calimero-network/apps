import { type AppInfo, type CalimeroClient, type CalimeroSession } from '@calimero-network/mero-js';
import { SessionStore, resolveTarget } from '@calimero-apps/connect';
import { withRoutes } from '@calimero-apps/connect/testing';
import { vi } from 'vitest';

import { LIBRARY_NAME } from '../lib/agreements';
import { migrateLegacyInvite } from '../lib/invites';
import { APP, type SessionDeps } from '../session';

/** Hold an invite stored the way an earlier build stored it: it moves into the shared store. */
export function hold(legacy: string) {
  localStorage.setItem('mero-sign:pending-invite', legacy);
  migrateLegacyInvite();
}

export const ME = 'acct-alice';
export const SESSION: CalimeroSession = {
  accountId: ME,
  sessionToken: 's',
  refreshToken: 'r',
  expiresAt: 9e12,
};
export const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: 'bundle-hash' };

export const instance = (appId: string, name: string, org: string | null): AppInfo => ({
  appId,
  name,
  owner: ME,
  org,
  bundle: 'bundle-hash',
  package: null,
  version: null,
});

export const AGREEMENT = instance('agr-1', 'Series A', 'org-1');
export const LIBRARY = instance('lib-1', LIBRARY_NAME, null);

export const DETAILS = {
  contextId: 'agr-1',
  contextName: 'Series A',
  owner: ME,
  isPrivate: false,
  participantCount: '1',
  participants: [{ userId: ME, permissionLevel: 'Admin' }],
  documentCount: '1',
  createdAt: '1700000000000',
};

export const DOC = {
  id: 'doc_1',
  name: 'Term sheet.pdf',
  hash: 'h',
  uploadedBy: ME,
  uploadedAt: '1700000000000',
  status: 'Pending',
  pdfBlobId: 'ab'.repeat(32),
  size: '2048',
  requiredSigners: [ME],
  embeddings: null,
  extractedText: null,
  chunks: null,
};

export function fakeClient() {
  let session: CalimeroSession | undefined;
  let next = 0;
  return withRoutes({
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signUp: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    me: vi.fn(async () => ({
      orgs: [{ orgId: 'org-1', name: 'Acme Legal', role: 'owner' }],
    })),
    getOrg: vi.fn(async () => ({
      name: 'Acme Legal',
      members: { [ME]: 'owner', 'acct-bob': 'member' },
    })),
    listApps: vi.fn(async () => [AGREEMENT, LIBRARY]),
    createApp: vi.fn(async () => `new-${++next}`),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result:
        method === 'listParticipants'
          ? [ME]
          : method === 'getContextDetails'
            ? DETAILS
            : method === 'listDocuments'
              ? [DOC]
              : method === 'whoami'
                ? ME
                : method === 'isDefaultPrivateContext'
                  ? true
                  : null,
    })),
    redeemInvite: vi.fn(async () => ({ org: 'org-1' })),
    createOrg: vi.fn(async () => 'org-new'),
    setCapabilities: vi.fn(async () => undefined),
    setMemberMetadata: vi.fn(async () => undefined),
  });
}

export function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => withRoutes(client)),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

/** A session an earlier visit left behind. */
export function remember() {
  const store = new SessionStore(APP, resolveTarget(DEV_ENV));
  store.sync({ session: SESSION } as unknown as CalimeroClient);
}
