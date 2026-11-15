import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { bindNodeShield } from '@calimero-apps/passkey/nodeShield';
import { NamespaceCreateDialog } from '../NamespaceCreateDialog';

// createWorkspace flips its own `loading` via real useState, so the dialog's
// submitting-gated close can be exercised without a real create round-trip.
const created = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => {
    const [loading, setLoading] = React.useState(false);
    const createWorkspace = React.useCallback(async (...args: unknown[]) => {
      created(...args);
      setLoading(true);
      return new Promise<string | null>(() => {}); // never resolves: simulates in-flight create
    }, []);
    return {
      createWorkspace,
      createWorkspaceLoading: loading,
      createWorkspaceError: null,
    };
  },
}));

const NODE = 'https://node-1.docs.example.net';
const PACKAGE = 'network.calimero.docs';
type Verification =
  | {
      status: 'verified';
      url: string;
      mock: boolean;
      release: string;
      profile: string;
      checkedAt: number;
    }
  | { status: 'refused'; url: string; reason: string; checkedAt: number };
const sealed: Verification = {
  status: 'verified',
  url: NODE,
  mock: false,
  release: '2.3.148',
  profile: 'locked-read-only',
  checkedAt: 1,
};

let source: string | { package: string; version?: string };
let verification: Verification;
let resolvingSource = false;
const packageCapabilities = vi.fn(() => new Promise<never>(() => {}));

vi.mock('@/calimero/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSession: () => ({
    session: { status: 'signed-in', client },
    source,
    resolvingSource,
  }),
}));

const client = {
  nodeUrl: NODE,
  nodes: [NODE],
  verification: () => verification,
  verify: async () => verification,
  packageCapabilities,
} as unknown as CalimeroClient;

let unbind: () => void;

beforeEach(() => {
  created.mockReset();
  packageCapabilities.mockClear();
  localStorage.clear();
  source = { package: PACKAGE, version: '1.2.0' };
  verification = sealed;
  resolvingSource = false;
  unbind = bindNodeShield(client, 'Calimero Cloud test');
});

afterEach(() => unbind());

const user = () => userEvent.setup();

async function fillNames(u: ReturnType<typeof user>) {
  await u.type(screen.getByPlaceholderText('Workspace name'), 'Acme');
  await u.type(
    screen.getByPlaceholderText('Your name in this workspace'),
    'Ada',
  );
}

async function toReview(u: ReturnType<typeof user>) {
  await fillNames(u);
  await u.click(screen.getByRole('button', { name: 'Continue' }));
  return screen.findByRole('heading', { name: 'Review before creating' });
}

describe('NamespaceCreateDialog closing', () => {
  it('closes on Escape even when focus is not on the name input', async () => {
    const onClose = vi.fn();
    render(<NamespaceCreateDialog onClose={onClose} />);
    const user = userEvent.setup();
    await user.tab(); // move focus off the autoFocused input
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores Escape while the workspace is being created', async () => {
    const onClose = vi.fn();
    render(<NamespaceCreateDialog onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Workspace name'), 'Slow Co');
    await user.type(
      screen.getByPlaceholderText('Your name in this workspace'),
      'Ada',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(
      await screen.findByRole('button', { name: 'Create workspace' }),
    );
    await screen.findByRole('button', { name: 'Creating…' });
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('NamespaceCreateDialog asks your name in the workspace', () => {
  it('needs a name, and hands it to the create with the workspace', async () => {
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Workspace name'), 'Acme');
    expect(
      screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled'),
    ).toBe(true);
    await user.type(
      screen.getByPlaceholderText('Your name in this workspace'),
      '  Ada  ',
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(
      await screen.findByRole('button', { name: 'Create workspace' }),
    );
    expect(created).toHaveBeenCalledWith('Acme', 'Ada');
  });

  it('offers the name last used in another workspace', () => {
    localStorage.setItem('calimero-names:last', 'Grace');
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    expect(
      (
        screen.getByPlaceholderText(
          'Your name in this workspace',
        ) as HTMLInputElement
      ).value,
    ).toBe('Grace');
  });
});

describe('NamespaceCreateDialog review step', () => {
  it('reviews the release the new workspace will run before creating anything', async () => {
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    const u = user();
    await toReview(u);
    expect(screen.queryByPlaceholderText('Workspace name')).toBeNull();
    expect(created).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(packageCapabilities).toHaveBeenCalledWith(PACKAGE, '1.2.0'),
    );
  });

  it('lets the review sit flush with the scrolling dialog padding', async () => {
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    await toReview(user());
    expect(screen.getByRole('dialog').className).toContain(
      '[--passkey-review-inset:theme(spacing.5)]',
    );
  });

  it('keeps both names when going back', async () => {
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    const u = user();
    await toReview(u);
    await u.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      (screen.getByPlaceholderText('Workspace name') as HTMLInputElement).value,
    ).toBe('Acme');
    expect(
      (
        screen.getByPlaceholderText(
          'Your name in this workspace',
        ) as HTMLInputElement
      ).value,
    ).toBe('Ada');
  });

  it('creates once, from the review', async () => {
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    const u = user();
    await toReview(u);
    await u.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(created).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledWith('Acme', 'Ada');
  });

  it('cannot create while the node has refused its check', async () => {
    verification = {
      status: 'refused',
      url: NODE,
      reason: 'wrong enclave key',
      checkedAt: 1,
    };
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    await toReview(user());
    const create = await screen.findByRole('button', {
      name: 'Create workspace',
    });
    await waitFor(() => expect(create.hasAttribute('disabled')).toBe(true));
  });

  it('holds Continue while the newest release is being read', async () => {
    source = { package: PACKAGE };
    resolvingSource = true;
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    await fillNames(user());
    expect(
      screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('creates straight from the names when no release could be read', async () => {
    source = { package: PACKAGE };
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    const u = user();
    await fillNames(u);
    await u.click(screen.getByRole('button', { name: 'Create' }));
    expect(created).toHaveBeenCalledWith('Acme', 'Ada');
  });

  it('creates straight from the names for a development bundle, which has no release', async () => {
    source = 'bundle-hash';
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    const u = user();
    await fillNames(u);
    await u.click(screen.getByRole('button', { name: 'Create' }));
    expect(created).toHaveBeenCalledWith('Acme', 'Ada');
  });
});
