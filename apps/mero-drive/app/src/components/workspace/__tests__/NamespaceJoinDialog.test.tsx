import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NamespaceJoinDialog } from '../NamespaceJoinDialog';
import { buildInviteUrl } from '@/hooks/useNamespaceInvitation';
import type { SignedGroupOpenInvitation } from '@calimero-network/mero-react';

// JoinInviteCard reads useMero + dispatches join through it. The
// dialog's own logic (parse → preview swap, error states, close)
// doesn't touch network, so stubbing useMero to a stable state
// keeps the card rendered without needing a real Mero client.
// ConnectButton is irrelevant once useMero reports !isAuthenticated;
// we stub it to a marker so the assertion is stable regardless of
// mero-react's internals.
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useMero: () => ({
    mero: null,
    isAuthenticated: false,
    isLoading: false,
    applicationId: null,
  }),
  // JoinInviteCard pre-checks namespace membership; an empty list keeps
  // the card in the plain accept state for these dialog tests.
  useNamespacesForApplication: () => ({
    namespaces: [],
    loading: false,
    error: null,
    refetch: async () => {},
  }),
  ConnectButton: () => <button data-testid="connect-stub">Connect</button>,
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  markNamespaceJustJoined: vi.fn(),
}));

vi.mock('@/hooks/namespaceNames', () => ({
  rememberNamespaceName: vi.fn(),
}));

const VALID_URL = buildInviteUrl(
  'namespace',
  'ns-abc',
  {} as SignedGroupOpenInvitation,
  'Acme',
);

const noop = () => {};

// Project convention (see RestrictedFolderCard.test.tsx) avoids
// `@testing-library/jest-dom` matchers — we use plain chai/vitest
// assertions throughout the suite so the test file stays import-
// minimal and doesn't depend on a global setup file.

describe('NamespaceJoinDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the input stage with disabled Continue when empty', () => {
    render(<NamespaceJoinDialog onClose={noop} onJoined={noop} />);
    screen.getByRole('dialog');
    screen.getByPlaceholderText(/mero-drive.vercel.app/i);
    const continueBtn = screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);
  });

  it('shows a friendly error when the pasted text is not a link', () => {
    render(<NamespaceJoinDialog onClose={noop} onJoined={noop} />);
    fireEvent.change(screen.getByPlaceholderText(/mero-drive.vercel.app/i), {
      target: { value: 'this is not a link' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/doesn't look like an invite link/i);
  });

  it('surfaces the parseInviteUrl error message verbatim', () => {
    render(<NamespaceJoinDialog onClose={noop} onJoined={noop} />);
    // URL has invite= but the payload itself is garbage — parseInviteUrl
    // returns its decoder error message rather than extractInviteParams
    // returning null.
    fireEvent.change(screen.getByPlaceholderText(/mero-drive.vercel.app/i), {
      target: {
        value: 'https://x/join?kind=namespace&id=ns&invite=$$not-base64$$',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/could not be decoded/i);
  });

  it('transitions to preview on a valid invite URL', () => {
    render(<NamespaceJoinDialog onClose={noop} onJoined={noop} />);
    fireEvent.change(screen.getByPlaceholderText(/mero-drive.vercel.app/i), {
      target: { value: VALID_URL },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    // Heading swaps to scope-specific title and the preview text
    // shows the carried namespace name.
    screen.getByRole('heading', { name: /join workspace/i });
    screen.getByText('Acme');
    // Connect prompt appears since useMero is mocked to !isAuthenticated.
    screen.getByTestId('connect-stub');
  });

  it('lets the user navigate back to the input stage from preview, preserving text', () => {
    render(<NamespaceJoinDialog onClose={noop} onJoined={noop} />);
    const textarea = screen.getByPlaceholderText(/mero-drive.vercel.app/i);
    fireEvent.change(textarea, { target: { value: VALID_URL } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.click(screen.getByRole('button', { name: /back to invite link/i }));

    const restored = screen.getByPlaceholderText(/mero-drive.vercel.app/i) as HTMLTextAreaElement;
    expect(restored.value).toBe(VALID_URL);
  });

  it('Cancel button closes the dialog', () => {
    const onClose = vi.fn();
    render(<NamespaceJoinDialog onClose={onClose} onJoined={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the backdrop closes the dialog', () => {
    const onClose = vi.fn();
    render(<NamespaceJoinDialog onClose={onClose} onJoined={noop} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clears the inline parse error when the user edits the textarea', () => {
    render(<NamespaceJoinDialog onClose={noop} onJoined={noop} />);
    const textarea = screen.getByPlaceholderText(/mero-drive.vercel.app/i);
    fireEvent.change(textarea, { target: { value: 'not a link' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    screen.getByRole('alert');
    fireEvent.change(textarea, { target: { value: 'still typing' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
