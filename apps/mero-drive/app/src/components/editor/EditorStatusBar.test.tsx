import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorStatusBar } from './EditorStatusBar';
import type { SaveStatus } from './DocumentEditor';

vi.mock('lucide-react', () => ({
  Shield: (p: any) => <span data-testid="icon-shield" {...p} />,
  AlertCircle: (p: any) => <span data-testid="icon-alert" {...p} />,
  Clock: (p: any) => <span data-testid="icon-clock" {...p} />,
  FileText: (p: any) => <span data-testid="icon-file" {...p} />,
  WifiOff: (p: any) => <span data-testid="icon-wifi-off" {...p} />,
}));

function fakeEditor(textContent = 'hello world') {
  return {
    state: { doc: { textContent } },
  } as any;
}

function renderBar(overrides: Record<string, any> = {}) {
  const defaults = {
    editor: fakeEditor(),
    documentName: 'Test Doc',
    saveStatus: 'saved' as SaveStatus,
    lastSavedAt: null as Date | null,
    isAppReady: true,
  };
  return render(<EditorStatusBar {...defaults} {...overrides} />);
}

describe('EditorStatusBar', () => {
  describe('save status display', () => {
    it('shows "Saved" for saved status', () => {
      renderBar({ saveStatus: 'saved' });
      expect(screen.getByText('Saved')).toBeTruthy();
    });

    it('shows "Saving…" for saving status', () => {
      renderBar({ saveStatus: 'saving' });
      expect(screen.getByText('Saving…')).toBeTruthy();
    });

    it('shows "Unsaved changes" for unsaved status', () => {
      renderBar({ saveStatus: 'unsaved' });
      expect(screen.getByText('Unsaved changes')).toBeTruthy();
    });

    it('shows "Save failed" for error status', () => {
      renderBar({ saveStatus: 'error' });
      expect(screen.getByText('Save failed')).toBeTruthy();
    });

    it('shows "Offline" when isAppReady is false regardless of saveStatus', () => {
      renderBar({ saveStatus: 'saved', isAppReady: false });
      expect(screen.getByText('Offline')).toBeTruthy();
      expect(screen.queryByText('Saved')).toBeNull();
    });
  });

  describe('word and character counts use visible text', () => {
    it('counts words from editor textContent, not raw HTML', () => {
      renderBar({ editor: fakeEditor('one two three') });
      expect(screen.getByText('3 words')).toBeTruthy();
    });

    it('counts characters from editor textContent', () => {
      renderBar({ editor: fakeEditor('abc') });
      expect(screen.getByText('3 characters')).toBeTruthy();
    });

    it('shows 0 words and 0 characters when editor is null', () => {
      renderBar({ editor: null });
      expect(screen.getByText('0 words')).toBeTruthy();
      expect(screen.getByText('0 characters')).toBeTruthy();
    });
  });

  describe('last saved timestamp', () => {
    it('shows formatted time when lastSavedAt is provided', () => {
      const date = new Date(2025, 0, 15, 14, 30);
      renderBar({ lastSavedAt: date });
      expect(screen.getByText(/Last saved/)).toBeTruthy();
    });

    it('hides timestamp when lastSavedAt is null', () => {
      renderBar({ lastSavedAt: null });
      expect(screen.queryByText(/Last saved/)).toBeNull();
    });
  });

  describe('document name display', () => {
    it('renders the document name', () => {
      renderBar({ documentName: 'My Report' });
      expect(screen.getByText('My Report')).toBeTruthy();
    });
  });

  describe('no simulated timers', () => {
    it('does not use setTimeout or setInterval internally', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const callsBefore = setTimeoutSpy.mock.calls.length + setIntervalSpy.mock.calls.length;

      renderBar();

      const callsAfter = setTimeoutSpy.mock.calls.length + setIntervalSpy.mock.calls.length;
      expect(callsAfter).toBe(callsBefore);

      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });
  });
});
