// The landing page's connect dialog offers BOTH ways in. `LoginModal` has no
// tabs unless it is handed `cloud`, and this popup used to mount it bare, so
// an app whose front door is the landing page had no account sign-in on it.
// The real `LoginModal` renders here; only the two hooks are stood in, the
// way the other suites stand in `useMero`.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import LoginPopup from '../pages/landing/loginPopup';

const enrolment = {
  goToWallet: vi.fn(() => Promise.resolve()),
  note: null as string | null,
  returning: false,
  walletUrl: 'https://wallet.example',
  customWallet: false,
};
const connectToNode = vi.fn();

vi.mock('@calimero-network/mero-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@calimero-network/mero-react')>();
  return {
    ...actual,
    useMero: () => ({ connectToNode }),
    useAccountEnrolment: () => enrolment,
  };
});


afterEach(() => {
  cleanup();
  enrolment.returning = false;
  enrolment.note = null;
});

describe('landing login popup', () => {
  it('offers a Node tab and a Cloud tab, Node first', () => {
    render(<LoginPopup isOpen onClose={() => {}} />);
    const node = screen.getByRole('tab', { name: 'Node' });
    const cloud = screen.getByRole('tab', { name: 'Cloud' });
    expect(node.getAttribute('aria-selected')).toBe('true');
    expect(cloud.getAttribute('aria-selected')).toBe('false');
  });

  it('the Cloud tab starts enrolment at the wallet', () => {
    render(<LoginPopup isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enrol with your account' }));
    expect(enrolment.goToWallet).toHaveBeenCalled();
  });

  it('opens itself on the Cloud tab when the tab comes back from the wallet', () => {
    enrolment.returning = true;
    enrolment.note = 'Connected, but this account has no relay yet.';
    const onClose = vi.fn();
    // The landing page has NOT opened it: this is the page load after the redirect.
    render(<LoginPopup isOpen={false} onClose={onClose} />);
    expect(screen.getByRole('tab', { name: 'Cloud' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(enrolment.note)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: 'Cloud' })).toBeNull();
  });

  it('stays closed when the landing has not opened it and nothing came back', () => {
    render(<LoginPopup isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('tab', { name: 'Cloud' })).toBeNull();
  });
});
