import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { bindNodeShield } from '@calimero-apps/passkey/nodeShield';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NamespaceCreateDialog from './NamespaceCreateDialog';

const RELEASE = { package: 'com.calimero.mero-crm', version: '1.4.0' };
const NODE = 'https://node-1.example.net';
const VERIFIED = { status: 'verified', url: NODE, mock: false, release: '2.3.148', profile: 'locked-read-only', checkedAt: 1 };
const REFUSED = { status: 'refused', url: NODE, reason: 'wrong enclave key', checkedAt: 1 };

/** A client whose own check answers `state`; its release card never arrives. */
function connect(state: typeof VERIFIED | typeof REFUSED = VERIFIED) {
  const client = {
    nodeUrl: NODE,
    nodes: [NODE],
    verification: () => state,
    verify: async () => state,
    packageCapabilities: () => new Promise(() => {}),
  } as unknown as CalimeroClient;
  return bindNodeShield(client, 'Test cluster');
}

let unbind: () => void;
beforeEach(() => {
  localStorage.clear();
  unbind = connect();
});
afterEach(() => {
  cleanup();
  unbind();
});

function open(props: { release?: typeof RELEASE | null; created?: { namespaceId: string | null; warning: string | null } } = {}) {
  const onCreate = vi.fn(async () => props.created ?? { namespaceId: 'org-new', warning: null });
  const onClose = vi.fn();
  render(<NamespaceCreateDialog release={props.release === undefined ? RELEASE : props.release} onCreate={onCreate} onClose={onClose} />);
  fireEvent.change(screen.getByTestId('ns-create-name'), { target: { value: 'Platform' } });
  fireEvent.change(screen.getByTestId('ns-create-self-name'), { target: { value: 'ronit' } });
  return { onCreate, onClose };
}

const createButton = () => screen.getByRole('button', { name: /^create workspace/i }) as HTMLButtonElement;

describe('NamespaceCreateDialog', () => {
  it('reviews the app before creating: Continue opens the review and creates nothing', () => {
    const { onCreate } = open();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    expect(screen.getByText('Review before creating')).toBeTruthy();
    expect(screen.queryByTestId('ns-create-name')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('Back returns to the form with both names kept', () => {
    open();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByTestId('ns-create-name') as HTMLInputElement).value).toBe('Platform');
    expect((screen.getByTestId('ns-create-self-name') as HTMLInputElement).value).toBe('ronit');
  });

  it('creates once, from the review, and closes', async () => {
    const { onCreate, onClose } = open();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    fireEvent.click(createButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith('Platform', 'ronit');
  });

  it('cannot create while the node has refused its check', async () => {
    unbind();
    unbind = connect(REFUSED);
    const { onCreate } = open();
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await waitFor(() => expect(createButton().disabled).toBe(true));
    fireEvent.click(createButton());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('says a failed create on the review and lets it be tried again', async () => {
    const { onCreate } = open({ created: { namespaceId: null, warning: null } });
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    fireEvent.click(createButton());
    expect(await screen.findByText('Could not create the workspace. Try again.')).toBeTruthy();
    expect(createButton().disabled).toBe(false);
    fireEvent.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  });

  it('keeps the workspace-created notice when its member defaults could not be set', async () => {
    open({ created: { namespaceId: 'org-new', warning: 'Defaults need an admin.' } });
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    fireEvent.click(createButton());
    expect((await screen.findByTestId('ns-create-ha-notice')).textContent).toContain('Defaults need an admin.');
  });

  it('waits while the release is being read: nothing to continue to, Enter included', () => {
    const onCreate = vi.fn();
    render(<NamespaceCreateDialog release={null} releasePending onCreate={onCreate} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('ns-create-name'), { target: { value: 'Platform' } });
    fireEvent.change(screen.getByTestId('ns-create-self-name'), { target: { value: 'ronit' } });
    expect((screen.getByTestId('ns-create-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('release-checking').textContent).toBe('Checking the newest release…');
    fireEvent.keyDown(screen.getByTestId('ns-create-name'), { key: 'Enter' });
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByText('Review before creating')).toBeNull();
  });

  it('creates straight from the form when there is no release to review', async () => {
    const { onCreate } = open({ release: null });
    expect(screen.getByTestId('ns-create-submit').textContent).toBe('Create workspace');
    fireEvent.click(screen.getByTestId('ns-create-submit'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Review before creating')).toBeNull();
  });

  describe.each([
    ['the review', RELEASE, (el: HTMLElement) => fireEvent.click(within(el).getByRole('button', { name: /^create workspace/i }))],
    ['the form, with no release to review', null, (el: HTMLElement) => fireEvent.click(within(el).getByTestId('ns-create-submit'))],
  ])('while creating from %s', (_where, release, create) => {
    /** A create that finishes when the test says. */
    function creating() {
      let finish: (v: { namespaceId: string; warning: null }) => void = () => {};
      const onCreate = vi.fn(() => new Promise<{ namespaceId: string; warning: null }>((r) => { finish = r; }));
      const onClose = vi.fn();
      render(<NamespaceCreateDialog release={release} onCreate={onCreate} onClose={onClose} />);
      fireEvent.change(screen.getByTestId('ns-create-name'), { target: { value: 'Platform' } });
      fireEvent.change(screen.getByTestId('ns-create-self-name'), { target: { value: 'ronit' } });
      if (release) fireEvent.click(screen.getByTestId('ns-create-submit'));
      create(screen.getByRole('dialog'));
      return { onCreate, onClose, finish: () => finish({ namespaceId: 'org-new', warning: null }) };
    }

    it('cannot be dismissed by the backdrop, Close or Escape', async () => {
      const { onCreate, onClose, finish } = creating();
      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('dialog').parentElement!);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      finish();
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
  });

  it('is dismissed by the backdrop, Close and Escape when nothing is being created', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
