import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from '../dialog';

// Opened from plain state, with no Dialog.Trigger for Radix to return focus to.
function Harness({
  onCloseAutoFocus,
  withAutoFocusField = false,
}: {
  onCloseAutoFocus?: (e: Event) => void;
  withAutoFocusField?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Details</DialogTitle>
          {withAutoFocusField && <input aria-label="Name" autoFocus />}
        </DialogContent>
      </Dialog>
    </>
  );
}

async function openThenEscape(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('dialog', { name: 'Details' });
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  return user;
}

// Enter reopens the dialog only if focus went back to the opener.
describe('DialogContent', () => {
  it('returns focus to whatever opened it', async () => {
    const user = await openThenEscape();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeTruthy();
  });

  // React focuses an autoFocus field before Radix's own open autofocus runs.
  it('returns focus to the opener when a field inside takes autofocus', async () => {
    const user = await openThenEscape({ withAutoFocusField: true });
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeTruthy();
  });

  it("leaves focus alone when the caller's onCloseAutoFocus prevents it", async () => {
    const user = await openThenEscape({
      onCloseAutoFocus: (e) => e.preventDefault(),
    });
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
