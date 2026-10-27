// The landing page's connect dialog: sign in with a passkey on the cluster, or
// create an account with one. The real `LoginModal` renders here under a stub
// `MeroContext.Provider`, the way the workspace suites mount things.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MeroContext } from '@calimero-apps/cloud';

import LoginPopup from '../pages/landing/loginPopup';

const connectToNode = vi.fn();

function mount(props: { isOpen: boolean; onClose: () => void }) {
  return render(
    <MeroContext.Provider value={{ connectToNode } as any}>
      <LoginPopup {...props} />
    </MeroContext.Provider>,
  );
}

afterEach(() => cleanup());

describe('landing login popup', () => {
  it('offers passkey sign-in on the cluster, and account creation', () => {
    mount({ isOpen: true, onClose: () => {} });
    expect(screen.getByRole('dialog', { name: 'Sign in to Calimero' })).toBeTruthy();
    expect(screen.getByLabelText('Cluster URL')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account with a passkey' })).toBeTruthy();
  });

  it('closes on the close button', () => {
    const onClose = vi.fn();
    mount({ isOpen: true, onClose });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays closed when the landing has not opened it', () => {
    mount({ isOpen: false, onClose: () => {} });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
