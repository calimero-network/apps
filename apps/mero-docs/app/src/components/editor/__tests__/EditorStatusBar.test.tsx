import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorStatusBar } from '../EditorStatusBar';

const baseProps = {
  documentName: 'Doc',
  saveStatus: 'saved' as const,
  lastSavedAt: null,
};

describe('EditorStatusBar connection state', () => {
  it('shows a neutral connecting state while the connection status is not yet known', () => {
    render(<EditorStatusBar {...baseProps} isAppReady={false} isOffline={false} />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('shows Offline only once the connection is known to be offline', () => {
    render(<EditorStatusBar {...baseProps} isAppReady={false} isOffline={true} />);
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('shows the normal save status once ready and online', () => {
    render(<EditorStatusBar {...baseProps} isAppReady={true} isOffline={false} />);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.queryByText('Connecting…')).toBeNull();
    expect(screen.queryByText('Offline')).toBeNull();
  });
});
