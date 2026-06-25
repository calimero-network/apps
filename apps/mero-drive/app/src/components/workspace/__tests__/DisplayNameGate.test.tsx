import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisplayNameGate } from '../DisplayNameGate';

const dnMock = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns1', selfIdentity: 'me' }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  MAX_DISPLAY_NAME_LEN: 64,
  useMemberDisplayName: () => dnMock(),
}));

const setName = vi.fn().mockResolvedValue(undefined);

describe('DisplayNameGate', () => {
  beforeEach(() => {
    dnMock.mockReset();
    setName.mockClear();
    localStorage.clear();
  });

  it('stays hidden on refresh when a name was set before, even if the hook returns null', () => {
    // Regression for the "gate shows on every refresh" bug: the persisted
    // marker means we already know this member has a name, so a flaky
    // post-refresh fetch returning null must not re-show the gate.
    localStorage.setItem('mero-name-set:ns1:me', '1');
    dnMock.mockReturnValue({ name: null, loading: false, error: null, setName });
    render(<DisplayNameGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing while the name is loading', () => {
    dnMock.mockReturnValue({ name: null, loading: true, error: null, setName });
    render(<DisplayNameGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing when a name is already set', () => {
    dnMock.mockReturnValue({ name: 'Ana', loading: false, error: null, setName });
    render(<DisplayNameGate />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks and saves when the name is null', async () => {
    dnMock.mockReturnValue({ name: null, loading: false, error: null, setName });
    render(<DisplayNameGate />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Your display name'), {
      target: { value: '  Ana Ruiz  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(setName).toHaveBeenCalledWith('Ana Ruiz'));
  });

  it('closes after a successful save even if the hook name stays null', async () => {
    // Regression for mero-drive#42: useMemberMetadata can fail to
    // rehydrate after a write, so `name` stays null even though the PUT
    // succeeded. The gate must still close on a successful setName.
    dnMock.mockReturnValue({ name: null, loading: false, error: null, setName });
    render(<DisplayNameGate />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Your display name'), {
      target: { value: 'Ronit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cannot submit an empty or whitespace-only name', () => {
    dnMock.mockReturnValue({ name: null, loading: false, error: null, setName });
    render(<DisplayNameGate />);
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Your display name'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(setName).not.toHaveBeenCalled();
  });

  it('cannot submit a name longer than the max length', () => {
    dnMock.mockReturnValue({ name: null, loading: false, error: null, setName });
    render(<DisplayNameGate />);
    fireEvent.change(screen.getByPlaceholderText('Your display name'), { target: { value: 'a'.repeat(65) } });
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(setName).not.toHaveBeenCalled();
  });
});
