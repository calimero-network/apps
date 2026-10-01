// A confirmation opened in the workspace names members, which reads the
// workspace; its body must render inside the workspace provider.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../App';
import { useConfirm } from '@/components/ui/confirm-dialog';

vi.mock('@calimero-network/mero-react', () => ({
  AppMode: { MultiContext: 'MultiContext' },
  MeroProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMero: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('sonner', () => ({ Toaster: () => null }));
vi.mock('@/components/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn(), toggle: vi.fn() }),
}));
vi.mock('@/hooks/useDriveWorkspace', async () => {
  const { createContext, useContext } = await import('react');
  const Ctx = createContext<{ name: string } | null>(null);
  return {
    DriveWorkspaceProvider: ({ children }: { children: React.ReactNode }) => (
      <Ctx.Provider value={{ name: 'Bob' }}>{children}</Ctx.Provider>
    ),
    useDriveWorkspace: () => {
      const ws = useContext(Ctx);
      if (!ws) throw new Error('useDriveWorkspace must be used inside <DriveWorkspaceProvider>');
      return ws;
    },
  };
});
vi.mock('../pages/landing/LandingPage', () => ({ default: () => null }));
vi.mock('../pages/join', () => ({ default: () => null }));
vi.mock('../pages/workspace', async () => {
  const { useDriveWorkspace } = await import('@/hooks/useDriveWorkspace');
  const Name = () => <b>{(useDriveWorkspace() as unknown as { name: string }).name}</b>;
  function WorkspacePage() {
    const confirm = useConfirm();
    return (
      <button
        type="button"
        onClick={() => void confirm({ title: 'Remove member?', body: <Name /> })}
      >
        Remove
      </button>
    );
  }
  return { default: WorkspacePage };
});

describe('workspace confirmations', () => {
  it('render a body that reads the workspace', async () => {
    window.history.replaceState({}, '', '/app');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove member?' });
    expect(dialog.textContent).toContain('Bob');
  });
});
