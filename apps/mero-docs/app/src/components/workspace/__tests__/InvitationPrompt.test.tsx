import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { markNamespaceJustJoined } from '@/hooks/useDriveWorkspace';
import { InvitationPrompt } from '../InvitationPrompt';

// The prompt's decisions worth pinning: what a join's outcome does, and what
// it says. A join, or a failed request for a workspace the node now lists,
// lands the user and flags the workspace for the syncing gate; a failure no
// retry can fix says why and lets the invitation go; one that could pass keeps
// it and offers "Try again". The link is opened for real, through mero-react's
// capture, and kept-or-acked is read back from it.

const h = vi.hoisted(() => ({
  admin: {} as Record<string, (...a: unknown[]) => Promise<unknown>>,
  memberOf: [] as string[],
}));

vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    mero: { admin: {} },
    admin: h.admin,
    isDelegated: false,
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useApplicationId', () => ({
  useApplicationId: () => ({ appId: 'app-1' }),
}));

vi.mock('@/hooks/useAppNamespaces', () => ({
  useAppNamespaces: (appId: string | null) => ({
    namespaces: appId ? h.memberOf.map((namespaceId) => ({ namespaceId })) : [],
  }),
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  markNamespaceJustJoined: vi.fn(),
}));

vi.mock('@/hooks/namespaceNames', () => ({
  rememberNamespaceName: vi.fn(),
}));

const { peekInvitation, resetInvitationCaptureForTests } = await import(
  '@calimero-network/mero-react'
);

// {"inviter_signature":"sig","invitation":{"group_id":"ns1"}}, base64url.
const PAYLOAD =
  'eyJpbnZpdGVyX3NpZ25hdHVyZSI6InNpZyIsImludml0YXRpb24iOnsiZ3JvdXBfaWQiOiJuczEifX0';

beforeEach(() => {
  resetInvitationCaptureForTests();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  h.memberOf = [];
});

afterEach(() => {
  cleanup();
  vi.mocked(markNamespaceJustJoined).mockClear();
});

const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

/** Whether the invitation is still held for another attempt. */
const held = () => peekInvitation() !== null;
const stage = () =>
  screen.queryByTestId('invite-prompt')?.getAttribute('data-stage');

/** Open the link as the links page would; press Join unless told not to. */
async function open(
  admin: {
    joinNamespace?: () => Promise<unknown>;
    joinGroup?: () => Promise<unknown>;
    listNamespaces?: () => Promise<unknown>;
  },
  { kind = 'namespace', click = true } = {},
) {
  h.admin = {
    joinNamespace: () => Promise.resolve({}),
    listNamespaces: () => Promise.resolve([]),
    ...admin,
  };
  window.history.replaceState(
    null,
    '',
    `/?invitation=${PAYLOAD}&kind=${kind}&id=ns1&name=Acme`,
  );
  const onJoined = vi.fn();
  render(<InvitationPrompt onJoined={onJoined} />);
  await screen.findByRole('dialog', { name: 'Join “Acme”?' });
  if (click) fireEvent.click(screen.getByTestId('invite-accept'));
  return onJoined;
}

describe('InvitationPrompt', () => {
  it('asks first, then lands the user and waits for the workspace to sync', async () => {
    const joinNamespace = vi.fn(() => Promise.resolve({}));
    const onJoined = await open({ joinNamespace }, { click: false });
    expect(screen.getByText("You'll be added to the workspace.")).toBeTruthy();
    expect(joinNamespace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('invite-accept'));
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(stage()).toBe('syncing');
    expect(markNamespaceJustJoined).toHaveBeenCalledWith('ns1');
    expect(held()).toBe(false);
  });

  it('lands the user when the join failed but the node lists the workspace', async () => {
    const joinNamespace = vi.fn(() =>
      Promise.reject(new Error('The request was aborted')),
    );
    const onJoined = await open({
      joinNamespace,
      listNamespaces: () => Promise.resolve([{ namespaceId: 'ns1' }]),
    });
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(markNamespaceJustJoined).toHaveBeenCalledWith('ns1');
    expect(joinNamespace).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('invite-error')).toBeNull();
  });

  it('says why a refused invitation failed, and offers no retry', async () => {
    const onJoined = await open({
      joinNamespace: () => Promise.reject(httpError(409, 'member was removed')),
    });
    expect((await screen.findByTestId('invite-error')).textContent).toContain(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
    expect(screen.queryByTestId('invite-retry')).toBeNull();
    expect(held()).toBe(false);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it('names a spent link when the node says so', async () => {
    await open({
      joinNamespace: () =>
        Promise.reject(
          httpError(
            409,
            'identity ab has already used this invitation to join group cd; a new invitation is required',
          ),
        ),
    });
    expect((await screen.findByTestId('invite-error')).textContent).toContain(
      "You've already used this link to join this workspace once. Ask an admin for a new link.",
    );
    expect(screen.queryByTestId('invite-retry')).toBeNull();
  });

  it('names a removal when the node says so', async () => {
    await open({
      joinNamespace: () =>
        Promise.reject(httpError(409, 'member was removed from group cd')),
    });
    expect((await screen.findByTestId('invite-error')).textContent).toContain(
      "An admin removed you from this workspace. A new link won't let you back in; ask an admin to add you again.",
    );
  });

  it('keeps the invitation when no one is online to let you in, and retries without asking again', async () => {
    const joinNamespace = vi.fn(
      (): Promise<unknown> =>
        Promise.reject(httpError(503, 'no peer available')),
    );
    const onJoined = await open({ joinNamespace });
    expect((await screen.findByTestId('invite-error')).textContent).toMatch(
      /No one in this workspace is online/,
    );
    expect(held()).toBe(true);
    expect(onJoined).not.toHaveBeenCalled();

    joinNamespace.mockImplementation(() => Promise.resolve({}));
    fireEvent.click(screen.getByTestId('invite-retry'));
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(held()).toBe(false);
    expect(joinNamespace).toHaveBeenCalledTimes(2);
  });

  it('says so when the node reports the invitation expired', async () => {
    await open({
      joinNamespace: () =>
        Promise.reject(httpError(410, 'invitation has expired')),
    });
    expect((await screen.findByTestId('invite-error')).textContent).toContain(
      'This invitation has expired.',
    );
    expect(held()).toBe(false);
  });

  it('tells a member they already are one, and joins nothing', async () => {
    h.memberOf = ['ns1'];
    const joinNamespace = vi.fn(() => Promise.resolve({}));
    const onJoined = await open({ joinNamespace }, { click: false });
    expect(
      await screen.findByText("You're already a member of this workspace."),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('invite-accept'));
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(stage()).toBe('already-member');
    expect(joinNamespace).not.toHaveBeenCalled();
    expect(held()).toBe(false);
  });

  it('a folder invitation says it grants the folder only, and joins the folder', async () => {
    const joinGroup = vi.fn(() => Promise.resolve({ groupId: 'ns1' }));
    const joinNamespace = vi.fn(() => Promise.resolve({}));
    const onJoined = await open(
      { joinGroup, joinNamespace },
      { kind: 'group', click: false },
    );
    expect(
      screen.getByText(
        "You'll only gain access to this folder, not the rest of the workspace.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('invite-accept'));
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(joinGroup).toHaveBeenCalledOnce();
    expect(joinNamespace).not.toHaveBeenCalled();
    // A folder is not a workspace: the workspace gate is not raised for it.
    expect(markNamespaceJustJoined).not.toHaveBeenCalled();
    expect(stage()).toBe('syncing');
  });
});
