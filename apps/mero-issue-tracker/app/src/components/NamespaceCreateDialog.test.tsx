import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CalimeroClient, NodeVerificationState } from '@calimero-network/mero-js';
import type { AppSource } from '@calimero-apps/connect';
import { bindNodeShield } from '@calimero-apps/passkey/nodeShield';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NamespaceCreateDialog from './NamespaceCreateDialog';
import { APP_PACKAGE } from '../config';

const signedIn = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../sessionContext', () => ({ useSignedIn: () => signedIn.current }));

const NODE = 'https://node-1.example.net';
const verified: NodeVerificationState = { status: 'verified', url: NODE, mock: false, release: '2.3.148', profile: 'locked-read-only', checkedAt: 1 };
const refused: NodeVerificationState = { status: 'refused', url: NODE, reason: 'wrong enclave key', checkedAt: 1 };

let unbind: (() => void) | null = null;

/** The dialog in a session on a node whose own check answered `state`, creating from `source`. */
function open(source: AppSource, state: NodeVerificationState = verified, lookup: () => Promise<unknown> = async () => ({ package: APP_PACKAGE, latest: '1.4.0', versions: [] })) {
  const client = {
    nodeUrl: NODE,
    verification: () => state,
    verify: async () => state,
    packages: { get: vi.fn(lookup) },
    packageCapabilities: vi.fn(async () => {
      throw new Error('no card in this test');
    }),
  };
  signedIn.current = { client, source };
  unbind = bindNodeShield(client as unknown as CalimeroClient, 'Test cluster', true);
  const onCreate = vi.fn(async () => ({ namespaceId: 'org-new', warning: null }));
  const onClose = vi.fn();
  render(<NamespaceCreateDialog onCreate={onCreate} onClose={onClose} />);
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
    const { onCreate } = open({ package: APP_PACKAGE });
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    expect(await screen.findByText('Review before creating')).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('reviews the newest release of the package when the source names no version', async () => {
    const { client } = open({ package: APP_PACKAGE });
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await waitFor(() => expect(client.packageCapabilities).toHaveBeenCalledWith(APP_PACKAGE, '1.4.0'));
  });

  it('reviews the release the source names, without looking one up', async () => {
    const { client } = open({ package: APP_PACKAGE, version: '2.0.0' });
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await waitFor(() => expect(client.packageCapabilities).toHaveBeenCalledWith(APP_PACKAGE, '2.0.0'));
    expect(client.packages.get).not.toHaveBeenCalled();
  });

  it('goes back to the names, kept as typed', async () => {
    open({ package: APP_PACKAGE });
    fillName('Platform', 'Alice');
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await screen.findByText(/Check what this app can do/);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByTestId('ns-create-name') as HTMLInputElement).value).toBe('Platform');
    expect((screen.getByTestId('ns-create-self-name') as HTMLInputElement).value).toBe('Alice');
  });

  it('creates once from the review with the names, then closes', async () => {
    const { onCreate, onClose } = open({ package: APP_PACKAGE });
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
    const { onCreate, onClose } = open({ package: APP_PACKAGE });
    onCreate.mockResolvedValueOnce({ namespaceId: null as never, warning: null });
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    fireEvent.click(await createButton());
    expect(await screen.findByText('Could not create the workspace. Try again.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot create on a node that refused its check', async () => {
    const { onCreate } = open({ package: APP_PACKAGE }, refused);
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    const create = await createButton();
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('says so and cannot create when the release cannot be read, until it is asked again', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ latest: '1.4.0' });
    const { onCreate } = open({ package: APP_PACKAGE }, verified, failing);
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    expect(await screen.findByText("The app's release could not be read from this node.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create workspace' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await createButton()).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('has no signed release to review on a development bundle, and creates from the same step', async () => {
    const { client, onCreate } = open('bundle-hash');
    fillName();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    expect(await screen.findByText(/runs a local bundle, not a signed release/)).toBeTruthy();
    fireEvent.click(await createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Platform', 'Alice'));
    expect(client.packages.get).not.toHaveBeenCalled();
  });
});
