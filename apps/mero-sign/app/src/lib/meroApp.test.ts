import { beforeEach, describe, expect, it } from 'vitest';
import type { MeroJs } from '@calimero-network/mero-js';

import { clearApplicationIdCache } from './appId';
import { PERSONAL_KIND } from './agreements';
import { meroApp } from './meroApp';
import { PACKAGE_NAME } from '../constants/config';

// ── `createContext` is the call rc.41 broke ─────────────────────────────────
//
// `CreateContextRequest.group_id` has no `Option` and no `#[serde(default)]`,
// and every admin body is `deny_unknown_fields`. The path this replaces posted
// `{applicationId, initializationParams, protocol}` — no group at all, plus a
// field core removed — so it was refused twice over and Mero Sign could not
// create an agreement on an rc.41 node at all.
//
// These assert the two things that has to mean: a group is always named, and
// the application id is the one the NODE reports for this package rather than
// one baked into the build.

interface Call {
  method: string;
  args: unknown[];
}

function fakeMero(
  over: Record<string, (...a: never[]) => unknown> = {},
  apps: unknown[] = [
    { id: 'app-real', package: PACKAGE_NAME, version: '1.0.0' },
  ],
) {
  const calls: Call[] = [];
  const rec =
    (method: string, impl?: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      const run = (over[method] ?? impl) as
        | ((...a: unknown[]) => unknown)
        | undefined;
      return Promise.resolve().then(() => (run ? run(...args) : undefined));
    };

  const admin = {
    listApplications: rec('listApplications', () => ({ apps })),
    listNamespacesForApplication: rec('listNamespacesForApplication', () => []),
    createNamespace: rec('createNamespace', () => ({ namespaceId: 'ns-mine' })),
    getGroupMetadata: rec('getGroupMetadata', () => null),
    setGroupMetadata: rec('setGroupMetadata'),
    setDefaultCapabilities: rec('setDefaultCapabilities'),
    setMemberCapabilities: rec('setMemberCapabilities'),
    getMemberCapabilities: rec('getMemberCapabilities', () => null),
    setSubgroupVisibility: rec('setSubgroupVisibility'),
    createGroupInNamespace: rec('createGroupInNamespace', () => ({
      groupId: 'sg-1',
    })),
    createContext: rec('createContext', () => ({
      contextId: 'ctx-1',
      memberPublicKey: 'pk-1',
    })),
    getContexts: rec('getContexts', () => []),
    getContextIdentitiesOwned: rec('getContextIdentitiesOwned', () => ({
      identities: [],
    })),
  };

  return {
    calls,
    mero: { admin, rpc: { execute: rec('execute') } } as unknown as MeroJs,
  };
}

const argsOf = (calls: Call[], m: string) =>
  calls.find((c) => c.method === m)?.args;
const methodsOf = (calls: Call[]) => calls.map((c) => c.method);

beforeEach(() => {
  // The resolver caches a positive answer for the page's lifetime, which is
  // the right behaviour and would otherwise leak between these tests.
  clearApplicationIdCache();
});

describe('createContext, for an agreement', () => {
  it('names a group — the binding rc.41 requires', async () => {
    const { calls, mero } = fakeMero();
    await meroApp(mero, 'ns-work').createContext(undefined, {
      context_name: 'Q3 NDA',
      is_private: false,
    });
    const req = argsOf(calls, 'createContext')?.[0] as { groupId?: string };
    expect(req.groupId).toBe('sg-1');
  });

  it('asks the NODE which application it is, rather than trusting a build-time id', async () => {
    // An ApplicationId is `hash(package, signer)` and therefore per-install. A
    // baked one names an application the node has never installed, which core
    // answers with an opaque 500 that never mentions application ids.
    const { calls, mero } = fakeMero({}, [
      { id: 'someone-else', package: 'com.example.other', version: '9.0.0' },
      { id: 'app-real', package: PACKAGE_NAME, version: '1.0.0' },
    ]);
    await meroApp(mero, 'ns-work').createContext(undefined, {
      context_name: 'Q3 NDA',
    });
    const req = argsOf(calls, 'createContext')?.[0] as {
      applicationId?: string;
    };
    expect(req.applicationId).toBe('app-real');
  });

  it('returns executorId, which the agreement row is built from', async () => {
    // `AgreementService.createAgreement` reads `contextData.executorId` into
    // `memberPublicKey`, `privateIdentity` AND `sharedIdentity`. Omitting it
    // does not throw — it produces an agreement whose every identity field is
    // undefined.
    const { mero } = fakeMero();
    const created = await meroApp(mero, 'ns-work').createContext(undefined, {
      context_name: 'Q3 NDA',
    });
    expect(created.executorId).toBe('pk-1');
    expect(created.memberPublicKey).toBe('pk-1');
    expect(created.contextId).toBe('ctx-1');
  });

  it('refuses outside a workspace, and says so in words', async () => {
    const { calls, mero } = fakeMero();
    await expect(
      meroApp(mero, null).createContext(undefined, { context_name: 'Q3 NDA' }),
    ).rejects.toThrow(/workspace/i);
    // And sends nothing: a 400 from the node would be a worse version of this.
    expect(methodsOf(calls)).not.toContain('createContext');
  });

  it('says the app is not installed rather than creating against nothing', async () => {
    const { calls, mero } = fakeMero({}, [
      { id: 'other', package: 'com.example.other', version: '1.0.0' },
    ]);
    await expect(
      meroApp(mero, 'ns-work').createContext(undefined, {
        context_name: 'Q3 NDA',
      }),
    ).rejects.toThrow(/not installed/i);
    expect(methodsOf(calls)).not.toContain('createContext');
  });
});

describe('createContext, for the private signature library', () => {
  it('puts it in the personal namespace, not the open workspace', async () => {
    // `is_private` is a flag on the CONTRACT, not an exemption from `group_id`
    // — and the group it gets must not be a workspace, which is a thing you
    // invite people into.
    const { calls, mero } = fakeMero();
    await meroApp(mero, 'ns-work').createContext(undefined, {
      context_name: 'default',
      is_private: true,
    });
    expect(argsOf(calls, 'createGroupInNamespace')?.[0]).toBe('ns-mine');
    expect(argsOf(calls, 'setGroupMetadata')).toEqual([
      'ns-mine',
      { name: 'Personal', data: { kind: PERSONAL_KIND } },
    ]);
  });

  it('never opens it', async () => {
    const { calls, mero } = fakeMero();
    await meroApp(mero, 'ns-work').createContext(undefined, {
      context_name: 'default',
      is_private: true,
    });
    expect(methodsOf(calls)).not.toContain('setSubgroupVisibility');
  });

  it('works with no workspace open at all', async () => {
    // It runs on a timer from `useDefaultContext`, which fires as soon as
    // there is a connection — long before anybody has picked a workspace.
    const { mero } = fakeMero();
    const created = await meroApp(mero, null).createContext(undefined, {
      context_name: 'default',
      is_private: true,
    });
    expect(created.contextId).toBe('ctx-1');
  });
});
