// The name a creator types has to reach the OTHER node. This file asserts the
// two halves of the path that carries it — what goes onto the invite link, and
// what goes onto the join request — at the level of the exact request body,
// because that is where every previous failure lived.
//
// ⚠️ Assertions here check the exact KEY SET, not `toHaveBeenCalledWith` on a
// subset and not `'groupName' in body`. Every core request body is
// `deny_unknown_fields`, so ONE stale key is a 400 for the whole call, and a
// containment assertion passes with a fatal key sitting beside the one it
// checked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
// vitest hoists `vi.mock` above every import, so the module under test can be
// imported here and still see the mocks below.
import {
  useCreateFolderInvite,
  useCreateNamespaceInvite,
  useJoinFolderByInvite,
  useJoinNamespaceByInvite,
  parseInviteUrl,
} from '../useNamespaceInvitation';


const joinNamespace = vi.fn();
const joinGroup = vi.fn();
const createGroupInvitation = vi.fn();
const createNamespaceInvitation = vi.fn();

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({
    mero: {
      admin: {
        joinNamespace,
        joinGroup,
        createGroupInvitation,
        createNamespaceInvitation,
      },
    },
  }),
}));

vi.mock('@/constants/config', () => ({
  PACKAGE_NAME: 'com.calimero.mero-drive-docs',
  DEEP_LINK_BASE: 'https://links.calimero.network',
}));

const INV = { inviter_signature: 'sig' } as never;

beforeEach(() => {
  joinNamespace.mockReset().mockResolvedValue({
    namespaceId: 'ns-1',
    memberIdentity: 'k',
    memberAccount: 'a',
  });
  joinGroup.mockReset().mockResolvedValue({
    groupId: 'g-1',
    memberIdentity: 'k',
    memberAccount: 'a',
  });
  createGroupInvitation.mockReset();
  createNamespaceInvitation.mockReset();
});

describe('joinNamespace request body', () => {
  it('carries groupName so the joiner node files the creator’s name', async () => {
    const { result } = renderHook(() => useJoinNamespaceByInvite());
    await act(async () => {
      await result.current.join('ns-1', INV, 'Q3 Budget');
    });
    const [id, body] = joinNamespace.mock.calls[0];
    expect(id).toBe('ns-1');
    expect(Object.keys(body).sort()).toEqual(['groupName', 'invitation']);
    expect(body.groupName).toBe('Q3 Budget');
    expect(body.invitation).toBe(INV);
  });

  // A blank name must not be sent: it is not "no opinion", it is an
  // instruction to file the empty string over a name the node may already hold.
  it('omits groupName entirely when the link carried no name', async () => {
    const { result } = renderHook(() => useJoinNamespaceByInvite());
    await act(async () => {
      await result.current.join('ns-1', INV);
    });
    const [, body] = joinNamespace.mock.calls[0];
    expect(Object.keys(body)).toEqual(['invitation']);
  });

  it('omits groupName when the name is an empty string', async () => {
    const { result } = renderHook(() => useJoinNamespaceByInvite());
    await act(async () => {
      await result.current.join('ns-1', INV, '');
    });
    const [, body] = joinNamespace.mock.calls[0];
    expect(Object.keys(body)).toEqual(['invitation']);
  });

  // core 0.11.0-rc.25 renamed this response field; reading the old spelling
  // returned `undefined` on every current node and raised nothing.
  it('reads namespaceId from the response, not the rc.24 groupId', async () => {
    const { result } = renderHook(() => useJoinNamespaceByInvite());
    let out = '';
    await act(async () => {
      out = await result.current.join('ns-1', INV, 'N');
    });
    expect(out).toBe('ns-1');
  });

  it('still reads groupId from a pre-rc.25 node', async () => {
    joinNamespace.mockResolvedValue({ groupId: 'legacy-ns' });
    const { result } = renderHook(() => useJoinNamespaceByInvite());
    let out = '';
    await act(async () => {
      out = await result.current.join('ns-1', INV);
    });
    expect(out).toBe('legacy-ns');
  });
});

describe('joinGroup request body', () => {
  it('carries groupName for a folder join too', async () => {
    const { result } = renderHook(() => useJoinFolderByInvite());
    await act(async () => {
      await result.current.join(INV, 'Design assets');
    });
    const [body] = joinGroup.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual(['groupName', 'invitation']);
    expect(body.groupName).toBe('Design assets');
  });

  it('omits groupName when there is none', async () => {
    const { result } = renderHook(() => useJoinFolderByInvite());
    await act(async () => {
      await result.current.join(INV);
    });
    expect(Object.keys(joinGroup.mock.calls[0][0])).toEqual(['invitation']);
  });
});

describe('invite links carry the target name', () => {
  it('a FOLDER invite link carries the folder name', async () => {
    createGroupInvitation.mockResolvedValue({
      invitation: INV,
      groupName: 'Q3 Budget',
    });
    const { result } = renderHook(() => useCreateFolderInvite());
    let created: { url: string; name?: string } | null = null;
    await act(async () => {
      created = await result.current.create('g-7');
    });
    const parsed = parseInviteUrl(new URL(created!.url).searchParams);
    expect('error' in parsed).toBe(false);
    expect((parsed as { targetName?: string }).targetName).toBe('Q3 Budget');
    expect(created!.name).toBe('Q3 Budget');
  });

  it('a folder invite link is still valid when the node returns no name', async () => {
    createGroupInvitation.mockResolvedValue({ invitation: INV });
    const { result } = renderHook(() => useCreateFolderInvite());
    let created: { url: string } | null = null;
    await act(async () => {
      created = await result.current.create('g-7');
    });
    const parsed = parseInviteUrl(new URL(created!.url).searchParams);
    expect('error' in parsed).toBe(false);
    expect((parsed as { targetName?: string }).targetName).toBeUndefined();
  });

  it('a NAMESPACE invite link carries the workspace name', async () => {
    createNamespaceInvitation.mockResolvedValue({
      invitation: INV,
      groupName: 'Acme Docs',
    });
    const { result } = renderHook(() => useCreateNamespaceInvite());
    let created: { url: string; name?: string } | null = null;
    await act(async () => {
      created = await result.current.create('ns-1');
    });
    const parsed = parseInviteUrl(new URL(created!.url).searchParams);
    expect((parsed as { targetName?: string }).targetName).toBe('Acme Docs');
    expect(created!.name).toBe('Acme Docs');
  });

  // The whole round trip: what the inviter's node named the group is what the
  // joiner's node is told to call it.
  it('round-trips a name from mint to join request', async () => {
    createNamespaceInvitation.mockResolvedValue({
      invitation: INV,
      groupName: 'Acme Docs',
    });
    const { result: mintResult } = renderHook(() => useCreateNamespaceInvite());
    let url = '';
    await act(async () => {
      url = (await mintResult.current.create('ns-1')).url;
    });
    const parsed = parseInviteUrl(new URL(url).searchParams);
    if ('error' in parsed) throw new Error(parsed.error);

    const { result: joinResult } = renderHook(() => useJoinNamespaceByInvite());
    await act(async () => {
      await joinResult.current.join(
        parsed.targetId,
        parsed.invitation,
        parsed.targetName,
      );
    });
    expect(joinNamespace.mock.calls[0][1].groupName).toBe('Acme Docs');
  });
});
