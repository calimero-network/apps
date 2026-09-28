import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import WorkspacePage from '..';
import { readReturnTo, saveReturnTo } from '@/lib/routes';

const meroState = { isAuthenticated: false, isLoading: true };

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => meroState,
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  ACTIVE_NS_KEY: 'mero-drive:activeNs',
}));
vi.mock('@/components/workspace/WorkspaceLayout', () => ({
  WorkspaceLayout: () => <div data-testid="layout" />,
}));

function tree(url: string) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/app/*" element={<WorkspacePage />} />
        <Route path="/" element={<div data-testid="landing" />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  meroState.isAuthenticated = false;
  meroState.isLoading = true;
});

describe('WorkspacePage sign-in guard', () => {
  it('remembers where a signed-out visitor was headed', () => {
    const url = '/app/w/f/f1/d/doc-2?node=2#b=blk';
    const { rerender } = render(tree(url));
    meroState.isLoading = false;
    rerender(tree(url));
    expect(screen.getByTestId('landing')).toBeTruthy();
    expect(readReturnTo()).toBe('/app/w/f/f1/d/doc-2?node=2#b=blk');
  });

  // The next person on this browser must not inherit the last one's page.
  it('does not remember the page someone logged out from', () => {
    meroState.isAuthenticated = true;
    meroState.isLoading = false;
    const { rerender } = render(tree('/app/w/f/f1'));
    expect(screen.getByTestId('layout')).toBeTruthy();
    localStorage.setItem('mero-drive:activeNs', '"w"');
    meroState.isAuthenticated = false;
    rerender(tree('/app/w/f/f1'));
    expect(screen.getByTestId('landing')).toBeTruthy();
    expect(readReturnTo()).toBeNull();
    expect(localStorage.getItem('mero-drive:activeNs')).toBeNull();
  });

  it('forgets the saved page once the app is reached signed in', () => {
    saveReturnTo('/app/w');
    meroState.isAuthenticated = true;
    meroState.isLoading = false;
    render(tree('/app/w'));
    expect(readReturnTo()).toBeNull();
  });
});
