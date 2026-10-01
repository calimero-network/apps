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

describe('EditorStatusBar read only', () => {
  it('says Read only instead of Saved when the member cannot edit', () => {
    render(<EditorStatusBar {...baseProps} readOnly />);
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('still reports Offline for a read only member', () => {
    render(<EditorStatusBar {...baseProps} readOnly isOffline />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Read only')).toBeNull();
  });
});

describe('EditorStatusBar counts', () => {
  it('uses the singular for a count of one', () => {
    render(<EditorStatusBar {...baseProps} wordCount={1} charCount={1} />);
    expect(screen.getByText('1 word')).toBeTruthy();
    expect(screen.getByText('1 character')).toBeTruthy();
  });

  it('uses the plural otherwise', () => {
    render(<EditorStatusBar {...baseProps} wordCount={0} charCount={5} />);
    expect(screen.getByText('0 words')).toBeTruthy();
    expect(screen.getByText('5 characters')).toBeTruthy();
  });
});
