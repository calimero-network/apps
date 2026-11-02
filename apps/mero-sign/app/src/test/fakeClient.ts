import { vi, type Mock } from 'vitest';
import type { Conn } from '../lib/conn';

/** The contract's answers by method, for a fake client. */
export type Answers = Record<string, unknown | ((args: Record<string, unknown>, app: string) => unknown)>;

/**
 * A `CalimeroClient` double: `call`/`view`/`callConfirmed` answer from
 * `answers` by method name; every other method is a `vi.fn` the test sets.
 */
/** The connection, and its client's methods as mocks (`fake`). */
export type FakeConn = Conn & { fake: Record<string, Mock> };

export function fakeConn(answers: Answers = {}, extra: Record<string, unknown> = {}): FakeConn {
  const answer = (app: string, method: string, args: unknown = {}) => {
    const a = answers[method];
    const result = typeof a === 'function' ? (a as (x: Record<string, unknown>, app: string) => unknown)(args as Record<string, unknown>, app) : a;
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({ index: 1, result: result ?? null, events: [] });
  };
  const client = {
    call: vi.fn(answer),
    view: vi.fn(answer),
    callConfirmed: vi.fn((app: string, method: string, args: unknown) => answer(app, method, args)),
    listApps: vi.fn().mockResolvedValue([]),
    createApp: vi.fn().mockResolvedValue('app-new'),
    createOrg: vi.fn().mockResolvedValue('org-new'),
    setOrgMetadata: vi.fn().mockResolvedValue(undefined),
    getOrg: vi.fn().mockResolvedValue({ name: '', members: {}, memberMetadata: {}, metadata: null }),
    getApp: vi.fn().mockResolvedValue({ org: null }),
    me: vi.fn().mockResolvedValue({ orgs: [] }),
    invite: vi.fn().mockResolvedValue('tok-1'),
    redeemInvite: vi.fn().mockResolvedValue({ org: 'org-1' }),
    uploadBlob: vi.fn().mockResolvedValue({ blobId: 'b58', id: 'ab'.repeat(32), size: 3 }),
    downloadBlob: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    setMemberMetadata: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
  return {
    fake: client as Record<string, Mock>,
    client: client as never,
    accountId: 'acct-me',
    target: { kind: 'local', nodes: ['http://127.0.0.1:2501'] } as never,
    source: 'bundle-hash',
    passkey: () => ({}) as never,
    after: vi.fn(),
  };
}
