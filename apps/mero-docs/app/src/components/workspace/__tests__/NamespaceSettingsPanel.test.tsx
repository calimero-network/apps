import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NamespaceSettingsPanel } from '../NamespaceSettingsPanel';

const parentOf = (el: HTMLElement) => el.parentElement; // eslint-disable-line testing-library/no-node-access
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    namespaces: [{ namespaceId: 'ns', name: 'Acme', memberCount: 2 }],
    namespaceMembers: { teeMembers: [] },
  }),
}));
vi.mock('@/calimero/react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMero: () => ({ session: { status: 'signed-in' } }),
}));
vi.mock('@calimero-apps/passkey', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ManageInHomeLink: ({
    org,
    className,
  }: {
    org: string | null;
    className?: string;
  }) => (
    <a className={className} href="#home">
      Manage people for {org}
    </a>
  ),
}));
vi.mock('../NamespaceMembersPanel', () => ({
  NamespaceMembersPanel: () => null,
}));
vi.mock('@/components/admin/MemberDefaultsPanel', () => ({
  MemberDefaultsPanel: () => null,
}));
vi.mock('@/components/admin/MyDisplayNamePanel', () => ({
  MyDisplayNamePanel: () => null,
}));
vi.mock('@/components/admin/WorkspaceSettingsPanel', () => ({
  WorkspaceSettingsPanel: () => null,
}));
vi.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));
vi.mock('../WorkspaceExitPanel', () => ({ WorkspaceExitPanel: () => null }));
vi.mock('../WorkspaceTrustPanel', () => ({
  WorkspaceTrustPanel: () => <div data-testid="trust-panel" />,
}));

describe('NamespaceSettingsPanel', () => {
  it('includes the workspace Trust section', () => {
    render(<NamespaceSettingsPanel />);
    expect(screen.getByTestId('trust-panel')).toBeTruthy();
  });

  it('offers the theme toggle that the narrow header drops', () => {
    render(<NamespaceSettingsPanel />);
    const toggle = screen.getByRole('button', { name: 'Toggle theme' });
    expect(parentOf(toggle)?.className).toContain('sm:hidden');
    expect(screen.getByText('Theme')).toBeTruthy();
  });

  it('offers the Calimero Home link below the width where the header shows it', () => {
    render(<NamespaceSettingsPanel />);
    const link = screen.getByText('Manage people for ns');
    expect(link.className).toContain('min-[1440px]:hidden');
  });
});
