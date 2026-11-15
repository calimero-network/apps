import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CalimeroClient, NodeVerificationState } from '@calimero-network/mero-js';
import { bindNodeShield } from '@calimero-apps/passkey/nodeShield';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NamespaceCreateDialog from './NamespaceCreateDialog';
import { APP_PACKAGE } from '../config';

const NODE = 'https://node-1.example.net';
const verified: NodeVerificationState = { status: 'verified', url: NODE, mock: false, release: '2.3.148', profile: 'locked-read-only', checkedAt: 1 };
const refused: NodeVerificationState = { status: 'refused', url: NODE, reason: 'wrong enclave key', checkedAt: 1 };
const RELEASE = { package: APP_PACKAGE, version: '1.4.0' };

let unbind: (() => void) | null = null;

/** The dialog over a node whose own check answered `state`. */
function open(props: { release?: typeof RELEASE | null; releasePending?: boolean; state?: NodeVerificationState } = {}) {
  const state = props.state ?? verified;
  const client = {
    nodeUrl: NODE,
    verification: () => state,
    verify: async () => state,
    packageCapabilities: vi.fn(async () => {
      throw new Error('no card in this test');
    }),
  };
  unbind = bindNodeShield(client as unknown as CalimeroClient, 'Test cluster', true);
  const onCreate = vi.fn(async () => ({ namespaceId: 'org-new', warning: null as string | null }));
  const onClose = vi.fn();
  render(
    <NamespaceCreateDialog
      release={props.release === undefined ? RELEASE : props.release}
      releasePending={props.releasePending}
      onCreate={onCreate}
      onClose={onClose}
    />,
  );
  return { client, onCreate, onClose };
}

function fillName(name = 'Platform', self = 'Alice') {
  fireEvent.change(screen.getByTestId('ns-create-name'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('ns-create-self-name'), { target: { value: self } });
}

const createButton = () => screen.findByRole('button', { name: 'Create workspace' }) as Promise<HTMLButtonElement>;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  unbind?.();
  unbind = null;
});

describe('NamespaceCreateDialog', () => {
  it('asks for the names first and creates nothing on Continue', async () => {
    const { onCreate } = open();
    expect(screen.getByTestId('ns-create-submit').textContent).toBe('Continue');
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    expect(await screen.findByText('Review before creating')).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('reviews the release it is given', async () => {
    const { client } = open();
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await waitFor(() => expect(client.packageCapabilities).toHaveBeenCalledWith(APP_PACKAGE, '1.4.0'));
  });

  it('goes back to the names, kept as typed', async () => {
    open();
    fillName('Platform', 'Alice');
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await screen.findByText(/Check what this app can do/);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByTestId('ns-create-name') as HTMLInputElement).value).toBe('Platform');
    expect((screen.getByTestId('ns-create-self-name') as HTMLInputElement).value).toBe('Alice');
  });

  it('creates once from the review with the names, then closes', async () => {
    const { onCreate, onClose } = open();
    fillName('  Platform ', ' Alice ');
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    const create = await createButton();
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith('Platform', 'Alice');
  });

  it('keeps the review open and says why when the workspace was not created', async () => {
    const { onCreate, onClose } = open();
    onCreate.mockResolvedValueOnce({ namespaceId: null as never, warning: null });
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    fireEvent.click(await createButton());
    expect(await screen.findByText('Could not create the workspace. Try again.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says the member defaults need an admin, and stays open, when the workspace was created without them', async () => {
    const { onCreate, onClose } = open();
    onCreate.mockResolvedValueOnce({ namespaceId: 'org-new', warning: 'Defaults need an admin.' });
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    fireEvent.click(await createButton());
    expect((await screen.findByTestId('ns-create-ha-notice')).textContent).toContain('Defaults need an admin.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot create on a node that refused its check', async () => {
    const { onCreate } = open({ state: refused });
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    const create = await createButton();
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('waits while the release is being read: nothing to continue to, Enter included', () => {
    const { onCreate } = open({ release: null, releasePending: true });
    fillName();
    expect((screen.getByTestId('ns-create-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('release-checking').textContent).toBe('Checking the newest release…');
    fireEvent.keyDown(screen.getByTestId('ns-create-name'), { key: 'Enter' });
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByText('Review before creating')).toBeNull();
  });

  it('creates straight from the form when there is no release to review', async () => {
    const { onCreate } = open({ release: null });
    expect(screen.getByTestId('ns-create-submit').textContent).toBe('Create workspace');
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Platform', 'Alice'));
    expect(screen.queryByText('Review before creating')).toBeNull();
  });
});
