/**
 * The admin writes behind "create a workspace" and "add a repo".
 *
 * What is pinned: every call goes to the admin client the function is GIVEN
 * (the session's `useMero().admin`), nothing is reached for anywhere else, and
 * the one node-only call (`createContextAlias`) is skipped - not attempted and
 * swallowed - on a delegated session. On prod an account's raw-client
 * `createNamespace`, `setGroupMetadata`, `setDefaultCapabilities`,
 * `createContext` and `setContextMetadata` all answered 403; the account
 * admin is what makes them governance ops instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { MEMBER_CAPABILITIES } from './roles';
import {
  createWorkspaceContext,
  foundWorkspace,
  publishContextName,
  type ContextAdmin,
  type FoundAdmin,
} from './workspaceOps';

const NS = 'ab'.repeat(32);
const CTX = 'cd'.repeat(32);

function fakeFoundAdmin(createResult: unknown = { namespaceId: NS }) {
  const createNamespace = vi.fn(async () => createResult as never);
  const setGroupMetadata = vi.fn(async () => undefined);
  const setDefaultCapabilities = vi.fn(async () => undefined);
  const admin = { createNamespace, setGroupMetadata, setDefaultCapabilities } as unknown as FoundAdmin;
  return { admin, createNamespace, setGroupMetadata, setDefaultCapabilities };
}

function fakeContextAdmin() {
  const createContext = vi.fn(async () => ({ contextId: CTX, memberPublicKey: '' }) as never);
  const setContextMetadata = vi.fn(async () => undefined);
  const createContextAlias = vi.fn(async () => undefined);
  const admin = { createContext, setContextMetadata, createContextAlias } as unknown as ContextAdmin;
  return { admin, createContext, setContextMetadata, createContextAlias };
}

describe('foundWorkspace', () => {
  it('creates, names and sets the member baseline through the admin it is given', async () => {
    const { admin, createNamespace, setGroupMetadata, setDefaultCapabilities } = fakeFoundAdmin();
    const res = await foundWorkspace(admin, { applicationId: 'app-1', name: 'Platform team' });
    expect(res).toEqual({ namespaceId: NS, haError: null });
    expect(createNamespace).toHaveBeenCalledWith({ applicationId: 'app-1', name: 'Platform team' });
    expect(setGroupMetadata).toHaveBeenCalledWith(NS, { name: 'Platform team' });
    expect(setDefaultCapabilities).toHaveBeenCalledWith(NS, { defaultCapabilities: MEMBER_CAPABILITIES });
  });

  it("surfaces the account admin's haError when the namespace is not hosted", async () => {
    // What the account admin answers for an account not linked to a cloud user:
    // the namespace exists, but no fleet node was admitted for it.
    const notLinked = 'link this account to your cloud user in the wallet so invitees can find this namespace';
    const { admin } = fakeFoundAdmin({ namespaceId: NS, haEnabled: false, haError: notLinked });
    const res = await foundWorkspace(admin, { applicationId: 'app-1', name: 'Platform team' });
    expect(res).toEqual({ namespaceId: NS, haError: notLinked });
  });

  it('reads a hosted founding as no notice', async () => {
    const { admin } = fakeFoundAdmin({ namespaceId: NS, haEnabled: true });
    expect((await foundWorkspace(admin, { applicationId: 'a', name: 'n' })).haError).toBeNull();
  });

  it('keeps the created workspace when the name or baseline write is refused', async () => {
    const { admin, setGroupMetadata, setDefaultCapabilities } = fakeFoundAdmin();
    setGroupMetadata.mockRejectedValueOnce(new Error('403'));
    setDefaultCapabilities.mockRejectedValueOnce(new Error('403'));
    const res = await foundWorkspace(admin, { applicationId: 'app-1', name: 'Platform team' });
    expect(res.namespaceId).toBe(NS);
  });

  it('fails when the create call returns no id', async () => {
    const { admin } = fakeFoundAdmin({});
    await expect(foundWorkspace(admin, { applicationId: 'a', name: 'n' })).rejects.toThrow(/namespaceId/);
  });
});

describe('createWorkspaceContext', () => {
  it('creates the context with its service name through the admin it is given', async () => {
    const { admin, createContext } = fakeContextAdmin();
    const id = await createWorkspaceContext(admin, {
      applicationId: 'app-1',
      groupId: NS,
      serviceName: 'issue_tracker',
      name: 'Q3 repo',
    });
    expect(id).toBe(CTX);
    expect(createContext).toHaveBeenCalledWith({
      applicationId: 'app-1',
      groupId: NS,
      serviceName: 'issue_tracker',
      initializationParams: [],
      name: 'Q3 repo',
    });
  });
});

describe('publishContextName', () => {
  it('writes the replicated name and, on a node, the local alias', async () => {
    const { admin, setContextMetadata, createContextAlias } = fakeContextAdmin();
    await publishContextName(admin, { groupId: NS, contextId: CTX, name: 'Q3' }, { isDelegated: false });
    expect(setContextMetadata).toHaveBeenCalledWith(NS, CTX, { name: 'Q3' });
    expect(createContextAlias).toHaveBeenCalledWith({ alias: 'Q3', contextId: CTX });
  });

  it('never asks an account for an alias - a node-only call the account admin refuses by name', async () => {
    const { admin, setContextMetadata, createContextAlias } = fakeContextAdmin();
    await publishContextName(admin, { groupId: NS, contextId: CTX, name: 'Q3' }, { isDelegated: true });
    expect(setContextMetadata).toHaveBeenCalledWith(NS, CTX, { name: 'Q3' });
    expect(createContextAlias).not.toHaveBeenCalled();
  });

  it('is best-effort: a refused metadata write does not throw', async () => {
    const { admin, setContextMetadata } = fakeContextAdmin();
    setContextMetadata.mockRejectedValueOnce(new Error('403'));
    await expect(
      publishContextName(admin, { groupId: NS, contextId: CTX, name: 'Q3' }, { isDelegated: true }),
    ).resolves.toBeUndefined();
  });
});
